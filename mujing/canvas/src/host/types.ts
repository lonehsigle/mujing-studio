/** 画布与短剧制作、时间线合成共享的数据模型。 */

export type NodeType = 'text' | 'image' | 'video' | 'audio'
export type NodeStatus = 'idle' | 'loading' | 'success' | 'error'

export interface CanvasNode {
  id: string
  type: NodeType
  x: number
  y: number
  width: number
  height: number
  title?: string
  /** 文本节点正文。 */
  content?: string
  /** 生成用提示词（图片/视频/音频节点；音频节点表示待朗读台词或旁白）。 */
  prompt?: string
  /** 音频节点的音色标识（如 alloy / nova 等）。 */
  voice?: string
  /** 媒体地址（/mujing/assets/... 或外链）。 */
  url?: string
  status?: NodeStatus
  error?: string
  /** 产出模型：写出当前媒体内容的模型。 */
  model?: string
  /** 媒体时长（毫秒，视频/音频探测所得）。 */
  durationMs?: number
}

export interface CanvasEdge {
  id: string
  source: string
  target: string
}

/* ───────────────────────── 短剧制作流水线模型 ───────────────────────── */

export type DramaCastKind = 'character' | 'scene' | 'prop'
export type HandoffMode = 'continue' | 'reverse_angle' | 'scene_cut'

export interface DramaCast {
  id: string
  kind: DramaCastKind
  name: string
  role?: string
  appearance: string
  imagePrompt: string
  voice?: string
  /** 关联画布上的设定图节点 id（用于一致性参考）。 */
  imageNodeId?: string
  /** 冗余保存已锁定的资产 URL，方便无画布节点时直接使用。 */
  imageUrl?: string
  locked?: boolean
}

export interface DramaShot {
  id: string
  segmentIndex: number
  scene: string
  shotSize: string
  camera: string
  action: string
  imagePrompt?: string
  videoPrompt?: string
  speaker?: string
  dialogue?: string
  durationMs: number
  castIds?: string[]
  transition?: 'cut' | 'fadeblack' | 'fadewhite'
  /** 分镜故事板关键帧图片节点 id 与 URL。 */
  keyframeNodeId?: string
  keyframeUrl?: string
  /** 单镜台词配音音频节点 id 与 URL。 */
  audioNodeId?: string
  audioUrl?: string
}

export interface DramaSegment {
  id: string
  index: number
  title: string
  /** 与上一段的镜头接续策略：同镜尾帧续拍 / 同场换镜 / 换场独立开拍。 */
  handoff: HandoffMode
  durationMs: number
  /** 编译好的多镜头分段视频提示词（也可由用户/Agent 手改）。 */
  prompt: string
  /** 本段关联的画布视频节点 id。 */
  videoNodeId?: string
  /** 上一段抽取出的尾帧图片 URL（仅 handoff === 'continue' 时生成并传入）。 */
  firstFrameUrl?: string
  status: NodeStatus
  error?: string
}

export interface DramaEpisode {
  id: string
  number: number
  title: string
  synopsis: string
  hook?: string
  cliffhanger?: string
  /** 小说原文或用户粘贴的本集剧本。 */
  sourceText?: string
  shots: DramaShot[]
  segments: DramaSegment[]
  /** 单集一键合成后的成片地址与字幕。 */
  finalVideoUrl?: string
  subtitleSrt?: string
}

export interface DramaData {
  genre?: string
  logline?: string
  style: string
  aspectRatio: '16:9' | '9:16' | '1:1'
  language: string
  /** 单段视频目标上限秒数（默认 10s，受视频模型上限约束）。 */
  segmentTargetSec: number
  novelText?: string
  casts: DramaCast[]
  episodes: DramaEpisode[]
}

/* ───────────────────────── 时间线与成片导出模型 ───────────────────────── */

export interface TimelineClip {
  id: string
  nodeId?: string
  title: string
  url: string
  durationMs: number
  /** 台词/字幕文本（合成或导出剪映草稿时写入字幕轨）。 */
  caption?: string
  /** 可选配音节点 id 或音频 URL（合成时混流替换或叠加）。 */
  audioNodeId?: string
  audioUrl?: string
}

export interface TimelineState {
  clips: TimelineClip[]
  burnSubtitles?: boolean
  outputUrl?: string
  subtitleSrt?: string
  subtitleAssetUrl?: string
  status?: NodeStatus
  error?: string
  updatedAt?: number
}

export interface CanvasProject {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  rev: number
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  drama?: DramaData
  timeline?: TimelineState
}

export interface ProjectSummary {
  id: string
  title: string
  updatedAt: number
  nodeCount: number
  aspectRatio?: '16:9' | '9:16' | '1:1'
  style?: string
  castCount?: number
  episodeCount?: number
  clipCount?: number
  coverUrl?: string
}

export type CanvasOp =
  | { op: 'add_node'; id?: string; type: NodeType; x?: number; y?: number; width?: number; height?: number; title?: string; content?: string; prompt?: string; voice?: string; url?: string; status?: NodeStatus; model?: string; durationMs?: number }
  | { op: 'update_node'; id: string; x?: number; y?: number; width?: number; height?: number; title?: string; content?: string; prompt?: string; voice?: string; url?: string; status?: NodeStatus; error?: string; model?: string; durationMs?: number }
  | { op: 'delete_node'; id: string }
  | { op: 'connect'; source: string; target: string }
  | { op: 'disconnect'; source: string; target: string }
