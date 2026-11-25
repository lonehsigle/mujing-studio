/** 幕境 host 服务 `ctx.mujing`：画布存储 + 图/视/音生成 + 小说→短剧流水线 + 时间线合成与剪映草稿导出。 */

import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import {
  buildEpisodeCaptions,
  buildEpisodeSegments,
  collectSegmentCastRefs,
  collectShotCastRefs,
  compileShotKeyframePrompt,
  ensureDrama,
  formatEpisodeMarkdown,
} from './drama.ts'
import {
  buildSrt,
  defaultJianyingDraftRoot,
  safeName,
  writeJianyingDraftToDisk,
  type JianyingAudioClip,
  type JianyingCaption,
  type JianyingClip,
} from './jianying.ts'
import {
  MediaService,
  type AudioProviderConfig,
  type ImageProviderConfig,
  type VideoProviderConfig,
} from './media.ts'
import { CanvasOpError, ProjectStore, shortId } from './store.ts'
import type {
  CanvasNode,
  CanvasProject,
  DramaCast,
  DramaData,
  DramaEpisode,
  DramaShot,
  HandoffMode,
  TimelineAudioClip,
  TimelineClip,
  TimelineState,
} from './types.ts'

/** 有限并发映射，避免对上游生图/音频 API 无上限并发突发触发 429 限流。 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const poolSize = Math.max(1, Math.min(limit, items.length))
  await Promise.all(
    Array.from({ length: poolSize }, async () => {
      while (nextIndex < items.length) {
        const cur = nextIndex++
        results[cur] = await worker(items[cur], cur)
      }
    }),
  )
  return results
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mujing: MujingService
  }
}

export interface Config {
  dataDir?: string
  image: ImageProviderConfig
  video: VideoProviderConfig
  audio: AudioProviderConfig
}

export const Config: Schema<Config> = z.object({
  dataDir: z.string().description('画布与资产数据目录，默认 $DSH_HOME/mujing'),
  image: z.object({
    baseURL: z.string().description('OpenAI 兼容图片服务地址（含 /v1）'),
    apiKeyEnv: z.string().default('MUJING_IMAGE_API_KEY').description('保存图片服务密钥的环境变量名'),
    model: z.string().default('gpt-image-1'),
    size: z.string().default('1024x1024'),
    flavor: z.union(['openai', 'ark']).default('openai'),
  }).default({}),
  video: z.object({
    baseURL: z.string().description('视频服务地址：OpenAI 兼容（/v1）或火山方舟（https://ark.cn-beijing.volces.com/api/v3）'),
    apiKeyEnv: z.string().default('MUJING_VIDEO_API_KEY'),
    model: z.string().default('doubao-seedance-1-0-pro-250528'),
    flavor: z.union(['openai', 'ark']).default('ark'),
    duration: z.number().default(5),
    ratio: z.string().default('16:9'),
    pollIntervalMs: z.number().default(5000),
    timeoutMs: z.number().default(15 * 60_000),
  }).default({}),
  audio: z.object({
    baseURL: z.string().description('OpenAI 兼容语音合成服务地址（含 /v1）'),
    apiKeyEnv: z.string().default('MUJING_AUDIO_API_KEY').description('保存语音服务密钥的环境变量名'),
    model: z.string().default('gpt-4o-mini-tts'),
    voice: z.string().default('alloy'),
    format: z.union(['mp3', 'wav']).default('mp3'),
  }).default({}),
})

export type GenerateKind = 'image' | 'video' | 'audio'

export interface GenerateRequest {
  projectId: string
  kind: GenerateKind
  prompt: string
  /** 已有节点则在其上生成，否则新建节点。 */
  nodeId?: string
  title?: string
  x?: number
  y?: number
  size?: string
  duration?: number
  ratio?: string
  voice?: string
  /** 参考/首帧节点 id：取其媒体 url。 */
  referenceNodeIds?: string[]
  /** 直接传入的首帧地址（如短剧流水线抽取出的上一段尾帧）。 */
  firstFrameUrl?: string
  /** 直接传入的附加参考图地址（如角色三视图锁定资产）。 */
  extraRefUrls?: string[]
}

