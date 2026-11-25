/** 幕境前端工作台共享常量与预设。 */

import type { DramaCastKind, HandoffMode, NodeType } from '../host/types.ts'
import type { RoutingStrategy } from './studio-bus.ts'

export const LF = String.fromCharCode(10)

export const TYPE_LABEL: Record<NodeType, string> = { text: '文本', image: '图片', video: '视频', audio: '配音' }
export const STATUS_LABEL = { idle: '待生成', loading: '生成中…', success: '已完成', error: '失败' } as const
export const CAST_KIND_LABEL: Record<DramaCastKind, string> = { character: '角色', scene: '场景', prop: '道具' }
export const HANDOFF_LABEL: Record<HandoffMode, string> = {
  continue: '同场尾帧续拍',
  reverse_angle: '同场正反打换镜',
  scene_cut: '跨场景硬切',
}
export const VOICES = ['alloy', 'nova', 'shimmer', 'onyx', 'echo', 'fable'] as const
export const SHOT_SIZES = ['远景', '全景', '中景', '近景', '特写'] as const
export const CAMERA_MOVES = ['固定', '缓推', '急推', '拉远', '横摇', '跟拍', '环绕'] as const
export const STRATEGY_LABEL: Record<RoutingStrategy, string> = {
  round_robin: '动态轮询',
  failover: '主备容灾',
  random: '随机均衡',
}

export const STYLE_PRESETS = [
  { label: '赛博雨夜写实', genre: '赛博悬疑短剧', style: '赛博雨夜冷调电影感，霓虹反光，35mm胶片质感，浅景深，人物五官服装稳定统一' },
  { label: '东方古风电影', genre: '古风权谋/虐恋', style: '东方古风电影质感，烛火冷雪对比，丝绸刺绣细节清晰，35mm胶片颗粒，浅景深' },
  { label: '国风3D仙侠漫剧', genre: '玄幻修仙漫剧', style: '高精度国风3D动画电影质感，体积光与流光粒子，精致建模，色彩通透' },
  { label: '都市高奢短剧', genre: '现代都市豪门', style: '现代都市商业大片光影，暖金与冷灰高级配色，85mm人像电影镜头，肤质自然真实' },
] as const
