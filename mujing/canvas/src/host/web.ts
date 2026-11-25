/** 幕境画布、短剧流水线与时间线导出的 HTTP 接口（挂在 dsh webServer 的 /mujing 前缀下，沿用 dsh Cookie 鉴权）。 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: {
      register(route: {
        kind: 'prefix' | 'exact'
        path: string
        handler: (req: IncomingMessage, res: ServerResponse) => unknown
      }): () => void
    }
  }
}
import { ASSET_PREFIX, extFromMime, MediaConfigError, MediaUpstreamError, mimeOf, type MediaConfigPatch, type MediaKind } from './media.ts'
import { CanvasOpError, ProjectNotFoundError } from './store.ts'
import type { CanvasOp, CanvasProject, DramaCast, DramaShot, HandoffMode } from './types.ts'

export const name = 'mujing-web'
export const inject = ['mujing', 'webServer']

const API = '/mujing/api'
const MAX_JSON_BODY = 10 * 1024 * 1024
const MAX_UPLOAD_BODY = 80 * 1024 * 1024

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

async function readBody(req: IncomingMessage, maxBytes = MAX_JSON_BODY): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > maxBytes) throw new HttpError(413, '请求体过大')
    chunks.push(chunk as Buffer)
  }
  if (size === 0) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch {
    throw new HttpError(400, '请求体必须是 JSON 对象')
  }
}

async function readRawBytes(req: IncomingMessage, maxBytes = MAX_UPLOAD_BODY): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > maxBytes) throw new HttpError(413, '上传文件过大（上限 80MB）')
    chunks.push(chunk as Buffer)
  }
  return new Uint8Array(Buffer.concat(chunks))
}

function statusOf(error: unknown): number {
  if (error instanceof HttpError) return error.status
  if (error instanceof ProjectNotFoundError) return 404
  if (error instanceof CanvasOpError) return 400
  if (error instanceof MediaConfigError) return 412
  if (error instanceof MediaUpstreamError) return 502
  return 500
}

export type ByteRangeParseResult =
  | { kind: 'ok'; start: number; end: number }
  | { kind: 'unsatisfiable' }
  | { kind: 'ignore' }

/** 按 RFC 9110 解析单段 HTTP Range（支持 bytes=start-end、bytes=start- 与后缀 bytes=-suffix）。 */
export function parseByteRange(header: string, totalSize: number): ByteRangeParseResult {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return { kind: 'ignore' }
  const [, rawStart, rawEnd] = m
  if (!rawStart && !rawEnd) return { kind: 'unsatisfiable' }
  if (totalSize <= 0) return { kind: 'unsatisfiable' }

  if (!rawStart) {
    // 后缀范围 bytes=-N：取最后 N 个字节
    const suffix = Number.parseInt(rawEnd, 10)
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: 'unsatisfiable' }
    const start = Math.max(0, totalSize - suffix)
    return { kind: 'ok', start, end: totalSize - 1 }
  }

  const start = Number.parseInt(rawStart, 10)
  if (!Number.isFinite(start) || start < 0 || start >= totalSize) return { kind: 'unsatisfiable' }
  const end = rawEnd ? Math.min(totalSize - 1, Number.parseInt(rawEnd, 10)) : totalSize - 1
  if (!Number.isFinite(end) || end < start) return { kind: 'unsatisfiable' }
  return { kind: 'ok', start, end }
}

