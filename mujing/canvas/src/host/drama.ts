/**
 * 小说 → 成片结构化短剧制作引擎：
 *  - 世界观与角色/场景/道具设定锁定（DramaCast）；
 *  - 分镜自动/手动归并为剧情段（DramaSegment），标注接续策略（同镜续拍 continue / 同场换镜 reverse_angle / 换场 scene_cut）；
 *  - 编译带时间轴、角色参考编号、音色、气口与段尾收住指令的结构化视频提示词（对标原项目 production/segment_prompt.go）；
 *  - 同步短剧结构到画布可视节点（支持自由微调）。
 */

import { shortId } from './store.ts'
import type {
  CanvasProject,
  DramaCast,
  DramaData,
  DramaEpisode,
  DramaSegment,
  DramaShot,
  HandoffMode,
} from './types.ts'
import { buildSrt, type JianyingCaption } from './jianying.ts'

const NL = String.fromCharCode(10)

const ORDINALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

const SHOT_LENS: Record<string, string> = {
  大远景: '24mm广角',
  远景: '28mm广角',
  全景: '35mm镜头',
  中全景: '40mm镜头',
  中景: '50mm标准镜头',
  中近景: '65mm镜头',
  近景: '85mm人像镜头',
  特写: '100mm特写镜头',
  大特写: '100mm微距特写',
}

export function defaultDrama(): DramaData {
  return {
    style: '电影级真人短剧，细腻自然光影，8K质感',
    aspectRatio: '9:16',
    language: '中文普通话',
    segmentTargetSec: 8,
    casts: [],
    episodes: [],
  }
}

export function ensureDrama(p: CanvasProject): DramaData {
  if (!p.drama) p.drama = defaultDrama()
  return p.drama
}

function fmtSec(ms: number): string {
  const sec = Math.max(0, ms / 1000)
  return Number.isInteger(sec) ? String(sec) : sec.toFixed(1).replace(/\.0$/, '')
}

/**
 * 将单集的分镜列表（shots）切分为多镜头视频生成段（segments），并编译每段完整提示词。
 * 若镜头未显式给定 segmentIndex，则按单段时长上限（segmentTargetSec）与场景变化自动切段。
 */
export function buildEpisodeSegments(drama: DramaData, episode: DramaEpisode, existing?: DramaSegment[]): DramaSegment[] {
  if (episode.shots.length === 0) return []
  const maxMs = Math.max(3000, Math.min(15_000, Math.round((drama.segmentTargetSec || 8) * 1000)))

  const groups: DramaShot[][] = []
  const hasExplicitIndex = episode.shots.some((s, idx) => idx > 0 && s.segmentIndex > 0)

  if (hasExplicitIndex) {
    const byIdx = new Map<number, DramaShot[]>()
    for (const shot of episode.shots) {
      const k = Math.max(0, Math.floor(shot.segmentIndex || 0))
      const list = byIdx.get(k) ?? []
      list.push(shot)
      byIdx.set(k, list)
    }
    for (const k of [...byIdx.keys()].sort((a, b) => a - b)) {
      const g = byIdx.get(k)
      if (g && g.length > 0) groups.push(g)
    }
  } else {
    let cur: DramaShot[] = []
    let curMs = 0
    for (const shot of episode.shots) {
      const dur = Math.max(1500, shot.durationMs || 3000)
      const sceneChanged = cur.length > 0 && Boolean(shot.scene) && Boolean(cur[0].scene) && shot.scene !== cur[0].scene
      if (cur.length > 0 && (curMs + dur > maxMs || sceneChanged || cur.length >= 4)) {
        groups.push(cur)
        cur = []
        curMs = 0
      }
      shot.segmentIndex = groups.length
      cur.push(shot)
      curMs += dur
    }
    if (cur.length > 0) groups.push(cur)
  }

  const prevByIndex = new Map((existing ?? []).map(s => [s.index, s]))

  return groups.map((shots, index) => {
    for (const s of shots) s.segmentIndex = index
    const prevSeg = prevByIndex.get(index)
    const prevShots = index > 0 ? groups[index - 1] : undefined
    const handoff: HandoffMode = prevSeg?.handoff ?? inferHandoff(prevShots, shots, index)
    const durationMs = shots.reduce((acc, s) => acc + Math.max(1500, s.durationMs || 3000), 0)
    const prompt = compileSegmentPrompt({
      drama,
      episode,
      shots,
      index,
      totalCount: groups.length,
      handoff,
    })
    return {
      id: prevSeg?.id ?? shortId('seg'),
      index,
      title: prevSeg?.title || `第${episode.number}集·第${index + 1}段（${shots.length}镜）`,
      handoff,
      durationMs,
      prompt,
      ...(prevSeg?.videoNodeId ? { videoNodeId: prevSeg.videoNodeId } : {}),
      ...(prevSeg?.firstFrameUrl ? { firstFrameUrl: prevSeg.firstFrameUrl } : {}),
      status: prevSeg?.status ?? 'idle',
      ...(prevSeg?.error ? { error: prevSeg.error } : {}),
    }
  })
}

