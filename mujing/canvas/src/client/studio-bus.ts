import type { CanvasProject, ProjectSummary } from '../host/types.ts'

export const API = '/mujing/api'
export const PANEL_ID = 'mujing.canvas'
export const STUDIO_TAB_ID = 'mujing.studio.tab'
export const STUDIO_TAB_KIND = 'mujing-studio'

export type WorkspaceTab = 'drama' | 'canvas' | 'timeline'

export interface StarterTemplate {
  id: string
  badge: string
  ratio: '9:16' | '16:9'
  title: string
  desc: string
  accent: string
  tab: WorkspaceTab
  prompt: string
}

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    id: 'cyber-drama',
    badge: '9:16 赛博悬疑短剧',
    ratio: '9:16',
    title: '《雨夜芯片》全流程短剧',
    desc: '拆集分镜 → 角色三视图锁定 → 首镜关键帧与配音 → 尾帧续拍成片与剪映导出',
    accent: 'linear-gradient(135deg, #1d2b64 0%, #3a7bd5 60%, #00d2ff 100%)',
    tab: 'drama',
    prompt: '请帮我把下面这段赛博悬疑短剧小说拍成 9:16 竖屏短剧成片：暴雨倾盆的江城深夜，冷面私家侦探林默推开“蓝调酒吧”大门，神秘线人苏晚从高脚凳转身将一枚记忆芯片推过吧台，话音未落窗外红外狙击红点骤然锁定两人。请建立角色与场景三视图设定卡、生成首镜故事板关键帧，并按尾帧接续生成第 1 集完整 MP4 成片。',
  },
  {
    id: 'ancient-drama',
    badge: '9:16 东方古风漫剧',
    ratio: '9:16',
    title: '《烬雪长歌》古风电影短剧',
    desc: '双主角+城楼场景锁定 → 情绪对峙分镜 → 连续视频与字幕时间线合成',
    accent: 'linear-gradient(135deg, #4b1248 0%, #8e2de2 55%, #f0c27b 100%)',
    tab: 'drama',
    prompt: '请帮我创作一部东方古风电影感 9:16 短剧《烬雪长歌》第 1 集：暴雪纷飞的夜色城楼之上，亡国公主沈清辞身披素白狐裘执剑拦住班师入城的镇北将军萧烬，质问三年前灭门军令真相，萧烬翻身下马踏雪逼近徒手握住剑锋。请锁定角色与场景三视图、生成关键帧并合成整集视频。',
  },
  {
    id: 'free-canvas',
    badge: '16:9 无限画布节点流',
    ratio: '16:9',
    title: '概念预告片 · 自由编排',
    desc: '在无限画布创建剧本、角色参考图并连线驱动首帧动态视频节点',
    accent: 'linear-gradient(135deg, #0f2027 0%, #203a43 55%, #2c5364 100%)',
    tab: 'canvas',
    prompt: '请用自由无限画布帮我搭建一支电影感概念预告片：创建剧本节点、主角概念设定图节点，连线并以设定图作为首帧生成推门镜头的动态视频。',
  },
]

export type MediaKind = 'image' | 'video' | 'audio'
export type RoutingStrategy = 'round_robin' | 'failover' | 'random'

export interface MediaStatus {
  image: { ready: boolean; model: string; readyCount: number; totalCount: number; strategy: RoutingStrategy }
  video: { ready: boolean; model: string; readyCount: number; totalCount: number; strategy: RoutingStrategy }
  audio: { ready: boolean; model: string; voice: string; readyCount: number; totalCount: number; strategy: RoutingStrategy }
}

export interface MediaEndpointDetailBase {
  id: string
  name: string
  enabled: boolean
  weight: number
  ready: boolean
  baseURL: string
  model: string
  apiKeyEnv: string
  hasApiKey: boolean
  apiKeySource: 'custom' | 'env' | 'none'
  apiKeyMasked: string
  totalRequests: number
  successCount: number
  failCount: number
  consecutiveFails: number
  inCooldown: boolean
  cooldownRemainingMs: number
  lastUsedAt?: number
  lastError?: string
}

export type ImageEndpointDetail = MediaEndpointDetailBase & { size: string; flavor: 'openai' | 'ark' }
export type VideoEndpointDetail = MediaEndpointDetailBase & { flavor: 'openai' | 'ark'; duration: number; ratio: string }
export type AudioEndpointDetail = MediaEndpointDetailBase & { voice: string; format: 'mp3' | 'wav' }

export interface MediaPoolDetail<T extends MediaEndpointDetailBase> {
  ready: boolean
  readyCount: number
  enabledCount: number
  totalCount: number
  strategy: RoutingStrategy
  autoFailover: boolean
  cursor: number
  endpoints: T[]
}

export interface MediaConfigDetails {
  image: MediaPoolDetail<ImageEndpointDetail>
  video: MediaPoolDetail<VideoEndpointDetail>
  audio: MediaPoolDetail<AudioEndpointDetail>
}

