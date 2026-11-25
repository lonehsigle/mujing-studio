/** 画布项目的文件存储：每个项目一个 JSON，写入原子化，单项目串行，支持项目内撤销/重做与导入导出。 */

import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CanvasEdge,
  CanvasNode,
  CanvasOp,
  CanvasProject,
  DramaCast,
  DramaCastKind,
  DramaData,
  DramaEpisode,
  DramaSegment,
  DramaShot,
  HandoffMode,
  NodeStatus,
  NodeType,
  ProjectSummary,
  TimelineAudioClip,
  TimelineClip,
  TimelineState,
} from './types.ts'

const ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_HISTORY = 40

const DEFAULT_SIZE: Record<NodeType, [number, number]> = {
  text: [320, 200],
  image: [320, 320],
  video: [384, 216],
  audio: [320, 128],
}

export const NODE_TYPES: readonly NodeType[] = ['text', 'image', 'video', 'audio']

export class ProjectNotFoundError extends Error {
  readonly code = 'MUJING_PROJECT_NOT_FOUND'
  constructor(id: string) { super(`画布项目不存在：${id}`) }
}

export class CanvasOpError extends Error {
  readonly code = 'MUJING_INVALID_OP'
}

export function shortId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 10)}`
}

interface SnapshotEntry {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  drama?: DramaData
  timeline?: TimelineState
}

function takeSnapshot(p: CanvasProject): SnapshotEntry {
  return structuredClone({
    nodes: p.nodes,
    edges: p.edges,
    ...(p.drama !== undefined ? { drama: p.drama } : {}),
    ...(p.timeline !== undefined ? { timeline: p.timeline } : {}),
  })
}

function restoreSnapshot(p: CanvasProject, snap: SnapshotEntry): void {
  const cloned = structuredClone(snap)
  p.nodes = cloned.nodes
  p.edges = cloned.edges
  p.drama = cloned.drama
  p.timeline = cloned.timeline
}

function sanitizeStatus(raw: unknown, fallback: NodeStatus = 'idle'): NodeStatus {
  if (raw === 'success' || raw === 'error' || raw === 'idle') return raw
  if (raw === 'loading') return 'idle'
  return fallback
}

function sanitizeDrama(raw: unknown): DramaData | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const obj = raw as Record<string, unknown>
  const aspectRatio: DramaData['aspectRatio'] = obj.aspectRatio === '16:9' || obj.aspectRatio === '1:1' ? obj.aspectRatio : '9:16'
  const rawCasts = Array.isArray(obj.casts) ? obj.casts : []
  const casts: DramaCast[] = rawCasts
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null && !Array.isArray(c) && typeof (c as Record<string, unknown>).name === 'string' && Boolean((c as Record<string, unknown>).name))
    .map(c => {
      const kind: DramaCastKind = c.kind === 'scene' || c.kind === 'prop' ? c.kind : 'character'
      const name = String(c.name).trim()
      const appearance = typeof c.appearance === 'string' ? c.appearance : ''
      return {
        id: typeof c.id === 'string' && ID.test(c.id) ? c.id : shortId('cast'),
        kind,
        name,
        ...(typeof c.role === 'string' && c.role.trim() ? { role: c.role.trim() } : {}),
        appearance,
        imagePrompt: typeof c.imagePrompt === 'string' && c.imagePrompt.trim() ? c.imagePrompt : `${name}，${appearance}`,
        ...(typeof c.voice === 'string' && c.voice.trim() ? { voice: c.voice.trim() } : {}),
        ...(typeof c.imageNodeId === 'string' && c.imageNodeId ? { imageNodeId: c.imageNodeId } : {}),
        ...(typeof c.imageUrl === 'string' && c.imageUrl ? { imageUrl: c.imageUrl } : {}),
        ...(typeof c.locked === 'boolean' ? { locked: c.locked } : {}),
      }
    })

  const rawEpisodes = Array.isArray(obj.episodes) ? obj.episodes : []
  const episodes: DramaEpisode[] = rawEpisodes
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null && !Array.isArray(e))
    .map((e, epIdx) => {
      const num = typeof e.number === 'number' && Number.isFinite(e.number) && e.number >= 1 ? Math.floor(e.number) : epIdx + 1
      const rawShots = Array.isArray(e.shots) ? e.shots : []
      const shots: DramaShot[] = rawShots
        .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null && !Array.isArray(s))
        .map(s => {
          const transition = s.transition === 'fadeblack' || s.transition === 'fadewhite' ? s.transition : s.transition === 'cut' ? 'cut' : undefined
          return {
            id: typeof s.id === 'string' && ID.test(s.id) ? s.id : shortId('shot'),
            segmentIndex: typeof s.segmentIndex === 'number' && Number.isFinite(s.segmentIndex) && s.segmentIndex >= 0 ? Math.floor(s.segmentIndex) : 0,
            scene: typeof s.scene === 'string' ? s.scene : '主场景',
            shotSize: typeof s.shotSize === 'string' ? s.shotSize : '中景',
            camera: typeof s.camera === 'string' ? s.camera : '固定',
            action: typeof s.action === 'string' ? s.action : '',
            ...(typeof s.imagePrompt === 'string' && s.imagePrompt ? { imagePrompt: s.imagePrompt } : {}),
            ...(typeof s.videoPrompt === 'string' && s.videoPrompt ? { videoPrompt: s.videoPrompt } : {}),
            ...(typeof s.speaker === 'string' && s.speaker ? { speaker: s.speaker } : {}),
            ...(typeof s.dialogue === 'string' && s.dialogue ? { dialogue: s.dialogue } : {}),
            durationMs: typeof s.durationMs === 'number' && Number.isFinite(s.durationMs) && s.durationMs >= 500 ? Math.round(s.durationMs) : 3500,
            ...(Array.isArray(s.castIds) ? { castIds: s.castIds.filter((x): x is string => typeof x === 'string') } : {}),
            ...(transition ? { transition } : {}),
            ...(typeof s.keyframeNodeId === 'string' && s.keyframeNodeId ? { keyframeNodeId: s.keyframeNodeId } : {}),
            ...(typeof s.keyframeUrl === 'string' && s.keyframeUrl ? { keyframeUrl: s.keyframeUrl } : {}),
            ...(typeof s.audioNodeId === 'string' && s.audioNodeId ? { audioNodeId: s.audioNodeId } : {}),
            ...(typeof s.audioUrl === 'string' && s.audioUrl ? { audioUrl: s.audioUrl } : {}),
          }
        })
      const rawSegs = Array.isArray(e.segments) ? e.segments : []
      const segments: DramaSegment[] = rawSegs
        .filter((g): g is Record<string, unknown> => typeof g === 'object' && g !== null && !Array.isArray(g))
        .map((g, segIdx) => {
          const handoff: HandoffMode = g.handoff === 'continue' || g.handoff === 'reverse_angle' ? g.handoff : 'scene_cut'
          return {
            id: typeof g.id === 'string' && ID.test(g.id) ? g.id : shortId('seg'),
            index: typeof g.index === 'number' && Number.isFinite(g.index) && g.index >= 0 ? Math.floor(g.index) : segIdx,
            title: typeof g.title === 'string' && g.title.trim() ? g.title.trim() : `第${num}集·第${segIdx + 1}段`,
            handoff,
            durationMs: typeof g.durationMs === 'number' && Number.isFinite(g.durationMs) && g.durationMs >= 500 ? Math.round(g.durationMs) : 5000,
            prompt: typeof g.prompt === 'string' ? g.prompt : '',
            ...(typeof g.videoNodeId === 'string' && g.videoNodeId ? { videoNodeId: g.videoNodeId } : {}),
            ...(typeof g.firstFrameUrl === 'string' && g.firstFrameUrl ? { firstFrameUrl: g.firstFrameUrl } : {}),
            status: sanitizeStatus(g.status),
            ...(typeof g.error === 'string' && g.error ? { error: g.error } : {}),
          }
        })
      return {
        id: typeof e.id === 'string' && ID.test(e.id) ? e.id : shortId('ep'),
        number: num,
        title: typeof e.title === 'string' && e.title.trim() ? e.title.trim() : `第${num}集`,
        synopsis: typeof e.synopsis === 'string' ? e.synopsis : '',
        ...(typeof e.hook === 'string' && e.hook ? { hook: e.hook } : {}),
        ...(typeof e.cliffhanger === 'string' && e.cliffhanger ? { cliffhanger: e.cliffhanger } : {}),
        ...(typeof e.sourceText === 'string' && e.sourceText ? { sourceText: e.sourceText } : {}),
        shots,
        segments,
        ...(typeof e.finalVideoUrl === 'string' && e.finalVideoUrl ? { finalVideoUrl: e.finalVideoUrl } : {}),
        ...(typeof e.subtitleSrt === 'string' && e.subtitleSrt ? { subtitleSrt: e.subtitleSrt } : {}),
      }
    })

  return {
    ...(typeof obj.genre === 'string' && obj.genre.trim() ? { genre: obj.genre.trim() } : {}),
    ...(typeof obj.logline === 'string' && obj.logline.trim() ? { logline: obj.logline.trim() } : {}),
    style: typeof obj.style === 'string' && obj.style.trim() ? obj.style.trim() : '电影级真人短剧，细腻自然光影，8K质感',
    aspectRatio,
    language: typeof obj.language === 'string' && obj.language.trim() ? obj.language.trim() : '中文普通话',
    segmentTargetSec: typeof obj.segmentTargetSec === 'number' && Number.isFinite(obj.segmentTargetSec)
      ? Math.max(3, Math.min(15, Math.round(obj.segmentTargetSec)))
      : 8,
    ...(typeof obj.novelText === 'string' && obj.novelText ? { novelText: obj.novelText } : {}),
    casts,
    episodes,
  }
}

function sanitizeTimeline(raw: unknown): TimelineState | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const obj = raw as Record<string, unknown>
  const rawClips = Array.isArray(obj.clips) ? obj.clips : []
  const clips: TimelineClip[] = rawClips
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null && !Array.isArray(c) && typeof (c as Record<string, unknown>).url === 'string' && Boolean((c as Record<string, unknown>).url))
    .map((c, idx) => {
      const rawAudioClips = Array.isArray(c.audioClips) ? c.audioClips : []
      const audioClips: TimelineAudioClip[] = rawAudioClips
        .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null && !Array.isArray(a) && typeof (a as Record<string, unknown>).url === 'string' && Boolean((a as Record<string, unknown>).url))
        .map(a => ({
          url: String(a.url),
          ...(typeof a.nodeId === 'string' && a.nodeId ? { nodeId: a.nodeId } : {}),
          ...(typeof a.startOffsetMs === 'number' && Number.isFinite(a.startOffsetMs) && a.startOffsetMs >= 0 ? { startOffsetMs: Math.round(a.startOffsetMs) } : {}),
          ...(typeof a.durationMs === 'number' && Number.isFinite(a.durationMs) && a.durationMs > 0 ? { durationMs: Math.round(a.durationMs) } : {}),
          ...(typeof a.title === 'string' && a.title ? { title: a.title } : {}),
        }))
      return {
        id: typeof c.id === 'string' && ID.test(c.id) ? c.id : shortId('clip'),
        ...(typeof c.nodeId === 'string' && c.nodeId ? { nodeId: c.nodeId } : {}),
        title: typeof c.title === 'string' && c.title.trim() ? c.title.trim() : `片段 ${idx + 1}`,
        url: String(c.url),
        durationMs: typeof c.durationMs === 'number' && Number.isFinite(c.durationMs) && c.durationMs >= 500 ? Math.round(c.durationMs) : 5000,
        ...(typeof c.caption === 'string' ? { caption: c.caption } : {}),
        ...(typeof c.audioNodeId === 'string' && c.audioNodeId ? { audioNodeId: c.audioNodeId } : {}),
        ...(typeof c.audioUrl === 'string' && c.audioUrl ? { audioUrl: c.audioUrl } : {}),
        ...(audioClips.length > 0 ? { audioClips } : {}),
      }
    })
  return {
    clips,
    ...(typeof obj.burnSubtitles === 'boolean' ? { burnSubtitles: obj.burnSubtitles } : {}),
    ...(typeof obj.outputUrl === 'string' && obj.outputUrl ? { outputUrl: obj.outputUrl } : {}),
    ...(typeof obj.subtitleSrt === 'string' ? { subtitleSrt: obj.subtitleSrt } : {}),
    ...(typeof obj.subtitleAssetUrl === 'string' && obj.subtitleAssetUrl ? { subtitleAssetUrl: obj.subtitleAssetUrl } : {}),
    status: sanitizeStatus(obj.status),
    ...(typeof obj.error === 'string' && obj.error ? { error: obj.error } : {}),
    updatedAt: typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) ? obj.updatedAt : Date.now(),
  }
}

export class ProjectStore {
  /** 项目变化事件：`change`(project)、`delete`(id)。 */
  readonly events = new EventEmitter()
  private readonly locks = new Map<string, Promise<unknown>>()
  private readonly undoStacks = new Map<string, SnapshotEntry[]>()
  private readonly redoStacks = new Map<string, SnapshotEntry[]>()
  private readonly dir: string

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'projects')
    this.events.setMaxListeners(0)
  }

  private file(id: string): string {
    if (!ID.test(id)) throw new ProjectNotFoundError(id)
    return join(this.dir, `${id}.json`)
  }

  /** 同一项目的读改写串行执行，避免 Agent 与 UI 并发写丢更新。 */
  private serial<T>(id: string, task: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve()
    const next = prev.then(task, task)
    const tail = next.catch(() => {})
    this.locks.set(id, tail)
    void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id) })
    return next
  }

  historyStatus(id: string): { canUndo: boolean; canRedo: boolean } {
    return {
      canUndo: (this.undoStacks.get(id)?.length ?? 0) > 0,
      canRedo: (this.redoStacks.get(id)?.length ?? 0) > 0,
    }
  }

  private pushUndo(id: string, snap: SnapshotEntry): void {
    const stack = this.undoStacks.get(id) ?? []
    stack.push(snap)
    if (stack.length > MAX_HISTORY) stack.shift()
    this.undoStacks.set(id, stack)
    this.redoStacks.delete(id)
  }

  async list(): Promise<ProjectSummary[]> {
    await mkdir(this.dir, { recursive: true })
    const out: ProjectSummary[] = []
    for (const name of await readdir(this.dir)) {
      if (!name.endsWith('.json')) continue
      try {
        const p = await this.get(name.slice(0, -5))
        const coverUrl = p.drama?.casts.find(c => c.imageUrl)?.imageUrl
          ?? p.nodes.find(n => n.type === 'image' && n.url)?.url
        out.push({
          id: p.id,
          title: p.title,
          updatedAt: p.updatedAt,
          nodeCount: p.nodes.length,
          ...(p.drama?.aspectRatio ? { aspectRatio: p.drama.aspectRatio } : {}),
          ...(p.drama?.style ? { style: p.drama.style } : {}),
          ...(p.drama?.casts.length ? { castCount: p.drama.casts.length } : {}),
          ...(p.drama?.episodes.length ? { episodeCount: p.drama.episodes.length } : {}),
          ...(p.timeline?.clips.length ? { clipCount: p.timeline.clips.length } : {}),
          ...(coverUrl ? { coverUrl } : {}),
        })
      } catch { /* 跳过损坏文件 */ }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(id: string): Promise<CanvasProject> {
    let text: string
    try {
      text = await readFile(this.file(id), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ProjectNotFoundError(id)
      throw error
    }
    return JSON.parse(text) as CanvasProject
  }

  private async write(project: CanvasProject): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const target = this.file(project.id)
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmp, JSON.stringify(project, null, 2))
    await rename(tmp, target)
  }

  async create(title: string): Promise<CanvasProject> {
    const now = Date.now()
    const project: CanvasProject = {
      id: shortId('p'), title: title.trim() || '未命名画布', createdAt: now, updatedAt: now, rev: 1, nodes: [], edges: [],
    }
    await this.write(project)
    this.events.emit('change', project)
    return project
  }

  /** 导入外部画布 JSON（生成新 id，保留节点、连线、短剧与时间线结构）。 */
  async importProject(payload: Partial<CanvasProject>): Promise<CanvasProject> {
    const now = Date.now()
    const id = shortId('p')
    const nodes = Array.isArray(payload.nodes)
      ? payload.nodes.filter(n => n && typeof n.id === 'string' && NODE_TYPES.includes(n.type)).map(n => {
        const [dw, dh] = DEFAULT_SIZE[n.type]
        return {
          ...n,
          x: Number.isFinite(n.x) ? n.x : 80,
          y: Number.isFinite(n.y) ? n.y : 80,
          width: Number.isFinite(n.width) && n.width > 0 ? n.width : dw,
          height: Number.isFinite(n.height) && n.height > 0 ? n.height : dh,
          status: n.status === 'loading' ? 'idle' : (n.status ?? (n.url ? 'success' : 'idle')),
        } satisfies CanvasNode
      })
      : []
    const validIds = new Set(nodes.map(n => n.id))
    const edges = Array.isArray(payload.edges)
      ? payload.edges.filter(e => e && validIds.has(e.source) && validIds.has(e.target) && e.source !== e.target).map(e => ({
        id: typeof e.id === 'string' && ID.test(e.id) ? e.id : shortId('e'),
        source: e.source,
        target: e.target,
      }))
      : []
    const drama = sanitizeDrama(payload.drama)
    const timeline = sanitizeTimeline(payload.timeline)
    const project: CanvasProject = {
      id,
      title: (typeof payload.title === 'string' ? payload.title.trim() : '') || '导入画布',
      createdAt: now,
      updatedAt: now,
      rev: 1,
      nodes,
      edges,
      ...(drama ? { drama } : {}),
      ...(timeline ? { timeline } : {}),
    }
    await this.write(project)
    this.events.emit('change', project)
    return project
  }

  async rename(id: string, title: string): Promise<CanvasProject> {
    return this.mutate(id, p => { p.title = title.trim() || p.title }, false)
  }

  async remove(id: string): Promise<void> {
    await this.serial(id, async () => {
      await this.get(id)
      await rm(this.file(id), { force: true })
    })
    this.undoStacks.delete(id)
    this.redoStacks.delete(id)
    this.events.emit('delete', id)
  }

  /** 应用一组画布操作；任一操作非法则整组不落盘。返回新项目与新增节点 id。 */
  async apply(id: string, ops: readonly CanvasOp[], recordUndo = true): Promise<{ project: CanvasProject; created: string[] }> {
    const created: string[] = []
    // 纯状态轮询写入（loading/success/error）不污染用户撤销栈
    const isStatusOnly = ops.length > 0 && ops.every(o => {
      if (o.op !== 'update_node') return false
      const keys = Object.keys(o).filter(k => k !== 'op' && k !== 'id')
      return keys.every(k => k === 'status' || k === 'error' || k === 'url' || k === 'model' || k === 'durationMs')
    })
    const project = await this.mutate(id, p => {
      for (const op of ops) applyOp(p, op, created)
    }, recordUndo && !isStatusOnly)
    return { project, created }
  }

  /** 直接变更项目的扩展域（如 drama / timeline）。 */
  async updateDomain(id: string, fn: (p: CanvasProject) => void, recordUndo = true): Promise<CanvasProject> {
    return this.mutate(id, fn, recordUndo)
  }

  async undo(id: string): Promise<{ project: CanvasProject; undone: boolean; changed: boolean }> {
    let undone = false
    const project = await this.serial(id, async () => {
      const p = await this.get(id)
      const stack = this.undoStacks.get(id)
      const prev = stack?.pop()
      if (prev === undefined) return p
      const redo = this.redoStacks.get(id) ?? []
      redo.push(takeSnapshot(p))
      this.redoStacks.set(id, redo)
      restoreSnapshot(p, prev)
      p.rev += 1
      p.updatedAt = Date.now()
      await this.write(p)
      undone = true
      return p
    })
    if (undone) this.events.emit('change', project)
    return { project, undone, changed: undone }
  }

  async redo(id: string): Promise<{ project: CanvasProject; redone: boolean; changed: boolean }> {
    let redone = false
    const project = await this.serial(id, async () => {
      const p = await this.get(id)
      const stack = this.redoStacks.get(id)
      const next = stack?.pop()
      if (next === undefined) return p
      const undo = this.undoStacks.get(id) ?? []
      undo.push(takeSnapshot(p))
      this.undoStacks.set(id, undo)
      restoreSnapshot(p, next)
      p.rev += 1
      p.updatedAt = Date.now()
      await this.write(p)
      redone = true
      return p
    })
    if (redone) this.events.emit('change', project)
    return { project, redone, changed: redone }
  }

  private async mutate(id: string, fn: (p: CanvasProject) => void, recordUndo = true): Promise<CanvasProject> {
    const project = await this.serial(id, async () => {
      const p = await this.get(id)
      const before = recordUndo ? takeSnapshot(p) : undefined
      fn(p)
      if (before !== undefined) this.pushUndo(id, before)
      p.rev += 1
      p.updatedAt = Date.now()
      await this.write(p)
      return p
    })
    this.events.emit('change', project)
    return project
  }
}

function findNode(p: CanvasProject, id: string): CanvasNode {
  const node = p.nodes.find(n => n.id === id)
  if (node === undefined) throw new CanvasOpError(`节点不存在：${id}`)
  return node
}

/** 新节点默认放在现有节点右侧，避免叠放。 */
function nextPosition(p: CanvasProject): { x: number; y: number } {
  if (p.nodes.length === 0) return { x: 80, y: 80 }
  const right = Math.max(...p.nodes.map(n => n.x + n.width))
  const top = Math.min(...p.nodes.map(n => n.y))
  return { x: right + 60, y: top }
}

const PATCHABLE = ['x', 'y', 'width', 'height', 'title', 'content', 'prompt', 'voice', 'url', 'status', 'error', 'model', 'durationMs'] as const

function applyOp(p: CanvasProject, op: CanvasOp, created: string[]): void {
  switch (op.op) {
    case 'add_node': {
      if (!NODE_TYPES.includes(op.type)) throw new CanvasOpError(`未知节点类型：${String(op.type)}`)
      const id = op.id !== undefined && ID.test(op.id) && !p.nodes.some(n => n.id === op.id) ? op.id : shortId('n')
      const [w, h] = DEFAULT_SIZE[op.type]
      const pos = nextPosition(p)
      const node: CanvasNode = {
        id, type: op.type,
        x: op.x ?? pos.x, y: op.y ?? pos.y, width: op.width ?? w, height: op.height ?? h,
        status: op.status ?? (op.url !== undefined ? 'success' : 'idle'),
      }
      for (const key of ['title', 'content', 'prompt', 'voice', 'url', 'model', 'durationMs'] as const) {
        if (op[key] !== undefined) (node as unknown as Record<string, unknown>)[key] = op[key]
      }
      p.nodes.push(node)
      created.push(id)
      return
    }
    case 'update_node': {
      const node = findNode(p, op.id)
      for (const key of PATCHABLE) {
        if (op[key] !== undefined) (node as unknown as Record<string, unknown>)[key] = op[key]
      }
      return
    }
    case 'delete_node': {
      findNode(p, op.id)
      p.nodes = p.nodes.filter(n => n.id !== op.id)
      p.edges = p.edges.filter(e => e.source !== op.id && e.target !== op.id)
      return
    }
    case 'connect': {
      findNode(p, op.source)
      findNode(p, op.target)
      if (op.source === op.target) throw new CanvasOpError('不能连接节点自身')
      if (!p.edges.some(e => e.source === op.source && e.target === op.target)) {
        const edge: CanvasEdge = { id: shortId('e'), source: op.source, target: op.target }
        p.edges.push(edge)
      }
      return
    }
    case 'disconnect': {
      p.edges = p.edges.filter(e => !(e.source === op.source && e.target === op.target))
      return
    }
    default:
      throw new CanvasOpError(`未知操作：${JSON.stringify(op)}`)
  }
}