function inferHandoff(prevShots: DramaShot[] | undefined, curShots: DramaShot[], index: number): HandoffMode {
  if (index === 0 || !prevShots || prevShots.length === 0) return 'scene_cut'
  const lastPrev = prevShots[prevShots.length - 1]
  const firstCur = curShots[0]
  if (lastPrev.scene && firstCur.scene && lastPrev.scene !== firstCur.scene) return 'scene_cut'
  // 同场景下若说话人互换且景别均为近景/特写，默认属于正反打同场换镜，避免直接把对方脸当首帧导致换脸
  if (lastPrev.speaker && firstCur.speaker && lastPrev.speaker !== firstCur.speaker) return 'reverse_angle'
  return 'continue'
}

export function compileSegmentPrompt(input: {
  drama: DramaData
  episode: DramaEpisode
  shots: DramaShot[]
  index: number
  totalCount: number
  handoff: HandoffMode
}): string {
  const { drama, episode, shots, index, totalCount, handoff } = input
  const lines: string[] = []
  lines.push(`【${episode.title || `第${episode.number}集`} · 剧情段 ${index + 1}/${totalCount}】`)
  lines.push(`画风与视听规范：${drama.style}；画幅 ${drama.aspectRatio}。`)

  const scenes = [...new Set(shots.map(s => s.scene.trim()).filter(Boolean))]
  if (scenes.length > 0) lines.push(`空间锁定：${scenes.join('；')}。`)
  lines.push('切镜保持轴线与画面左右关系，不越轴，不穿模；人物按剧情自然走位。')

  if (index > 0) {
    if (handoff === 'continue') {
      lines.push('接续关系：本段以传入的首帧图（上一段真实尾帧）无缝起幅，紧接上一镜动作继续表演，禁止重复上一镜已完成的动作。')
    } else if (handoff === 'reverse_angle') {
      lines.push('接续关系：同场换机位/正反打切镜，保持场景光线与人物站位一致，新机位干净切入。')
    } else {
      lines.push('接续关系：新场次独立开拍，按首镜画面设定直接起幅。')
    }
  }

  // 汇总本段涉及的角色/场景/道具设定
  const activeCastIds = new Set<string>()
  for (const shot of shots) {
    for (const cid of shot.castIds ?? []) activeCastIds.add(cid)
    // 兼容按名字自动匹配说话人或动作里提到的角色
    for (const c of drama.casts) {
      if (shot.speaker === c.name || shot.action.includes(c.name) || shot.scene.includes(c.name)) {
        activeCastIds.add(c.id)
      }
    }
  }
  const activeCasts = drama.casts.filter(c => activeCastIds.has(c.id))
  const chars = activeCasts.filter(c => c.kind === 'character')
  const propsAndScenes = activeCasts.filter(c => c.kind !== 'character')

  if (chars.length > 0) {
    lines.push('')
    lines.push('【出场角色锁定】')
    chars.forEach((c, idx) => {
      const refTag = c.imageUrl || c.imageNodeId ? `（参考图${idx + 1}）` : ''
      lines.push(`- ${c.name}${refTag}：${c.appearance}。外貌、服装与发型严格保持一致。`)
    })
  }
  if (propsAndScenes.length > 0) {
    lines.push('')
    lines.push('【场景与关键道具】')
    for (const item of propsAndScenes) {
      lines.push(`- ${item.name}（${item.kind === 'scene' ? '场景' : '道具'}）：${item.appearance}。`)
    }
  }

  lines.push('')
  lines.push('【光源与声音】')
  lines.push(`光线方向与色温在本段内保持连续。对白使用${drama.language || '中文普通话'}，口型与台词同步，环境音随画面动作。`)
  for (const c of chars) {
    if (c.voice?.trim()) lines.push(`- ${c.name}音色：${c.voice.trim()}`)
  }

  let cursorMs = 0
  shots.forEach((shot, sIdx) => {
    const dur = Math.max(1500, shot.durationMs || 3000)
    const start = cursorMs
    const end = cursorMs + dur
    cursorMs = end
    const ord = ORDINALS[sIdx] ?? String(sIdx + 1)
    const cam = shot.camera?.trim() || '固定'
    const size = shot.shotSize?.trim() || '中景'
    const head = cam !== '固定' ? `${size}·${cam}` : size
    lines.push('')
    lines.push(`【${fmtSec(start)}—${fmtSec(end)}秒｜镜头${ord}：${head}】`)
    const lens = SHOT_LENS[size] ? `${SHOT_LENS[size]}，${size}` : size
    lines.push(`${lens}${cam !== '固定' ? `，运镜：${cam}` : ''}。`)
    if (sIdx > 0 && shot.transition === 'fadeblack') lines.push('本镜从黑场淡入。')
    if (sIdx > 0 && shot.transition === 'fadewhite') lines.push('本镜以短暂闪白切入。')
    if (shot.imagePrompt?.trim()) lines.push(`起幅画面：${shot.imagePrompt.trim()}`)
    if (shot.action?.trim()) lines.push(`动作表演：${shot.action.trim()}`)
    if (shot.videoPrompt?.trim() && shot.videoPrompt.trim() !== shot.action?.trim()) {
      lines.push(shot.videoPrompt.trim())
    }
    if (shot.dialogue?.trim()) {
      const spk = shot.speaker?.trim() || '旁白（画外音）'
      lines.push(`${spk}：“${shot.dialogue.trim()}”`)
      if (dur >= 2000) lines.push('台词清晰自然，说完留0.3秒气口。')
    } else {
      lines.push('无台词。')
    }
    if (sIdx === shots.length - 1 && index < totalCount - 1) {
      lines.push(`末0.4秒动作收住、镜头停稳，人物保留呼吸与眼神微动态，作为第${index + 2}段的接续基准。`)
    }
  })

  return lines.join(NL)
}

