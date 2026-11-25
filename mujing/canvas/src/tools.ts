/**
 * 幕境画布、短剧流水线与时间线合成 Agent 工具（agent plane，由「幕境导演」preset 挂载）。
 * 执行全部落在 dsh 进程内的 `ctx.mujing` 服务上。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, HarnessError, type ContextFormed } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { digestProject } from './host/digest.ts'
import type {} from './host/service.ts'
import type { CanvasOp, CanvasProject, DramaCast, DramaShot } from './host/types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'mujing-studio': { kind: 'mujing-studio' } & ContextFormed
  }
}

export const name = 'mujing-tools'
export const inject = ['tools', 'mujing', 'agents']

function formatStudioContext(p: CanvasProject | null, mediaReady: { image: boolean; video: boolean; audio: boolean }): string {
  const lines: string[] = ['<mujing_studio_context>']
  lines.push(`媒体引擎状态：生图=${mediaReady.image ? '就绪' : '未配置'}｜生视频=${mediaReady.video ? '就绪' : '未配置'}｜配音TTS=${mediaReady.audio ? '就绪' : '未配置'}`)
  if (!p) {
    lines.push('当前活动项目：无（请先调用 canvas_create_project 新建短剧/影视项目）')
  } else {
    lines.push(`当前活动项目：《${p.title}》（project_id: ${p.id}，修订 rev=${p.rev}，画布节点=${p.nodes.length}）`)
    if (p.drama) {
      const lockedCount = p.drama.casts.filter(c => c.locked && c.imageUrl).length
      lines.push(`短剧设定：画幅=${p.drama.aspectRatio}｜画风=${p.drama.style}｜角色/场景资产=${p.drama.casts.length}（已锁定三视图=${lockedCount}）｜剧集数=${p.drama.episodes.length}`)
      for (const ep of p.drama.episodes.slice(0, 5)) {
        const doneSegs = ep.segments.filter(s => s.status === 'success').length
        const kfCount = ep.shots.filter(s => s.keyframeUrl).length
        const ttsCount = ep.shots.filter(s => s.audioUrl).length
        lines.push(`- 第${ep.number}集《${ep.title}》：${ep.shots.length}镜（关键帧=${kfCount}，配音=${ttsCount}）｜视频段=${doneSegs}/${ep.segments.length}已完成${ep.finalVideoUrl ? '｜整集成片已就绪' : ''}`)
      }
    }
    if (p.timeline) {
      lines.push(`时间线状态：片段=${p.timeline.clips.length}｜合成状态=${p.timeline.status ?? 'idle'}${p.timeline.outputUrl ? `｜成片=${p.timeline.outputUrl}` : ''}`)
    }
  }
  lines.push('</mujing_studio_context>')
  return lines.join('\n')
}

/** 把领域错误转成带稳定 code 的 HarnessError，工具结果保留 code。 */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof HarnessError) throw error
    if (error instanceof Error && error.name === 'AbortError') throw error
    const code = (error as { code?: unknown }).code
    throw new HarnessError(error instanceof Error ? error.message : String(error), typeof code === 'string' ? code : 'MUJING_ERROR')
  }
}

const json = (value: unknown): [{ type: 'text'; text: string }] => [{ type: 'text', text: JSON.stringify(value, null, 1) }]

const NODE_FIELDS = {
  id: { type: 'string', description: 'add_node 可选自定义 id；其它操作为目标节点 id' },
  type: { type: 'string', enum: ['text', 'image', 'video', 'audio'], description: 'add_node 的节点类型' },
  source: { type: 'string', description: 'connect/disconnect 的源节点 id（上游，如参考图）' },
  target: { type: 'string', description: 'connect/disconnect 的目标节点 id' },
  x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
  title: { type: 'string' },
  content: { type: 'string', description: '文本节点正文（剧本、分镜表、人设等，支持 Markdown）' },
  prompt: { type: 'string', description: '图片/视频节点的生成提示词，或音频节点的待朗读台词' },
  voice: { type: 'string', description: '音频节点的音色（如 alloy / nova / shimmer / onyx）' },
  url: { type: 'string', description: '已有媒体地址' },
} as const