export interface ProjectWithHistory extends CanvasProject {
  history?: { canUndo: boolean; canRedo: boolean }
}

export async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(API + path, {
    method: init?.method ?? 'GET',
    credentials: 'same-origin',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const data = await res.json().catch(() => ({})) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

export async function uploadLocalFile(file: File): Promise<{ url: string; meta?: { durationMs: number; width: number; height: number } }> {
  const res = await fetch(`${API}/assets/upload?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  })
  const data = await res.json().catch(() => ({})) as { url?: string; meta?: { durationMs: number; width: number; height: number }; error?: string }
  if (!res.ok || !data.url) throw new Error(data.error ?? `上传失败 HTTP ${res.status}`)
  return { url: data.url, meta: data.meta }
}

/* ─────────── 全局幕境应用状态（常驻左侧主导航栏 & 各主视图共享） ─────────── */

export interface AppShellSnapshot {
  projects: ProjectSummary[]
  projectsLoaded: boolean
  activeId: string | null
  showHub: boolean
  media: MediaStatus | null
  railCollapsed: boolean
  createModalOpen: boolean
  mediaConfigTab: MediaKind | null
}

let shellState: AppShellSnapshot = {
  projects: [],
  projectsLoaded: false,
  activeId: null,
  showHub: false,
  media: null,
  railCollapsed: false,
  createModalOpen: false,
  mediaConfigTab: null,
}

const shellListeners = new Set<() => void>()
const knownProjectIds = new Set<string>()
let importTriggerHandler: (() => void) | null = null

function notifyShell(): void {
  for (const fn of shellListeners) {
    try { fn() } catch {}
  }
}

export function getAppShellState(): AppShellSnapshot {
  return shellState
}

export function subscribeAppShell(fn: () => void): () => void {
  shellListeners.add(fn)
  return () => { shellListeners.delete(fn) }
}

export function patchAppShellState(patch: Partial<AppShellSnapshot>): void {
  shellState = { ...shellState, ...patch }
  if (patch.activeId !== undefined) desiredProjectId = patch.activeId
  notifyShell()
}

export function upsertAppProjectSummary(summary: ProjectSummary): void {
  knownProjectIds.add(summary.id)
  const hit = shellState.projects.some(x => x.id === summary.id)
  const next = hit
    ? shellState.projects.map(x => (x.id === summary.id ? summary : x))
    : [summary, ...shellState.projects]
  shellState = { ...shellState, projects: next }
  notifyShell()
}

export async function refreshAppProjects(opts?: { autoSelectNew?: boolean }): Promise<ProjectSummary[]> {
  const [list, cfg] = await Promise.all([
    call<ProjectSummary[]>('/projects'),
    call<MediaStatus & { activeProjectId: string | null }>('/config'),
  ])
  const brandNew = opts?.autoSelectNew && knownProjectIds.size > 0
    ? list.find(item => !knownProjectIds.has(item.id))
    : undefined
  knownProjectIds.clear()
  for (const item of list) knownProjectIds.add(item.id)

  let nextActiveId = shellState.activeId
  let nextShowHub = shellState.showHub

  if (brandNew) {
    nextActiveId = brandNew.id
    nextShowHub = false
    void call('/active', { method: 'PUT', body: { projectId: brandNew.id } }).catch(() => {})
  } else {
    if (!nextActiveId || !list.some(x => x.id === nextActiveId)) {
      nextActiveId = cfg.activeProjectId ?? list[0]?.id ?? null
    }
    if (list.length === 0) {
      nextShowHub = true
    }
  }

  desiredProjectId = nextActiveId
  shellState = {
    ...shellState,
    projects: list,
    projectsLoaded: true,
    media: cfg,
    activeId: nextActiveId,
    showHub: nextShowHub,
  }
  notifyShell()
  return list
}

export async function selectAppProject(id: string, opts?: { focusStudio?: boolean }): Promise<void> {
  desiredProjectId = id
  shellState = { ...shellState, activeId: id, showHub: false }
  notifyShell()
  if (opts?.focusStudio !== false) {
    navBridge?.openFullscreen()
  }
  await call('/active', { method: 'PUT', body: { projectId: id } }).catch(() => {})
}

export function openAppHub(): void {
  shellState = { ...shellState, showHub: true }
  notifyShell()
  navBridge?.openFullscreen()
}

export function openMediaConfigModal(tab: MediaKind): void {
  shellState = { ...shellState, mediaConfigTab: tab }
  notifyShell()
}

export function updateMediaStatus(media: MediaStatus): void {
  shellState = { ...shellState, media }
  notifyShell()
}

export function registerImportTrigger(fn: (() => void) | null): void {
  importTriggerHandler = fn
}

export function triggerAppImport(): void {
  importTriggerHandler?.()
}

/* ─────────── 跨组件同步总线（常驻主导航栏 / 幕境工作台 / AI 导演副驾 / 工具卡片共享） ─────────── */

export interface StudioFocusIntent {
  tab?: WorkspaceTab
  projectId?: string
  openSplit?: boolean
  openFullscreen?: boolean
  openDirector?: boolean
  exitHub?: boolean
  reloadProjects?: boolean
}

type StudioListener = (intent: StudioFocusIntent) => void

export interface HostNavigationBridge {
  openSplit: () => void
  toggleSplit: () => void
  openFullscreen: () => void
  openClassicChat: () => void
  openPlugins: () => void
  openSettings: () => void
  newDirectorSession: () => void
  newChatSession: () => void
  openSessionInStudio: (sessionId: string) => void
  openSessionInChat: (sessionId: string) => void
  isSplitOpen: () => boolean
  isStudioActive: () => boolean
}

let desiredTab: WorkspaceTab = 'drama'
let desiredProjectId: string | null = null
let navBridge: HostNavigationBridge | null = null
const listeners = new Set<StudioListener>()

let directorSender: ((text: string) => boolean) | null = null
let pendingDirectorPrompt: string | null = null
let pendingPromptTimer: ReturnType<typeof setInterval> | null = null

function clearPendingPromptTimer(): void {
  if (pendingPromptTimer !== null) {
    clearInterval(pendingPromptTimer)
    pendingPromptTimer = null
  }
}

function tryDeliverPendingPrompt(): boolean {
  if (!pendingDirectorPrompt || !directorSender) return false
  const prompt = pendingDirectorPrompt
  pendingDirectorPrompt = null
  if (directorSender(prompt)) {
    clearPendingPromptTimer()
    return true
  }
  pendingDirectorPrompt = prompt
  return false
}

export function setStudioBridge(bridge: HostNavigationBridge | null): void {
  navBridge = bridge
}

export function getStudioBridge(): HostNavigationBridge | null {
  return navBridge
}

export function getDesiredStudioState(): { tab: WorkspaceTab; projectId: string | null } {
  return { tab: desiredTab, projectId: desiredProjectId }
}

export function subscribeStudioIntent(fn: StudioListener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function emitStudioIntent(intent: StudioFocusIntent): void {
  if (intent.tab) desiredTab = intent.tab
  if (intent.projectId) {
    desiredProjectId = intent.projectId
    patchAppShellState({ activeId: intent.projectId, showHub: false })
  }
  if (intent.exitHub) {
    patchAppShellState({ showHub: false })
  }
  if (intent.openFullscreen) {
    navBridge?.openFullscreen()
  } else if (intent.openSplit) {
    if (navBridge?.isStudioActive()) {
      intent = { ...intent, openDirector: true, exitHub: intent.projectId ? true : intent.exitHub }
    } else {
      navBridge?.openSplit()
    }
  }
  for (const fn of listeners) {
    try { fn(intent) } catch {}
  }
}

export function registerDirectorSender(fn: ((text: string) => boolean) | null): void {
  directorSender = fn
  if (fn && pendingDirectorPrompt) {
    tryDeliverPendingPrompt()
  }
}

export function dispatchDirectorPrompt(prompt: string, options?: { tab?: WorkspaceTab; freshSession?: boolean }): void {
  const clean = prompt.trim()
  if (!clean) return
  clearPendingPromptTimer()
  if (options?.freshSession) {
    navBridge?.newDirectorSession()
  }
  emitStudioIntent({ tab: options?.tab, openDirector: true, openFullscreen: true })
  if (!options?.freshSession && directorSender && directorSender(clean)) {
    return
  }
  pendingDirectorPrompt = clean
  const deadline = Date.now() + 2500
  const startAfter = options?.freshSession ? Date.now() + 120 : Date.now()
  pendingPromptTimer = setInterval(() => {
    if (Date.now() < startAfter) return
    if (!pendingDirectorPrompt || tryDeliverPendingPrompt() || Date.now() >= deadline) {
      clearPendingPromptTimer()
    }
  }, 50)
}

export function summarizeProject(snap: CanvasProject): ProjectSummary {
  const coverUrl = snap.drama?.casts.find(c => c.imageUrl)?.imageUrl
    ?? snap.drama?.episodes[0]?.shots.find(s => s.keyframeUrl)?.keyframeUrl
    ?? snap.nodes.find(n => n.type === 'image' && n.url)?.url
  return {
    id: snap.id,
    title: snap.title,
    updatedAt: snap.updatedAt,
    nodeCount: snap.nodes.length,
    aspectRatio: snap.drama?.aspectRatio,
    style: snap.drama?.style,
    castCount: snap.drama?.casts.length ?? 0,
    episodeCount: snap.drama?.episodes.length ?? 0,
    clipCount: snap.timeline?.clips.length ?? 0,
    coverUrl,
  }
}