export class MujingService extends Service {
  readonly store: ProjectStore
  readonly media: MediaService
  readonly dataDir: string
  /** UI 当前打开的画布；Agent 工具缺省 project_id 时使用。 */
  activeProjectId: string | undefined
  /** 进行中的生成任务，key 为节点 id 或任务键。 */
  private readonly running = new Map<string, AbortController>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'mujing')
    this.dataDir = config.dataDir ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'mujing')
    this.store = new ProjectStore(this.dataDir)
    this.media = new MediaService(this.dataDir, config.image, config.video, config.audio)
    ctx.effect(() => () => {
      for (const c of this.running.values()) c.abort(new Error('mujing 插件已卸载'))
      this.running.clear()
    })
  }

  /** 解析 Agent 传入的项目 id：缺省取当前画布，再缺省取最近更新的画布。 */
  async resolveProjectId(id?: string): Promise<string> {
    if (id) return id
    if (this.activeProjectId) return this.activeProjectId
    const [latest] = await this.store.list()
    if (latest === undefined) throw new CanvasOpError('还没有任何画布：先调用 canvas_create_project 创建一个')
    return latest.id
  }

  isRunning(nodeId: string): boolean {
    return this.running.has(nodeId)
  }

  /**
   * 在节点上发起生成（image / video / audio）：立即把节点置为 loading 并返回 `{ nodeId, done }`。
   */
  async startGeneration(req: GenerateRequest, signal?: AbortSignal): Promise<{ nodeId: string; done: Promise<CanvasNode> }> {
    const project = await this.store.get(req.projectId)
    const refs = (req.referenceNodeIds ?? []).map(id => {
      const node = project.nodes.find(n => n.id === id)
      if (node === undefined) throw new CanvasOpError(`参考节点不存在：${id}`)
      if (!node.url) throw new CanvasOpError(`参考节点 ${id} 还没有媒体内容`)
      return node.url
    })
    let nodeId = req.nodeId
    if (nodeId === undefined) {
      const { created } = await this.store.apply(req.projectId, [{
        op: 'add_node', type: req.kind, title: req.title, prompt: req.prompt, voice: req.voice, x: req.x, y: req.y,
      }])
      nodeId = created[0]
      for (const ref of req.referenceNodeIds ?? []) {
        await this.store.apply(req.projectId, [{ op: 'connect', source: ref, target: nodeId }])
      }
    } else {
      const node = project.nodes.find(n => n.id === nodeId)
      if (node === undefined) throw new CanvasOpError(`节点不存在：${nodeId}`)
      if (node.type !== req.kind) throw new CanvasOpError(`节点 ${nodeId} 是 ${node.type} 节点，不能生成 ${req.kind}`)
      if (this.running.has(nodeId)) throw new CanvasOpError(`节点 ${nodeId} 正在生成中`)
    }
    const id = nodeId
    await this.store.apply(req.projectId, [{
      op: 'update_node', id, prompt: req.prompt, ...(req.voice !== undefined ? { voice: req.voice } : {}), status: 'loading', error: '',
    }], false)

    const controller = new AbortController()
    const onAbort = (): void => controller.abort(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    this.running.set(id, controller)

    const done = (async (): Promise<CanvasNode> => {
      let patch: { url?: string; model?: string; durationMs?: number; status: 'success' | 'error'; error: string }
      try {
        if (req.kind === 'image') {
          const allRefs = [...refs, ...(req.extraRefUrls ?? [])]
          const out = await this.media.generateImage({ prompt: req.prompt, size: req.size, refs: allRefs }, controller.signal)
          patch = { url: out.url, model: out.model, status: 'success', error: '' }
        } else if (req.kind === 'video') {
          const firstFrame = req.firstFrameUrl ?? refs[0]
          const extraRefs = [...(req.firstFrameUrl ? refs : refs.slice(1)), ...(req.extraRefUrls ?? [])]
          const out = await this.media.generateVideo({
            prompt: req.prompt, duration: req.duration, ratio: req.ratio, firstFrame, extraRefs,
          }, controller.signal)
          patch = { url: out.url, model: out.model, durationMs: out.durationMs, status: 'success', error: '' }
        } else {
          const out = await this.media.generateAudio({ prompt: req.prompt, voice: req.voice }, controller.signal)
          patch = { url: out.url, model: out.model, durationMs: out.durationMs, status: 'success', error: '' }
        }
      } catch (error) {
        patch = { status: 'error', error: error instanceof Error ? error.message : String(error) }
      } finally {
        signal?.removeEventListener('abort', onAbort)
        this.running.delete(id)
      }
      try {
        const { project: next } = await this.store.apply(req.projectId, [{ op: 'update_node', id, ...patch }], false)
        return next.nodes.find(n => n.id === id) ?? { id, type: req.kind, x: 0, y: 0, width: 0, height: 0, ...patch }
      } catch {
        return { id, type: req.kind, x: 0, y: 0, width: 0, height: 0, ...patch }
      }
    })()
    return { nodeId: id, done }
  }

  cancelGeneration(nodeId: string): boolean {
    const c = this.running.get(nodeId)
    if (c === undefined) return false
    c.abort(new Error('用户取消'))
    return true
  }

  /* ───────────────────────── 短剧制作流水线编排 ───────────────────────── */

  /** 保存/增量更新短剧世界观、小说原文、角色设定与分集分镜；自动重算各集视频段提示词。 */
  async saveDrama(projectId: string, patch: {
    genre?: string
    logline?: string
    style?: string
    aspectRatio?: '16:9' | '9:16' | '1:1'
    language?: string
    segmentTargetSec?: number
    novelText?: string
    casts?: Array<Partial<DramaCast> & { name: string }>
    episodes?: Array<{
      id?: string
      number: number
      title: string
      synopsis?: string
      hook?: string
      cliffhanger?: string
      sourceText?: string
      shots?: Array<Partial<DramaShot> & { action: string }>
    }>
    syncCanvasNodes?: boolean
  }): Promise<CanvasProject> {
    let updated = await this.store.updateDomain(projectId, p => {
      const d = ensureDrama(p)
      if (patch.genre !== undefined) d.genre = patch.genre.trim() || undefined
      if (patch.logline !== undefined) d.logline = patch.logline.trim() || undefined
      if (patch.style !== undefined) d.style = patch.style.trim() || d.style
      if (patch.aspectRatio !== undefined) d.aspectRatio = patch.aspectRatio
      if (patch.language !== undefined) d.language = patch.language.trim() || d.language
      if (patch.segmentTargetSec !== undefined && patch.segmentTargetSec >= 3 && patch.segmentTargetSec <= 15) {
        d.segmentTargetSec = patch.segmentTargetSec
      }
      if (patch.novelText !== undefined) d.novelText = patch.novelText

      if (patch.casts !== undefined) {
        const prevByName = new Map(d.casts.map(c => [c.name, c]))
        const prevById = new Map(d.casts.map(c => [c.id, c]))
        d.casts = patch.casts.map(c => {
          const prev = (c.id ? prevById.get(c.id) : undefined) ?? prevByName.get(c.name)
          const kind = c.kind ?? prev?.kind ?? 'character'
          const appearance = c.appearance?.trim() || prev?.appearance || ''
          const defaultImgPrompt = kind === 'character'
            ? `${c.name}，角色设定三视图（正面、侧面、背面全身与面部特写），白底设定卡，${appearance}，${d.style}`
            : `${c.name}，${appearance}，${d.style}`
          return {
            id: c.id ?? prev?.id ?? shortId('cast'),
            kind,
            name: c.name.trim(),
            ...(c.role ?? prev?.role ? { role: c.role ?? prev?.role } : {}),
            appearance,
            imagePrompt: c.imagePrompt?.trim() || prev?.imagePrompt || defaultImgPrompt,
            ...(c.voice ?? prev?.voice ? { voice: c.voice ?? prev?.voice } : {}),
            ...(c.imageNodeId ?? prev?.imageNodeId ? { imageNodeId: c.imageNodeId ?? prev?.imageNodeId } : {}),
            ...(c.imageUrl ?? prev?.imageUrl ? { imageUrl: c.imageUrl ?? prev?.imageUrl } : {}),
            locked: c.locked ?? prev?.locked ?? false,
          } satisfies DramaCast
        })
      }

      if (patch.episodes !== undefined) {
        const prevByNum = new Map(d.episodes.map(e => [e.number, e]))
        const prevById = new Map(d.episodes.map(e => [e.id, e]))
        d.episodes = patch.episodes.map(ep => {
          const prev = (ep.id ? prevById.get(ep.id) : undefined) ?? prevByNum.get(ep.number)
          const prevShotsById = new Map((prev?.shots ?? []).map(s => [s.id, s]))
          const shots: DramaShot[] = ep.shots !== undefined
            ? ep.shots.map((s, idx) => {
              const prevShot = (s.id ? prevShotsById.get(s.id) : undefined) ?? prev?.shots[idx]
              return {
                id: s.id ?? prevShot?.id ?? shortId('shot'),
                segmentIndex: typeof s.segmentIndex === 'number' ? s.segmentIndex : (prevShot?.segmentIndex ?? 0),
                scene: s.scene?.trim() || prevShot?.scene || '主场景',
                shotSize: s.shotSize?.trim() || prevShot?.shotSize || '中景',
                camera: s.camera?.trim() || prevShot?.camera || '固定',
                action: s.action.trim(),
                ...(s.imagePrompt ?? prevShot?.imagePrompt ? { imagePrompt: s.imagePrompt ?? prevShot?.imagePrompt } : {}),
                ...(s.videoPrompt ?? prevShot?.videoPrompt ? { videoPrompt: s.videoPrompt ?? prevShot?.videoPrompt } : {}),
                ...(s.speaker !== undefined ? (s.speaker ? { speaker: s.speaker } : {}) : (prevShot?.speaker ? { speaker: prevShot.speaker } : {})),
                ...(s.dialogue !== undefined ? (s.dialogue ? { dialogue: s.dialogue } : {}) : (prevShot?.dialogue ? { dialogue: prevShot.dialogue } : {})),
                durationMs: typeof s.durationMs === 'number' && s.durationMs >= 1500 ? Math.round(s.durationMs) : (prevShot?.durationMs ?? 3500),
                ...(s.castIds ?? prevShot?.castIds ? { castIds: s.castIds ?? prevShot?.castIds } : {}),
                ...(s.transition ?? prevShot?.transition ? { transition: s.transition ?? prevShot?.transition } : {}),
                ...(s.keyframeNodeId ?? prevShot?.keyframeNodeId ? { keyframeNodeId: s.keyframeNodeId ?? prevShot?.keyframeNodeId } : {}),
                ...(s.keyframeUrl ?? prevShot?.keyframeUrl ? { keyframeUrl: s.keyframeUrl ?? prevShot?.keyframeUrl } : {}),
                ...(s.audioNodeId ?? prevShot?.audioNodeId ? { audioNodeId: s.audioNodeId ?? prevShot?.audioNodeId } : {}),
                ...(s.audioUrl ?? prevShot?.audioUrl ? { audioUrl: s.audioUrl ?? prevShot?.audioUrl } : {}),
              }
            })
            : (prev?.shots ?? [])
          const nextEp: DramaEpisode = {
            id: ep.id ?? prev?.id ?? shortId('ep'),
            number: ep.number,
            title: ep.title.trim() || `第${ep.number}集`,
            synopsis: ep.synopsis ?? prev?.synopsis ?? '',
            ...(ep.hook ?? prev?.hook ? { hook: ep.hook ?? prev?.hook } : {}),
            ...(ep.cliffhanger ?? prev?.cliffhanger ? { cliffhanger: ep.cliffhanger ?? prev?.cliffhanger } : {}),
            ...(ep.sourceText ?? prev?.sourceText ? { sourceText: ep.sourceText ?? prev?.sourceText } : {}),
            shots,
            segments: [],
            ...(prev?.finalVideoUrl ? { finalVideoUrl: prev.finalVideoUrl } : {}),
            ...(prev?.subtitleSrt ? { subtitleSrt: prev.subtitleSrt } : {}),
          }
          nextEp.segments = buildEpisodeSegments(d, nextEp, prev?.segments)
          nextEp.subtitleSrt = buildEpisodeCaptions(nextEp).srt
          return nextEp
        }).sort((a, b) => a.number - b.number)
      } else {
        // 世界观或画幅变更后重算现有剧集分段提示词
        for (const ep of d.episodes) {
          ep.segments = buildEpisodeSegments(d, ep, ep.segments)
        }
      }
    })

    if (patch.syncCanvasNodes !== false) {
      updated = await this.syncDramaToCanvas(projectId)
    }
    return updated
  }

  /** 修改、新增或删除单集中的分镜条目，并自动重算该集剧情分段提示词与字幕（默认保留既有分段归属）。 */
  async updateDramaShot(projectId: string, episodeIdOrNum: string | number, input: {
    shotId?: string
    shotIndex?: number
    delete?: boolean
    resegment?: boolean
    patch?: Partial<DramaShot>
  }): Promise<CanvasProject> {
    const updated = await this.store.updateDomain(projectId, p => {
      const d = ensureDrama(p)
      const ep = d.episodes.find(e => e.id === episodeIdOrNum || e.number === Number(episodeIdOrNum))
      if (!ep) throw new CanvasOpError(`找不到剧集：${String(episodeIdOrNum)}`)
      const idx = input.shotId
        ? ep.shots.findIndex(s => s.id === input.shotId)
        : typeof input.shotIndex === 'number' ? input.shotIndex : -1
      if (input.delete) {
        if (idx < 0 || idx >= ep.shots.length) throw new CanvasOpError('找不到要删除的分镜')
        ep.shots.splice(idx, 1)
      } else if (idx >= 0 && idx < ep.shots.length) {
        const cur = ep.shots[idx]
        const sp = input.patch ?? {}
        if (sp.scene !== undefined) cur.scene = sp.scene.trim() || cur.scene
        if (sp.shotSize !== undefined) cur.shotSize = sp.shotSize.trim() || cur.shotSize
        if (sp.camera !== undefined) cur.camera = sp.camera.trim() || cur.camera
        if (sp.action !== undefined) cur.action = sp.action.trim() || cur.action
        if (sp.imagePrompt !== undefined) cur.imagePrompt = sp.imagePrompt.trim() || undefined
        if (sp.videoPrompt !== undefined) cur.videoPrompt = sp.videoPrompt.trim() || undefined
        if (sp.speaker !== undefined) cur.speaker = sp.speaker.trim() || undefined
        if (sp.dialogue !== undefined) cur.dialogue = sp.dialogue.trim() || undefined
        if (typeof sp.durationMs === 'number' && sp.durationMs >= 1500) cur.durationMs = Math.round(sp.durationMs)
        if (sp.transition !== undefined) cur.transition = sp.transition
        if (typeof sp.segmentIndex === 'number' && Number.isInteger(sp.segmentIndex) && sp.segmentIndex >= 0) {
          cur.segmentIndex = sp.segmentIndex
        }
      } else {
        const sp = input.patch ?? {}
        if (!sp.action?.trim()) throw new CanvasOpError('新增分镜必须填写画面动作描述')
        const lastShot = ep.shots.at(-1)
        const scene = sp.scene?.trim() || lastShot?.scene || '主场景'
        const durMs = typeof sp.durationMs === 'number' && sp.durationMs >= 1500 ? Math.round(sp.durationMs) : 3500
        let defaultSegIndex = 0
        if (typeof sp.segmentIndex === 'number' && Number.isInteger(sp.segmentIndex) && sp.segmentIndex >= 0) {
          defaultSegIndex = sp.segmentIndex
        } else if (ep.segments.length > 0 && lastShot) {
          const lastSegIdx = Math.max(0, lastShot.segmentIndex)
          const lastSegShots = ep.shots.filter(s => s.segmentIndex === lastSegIdx)
          const lastSegMs = lastSegShots.reduce((acc, s) => acc + Math.max(1500, s.durationMs || 3000), 0)
          const maxMs = Math.max(3000, Math.min(15_000, Math.round((d.segmentTargetSec || 8) * 1000)))
          const sameScene = !lastShot.scene || scene === lastShot.scene
          defaultSegIndex = sameScene && lastSegMs + durMs <= maxMs && lastSegShots.length < 4
            ? lastSegIdx
            : lastSegIdx + 1
        }
        ep.shots.push({
          id: shortId('shot'),
          segmentIndex: defaultSegIndex,
          scene,
          shotSize: sp.shotSize?.trim() || '中景',
          camera: sp.camera?.trim() || '固定',
          action: sp.action.trim(),
          ...(sp.imagePrompt?.trim() ? { imagePrompt: sp.imagePrompt.trim() } : {}),
          ...(sp.speaker?.trim() ? { speaker: sp.speaker.trim() } : {}),
          ...(sp.dialogue?.trim() ? { dialogue: sp.dialogue.trim() } : {}),
          durationMs: durMs,
          ...(sp.transition ? { transition: sp.transition } : {}),
        })
      }
      // 仅在显式请求 resegment 时才清空手工段号重新自动切段；常规编辑保留每镜既有段归属
      if (input.resegment) {
        for (const s of ep.shots) s.segmentIndex = 0
      }
      ep.segments = buildEpisodeSegments(d, ep, ep.segments)
      ep.subtitleSrt = buildEpisodeCaptions(ep).srt
    })
    return this.syncDramaToCanvas(projectId).catch(() => updated)
  }

  /** 为单镜或整集生成故事板关键帧图片（keyframe）或角色台词配音（audio）。 */
  async generateDramaShotMedia(
    projectId: string,
    episodeIdOrNum: string | number,
    options: { kind: 'keyframe' | 'audio'; shotId?: string; shotIndex?: number },
    signal?: AbortSignal,
  ): Promise<{ episodeId: string; kind: 'keyframe' | 'audio'; generated: Array<{ shotId: string; shotNumber: number; url?: string; error?: string }> }> {
    await this.syncDramaToCanvas(projectId)
    const project = await this.store.get(projectId)
    const drama = project.drama
    if (!drama) throw new CanvasOpError('当前项目尚未配置短剧流水线')
    const ep = drama.episodes.find(e => e.id === episodeIdOrNum || e.number === Number(episodeIdOrNum))
    if (!ep) throw new CanvasOpError(`找不到剧集：${String(episodeIdOrNum)}`)

    const targets = ep.shots
      .map((shot, idx) => ({ shot, shotNumber: idx + 1 }))
      .filter(({ shot, shotNumber }) => {
        if (options.shotId) return shot.id === options.shotId
        if (typeof options.shotIndex === 'number') return shotNumber - 1 === options.shotIndex
        return options.kind === 'audio' ? Boolean(shot.dialogue?.trim()) : true
      })

    if (targets.length === 0) {
      throw new CanvasOpError(options.kind === 'audio' ? '目标镜头没有可朗读的台词' : '找不到目标分镜')
    }

    const size = drama.aspectRatio === '9:16' ? '1024x1536' : drama.aspectRatio === '16:9' ? '1536x1024' : '1024x1024'
    const results: Array<{ shotId: string; shotNumber: number; nodeId?: string; url?: string; error?: string }> = []

    for (const { shot, shotNumber } of targets) {
      if (options.kind === 'keyframe') {
        const prompt = compileShotKeyframePrompt(drama, shot)
        const refs = collectShotCastRefs(project, [shot])
        const { nodeId, done } = await this.startGeneration({
          projectId,
          kind: 'image',
          nodeId: shot.keyframeNodeId,
          title: `第${ep.number}集·镜${shotNumber}关键帧`,
          prompt,
          size,
          extraRefUrls: refs,
          x: 80 + (shotNumber - 1) * 340,
          y: 780 + (ep.number - 1) * 360,
        }, signal)
        const finalNode = await done
        results.push({ shotId: shot.id, shotNumber, nodeId, url: finalNode.url, error: finalNode.error })
      } else {
        const dlg = shot.dialogue?.trim()
        if (!dlg) continue
        const speakerCast = shot.speaker ? drama.casts.find(c => c.name === shot.speaker) : undefined
        const voice = speakerCast?.voice || undefined
        const { nodeId, done } = await this.startGeneration({
          projectId,
          kind: 'audio',
          nodeId: shot.audioNodeId,
          title: `第${ep.number}集·镜${shotNumber}配音${shot.speaker ? `·${shot.speaker}` : ''}`,
          prompt: dlg,
          voice,
          x: 80 + (shotNumber - 1) * 340,
          y: 1120 + (ep.number - 1) * 200,
        }, signal)
        const finalNode = await done
        results.push({ shotId: shot.id, shotNumber, nodeId, url: finalNode.url, error: finalNode.error })
      }
    }

    await this.store.updateDomain(projectId, p => {
      const targetEp = p.drama?.episodes.find(e => e.id === ep.id)
      if (!targetEp) return
      for (const r of results) {
        const s = targetEp.shots.find(item => item.id === r.shotId)
        if (!s) continue
        if (options.kind === 'keyframe') {
          if (r.nodeId) s.keyframeNodeId = r.nodeId
          if (r.url) s.keyframeUrl = r.url
        } else {
          if (r.nodeId) s.audioNodeId = r.nodeId
          if (r.url) s.audioUrl = r.url
        }
      }
    }, false)

    return {
      episodeId: ep.id,
      kind: options.kind,
      generated: results.map(({ shotId, shotNumber, url, error }) => ({ shotId, shotNumber, ...(url ? { url } : {}), ...(error ? { error } : {}) })),
    }
  }

  /** 修改某一段的接续模式（handoff）或自定义提示词。 */
  async updateDramaSegment(projectId: string, episodeId: string, segmentIndex: number, patch: {
    handoff?: HandoffMode
    prompt?: string
  }): Promise<CanvasProject> {
    return this.store.updateDomain(projectId, p => {
      const d = ensureDrama(p)
      const ep = d.episodes.find(e => e.id === episodeId || String(e.number) === episodeId)
      if (!ep) throw new CanvasOpError(`剧集不存在：${episodeId}`)
      const seg = ep.segments.find(s => s.index === segmentIndex)
      if (!seg) throw new CanvasOpError(`分段不存在：${segmentIndex}`)
      if (patch.handoff !== undefined) {
        seg.handoff = patch.handoff
        if (patch.prompt === undefined) {
          const rebuilt = buildEpisodeSegments(d, ep, ep.segments)
          const target = rebuilt.find(s => s.index === segmentIndex)
          if (target) seg.prompt = target.prompt
        }
      }
      if (patch.prompt !== undefined) seg.prompt = patch.prompt
    })
  }

  /** 将短剧的角色设定卡与分集剧本映射/更新到画布节点上，实现「流水线 ↔ 无限画布」双向贯通。 */
  async syncDramaToCanvas(projectId: string): Promise<CanvasProject> {
    return this.store.updateDomain(projectId, p => {
      const d = p.drama
      if (!d) return
      // 第 1 行（y=60）：角色与场景设定图卡
      d.casts.forEach((cast, idx) => {
        const nodeId = cast.imageNodeId ?? `cast_${cast.id}`
        cast.imageNodeId = nodeId
        const existing = p.nodes.find(n => n.id === nodeId)
        const title = `${cast.kind === 'character' ? '角色' : cast.kind === 'scene' ? '场景' : '道具'} · ${cast.name}`
        if (existing) {
          existing.title = title
          existing.prompt = cast.imagePrompt
          if (existing.url) cast.imageUrl = existing.url
        } else {
          p.nodes.push({
            id: nodeId,
            type: 'image',
            x: 80 + idx * 380,
            y: 60,
            width: 320,
            height: 320,
            title,
            prompt: cast.imagePrompt,
            ...(cast.imageUrl ? { url: cast.imageUrl, status: 'success' } : { status: 'idle' }),
          })
        }
      })

      // 每一集占一行（y = 440 + epIndex * 320）：左侧剧本/分镜节点，右侧各段视频节点串联
      d.episodes.forEach((ep, epIdx) => {
        const rowY = 440 + epIdx * 320
        const scriptNodeId = `ep_script_${ep.number}`
        const md = formatEpisodeMarkdown(ep)
        const existingScript = p.nodes.find(n => n.id === scriptNodeId)
        if (existingScript) {
          existingScript.title = `第${ep.number}集剧本 · ${ep.title}`
          existingScript.content = md
        } else {
          p.nodes.push({
            id: scriptNodeId,
            type: 'text',
            x: 80,
            y: rowY,
            width: 360,
            height: 240,
            title: `第${ep.number}集剧本 · ${ep.title}`,
            content: md,
            status: 'idle',
          })
        }

        ep.segments.forEach((seg, segIdx) => {
          const vNodeId = seg.videoNodeId ?? `ep${ep.number}_seg${segIdx + 1}`
          seg.videoNodeId = vNodeId
          const existingV = p.nodes.find(n => n.id === vNodeId)
          const [vw, vh] = d.aspectRatio === '9:16' ? [216, 384] : [384, 216]
          if (existingV) {
            existingV.title = seg.title
            existingV.prompt = seg.prompt
          } else {
            p.nodes.push({
              id: vNodeId,
              type: 'video',
              x: 500 + segIdx * (vw + 80),
              y: rowY,
              width: vw,
              height: vh,
              title: seg.title,
              prompt: seg.prompt,
              status: 'idle',
            })
          }
          const prevSeg = segIdx > 0 ? ep.segments[segIdx - 1] : undefined
          const upSource = segIdx === 0 ? scriptNodeId : (prevSeg?.videoNodeId ?? `ep${ep.number}_seg${segIdx}`)
          if (!p.edges.some(e => e.source === upSource && e.target === vNodeId)) {
            p.edges.push({ id: shortId('e'), source: upSource, target: vNodeId })
          }
        })
      })
    }, false)
  }

  /** 为单个或全部未锁定的角色/场景生成设定图（三视图卡），完成后自动锁定（限流并发上限 3）。 */
  async generateDramaCastImage(projectId: string, castId?: string, signal?: AbortSignal): Promise<{ generated: Array<{ castId: string; name: string; url?: string; error?: string }> }> {
    await this.syncDramaToCanvas(projectId)
    const project = await this.store.get(projectId)
    const d = project.drama
    if (!d || d.casts.length === 0) throw new CanvasOpError('当前项目还没有角色/场景设定')
    const targets = castId
      ? d.casts.filter(c => c.id === castId || c.name === castId)
      : d.casts.filter(c => !c.locked || !c.imageUrl)
    if (targets.length === 0) return { generated: [] }

    const size = d.aspectRatio === '9:16' ? '1024x1536' : d.aspectRatio === '16:9' ? '1536x1024' : '1024x1024'
    const jobs = await mapWithConcurrency(targets, 3, async cast => {
      const { done } = await this.startGeneration({
        projectId,
        kind: 'image',
        nodeId: cast.imageNodeId,
        title: `角色 · ${cast.name}`,
        prompt: cast.imagePrompt,
        size,
      }, signal)
      const finalNode = await done
      return { castId: cast.id, name: cast.name, url: finalNode.url, error: finalNode.error }
    })

    await this.store.updateDomain(projectId, p => {
      const drama = p.drama
      if (!drama) return
      for (const res of jobs) {
        const c = drama.casts.find(item => item.id === res.castId)
        if (c && res.url) {
          c.imageUrl = res.url
          c.locked = true
        }
      }
      // 角色锁定图到位后，刷新各段提示词中的「参考图1/2」标注
      for (const ep of drama.episodes) {
        ep.segments = buildEpisodeSegments(drama, ep, ep.segments)
      }
    }, false)

    return { generated: jobs }
  }

  /**
   * 按段顺序推进单集视频生成（核心连续性保障）：
   *  - 若某段 handoff === 'continue' 且上一段已有成片，则用 FFmpeg 抽取上一段真实尾帧作为本段首帧（first_frame）；
   *  - 自动附带本段出场角色已锁定的三视图设定图（extraRefUrls）；
   *  - 可指定只跑单段（segmentIndex），或跑整集（缺省）。
   */
  async runDramaEpisode(
    projectId: string,
    episodeIdOrNum: string | number,
    options?: { segmentIndex?: number; forceRegenerate?: boolean },
    signal?: AbortSignal,
  ): Promise<{ episodeId: string; segments: Array<{ index: number; status: string; videoUrl?: string; firstFrameUrl?: string; error?: string }> }> {
    await this.syncDramaToCanvas(projectId)
    const initial = await this.store.get(projectId)
    const drama = initial.drama
    if (!drama) throw new CanvasOpError('当前项目尚未配置短剧流水线')
    const ep = drama.episodes.find(e => e.id === episodeIdOrNum || e.number === Number(episodeIdOrNum))
    if (!ep) throw new CanvasOpError(`找不到剧集：${String(episodeIdOrNum)}`)
    if (ep.segments.length === 0) throw new CanvasOpError(`第${ep.number}集还没有分镜段`)

    const indices = options?.segmentIndex !== undefined
      ? [options.segmentIndex]
      : ep.segments.map(s => s.index)

    const results: Array<{ index: number; status: string; videoUrl?: string; firstFrameUrl?: string; error?: string }> = []

    for (const idx of indices) {
      const curProj = await this.store.get(projectId)
      const curDrama = curProj.drama!
      const curEp = curDrama.episodes.find(e => e.id === ep.id)!
      const seg = curEp.segments.find(s => s.index === idx)
      if (!seg) throw new CanvasOpError(`找不到分段：${idx}`)

      const curNode = seg.videoNodeId ? curProj.nodes.find(n => n.id === seg.videoNodeId) : undefined
      if (!options?.forceRegenerate && options?.segmentIndex === undefined && curNode?.status === 'success' && curNode.url) {
        results.push({ index: idx, status: 'success', videoUrl: curNode.url, firstFrameUrl: seg.firstFrameUrl })
        continue
      }

      let firstFrameUrl: string | undefined
      const segShots = curEp.shots.filter(s => s.segmentIndex === idx)
      if (idx > 0 && seg.handoff === 'continue') {
        const prevSeg = curEp.segments.find(s => s.index === idx - 1)
        const prevNode = prevSeg?.videoNodeId ? curProj.nodes.find(n => n.id === prevSeg.videoNodeId) : undefined
        if (prevNode?.url) {
          const tail = await this.media.extractLastFrame(prevNode.url)
          if (tail) firstFrameUrl = tail
        }
      }
      // 若无上一段尾帧接续，且本段首镜已生成故事板关键帧图片，则自动以该关键帧起幅！
      if (!firstFrameUrl && segShots[0]?.keyframeUrl) {
        firstFrameUrl = segShots[0].keyframeUrl
      }

      const castRefs = collectSegmentCastRefs(curProj, curEp, seg)
      await this.store.updateDomain(projectId, p => {
        const target = p.drama?.episodes.find(e => e.id === ep.id)?.segments.find(s => s.index === idx)
        if (target) {
          target.status = 'loading'
          target.error = undefined
          if (firstFrameUrl) target.firstFrameUrl = firstFrameUrl
        }
      }, false)

      const durationSec = Math.max(3, Math.min(12, Math.round(seg.durationMs / 1000)))
      const { done } = await this.startGeneration({
        projectId,
        kind: 'video',
        nodeId: seg.videoNodeId,
        title: seg.title,
        prompt: seg.prompt,
        duration: durationSec,
        ratio: curDrama.aspectRatio,
        firstFrameUrl,
        extraRefUrls: castRefs,
      }, signal)

      const finalNode = await done
      await this.store.updateDomain(projectId, p => {
        const target = p.drama?.episodes.find(e => e.id === ep.id)?.segments.find(s => s.index === idx)
        if (target) {
          target.status = finalNode.status ?? 'error'
          target.error = finalNode.error || undefined
        }
      }, false)

      results.push({
        index: idx,
        status: finalNode.status ?? 'error',
        videoUrl: finalNode.url,
        firstFrameUrl,
        error: finalNode.error || undefined,
      })

      // 顺序流水线中某段失败则停下，方便用户重跑该段后再接续下一段尾帧
      if (finalNode.status !== 'success') break
    }

    return { episodeId: ep.id, segments: results }
  }

  /** 将某集的全部已完成分段推送到项目时间线，并可立即用 FFmpeg 合成单集成片。 */
  async populateTimelineFromEpisode(projectId: string, episodeIdOrNum: string | number, autoRender = false): Promise<CanvasProject> {
    const p = await this.store.get(projectId)
    const ep = p.drama?.episodes.find(e => e.id === episodeIdOrNum || e.number === Number(episodeIdOrNum))
    if (!ep) throw new CanvasOpError(`找不到剧集：${String(episodeIdOrNum)}`)
    const clips: TimelineClip[] = []
    for (const seg of ep.segments) {
      const vNode = seg.videoNodeId ? p.nodes.find(n => n.id === seg.videoNodeId) : undefined
      if (!vNode?.url) continue
      const segShots = ep.shots.filter(s => s.segmentIndex === seg.index)
      const caption = segShots
        .filter(s => s.dialogue?.trim())
        .map(s => (s.speaker && s.speaker !== '旁白' ? `${s.speaker}：${s.dialogue!.trim()}` : s.dialogue!.trim()))
        .join(' / ')
      const audioClips: TimelineAudioClip[] = []
      let offsetMs = 0
      for (const shot of segShots) {
        const shotDurMs = Math.max(1500, shot.durationMs || 3000)
        if (shot.audioUrl) {
          const aNode = shot.audioNodeId ? p.nodes.find(n => n.id === shot.audioNodeId) : undefined
          audioClips.push({
            url: shot.audioUrl,
            ...(shot.audioNodeId ? { nodeId: shot.audioNodeId } : {}),
            startOffsetMs: offsetMs,
            durationMs: aNode?.durationMs ?? shotDurMs,
            ...(shot.speaker ? { title: `${shot.speaker}配音` } : {}),
          })
        }
        offsetMs += shotDurMs
      }
      const firstAudio = audioClips[0]
      clips.push({
        id: shortId('clip'),
        nodeId: vNode.id,
        title: seg.title,
        url: vNode.url,
        durationMs: vNode.durationMs ?? seg.durationMs,
        ...(caption ? { caption } : {}),
        ...(firstAudio?.nodeId ? { audioNodeId: firstAudio.nodeId } : {}),
        ...(firstAudio?.url ? { audioUrl: firstAudio.url } : {}),
        ...(audioClips.length > 0 ? { audioClips } : {}),
      })
    }
    if (clips.length === 0) throw new CanvasOpError(`第${ep.number}集还没有已生成的视频片段`)
    const { srt } = buildEpisodeCaptions(ep)
    await this.store.updateDomain(projectId, proj => {
      proj.timeline = {
        clips,
        subtitleSrt: srt,
        status: 'idle',
        updatedAt: Date.now(),
      }
    })
    if (autoRender) {
      const rendered = await this.renderTimeline(projectId)
      await this.store.updateDomain(projectId, proj => {
        const target = proj.drama?.episodes.find(e => e.id === ep.id)
        if (target && rendered.timeline?.outputUrl) {
          target.finalVideoUrl = rendered.timeline.outputUrl
          target.subtitleSrt = rendered.timeline.subtitleSrt
        }
      }, false)
      return this.store.get(projectId)
    }
    return this.store.get(projectId)
  }

  /* ───────────────────────── 时间线编排、FFmpeg 合成与剪映导出 ───────────────────────── */

  /** 保存时间线片段顺序与字幕；支持直接传画布视频节点 id 自动补全 URL 与时长。 */
  async saveTimeline(projectId: string, input: {
    clips: Array<{
      id?: string
      nodeId?: string
      title?: string
      url?: string
      durationMs?: number
      caption?: string
      audioNodeId?: string
      audioUrl?: string
      audioClips?: Array<{ url?: string; nodeId?: string; startOffsetMs?: number; durationMs?: number; title?: string }>
    }>
    burnSubtitles?: boolean
  }): Promise<CanvasProject> {
    const p = await this.store.get(projectId)
    const resolved: TimelineClip[] = input.clips.map((item, idx) => {
      const vNode = item.nodeId ? p.nodes.find(n => n.id === item.nodeId) : undefined
      const url = item.url || vNode?.url
      if (!url) throw new CanvasOpError(`时间线第 ${idx + 1} 段缺少视频地址`)
      const aNode = item.audioNodeId ? p.nodes.find(n => n.id === item.audioNodeId) : undefined
      const audioUrl = item.audioUrl || aNode?.url
      const audioClips: TimelineAudioClip[] = []
      if (Array.isArray(item.audioClips)) {
        for (const ac of item.audioClips) {
          const acNode = ac.nodeId ? p.nodes.find(n => n.id === ac.nodeId) : undefined
          const acUrl = ac.url || acNode?.url
          if (!acUrl) continue
          audioClips.push({
            url: acUrl,
            ...(ac.nodeId ? { nodeId: ac.nodeId } : {}),
            ...(typeof ac.startOffsetMs === 'number' && ac.startOffsetMs >= 0 ? { startOffsetMs: Math.round(ac.startOffsetMs) } : {}),
            ...(typeof ac.durationMs === 'number' && ac.durationMs > 0 ? { durationMs: Math.round(ac.durationMs) } : {}),
            ...(ac.title ? { title: ac.title } : {}),
          })
        }
      }
      return {
        id: item.id ?? shortId('clip'),
        ...(item.nodeId ? { nodeId: item.nodeId } : {}),
        title: item.title?.trim() || vNode?.title || `片段 ${idx + 1}`,
        url,
        durationMs: item.durationMs ?? vNode?.durationMs ?? 5000,
        ...(item.caption !== undefined ? { caption: item.caption } : {}),
        ...(item.audioNodeId ? { audioNodeId: item.audioNodeId } : {}),
        ...(audioUrl ? { audioUrl } : {}),
        ...(audioClips.length > 0 ? { audioClips } : {}),
      }
    })
    const captions: JianyingCaption[] = []
    let cursorUs = 0
    for (const c of resolved) {
      const durUs = Math.max(500, c.durationMs) * 1000
      if (c.caption?.trim()) {
        captions.push({ text: c.caption.trim(), startUs: cursorUs + 100_000, durationUs: Math.max(400_000, durUs - 200_000) })
      }
      cursorUs += durUs
    }
    const subtitleSrt = buildSrt(captions)
    return this.store.updateDomain(projectId, proj => {
      const prev: Partial<TimelineState> = proj.timeline ?? {}
      proj.timeline = {
        ...prev,
        clips: resolved,
        burnSubtitles: input.burnSubtitles ?? prev.burnSubtitles ?? false,
        subtitleSrt,
        status: 'idle',
        error: undefined,
        updatedAt: Date.now(),
      }
    })
  }

  /** 使用 FFmpeg 拼接时间线中的所有片段为完整 MP4 成片，同时落盘最新对齐的 SRT 字幕资产（支持硬烧录）。 */
  async renderTimeline(projectId: string): Promise<CanvasProject> {
    const project = await this.store.get(projectId)
    const tl = project.timeline
    if (!tl || tl.clips.length === 0) throw new CanvasOpError('时间线为空：请先从画布或短剧集添加视频片段')

    await this.store.updateDomain(projectId, p => {
      if (p.timeline) { p.timeline.status = 'loading'; p.timeline.error = undefined }
    }, false)

    try {
      const aspect = project.drama?.aspectRatio
      const dims = aspect === '9:16' ? { width: 720, height: 1280 } : aspect === '1:1' ? { width: 1080, height: 1080 } : undefined

      // 先探测每段视频真实时长并重新生成对齐的 SRT，避免旧字幕时间戳偏移，同时也为字幕硬烧录提供最新 SRT
      const captions: JianyingCaption[] = []
      let cursorUs = 0
      for (const clip of tl.clips) {
        const probed = await this.media.probeMedia(clip.url).catch(() => null)
        const durMs = probed?.durationMs ?? clip.durationMs
        clip.durationMs = durMs
        const durUs = durMs * 1000
        if (clip.caption?.trim()) {
          captions.push({ text: clip.caption.trim(), startUs: cursorUs + 100_000, durationUs: Math.max(400_000, durUs - 200_000) })
        }
        cursorUs += durUs
      }
      const srt = captions.length > 0 ? buildSrt(captions) : (tl.subtitleSrt ?? '')

      const out = await this.media.concatVideos(tl.clips, {
        ...dims,
        subtitleSrt: srt,
        burnSubtitles: Boolean(tl.burnSubtitles),
      })
      const subtitleAssetUrl = srt.trim() ? await this.media.saveAsset(Buffer.from(srt, 'utf8'), '.srt') : undefined
      return await this.store.updateDomain(projectId, p => {
        if (!p.timeline) return
        p.timeline.clips = tl.clips
        p.timeline.outputUrl = out.url
        p.timeline.subtitleSrt = srt
        p.timeline.subtitleAssetUrl = subtitleAssetUrl
        p.timeline.status = 'success'
        p.timeline.error = undefined
        p.timeline.updatedAt = Date.now()
      }, false)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      await this.store.updateDomain(projectId, p => {
        if (p.timeline) { p.timeline.status = 'error'; p.timeline.error = msg }
      }, false)
      throw error
    }
  }

  /** 导出当前时间线到剪映专业版草稿目录（包含视频轨、配音音频轨与台词字幕轨）。 */
  async exportJianyingDraft(projectId: string, input: {
    draftRoot?: string
    draftName?: string
  }): Promise<{
    folderPath: string
    draftDir: string
    writtenToDisk: boolean
    reason?: string
    filesCount: number
    clipCount: number
    audioCount: number
    captionCount: number
    defaultRoot: string
    defaultMacRoot: string
  }> {
    const defaultRoot = defaultJianyingDraftRoot()
    const root = input.draftRoot?.trim() || defaultRoot
    const project = await this.store.get(projectId)
    const tl = project.timeline
    if (!tl || tl.clips.length === 0) throw new CanvasOpError('时间线为空：请先添加视频片段再导出剪映草稿')

    const jClips: JianyingClip[] = []
    const jAudios: JianyingAudioClip[] = []
    const captions: JianyingCaption[] = []
    let cursorUs = 0
    let canvasW = project.drama?.aspectRatio === '9:16' ? 1080 : 1920
    let canvasH = project.drama?.aspectRatio === '9:16' ? 1920 : 1080

    for (const [idx, clip] of tl.clips.entries()) {
      const { file } = await this.media.ensureLocalFile(clip.url, '.mp4')
      const meta = await this.media.probeMedia(file).catch(() => ({
        durationMs: clip.durationMs || 5000,
        width: canvasW,
        height: canvasH,
        hasAudio: false,
      }))
      if (idx === 0 && meta.width > 0 && meta.height > 0) {
        canvasW = meta.width
        canvasH = meta.height
      }
      const ext = extname(file) || '.mp4'
      const fileName = `${String(idx + 1).padStart(2, '0')}-${safeName(clip.title, `clip-${idx + 1}`, 40)}${ext}`
      const durUs = Math.max(500, meta.durationMs) * 1000
      jClips.push({
        fileName,
        sourceFile: file,
        name: clip.title,
        durationUs: durUs,
        width: meta.width,
        height: meta.height,
      })

      const clipAudios: TimelineAudioClip[] = clip.audioClips && clip.audioClips.length > 0
        ? clip.audioClips
        : clip.audioUrl
          ? [{ url: clip.audioUrl, nodeId: clip.audioNodeId, startOffsetMs: 0, title: `${clip.title}-配音` }]
          : []
      for (const [aIdx, aud] of clipAudios.entries()) {
        if (!aud.url) continue
        const { file: audioFile } = await this.media.ensureLocalFile(aud.url, '.mp3')
        const aMeta = await this.media.probeMedia(audioFile).catch(() => null)
        const aExt = extname(audioFile) || '.mp3'
        const aName = aud.title || `${clip.title}-配音${clipAudios.length > 1 ? aIdx + 1 : ''}`
        const aFileName = `${String(idx + 1).padStart(2, '0')}-a${String(aIdx + 1).padStart(2, '0')}-${safeName(aName, `audio-${idx + 1}-${aIdx + 1}`, 32)}${aExt}`
        const aStartUs = cursorUs + Math.max(0, Math.round(aud.startOffsetMs ?? 0)) * 1000
        const aDurUs = Math.max(200, aMeta?.durationMs ?? aud.durationMs ?? meta.durationMs) * 1000
        jAudios.push({
          fileName: aFileName,
          sourceFile: audioFile,
          name: aName,
          startUs: aStartUs,
          durationUs: aDurUs,
        })
      }

      if (clip.caption?.trim()) {
        captions.push({
          text: clip.caption.trim(),
          startUs: cursorUs + 100_000,
          durationUs: Math.max(400_000, durUs - 200_000),
        })
      }
      cursorUs += durUs
    }

    const res = await writeJianyingDraftToDisk({
      name: input.draftName?.trim() || `${project.title}-幕境草稿`,
      root,
      width: canvasW,
      height: canvasH,
      fps: 30,
      clips: jClips,
      audios: jAudios,
      captions,
    })
    return {
      ...res,
      draftDir: res.folderPath,
      clipCount: jClips.length,
      audioCount: jAudios.length,
      captionCount: captions.length,
      defaultRoot,
      defaultMacRoot: defaultRoot,
    }
  }
}