export function apply(ctx: Context): void {
  const mujing = ctx.mujing

  // 在每轮第 1 步自动向「幕境导演」注入当前幕境工作台实时快照（活动项目、角色锁定进度、分镜与成片状态）
  const lastInjectedSig = new WeakMap<object, string>()
  ctx.on('agent/pre-step', async ({ agent, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted || step !== 1) return decision
    try {
      const mStatus = mujing.media.status()
      let activeProj: CanvasProject | null = null
      if (mujing.activeProjectId) {
        activeProj = await mujing.store.get(mujing.activeProjectId).catch(() => null)
      }
      if (!activeProj) {
        const [latest] = await mujing.store.list()
        if (latest) activeProj = await mujing.store.get(latest.id).catch(() => null)
      }
      const text = formatStudioContext(activeProj, {
        image: mStatus.image.ready,
        video: mStatus.video.ready,
        audio: mStatus.audio.ready,
      })
      if (lastInjectedSig.get(agent.session) === text) return decision
      lastInjectedSig.set(agent.session, text)
      return {
        ...decision,
        messages: [
          ...decision.messages,
          createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: 'mujing-studio', form: 'snapshot', sections: [{ name: 'mujing-studio', text }] },
          }),
        ],
      }
    } catch {
      return decision
    }
  }, { prepend: true })

  ctx.tools.register(defineTool({
    name: 'canvas_list_projects',
    description: '列出幕境画布项目（按最近更新排序），并标出用户当前在界面上打开的画布。',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_a, v) => json(v) },
    async execute() {
      return guard(async () => ({
        active_project_id: mujing.activeProjectId ?? null,
        projects: (await mujing.store.list()).map(p => ({ ...p })),
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'canvas_create_project',
    description: '新建一个幕境画布项目，并把它设为当前画布。',
    parameters: { title: { type: 'string', required: true, description: '画布标题' } },
    output: { schema: { type: 'json' }, render: (_a, v) => json(v) },
    async execute(args) {
      return guard(async () => {
        const p = await mujing.store.create(args.title)
        mujing.activeProjectId = p.id
        return { project_id: p.id, title: p.title }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'canvas_get_state',
    description: '读取画布的全部节点、连线、短剧流水线状态（角色锁定/分集分段）及时间线状态。修改画布前先调用。project_id 缺省时读取用户当前打开的画布。',
    parameters: { project_id: { type: 'string' } },
    output: { schema: { type: 'json' }, render: (_a, v) => json(v) },
    async execute(args) {
      return guard(async () => digestProject(await mujing.store.get(await mujing.resolveProjectId(args.project_id))) as never)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'canvas_apply_ops',
    description: [
      '批量修改画布，整组原子生效（任一操作失败则全部不生效）。操作类型 op：',
      'add_node（type 必填：text/image/video/audio；不填坐标则自动排到右侧）、update_node（id 必填）、delete_node（id）、',
      'connect / disconnect（source → target，表示上游素材流向下游，例如角色图 → 分镜图）。',
      '用 text 节点承载剧本、分镜表、角色设定；image/video/audio 节点写好 prompt 后用 generate_media 生成。',
    ].join(''),
    parameters: {
      project_id: { type: 'string' },
      ops: {
        type: 'array', required: true,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            op: { type: 'string', required: true, enum: ['add_node', 'update_node', 'delete_node', 'connect', 'disconnect'] },
            ...NODE_FIELDS,
          },
        },
      },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => json(v) },
    async execute(args) {
      return guard(async () => {
        const id = await mujing.resolveProjectId(args.project_id)
        const { project, created } = await mujing.store.apply(id, args.ops as unknown as CanvasOp[])
        return { project_id: id, rev: project.rev, created_node_ids: created, node_count: project.nodes.length }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'generate_media',
    description: [
      '在画布上生成图片（image）、视频（video）或语音配音（audio）。给 node_id 则在该节点上（重新）生成，否则新建节点。',
      'reference_node_ids：图片生成时作为参考图（保持角色/场景一致），视频生成时第一个作为首帧、其余作为参考图。',
      'audio 生成：prompt 填写要朗读的台词或旁白，voice 可选 alloy/nova/shimmer/onyx/echo。',
      'wait=true（默认）等待生成完成并返回结果；批量互不依赖的任务可设 wait=false 并行提交。',
    ].join(''),
    parameters: {
      project_id: { type: 'string' },
      kind: { type: 'string', required: true, enum: ['image', 'video', 'audio'] },
      prompt: { type: 'string', required: true, description: '图片/视频画面描述，或音频待朗读台词' },
      node_id: { type: 'string' },
      title: { type: 'string', description: '新建节点的标题，例如「镜头 3 · 雨夜对峙」或「旁白·第1集」' },
      x: { type: 'number' }, y: { type: 'number' },
      reference_node_ids: { type: 'array', items: { type: 'string' } },
      size: { type: 'string', description: '图片尺寸，如 1024x1024、1536x1024、1024x1536' },
      duration: { type: 'number', description: '视频秒数' },
      ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: '视频画幅' },
      voice: { type: 'string', description: '音频 TTS 音色（如 alloy / nova / shimmer / onyx）' },
      wait: { type: 'boolean' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => json(v) },
    async execute(args, exec) {
      return guard(async () => {
        if (args.prompt.trim() === '') throw new HarnessError('prompt 不能为空', 'INVALID_ARGS')
        const projectId = await mujing.resolveProjectId(args.project_id)
        const wait = args.wait !== false
        const { nodeId, done } = await mujing.startGeneration({
          projectId, kind: args.kind, prompt: args.prompt, nodeId: args.node_id, title: args.title, x: args.x, y: args.y,
          referenceNodeIds: args.reference_node_ids, size: args.size, duration: args.duration, ratio: args.ratio, voice: args.voice,
        }, wait ? exec.signal : undefined)
        if (!wait) return { project_id: projectId, node_id: nodeId, status: 'loading' }
        const node = await done
        if (node.status === 'error') throw new HarnessError(`生成失败（节点 ${nodeId}）：${node.error ?? '未知错误'}`, 'MUJING_GENERATION_FAILED')
        return {
          project_id: projectId,
          node_id: nodeId,
          status: node.status ?? 'success',
          ...(node.url !== undefined ? { url: node.url } : {}),
          ...(node.model !== undefined ? { model: node.model } : {}),
          ...(node.durationMs !== undefined ? { durationMs: node.durationMs } : {}),
        }
      })
    },
  }))

  /* ───────────────────────── 小说 → 成片结构化短剧流水线工具 ───────────────────────── */

  ctx.tools.register(defineTool({
    name: 'drama_save_plan',
    description: [
      '保存或更新「小说→成片短剧流水线」规划（世界观风格、画幅、角色三视图设定卡、分集大纲与结构化分镜表）。',
      '保存后系统会自动将短剧的镜头按单段时长（默认 10s）聚合编译成多镜头连续视频提示词（含同镜尾帧续拍 / 换镜 / 换场策略），并同步映射为画布上的角色卡、分集剧本与串联视频节点。',
      '建议流程：收到小说或长故事需求时，先用此工具建好角色与第1~N集分镜，再用 drama_generate_casts 锁定角色三视图，最后用 drama_run_episode 逐段尾帧接首帧生成成片。',
    ].join(''),
    parameters: {
      project_id: { type: 'string' },
      style: { type: 'string', description: '全剧统一美术风格，如「电影级冷调写实，浅景深，35mm胶片颗粒」或「国风仙侠3D动画」' },
      aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: '画幅比例（竖屏短剧推荐 9:16，横屏影视推荐 16:9）' },
      segment_target_sec: { type: 'number', description: '每段视频聚合目标秒数（3~15，默认 10）' },
      novel_text: { type: 'string', description: '用户提供的小说原文或故事梗概' },
      casts: {
        type: 'array',
        description: '全剧核心角色、常驻主场景或关键道具设定',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            id: { type: 'string' },
            kind: { type: 'string', enum: ['character', 'scene', 'prop'] },
            name: { type: 'string', required: true },
            role: { type: 'string', description: '角色身份定位，如「女主·冷面法医」' },
            appearance: { type: 'string', required: true, description: '固定外貌锚点（年龄、发型发色、标志性服饰、材质配色），全剧保持不变' },
            imagePrompt: { type: 'string', description: '角色三视图设定卡或场景空镜的完整英文/中文生图提示词' },
            voice: { type: 'string', description: '角色推荐配音音色（如 nova / onyx / alloy）' },
          },
        },
      },
      episodes: {
        type: 'array',
        description: '分集剧本与镜头表（每集包含开篇钩子、结尾卡点与多个镜头）',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            number: { type: 'number', required: true, description: '集数（从 1 开始）' },
            title: { type: 'string', required: true },
            synopsis: { type: 'string', description: '本集剧情梗概' },
            hook: { type: 'string', description: '前 3 秒抓人钩子' },
            cliffhanger: { type: 'string', description: '集尾悬念卡点' },
            shots: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false,
                properties: {
                  scene: { type: 'string', required: true, description: '场景地点与时间光影，同场景名会自动触发尾帧平滑接续' },
                  shotSize: { type: 'string', description: '景别：远景/全景/中景/近景/特写' },
                  camera: { type: 'string', description: '运镜：固定/缓推/拉远/横摇/跟拍/环绕' },
                  action: { type: 'string', required: true, description: '具体可视动作与物理细节描述' },
                  speaker: { type: 'string', description: '说话角色名（无台词可省略，旁白填「旁白」）' },
                  dialogue: { type: 'string', description: '该镜头内的精炼台词（将自动生成时间轴字幕）' },
                  durationMs: { type: 'number', description: '单镜时长毫秒数（默认 3500，建议 2000~5000）' },
                  transition: { type: 'string', enum: ['cut', 'fadeblack', 'fadewhite'] },
                },
              },
            },
          },
        },
      },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => json(v) },
    async execute(args) {
      return guard(async () => {
        const id = await mujing.resolveProjectId(args.project_id)
        const updated = await mujing.saveDrama(id, {
          style: args.style,
          aspectRatio: args.aspect_ratio,
          segmentTargetSec: args.segment_target_sec,
          novelText: args.novel_text,
          casts: args.casts as Array<Partial<DramaCast> & { name: string }> | undefined,
          episodes: args.episodes as Array<{
            number: number
            title: string
            synopsis?: string
            hook?: string
            cliffhanger?: string
            shots?: Array<Partial<DramaShot> & { action: string }>
          }> | undefined,
          syncCanvasNodes: true,
        })
        return {
          project_id: id,
          cast_count: updated.drama?.casts.length ?? 0,
          episodes: (updated.drama?.episodes ?? []).map(ep => ({
            number: ep.number,
            title: ep.title,
            shot_count: ep.shots.length,
            segment_count: ep.segments.length,
            segments: ep.segments.map(s => ({
              index: s.index,
              title: s.title,
              handoff: s.handoff,
              durationMs: s.durationMs,
              ...(s.videoNodeId !== undefined ? { videoNodeId: s.videoNodeId } : {}),
            })),
          })),
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'drama_generate_casts',
    description: '为短剧角色/常驻场景生成三视图设定图并自动锁定（locked=true），锁定后的设定图会在后续各段视频生成时自动作为参考图传入以锁定角色长相服装一致。',
    parameters: {
      project_id: { type: 'string' },
      cast_id: { type: 'string', description: '指定单个角色 id 或角色名；缺省则为所有尚未锁定的角色并行生成设定图' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => json(v) },
    async execute(args, exec) {
      return guard(async () => {
        const id = await mujing.resolveProjectId(args.project_id)
        const out = await mujing.generateDramaCastImage(id, args.cast_id, exec.signal)
        return { project_id: id, ...out }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'drama_generate_shot_media',
    description: '为指定剧集中的单个分镜或整集分镜批量生成「故事板关键帧图片（kind=keyframe）」或「角色台词配音 TTS（kind=audio）」。生成的首镜关键帧会自动在视频生成时作为起幅首帧，生成的配音会自动挂载到时间线音轨。',
    parameters: {
      project_id: { type: 'string' },
      episode: { type: 'number', required: true, description: '集数（如 1）' },
      kind: { type: 'string', required: true, enum: ['keyframe', 'audio'], description: 'keyframe 生成分镜关键帧画面，audio 生成分镜台词语音' },
      shot_index: { type: 'number', description: '可选：指定单镜序号（0-based）；缺省则为该集全部分镜生成' },
      shot_id: { type: 'string', description: '可选：指定单镜 id' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => json(v) },
    async execute(args, exec) {
      return guard(async () => {
        const id = await mujing.resolveProjectId(args.project_id)
        const out = await mujing.generateDramaShotMedia(id, args.episode, {
          kind: args.kind,
          shotIndex: args.shot_index,
          shotId: args.shot_id,
        }, exec.signal)
        return { project_id: id, ...out }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'drama_run_episode',
    description: [
      '按分段顺序执行某集短剧视频生成：',
      '当相邻分段同属一场且 handoff=continue 时，自动用 FFmpeg 抽取上一段真实尾帧作为下一段的首帧（first_frame），并携带出场角色的锁定三视图，实现长剧情丝滑接续。',
      'auto_compose=true 时，全集各段生成完毕后自动推送时间线并调用 FFmpeg 合成单集完整 MP4 成片与 SRT 字幕。',
    ].join(''),
    parameters: {
      project_id: { type: 'string' },
      episode: { type: 'number', required: true, description: '集数（如 1）' },
      segment_index: { type: 'number', description: '可选：只重跑某一段（0-based）；缺省按顺序跑完整集' },
      force_regenerate: { type: 'boolean', description: '是否强制重跑已成功的分段' },
      auto_compose: { type: 'boolean', description: '各段全部成功后是否自动合成整集 MP4 成片（默认 true）' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => json(v) },
    async execute(args, exec) {
      return guard(async () => {
        const id = await mujing.resolveProjectId(args.project_id)
        const runOut = await mujing.runDramaEpisode(id, args.episode, {
          segmentIndex: args.segment_index,
          forceRegenerate: args.force_regenerate,
        }, exec.signal)
        let finalVideoUrl: string | undefined
        const allOk = runOut.segments.length > 0 && runOut.segments.every(s => s.status === 'success')
        if (allOk && args.auto_compose !== false && args.segment_index === undefined) {
          try {
            const composed = await mujing.populateTimelineFromEpisode(id, args.episode, true)
            finalVideoUrl = composed.timeline?.outputUrl
          } catch {
            // 若上游返回非标准编码 mock 视频无法 FFmpeg 解码，至少把片段推入时间线供查看
            await mujing.populateTimelineFromEpisode(id, args.episode, false).catch(() => {})
          }
        }
        return { project_id: id, ...runOut, ...(finalVideoUrl ? { final_video_url: finalVideoUrl } : {}) }
      })
    },
  }))

  /* ───────────────────────── 时间线合成与剪映专业版导出工具 ───────────────────────── */

  ctx.tools.register(defineTool({
    name: 'timeline_compose',
    description: '编排项目时间线片段（支持指定画布视频节点 nodeId、配音音频节点 audioNodeId 与台词字幕 caption），并调用本地 FFmpeg 合成完整 MP4 成片与 SRT 字幕。',
    parameters: {
      project_id: { type: 'string' },
      clips: {
        type: 'array',
        description: '可选：更新片段列表；若已由 drama_run_episode 推入时间线可省略直接合成',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            nodeId: { type: 'string', description: '画布上的视频节点 id' },
            title: { type: 'string' },
            caption: { type: 'string', description: '该片段对应的字幕/台词文本' },
            audioNodeId: { type: 'string', description: '可选：画布上的配音音频节点 id，合成时混入该片段音轨' },
          },
        },
      },
      render_mp4: { type: 'boolean', description: '是否立即调用 FFmpeg 拼接生成完整 MP4（默认 true）' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => json(v) },
    async execute(args) {
      return guard(async () => {
        const id = await mujing.resolveProjectId(args.project_id)
        if (args.clips && args.clips.length > 0) {
          await mujing.saveTimeline(id, { clips: args.clips })
        }
        if (args.render_mp4 !== false) {
          const p = await mujing.renderTimeline(id)
          return {
            project_id: id,
            clip_count: p.timeline?.clips.length ?? 0,
            status: p.timeline?.status ?? 'success',
            output_url: p.timeline?.outputUrl ?? null,
            has_srt: Boolean(p.timeline?.subtitleSrt),
          }
        }
        const p = await mujing.store.get(id)
        return {
          project_id: id,
          clip_count: p.timeline?.clips.length ?? 0,
          status: p.timeline?.status ?? 'idle',
          output_url: p.timeline?.outputUrl ?? null,
          has_srt: Boolean(p.timeline?.subtitleSrt),
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'timeline_export_jianying',
    description: '将项目当前时间线导出为剪映专业版（JianyingPro）草稿目录，拷贝全部视频素材并生成视频轨 + 台词字幕轨 + SRT 文件，打开剪映即可精剪。',
    parameters: {
      project_id: { type: 'string' },
      draft_name: { type: 'string', description: '草稿名称，缺省使用「<画布标题>-幕境草稿」' },
      draft_root: { type: 'string', description: '剪映草稿根目录，macOS 缺省自动写入 ~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => json(v) },
    async execute(args) {
      return guard(async () => {
        const id = await mujing.resolveProjectId(args.project_id)
        return await mujing.exportJianyingDraft(id, { draftName: args.draft_name, draftRoot: args.draft_root })
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'media_status',
    description: '查看图片/视频/音频生成服务是否已配置以及所用模型。生成失败提示“未配置”时调用，并把配置方法告诉用户。',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_a, v) => json(v) },
    async execute() {
      return {
        ...mujing.media.status(),
        hint: '在 mujing 插件配置或环境变量中设置 MUJING_IMAGE_BASE_URL / MUJING_IMAGE_API_KEY、MUJING_VIDEO_BASE_URL / MUJING_VIDEO_API_KEY、MUJING_AUDIO_BASE_URL / MUJING_AUDIO_API_KEY',
      }
    },
  }))
}