export function apply(ctx: Context): void {
  const mujing = ctx.mujing

  const api = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://local')
    const parts = url.pathname.slice(API.length).split('/').filter(Boolean)
    const method = req.method ?? 'GET'
    try {
      // GET /config
      if (parts[0] === 'config' && parts.length === 1 && method === 'GET') {
        send(res, 200, { ...mujing.media.status(), activeProjectId: mujing.activeProjectId ?? null })
        return
      }
      // GET /media-config — 获取多模态模型详细配置（密钥已脱敏）
      if (parts[0] === 'media-config' && parts.length === 1 && method === 'GET') {
        send(res, 200, mujing.media.getConfigDetails())
        return
      }
      // PUT /media-config — 保存多模态模型配置并热生效
      if (parts[0] === 'media-config' && parts.length === 1 && method === 'PUT') {
        const body = await readBody(req)
        const out = await mujing.media.updateConfig(body as MediaConfigPatch)
        send(res, 200, { ...out.status, config: out.config })
        return
      }
      // POST /media-config/reset — 恢复指定或全部模态的环境变量默认配置
      if (parts[0] === 'media-config' && parts[1] === 'reset' && parts.length === 2 && method === 'POST') {
        const body = await readBody(req)
        const kind: MediaKind | undefined = body.kind === 'image' || body.kind === 'video' || body.kind === 'audio' ? body.kind : undefined
        const out = await mujing.media.resetConfig(kind)
        send(res, 200, { ...out.status, config: out.config })
        return
      }
      // POST /media-config/reset-health — 清除指定或全部模态的接口熔断冷却与轮询统计
      if (parts[0] === 'media-config' && parts[1] === 'reset-health' && parts.length === 2 && method === 'POST') {
        const body = await readBody(req)
        const kind: MediaKind | undefined = body.kind === 'image' || body.kind === 'video' || body.kind === 'audio' ? body.kind : undefined
        const out = mujing.media.resetHealth(kind)
        send(res, 200, { ...out.status, config: out.config })
        return
      }
      // PUT /active  { projectId }
      if (parts[0] === 'active' && parts.length === 1 && method === 'PUT') {
        const body = await readBody(req)
        const id = typeof body.projectId === 'string' ? body.projectId : undefined
        if (id !== undefined) await mujing.store.get(id)
        mujing.activeProjectId = id
        send(res, 200, { activeProjectId: id ?? null })
        return
      }

      // POST /assets/upload?filename=xxx — 本地媒体上传落盘
      if (parts[0] === 'assets' && parts[1] === 'upload' && parts.length === 2 && method === 'POST') {
        const ct = req.headers['content-type'] ?? ''
        const filenameParam = url.searchParams.get('filename') ?? ''
        if (ct.includes('application/json')) {
          const body = await readBody(req, MAX_UPLOAD_BODY)
          const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : ''
          const fileName = typeof body.filename === 'string' ? body.filename : filenameParam
          const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
          if (!m) throw new HttpError(400, '无效的 dataUrl')
          const bytes = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
          const ext = extname(fileName) || extFromMime(m[1] ?? null, '.bin')
          const assetUrl = await mujing.media.saveAsset(bytes, ext)
          const probed = await mujing.media.probeMedia(assetUrl).catch(() => null)
          send(res, 201, { url: assetUrl, ...(probed ? { meta: probed } : {}) })
          return
        }
        const raw = await readRawBytes(req)
        if (raw.byteLength === 0) throw new HttpError(400, '上传文件内容为空')
        const ext = extname(filenameParam) || extFromMime(ct || null, '.bin')
        const assetUrl = await mujing.media.saveAsset(raw, ext)
        const probed = await mujing.media.probeMedia(assetUrl).catch(() => null)
        send(res, 201, { url: assetUrl, ...(probed ? { meta: probed } : {}) })
        return
      }

      if (parts[0] !== 'projects') throw new HttpError(404, '未知接口')

      // /projects
      if (parts.length === 1) {
        if (method === 'GET') { send(res, 200, await mujing.store.list()); return }
        if (method === 'POST') {
          const body = await readBody(req)
          const created = await mujing.store.create(typeof body.title === 'string' ? body.title : '')
          mujing.activeProjectId = created.id
          if (typeof body.aspectRatio === 'string' || typeof body.style === 'string' || typeof body.genre === 'string') {
            const aspectRatio = body.aspectRatio === '9:16' || body.aspectRatio === '1:1' || body.aspectRatio === '16:9'
              ? body.aspectRatio
              : undefined
            const withDrama = await mujing.saveDrama(created.id, {
              genre: typeof body.genre === 'string' ? body.genre : undefined,
              style: typeof body.style === 'string' ? body.style : undefined,
              aspectRatio,
              syncCanvasNodes: false,
            })
            send(res, 201, withDrama)
            return
          }
          send(res, 201, created)
          return
        }
        throw new HttpError(405, '不支持的方法')
      }

      // POST /projects/import — 导入画布 JSON
      if (parts[1] === 'import' && parts.length === 2 && method === 'POST') {
        const body = await readBody(req)
        const payload = (typeof body.project === 'object' && body.project !== null ? body.project : body) as Partial<CanvasProject>
        const imported = await mujing.store.importProject(payload)
        mujing.activeProjectId = imported.id
        send(res, 201, imported)
        return
      }

      const id = parts[1]

      // /projects/:id
      if (parts.length === 2) {
        if (method === 'GET') {
          const project = await mujing.store.get(id)
          send(res, 200, { ...project, history: mujing.store.historyStatus(id) })
          return
        }
        if (method === 'PATCH') {
          const body = await readBody(req)
          send(res, 200, await mujing.store.rename(id, typeof body.title === 'string' ? body.title : ''))
          return
        }
        if (method === 'DELETE') {
          await mujing.store.remove(id)
          if (mujing.activeProjectId === id) mujing.activeProjectId = undefined
          send(res, 200, { ok: true })
          return
        }
        throw new HttpError(405, '不支持的方法')
      }

      // GET /projects/:id/export — 导出画布 JSON
      if (parts[2] === 'export' && parts.length === 3 && method === 'GET') {
        const project = await mujing.store.get(id)
        const filename = encodeURIComponent(`${project.title || project.id}.mujing.json`)
        const text = JSON.stringify(project, null, 2)
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename*=UTF-8''${filename}`,
          'cache-control': 'no-store',
        })
        res.end(text)
        return
      }

      // POST /projects/:id/ops  { ops: CanvasOp[] }
      if (parts[2] === 'ops' && parts.length === 3 && method === 'POST') {
        const body = await readBody(req)
        if (!Array.isArray(body.ops)) throw new HttpError(400, 'ops 必须是数组')
        const { project, created } = await mujing.store.apply(id, body.ops as CanvasOp[])
        send(res, 200, { project, created, history: mujing.store.historyStatus(id) })
        return
      }

      // POST /projects/:id/undo & /redo
      if (parts[2] === 'undo' && parts.length === 3 && method === 'POST') {
        const out = await mujing.store.undo(id)
        send(res, 200, { ...out, history: mujing.store.historyStatus(id) })
        return
      }
      if (parts[2] === 'redo' && parts.length === 3 && method === 'POST') {
        const out = await mujing.store.redo(id)
        send(res, 200, { ...out, history: mujing.store.historyStatus(id) })
        return
      }

      // POST /projects/:id/generate  { kind, nodeId?, prompt, voice?, size?, duration?, ratio?, referenceNodeIds? }
      if (parts[2] === 'generate' && parts.length === 3 && method === 'POST') {
        const body = await readBody(req)
        const kind = body.kind === 'video' ? 'video' : body.kind === 'image' ? 'image' : body.kind === 'audio' ? 'audio' : undefined
        if (kind === undefined) throw new HttpError(400, 'kind 必须是 image、video 或 audio')
        if (typeof body.prompt !== 'string' || body.prompt.trim() === '') throw new HttpError(400, '提示词/台词不能为空')
        const { nodeId } = await mujing.startGeneration({
          projectId: id,
          kind,
          prompt: body.prompt,
          nodeId: typeof body.nodeId === 'string' ? body.nodeId : undefined,
          title: typeof body.title === 'string' ? body.title : undefined,
          voice: typeof body.voice === 'string' ? body.voice : undefined,
          size: typeof body.size === 'string' ? body.size : undefined,
          duration: typeof body.duration === 'number' ? body.duration : undefined,
          ratio: typeof body.ratio === 'string' ? body.ratio : undefined,
          referenceNodeIds: Array.isArray(body.referenceNodeIds) ? body.referenceNodeIds.filter((x): x is string => typeof x === 'string') : undefined,
        })
        send(res, 202, { nodeId })
        return
      }

      // POST /projects/:id/cancel  { nodeId }
      if (parts[2] === 'cancel' && parts.length === 3 && method === 'POST') {
        const body = await readBody(req)
        send(res, 200, { cancelled: typeof body.nodeId === 'string' && mujing.cancelGeneration(body.nodeId) })
        return
      }

      /* ───────────────────────── 短剧制作流水线接口 ───────────────────────── */

      // PUT /projects/:id/drama — 保存世界观/小说/角色/分集分镜
      if (parts[2] === 'drama' && parts.length === 3 && method === 'PUT') {
        const body = await readBody(req)
        const aspectRatio = body.aspectRatio === '9:16' || body.aspectRatio === '1:1' || body.aspectRatio === '16:9'
          ? body.aspectRatio
          : undefined
        const project = await mujing.saveDrama(id, {
          genre: typeof body.genre === 'string' ? body.genre : undefined,
          logline: typeof body.logline === 'string' ? body.logline : undefined,
          style: typeof body.style === 'string' ? body.style : undefined,
          aspectRatio,
          language: typeof body.language === 'string' ? body.language : undefined,
          segmentTargetSec: typeof body.segmentTargetSec === 'number' ? body.segmentTargetSec : undefined,
          novelText: typeof body.novelText === 'string' ? body.novelText : undefined,
          casts: Array.isArray(body.casts) ? (body.casts as Array<Partial<DramaCast> & { name: string }>) : undefined,
          episodes: Array.isArray(body.episodes)
            ? (body.episodes as Array<{
              id?: string
              number: number
              title: string
              synopsis?: string
              hook?: string
              cliffhanger?: string
              sourceText?: string
              shots?: Array<Partial<DramaShot> & { action: string }>
            }>)
            : undefined,
          syncCanvasNodes: body.syncCanvasNodes !== false,
        })
        send(res, 200, project)
        return
      }

      // POST /projects/:id/drama/sync-canvas
      if (parts[2] === 'drama' && parts[3] === 'sync-canvas' && parts.length === 4 && method === 'POST') {
        send(res, 200, await mujing.syncDramaToCanvas(id))
        return
      }

      // POST /projects/:id/drama/generate-casts  { castId? }
      if (parts[2] === 'drama' && parts[3] === 'generate-casts' && parts.length === 4 && method === 'POST') {
        const body = await readBody(req)
        const castId = typeof body.castId === 'string' ? body.castId : undefined
        const out = await mujing.generateDramaCastImage(id, castId)
        send(res, 200, out)
        return
      }

      // PATCH /projects/:id/drama/shot  { episode, shotId?, shotIndex?, delete?, resegment?, patch? }
      if (parts[2] === 'drama' && parts[3] === 'shot' && parts.length === 4 && method === 'PATCH') {
        const body = await readBody(req)
        const ep = typeof body.episode === 'number' || typeof body.episode === 'string' ? body.episode : 1
        const project = await mujing.updateDramaShot(id, ep, {
          shotId: typeof body.shotId === 'string' ? body.shotId : undefined,
          shotIndex: typeof body.shotIndex === 'number' ? body.shotIndex : undefined,
          delete: Boolean(body.delete),
          resegment: Boolean(body.resegment),
          patch: (typeof body.patch === 'object' && body.patch !== null ? body.patch : undefined) as Partial<DramaShot> | undefined,
        })
        send(res, 200, project)
        return
      }

      // POST /projects/:id/drama/shot-media  { episode, kind: 'keyframe' | 'audio', shotId?, shotIndex? }
      if (parts[2] === 'drama' && parts[3] === 'shot-media' && parts.length === 4 && method === 'POST') {
        const body = await readBody(req)
        const ep = typeof body.episode === 'number' || typeof body.episode === 'string' ? body.episode : 1
        const kind = body.kind === 'audio' ? 'audio' : 'keyframe'
        const out = await mujing.generateDramaShotMedia(id, ep, {
          kind,
          shotId: typeof body.shotId === 'string' ? body.shotId : undefined,
          shotIndex: typeof body.shotIndex === 'number' ? body.shotIndex : undefined,
        })
        send(res, 200, out)
        return
      }

      // PATCH /projects/:id/drama/segment  { episodeId, segmentIndex, handoff?, prompt? }
      if (parts[2] === 'drama' && parts[3] === 'segment' && parts.length === 4 && method === 'PATCH') {
        const body = await readBody(req)
        const episodeId = typeof body.episodeId === 'string' || typeof body.episodeId === 'number' ? String(body.episodeId) : ''
        const segmentIndex = typeof body.segmentIndex === 'number' ? body.segmentIndex : -1
        if (!episodeId || segmentIndex < 0) throw new HttpError(400, '需要提供 episodeId 与 segmentIndex')
        const handoff = body.handoff === 'continue' || body.handoff === 'reverse_angle' || body.handoff === 'scene_cut'
          ? (body.handoff as HandoffMode)
          : undefined
        const project = await mujing.updateDramaSegment(id, episodeId, segmentIndex, {
          handoff,
          prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
        })
        send(res, 200, project)
        return
      }

      // POST /projects/:id/drama/run-episode  { episode, segmentIndex?, forceRegenerate? }
      if (parts[2] === 'drama' && parts[3] === 'run-episode' && parts.length === 4 && method === 'POST') {
        const body = await readBody(req)
        const ep = typeof body.episode === 'number' || typeof body.episode === 'string' ? body.episode : 1
        const out = await mujing.runDramaEpisode(id, ep, {
          segmentIndex: typeof body.segmentIndex === 'number' ? body.segmentIndex : undefined,
          forceRegenerate: Boolean(body.forceRegenerate),
        })
        send(res, 200, out)
        return
      }

      // POST /projects/:id/drama/to-timeline  { episode, autoRender? }
      if (parts[2] === 'drama' && parts[3] === 'to-timeline' && parts.length === 4 && method === 'POST') {
        const body = await readBody(req)
        const ep = typeof body.episode === 'number' || typeof body.episode === 'string' ? body.episode : 1
        const project = await mujing.populateTimelineFromEpisode(id, ep, Boolean(body.autoRender))
        send(res, 200, project)
        return
      }

      /* ───────────────────────── 时间线合成与剪映导出接口 ───────────────────────── */

      // PUT /projects/:id/timeline  { clips, burnSubtitles? }
      if (parts[2] === 'timeline' && parts.length === 3 && method === 'PUT') {
        const body = await readBody(req)
        if (!Array.isArray(body.clips)) throw new HttpError(400, 'clips 必须是数组')
        const project = await mujing.saveTimeline(id, {
          clips: body.clips as Array<{
            id?: string
            nodeId?: string
            title?: string
            url?: string
            durationMs?: number
            caption?: string
            audioNodeId?: string
            audioUrl?: string
            audioClips?: Array<{ url?: string; nodeId?: string; startOffsetMs?: number; durationMs?: number; title?: string }>
          }>,
          burnSubtitles: typeof body.burnSubtitles === 'boolean' ? body.burnSubtitles : undefined,
        })
        send(res, 200, project)
        return
      }

      // POST /projects/:id/timeline/render — FFmpeg 合成 MP4 成片
      if (parts[2] === 'timeline' && parts[3] === 'render' && parts.length === 4 && method === 'POST') {
        const project = await mujing.renderTimeline(id)
        send(res, 200, project)
        return
      }

      // POST /projects/:id/timeline/export-jianying  { draftRoot?, draftName? }
      if (parts[2] === 'timeline' && parts[3] === 'export-jianying' && parts.length === 4 && method === 'POST') {
        const body = await readBody(req)
        const out = await mujing.exportJianyingDraft(id, {
          draftRoot: typeof body.draftRoot === 'string' ? body.draftRoot : undefined,
          draftName: typeof body.draftName === 'string' ? body.draftName : undefined,
        })
        send(res, 200, out)
        return
      }

      // GET /projects/:id/events  — SSE：项目每次变化推送完整快照 + 撤销/重做状态
      if (parts[2] === 'events' && parts.length === 3 && method === 'GET') {
        const first = await mujing.store.get(id)
        const LF = String.fromCharCode(10)
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no',
        })
        const push = (event: string, data: unknown): void => {
          res.write(`event: ${event}${LF}data: ${JSON.stringify(data)}${LF}${LF}`)
        }
        push('snapshot', { ...first, history: mujing.store.historyStatus(id) })
        const onChange = (p: CanvasProject): void => {
          if (p.id === id) push('snapshot', { ...p, history: mujing.store.historyStatus(id) })
        }
        const onDelete = (deleted: string): void => { if (deleted === id) { push('deleted', { id }); res.end() } }
        const heartbeat = setInterval(() => res.write(`: ping${LF}${LF}`), 15_000)
        const cleanup = (): void => {
          clearInterval(heartbeat)
          mujing.store.events.off('change', onChange)
          mujing.store.events.off('delete', onDelete)
        }
        mujing.store.events.on('change', onChange)
        mujing.store.events.on('delete', onDelete)
        req.on('close', cleanup)
        return
      }

      throw new HttpError(404, '未知接口')
    } catch (error) {
      if (res.headersSent) { res.end(); return }
      send(res, statusOf(error), { error: error instanceof Error ? error.message : String(error) })
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API, handler: (req, res) => api(req, res) }))

  // 生成与上传产物：/mujing/assets/<file>（支持 HTTP Range，供浏览器 <video>/<audio> 拖动进度条）
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ASSET_PREFIX.slice(0, -1),
    handler: async (req, res) => {
      const BS = String.fromCharCode(92)
      let name: string
      try {
        name = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname.slice(ASSET_PREFIX.length))
      } catch {
        send(res, 400, { error: '非法路径编码' })
        return
      }
      if (!name || name.includes('/') || name.includes(BS) || name.includes('..')) { send(res, 400, { error: '非法路径' }); return }
      const file = join(mujing.media.assetsDir, name)
      try {
        const info = await stat(file)
        const mime = mimeOf(name)
        const range = req.headers.range
        if (range) {
          const parsed = parseByteRange(range, info.size)
          if (parsed.kind === 'unsatisfiable') {
            res.writeHead(416, {
              'content-range': `bytes */${info.size}`,
              'accept-ranges': 'bytes',
            })
            res.end()
            return
          }
          if (parsed.kind === 'ok') {
            const { start, end } = parsed
            res.writeHead(206, {
              'content-type': mime,
              'content-range': `bytes ${start}-${end}/${info.size}`,
              'accept-ranges': 'bytes',
              'content-length': String(end - start + 1),
              'cache-control': 'private, max-age=31536000, immutable',
            })
            if (req.method === 'HEAD') { res.end(); return }
            createReadStream(file, { start, end }).pipe(res)
            return
          }
        }
        res.writeHead(200, {
          'content-type': mime,
          'accept-ranges': 'bytes',
          'content-length': String(info.size),
          'cache-control': 'private, max-age=31536000, immutable',
        })
        if (req.method === 'HEAD') { res.end(); return }
        createReadStream(file).pipe(res)
      } catch {
        send(res, 404, { error: '资产不存在' })
      }
    },
  }))
}