/** 提取单镜或本段出场且拥有设定图的参考资产 URL 列表（按编译提示词中的角色顺序排列）。 */
export function collectShotCastRefs(project: CanvasProject, shots: readonly DramaShot[]): string[] {
  const drama = project.drama
  if (!drama) return []
  const activeIds = new Set<string>()
  for (const shot of shots) {
    for (const cid of shot.castIds ?? []) activeIds.add(cid)
    for (const c of drama.casts) {
      if (shot.speaker === c.name || shot.action.includes(c.name) || shot.scene.includes(c.name)) activeIds.add(c.id)
    }
  }
  const urls: string[] = []
  for (const c of drama.casts) {
    if (!activeIds.has(c.id)) continue
    const nodeUrl = c.imageNodeId ? project.nodes.find(n => n.id === c.imageNodeId)?.url : undefined
    const url = nodeUrl || c.imageUrl
    if (url && !urls.includes(url)) urls.push(url)
  }
  return urls
}

export function collectSegmentCastRefs(project: CanvasProject, episode: DramaEpisode, segment: DramaSegment): string[] {
  const shots = episode.shots.filter(s => s.segmentIndex === segment.index)
  return collectShotCastRefs(project, shots)
}

/** 编译单镜故事板关键帧提示词（结合画风、场景、景别、运镜、人物外貌锁定与动作细节）。 */
export function compileShotKeyframePrompt(drama: DramaData, shot: DramaShot): string {
  if (shot.imagePrompt?.trim()) return `${shot.imagePrompt.trim()}，${drama.style}`
  const size = shot.shotSize?.trim() || '中景'
  const lens = SHOT_LENS[size] ? `${SHOT_LENS[size]}，${size}` : size
  const matchedCasts = drama.casts.filter(c =>
    (shot.castIds ?? []).includes(c.id) || shot.speaker === c.name || shot.action.includes(c.name) || shot.scene.includes(c.name),
  )
  const castDesc = matchedCasts.map(c => `${c.name}（${c.appearance}）`).join('；')
  return [
    `电影故事板关键帧，${drama.style}，画幅 ${drama.aspectRatio}`,
    `场景：${shot.scene}`,
    `景别与镜头：${lens}${shot.camera && shot.camera !== '固定' ? `，${shot.camera}构图` : ''}`,
    castDesc ? `出场角色设定：${castDesc}` : '',
    `画面瞬间：${shot.action}`,
  ].filter(Boolean).join('；')
}

/** 根据单集内各镜头台词与时长生成时间对齐的字幕列表与 SRT 文本。 */
export function buildEpisodeCaptions(episode: DramaEpisode): { captions: JianyingCaption[]; srt: string } {
  const captions: JianyingCaption[] = []
  let cursorUs = 0
  for (const shot of episode.shots) {
    const durUs = Math.max(1500, shot.durationMs || 3000) * 1000
    const dlg = shot.dialogue?.trim()
    if (dlg) {
      const spk = shot.speaker?.trim()
      const label = spk && spk !== '旁白' ? `${spk}：${dlg}` : dlg
      captions.push({ text: label, startUs: cursorUs + 100_000, durationUs: Math.max(500_000, durUs - 250_000) })
    }
    cursorUs += durUs
  }
  return { captions, srt: buildSrt(captions) }
}

/** 格式化分集剧本与分镜表为可读 Markdown（用于同步到画布文本节点）。 */
export function formatEpisodeMarkdown(ep: DramaEpisode): string {
  const lines: string[] = [`# 第${ep.number}集：${ep.title}`, '']
  if (ep.hook) lines.push(`> **开场钩子**：${ep.hook}`)
  if (ep.synopsis) lines.push(`> **本集梗概**：${ep.synopsis}`)
  if (ep.cliffhanger) lines.push(`> **集尾悬念**：${ep.cliffhanger}`)
  lines.push('', '## 分镜表', '')
  ep.shots.forEach((s, i) => {
    const dlg = s.dialogue ? ` ｜ **${s.speaker || '旁白'}**：「${s.dialogue}」` : ''
    lines.push(`${i + 1}. **[段${s.segmentIndex + 1} · ${s.shotSize} · ${s.camera} · ${(s.durationMs / 1000).toFixed(1)}s]** （${s.scene}）${s.action}${dlg}`)
  })
  return lines.join(NL)
}
