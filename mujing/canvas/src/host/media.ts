/**
 * 媒体生成与本地处理：
 *  - 图片：OpenAI 兼容 Images API 或火山方舟 Seedream；
 *  - 视频：OpenAI Videos API 或火山方舟 Seedance（支持首帧 first_frame + 多参考图）；
 *  - 音频：OpenAI 兼容 /audio/speech（同时兼容二进制流返回与 JSON URL/b64 返回）；
 *  - 本地媒体工具：FFprobe 探测元数据、FFmpeg 抽取视频尾帧、FFmpeg 多片段拼接与 SRT 字幕生成。
 */

import { execFile, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { extname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function resolveWorkingBinary(envVars: string[], defaultCmd: string, fallbacks: string[]): string {
  const candidates = [...envVars.map(k => process.env[k]), defaultCmd, ...fallbacks].filter((x): x is string => Boolean(x))
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore', timeout: 3000 })
      return bin
    } catch { /* try next candidate */ }
  }
  return defaultCmd
}

const FFMPEG_BIN = resolveWorkingBinary(['MUJING_FFMPEG_BIN', 'FFMPEG_PATH'], 'ffmpeg', [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
])

const FFPROBE_BIN = resolveWorkingBinary(['MUJING_FFPROBE_BIN', 'FFPROBE_PATH'], 'ffprobe', [
  '/opt/homebrew/bin/ffprobe',
  '/usr/local/bin/ffprobe',
])

export interface ImageProviderConfig {
  /** OpenAI 兼容服务根地址，含 /v1，例如 https://api.openai.com/v1 */
  baseURL?: string
  /** 用户在工作台手动保存的 API Key（优先于环境变量） */
  apiKey?: string
  apiKeyEnv: string
  model: string
  size: string
  /** openai：参考图走 /images/edits（multipart）；ark：参考图以 image 字段随 /images/generations 提交（Seedream）。 */
  flavor: 'openai' | 'ark'
}

export interface VideoProviderConfig {
  baseURL?: string
  apiKey?: string
  apiKeyEnv: string
  model: string
  /** openai：POST /videos；ark：POST /contents/generations/tasks（Seedance）。 */
  flavor: 'openai' | 'ark'
  /** 默认时长（秒）。 */
  duration: number
  ratio: string
  pollIntervalMs: number
  timeoutMs: number
}

export interface AudioProviderConfig {
  /** OpenAI 兼容 TTS 服务根地址，含 /v1，例如 https://api.openai.com/v1 */
  baseURL?: string
  apiKey?: string
  apiKeyEnv: string
  model: string
  voice: string
  format: 'mp3' | 'wav'
}

export type MediaKind = 'image' | 'video' | 'audio'
export type RoutingStrategy = 'round_robin' | 'failover' | 'random'

export interface EndpointMeta {
  id: string
  name: string
  enabled: boolean
  /** 动态轮询/随机调度权重（1-10，默认 1） */
  weight: number
}

export type ImageEndpointConfig = ImageProviderConfig & EndpointMeta
export type VideoEndpointConfig = VideoProviderConfig & EndpointMeta
export type AudioEndpointConfig = AudioProviderConfig & EndpointMeta

interface EndpointHealth {
  totalRequests: number
  successCount: number
  failCount: number
  consecutiveFails: number
  lastUsedAt?: number
  lastError?: string
  cooldownUntil?: number
}

interface MediaPool<T extends EndpointMeta> {
  strategy: RoutingStrategy
  autoFailover: boolean
  cursor: number
  endpoints: T[]
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

export interface ImageEndpointPatch {
  id?: string
  name?: string
  enabled?: boolean
  weight?: number
  baseURL?: string
  apiKey?: string
  clearApiKey?: boolean
  cloneKeyFromId?: string
  apiKeyEnv?: string
  model?: string
  size?: string
  flavor?: 'openai' | 'ark'
}

export interface VideoEndpointPatch {
  id?: string
  name?: string
  enabled?: boolean
  weight?: number
  baseURL?: string
  apiKey?: string
  clearApiKey?: boolean
  cloneKeyFromId?: string
  apiKeyEnv?: string
  model?: string
  flavor?: 'openai' | 'ark'
  duration?: number
  ratio?: string
}

export interface AudioEndpointPatch {
  id?: string
  name?: string
  enabled?: boolean
  weight?: number
  baseURL?: string
  apiKey?: string
  clearApiKey?: boolean
  cloneKeyFromId?: string
  apiKeyEnv?: string
  model?: string
  voice?: string
  format?: 'mp3' | 'wav'
}

export interface MediaPoolPatch<T> {
  strategy?: RoutingStrategy
  autoFailover?: boolean
  endpoints?: T[]
}

export interface MediaConfigPatch {
  image?: MediaPoolPatch<ImageEndpointPatch> & Partial<ImageEndpointPatch>
  video?: MediaPoolPatch<VideoEndpointPatch> & Partial<VideoEndpointPatch>
  audio?: MediaPoolPatch<AudioEndpointPatch> & Partial<AudioEndpointPatch>
}

interface PersistedPool<T> {
  strategy?: RoutingStrategy
  autoFailover?: boolean
  endpoints?: Array<Partial<T>>
}

interface PersistedMediaConfig {
  version?: number
  image?: PersistedPool<ImageEndpointConfig> | Partial<ImageProviderConfig>
  video?: PersistedPool<VideoEndpointConfig> | Partial<VideoProviderConfig>
  audio?: PersistedPool<AudioEndpointConfig> | Partial<AudioProviderConfig>
}

const COOLDOWN_BASE_MS = 15_000
const COOLDOWN_MAX_MS = 60_000

function normalizeStrategy(v: unknown, fallback: RoutingStrategy = 'round_robin'): RoutingStrategy {
  return v === 'round_robin' || v === 'failover' || v === 'random' ? v : fallback
}

function clampWeight(v: unknown, fallback = 1): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.min(10, Math.round(n)))
}

function makeEndpointId(kind: MediaKind): string {
  return `${kind}-${randomUUID().slice(0, 8)}`
}

function maskApiKey(key: string): string {
  const s = key.trim()
  if (!s) return ''
  if (s.length <= 6) return '••••'
  if (s.length <= 10) return `${s.slice(0, 2)}••••${s.slice(-2)}`
  return `${s.slice(0, 4)}••••${s.slice(-4)}`
}

/** 将带权重节点展开为尽量均匀交错的轮询序列，例如 [A(2), B(1)] => [A, B, A]。 */
function buildInterleavedSlots<T extends { weight: number }>(items: T[]): T[] {
  if (items.length <= 1) return [...items]
  const counts = items.map(it => clampWeight(it.weight, 1))
  const total = counts.reduce((a, b) => a + b, 0)
  const current = items.map(() => 0)
  const slots: T[] = []
  for (let i = 0; i < total; i++) {
    let bestIdx = 0
    for (let j = 0; j < items.length; j++) {
      current[j] += counts[j]
      if (current[j] > current[bestIdx]) bestIdx = j
    }
    current[bestIdx] -= total
    slots.push(items[bestIdx])
  }
  return slots
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && error.name === 'AbortError'
}

export class MediaConfigError extends Error {
  readonly code = 'MUJING_MEDIA_NOT_CONFIGURED'
}

export class MediaUpstreamError extends Error {
  readonly code = 'MUJING_MEDIA_UPSTREAM'
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.srt': 'text/plain; charset=utf-8',
}

export function mimeOf(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

export function extFromMime(mime: string | null, fallback: string): string {
  const clean = mime?.split(';')[0]?.trim().toLowerCase() ?? null
  const hit = Object.entries(MIME).find(([, m]) => clean !== null && m.split(';')[0] === clean)
  return hit?.[0] ?? fallback
}

const DEFAULT_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024 // 100 MB
const DEFAULT_MAX_REF_BYTES = 30 * 1024 * 1024 // 30 MB

const BLOCKED_METADATA_HOSTS = new Set([
  '169.254.169.254',
  '169.254.170.2',
  'metadata.google.internal',
  'metadata.goog',
  'fd00:ec2::254',
  '0.0.0.0',
  '::',
])

function maxDownloadBytes(fallback = DEFAULT_MAX_DOWNLOAD_BYTES): number {
  const raw = Number(process.env.MUJING_MAX_DOWNLOAD_BYTES)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

function stripIpv6Brackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

function isPrivateOrReservedIp(rawIp: string): boolean {
  const ip = stripIpv6Brackets(rawIp).toLowerCase()
  const mapped = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  const ver = isIP(mapped)
  if (ver === 4) {
    const [a, b] = mapped.split('.').map(n => Number.parseInt(n, 10))
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }
  if (isIP(ip) === 6) {
    if (ip === '::' || ip === '::1') return true
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true // fc00::/7 ULA
    if (/^fe[89ab]/i.test(ip)) return true // fe80::/10 link-local
    return false
  }
  return false
}

/** 校验用户配置的媒体端点 Base URL：仅允许 http/https，并禁止云元数据地址。 */
export function validateEndpointBaseUrl(rawUrl: string): void {
  const trimmed = rawUrl.trim()
  if (!trimmed) return
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new MediaConfigError(`接口地址格式无效：${trimmed}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new MediaConfigError(`接口地址仅支持 http/https 协议：${parsed.protocol}`)
  }
  const host = stripIpv6Brackets(parsed.hostname).toLowerCase()
  if (BLOCKED_METADATA_HOSTS.has(host)) {
    throw new MediaConfigError(`禁止将云元数据或保留地址配置为媒体端点：${host}`)
  }
}

/**
 * 校验远程下载 / 参考图 URL，防范 SSRF：
 *  - 仅允许 http / https 协议；
 *  - 始终拦截云元数据地址（169.254.169.254 等）；
 *  - 默认拦截内网/回环地址（除非该 origin 已在媒体端点配置中显式信任，或开启 MUJING_ALLOW_PRIVATE_URLS=1）。
 */
export async function assertSafeRemoteUrl(
  rawUrl: string,
  opts?: { allowedOrigins?: ReadonlySet<string>; allowPrivate?: boolean; label?: string },
): Promise<URL> {
  const label = opts?.label ?? '远程资源'
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new MediaUpstreamError(`${label}地址格式无效`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new MediaUpstreamError(`${label}仅允许 http/https 协议（拒绝 ${parsed.protocol}）`)
  }
  const host = stripIpv6Brackets(parsed.hostname).toLowerCase()
  if (!host || BLOCKED_METADATA_HOSTS.has(host)) {
    throw new MediaUpstreamError(`${label}地址被安全策略拒绝：${host || rawUrl}`)
  }

  const allowPrivate = Boolean(opts?.allowPrivate)
    || process.env.MUJING_ALLOW_PRIVATE_URLS === '1'
    || process.env.MUJING_ALLOW_PRIVATE_URLS === 'true'
    || Boolean(opts?.allowedOrigins?.has(parsed.origin))

  if (allowPrivate) return parsed

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new MediaUpstreamError(`${label}不允许访问本机或内网域名：${host}`)
  }
  if (isIP(host) !== 0) {
    if (isPrivateOrReservedIp(host)) {
      throw new MediaUpstreamError(`${label}不允许访问内网或回环地址：${host}`)
    }
    return parsed
  }
  try {
    const resolved = await lookup(host, { all: true })
    for (const entry of resolved) {
      const addr = entry.address.toLowerCase()
      if (BLOCKED_METADATA_HOSTS.has(addr) || isPrivateOrReservedIp(addr)) {
        throw new MediaUpstreamError(`${label}域名解析到受限内网地址：${host} -> ${addr}`)
      }
    }
  } catch (error) {
    if (error instanceof MediaUpstreamError) throw error
    // 域名解析失败留给后续 fetch 返回标准网络错误
  }
  return parsed
}

/** 带字节上限的流式响应读取，防止大文件或恶意响应导致内存 OOM。 */
export async function readResponseBytesWithLimit(
  res: Response,
  limitBytes: number,
  label = '下载内容',
): Promise<Uint8Array> {
  const cl = Number(res.headers.get('content-length'))
  if (Number.isFinite(cl) && cl > limitBytes) {
    await res.body?.cancel().catch(() => {})
    throw new MediaUpstreamError(`${label}体积超限（${cl} > ${limitBytes} 字节）`)
  }
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > limitBytes) {
      throw new MediaUpstreamError(`${label}体积超限（${buf.byteLength} > ${limitBytes} 字节）`)
    }
    return buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > limitBytes) {
        await reader.cancel().catch(() => {})
        throw new MediaUpstreamError(`${label}体积超限（超过 ${limitBytes} 字节上限）`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export const ASSET_PREFIX = '/mujing/assets/'

export interface ProbedMedia {
  durationMs: number
  width: number
  height: number
  hasAudio: boolean
}

export class MediaService {
  readonly assetsDir: string
  private readonly dataDir: string
  private readonly configFile: string
  private readonly defaults: {
    image: ImageProviderConfig
    video: VideoProviderConfig
    audio: AudioProviderConfig
  }
  private imagePool: MediaPool<ImageEndpointConfig>
  private videoPool: MediaPool<VideoEndpointConfig>
  private audioPool: MediaPool<AudioEndpointConfig>
  private readonly health = new Map<string, EndpointHealth>()

  constructor(
    dataDir: string,
    image: ImageProviderConfig,
    video: VideoProviderConfig,
    audio: AudioProviderConfig,
  ) {
    this.dataDir = dataDir
    this.assetsDir = join(dataDir, 'assets')
    this.configFile = join(dataDir, 'media-config.json')
    this.defaults = {
      image: { ...image },
      video: { ...video },
      audio: { ...audio },
    }
    this.imagePool = this.makeDefaultImagePool()
    this.videoPool = this.makeDefaultVideoPool()
    this.audioPool = this.makeDefaultAudioPool()
    this.loadSavedConfigSync()
  }

  private makeDefaultImagePool(): MediaPool<ImageEndpointConfig> {
    return {
      strategy: 'round_robin',
      autoFailover: true,
      cursor: 0,
      endpoints: [{
        ...this.defaults.image,
        id: 'default-image',
        name: '默认生图接口',
        enabled: true,
        weight: 1,
      }],
    }
  }

  private makeDefaultVideoPool(): MediaPool<VideoEndpointConfig> {
    return {
      strategy: 'round_robin',
      autoFailover: true,
      cursor: 0,
      endpoints: [{
        ...this.defaults.video,
        id: 'default-video',
        name: '默认视频接口',
        enabled: true,
        weight: 1,
      }],
    }
  }

  private makeDefaultAudioPool(): MediaPool<AudioEndpointConfig> {
    return {
      strategy: 'round_robin',
      autoFailover: true,
      cursor: 0,
      endpoints: [{
        ...this.defaults.audio,
        id: 'default-audio',
        name: '默认配音接口',
        enabled: true,
        weight: 1,
      }],
    }
  }

  private normalizeImageEndpoint(raw: Partial<ImageEndpointConfig>, index: number): ImageEndpointConfig {
    return {
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : makeEndpointId('image'),
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `生图接口 #${index + 1}`,
      enabled: raw.enabled !== false,
      weight: clampWeight(raw.weight, 1),
      baseURL: typeof raw.baseURL === 'string' ? raw.baseURL.trim() : (this.defaults.image.baseURL ?? ''),
      ...(typeof raw.apiKey === 'string' && raw.apiKey.trim() ? { apiKey: raw.apiKey.trim() } : {}),
      apiKeyEnv: typeof raw.apiKeyEnv === 'string' ? raw.apiKeyEnv.trim() : this.defaults.image.apiKeyEnv,
      model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : this.defaults.image.model,
      size: typeof raw.size === 'string' && raw.size.trim() ? raw.size.trim() : this.defaults.image.size,
      flavor: raw.flavor === 'openai' || raw.flavor === 'ark' ? raw.flavor : this.defaults.image.flavor,
    }
  }

  private normalizeVideoEndpoint(raw: Partial<VideoEndpointConfig>, index: number): VideoEndpointConfig {
    const dur = typeof raw.duration === 'number' && Number.isFinite(raw.duration) && raw.duration >= 2 && raw.duration <= 20
      ? Math.round(raw.duration)
      : this.defaults.video.duration
    return {
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : makeEndpointId('video'),
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `视频接口 #${index + 1}`,
      enabled: raw.enabled !== false,
      weight: clampWeight(raw.weight, 1),
      baseURL: typeof raw.baseURL === 'string' ? raw.baseURL.trim() : (this.defaults.video.baseURL ?? ''),
      ...(typeof raw.apiKey === 'string' && raw.apiKey.trim() ? { apiKey: raw.apiKey.trim() } : {}),
      apiKeyEnv: typeof raw.apiKeyEnv === 'string' ? raw.apiKeyEnv.trim() : this.defaults.video.apiKeyEnv,
      model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : this.defaults.video.model,
      flavor: raw.flavor === 'openai' || raw.flavor === 'ark' ? raw.flavor : this.defaults.video.flavor,
      duration: dur,
      ratio: typeof raw.ratio === 'string' && raw.ratio.trim() ? raw.ratio.trim() : this.defaults.video.ratio,
      pollIntervalMs: this.defaults.video.pollIntervalMs,
      timeoutMs: this.defaults.video.timeoutMs,
    }
  }

  private normalizeAudioEndpoint(raw: Partial<AudioEndpointConfig>, index: number): AudioEndpointConfig {
    return {
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : makeEndpointId('audio'),
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `配音接口 #${index + 1}`,
      enabled: raw.enabled !== false,
      weight: clampWeight(raw.weight, 1),
      baseURL: typeof raw.baseURL === 'string' ? raw.baseURL.trim() : (this.defaults.audio.baseURL ?? ''),
      ...(typeof raw.apiKey === 'string' && raw.apiKey.trim() ? { apiKey: raw.apiKey.trim() } : {}),
      apiKeyEnv: typeof raw.apiKeyEnv === 'string' ? raw.apiKeyEnv.trim() : this.defaults.audio.apiKeyEnv,
      model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : this.defaults.audio.model,
      voice: typeof raw.voice === 'string' && raw.voice.trim() ? raw.voice.trim() : this.defaults.audio.voice,
      format: raw.format === 'mp3' || raw.format === 'wav' ? raw.format : this.defaults.audio.format,
    }
  }

  private loadSavedConfigSync(): void {
    try {
      if (!existsSync(this.configFile)) return
      const raw = JSON.parse(readFileSync(this.configFile, 'utf8')) as PersistedMediaConfig
      if (raw.image && typeof raw.image === 'object') {
        if ('endpoints' in raw.image && Array.isArray(raw.image.endpoints)) {
          const pool = raw.image as PersistedPool<ImageEndpointConfig>
          this.imagePool = {
            strategy: normalizeStrategy(pool.strategy),
            autoFailover: pool.autoFailover !== false,
            cursor: 0,
            endpoints: (pool.endpoints ?? []).map((ep, i) => this.normalizeImageEndpoint(ep, i)),
          }
        } else {
          // 兼容旧版单接口配置自动迁移为接口池
          this.imagePool = {
            strategy: 'round_robin',
            autoFailover: true,
            cursor: 0,
            endpoints: [this.normalizeImageEndpoint({ id: 'default-image', name: '默认生图接口', ...raw.image }, 0)],
          }
        }
      }
      if (raw.video && typeof raw.video === 'object') {
        if ('endpoints' in raw.video && Array.isArray(raw.video.endpoints)) {
          const pool = raw.video as PersistedPool<VideoEndpointConfig>
          this.videoPool = {
            strategy: normalizeStrategy(pool.strategy),
            autoFailover: pool.autoFailover !== false,
            cursor: 0,
            endpoints: (pool.endpoints ?? []).map((ep, i) => this.normalizeVideoEndpoint(ep, i)),
          }
        } else {
          this.videoPool = {
            strategy: 'round_robin',
            autoFailover: true,
            cursor: 0,
            endpoints: [this.normalizeVideoEndpoint({ id: 'default-video', name: '默认视频接口', ...raw.video }, 0)],
          }
        }
      }
      if (raw.audio && typeof raw.audio === 'object') {
        if ('endpoints' in raw.audio && Array.isArray(raw.audio.endpoints)) {
          const pool = raw.audio as PersistedPool<AudioEndpointConfig>
          this.audioPool = {
            strategy: normalizeStrategy(pool.strategy),
            autoFailover: pool.autoFailover !== false,
            cursor: 0,
            endpoints: (pool.endpoints ?? []).map((ep, i) => this.normalizeAudioEndpoint(ep, i)),
          }
        } else {
          this.audioPool = {
            strategy: 'round_robin',
            autoFailover: true,
            cursor: 0,
            endpoints: [this.normalizeAudioEndpoint({ id: 'default-audio', name: '默认配音接口', ...raw.audio }, 0)],
          }
        }
      }
    } catch {
      // 配置文件损坏时安全回退默认配置
    }
  }

  private async persistConfig(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    const payload: PersistedMediaConfig = {
      version: 2,
      image: {
        strategy: this.imagePool.strategy,
        autoFailover: this.imagePool.autoFailover,
        endpoints: this.imagePool.endpoints.map(ep => ({
          id: ep.id,
          name: ep.name,
          enabled: ep.enabled,
          weight: ep.weight,
          baseURL: ep.baseURL ?? '',
          ...(ep.apiKey ? { apiKey: ep.apiKey } : {}),
          apiKeyEnv: ep.apiKeyEnv,
          model: ep.model,
          size: ep.size,
          flavor: ep.flavor,
        })),
      },
      video: {
        strategy: this.videoPool.strategy,
        autoFailover: this.videoPool.autoFailover,
        endpoints: this.videoPool.endpoints.map(ep => ({
          id: ep.id,
          name: ep.name,
          enabled: ep.enabled,
          weight: ep.weight,
          baseURL: ep.baseURL ?? '',
          ...(ep.apiKey ? { apiKey: ep.apiKey } : {}),
          apiKeyEnv: ep.apiKeyEnv,
          model: ep.model,
          flavor: ep.flavor,
          duration: ep.duration,
          ratio: ep.ratio,
        })),
      },
      audio: {
        strategy: this.audioPool.strategy,
        autoFailover: this.audioPool.autoFailover,
        endpoints: this.audioPool.endpoints.map(ep => ({
          id: ep.id,
          name: ep.name,
          enabled: ep.enabled,
          weight: ep.weight,
          baseURL: ep.baseURL ?? '',
          ...(ep.apiKey ? { apiKey: ep.apiKey } : {}),
          apiKeyEnv: ep.apiKeyEnv,
          model: ep.model,
          voice: ep.voice,
          format: ep.format,
        })),
      },
    }
    const tmpFile = `${this.configFile}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
    await writeFile(tmpFile, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(tmpFile, this.configFile)
    await chmod(this.configFile, 0o600).catch(() => {})
  }

  private getHealth(id: string): EndpointHealth {
    let h = this.health.get(id)
    if (!h) {
      h = { totalRequests: 0, successCount: 0, failCount: 0, consecutiveFails: 0 }
      this.health.set(id, h)
    }
    return h
  }

  private recordSuccess(id: string): void {
    const h = this.getHealth(id)
    h.totalRequests += 1
    h.successCount += 1
    h.consecutiveFails = 0
    h.lastUsedAt = Date.now()
    delete h.lastError
    delete h.cooldownUntil
  }

  private recordFailure(id: string, error: unknown): void {
    const h = this.getHealth(id)
    h.totalRequests += 1
    h.failCount += 1
    h.consecutiveFails += 1
    h.lastUsedAt = Date.now()
    h.lastError = error instanceof Error ? error.message : String(error)
    const cooldownMs = Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * Math.min(4, h.consecutiveFails))
    h.cooldownUntil = Date.now() + cooldownMs
  }

  private resolveKey(c: { apiKey?: string; apiKeyEnv: string }): { key: string; source: 'custom' | 'env' | 'none' } {
    const custom = c.apiKey?.trim() ?? ''
    if (custom) return { key: custom, source: 'custom' }
    const envName = c.apiKeyEnv?.trim() ?? ''
    const envVal = envName ? (process.env[envName]?.trim() ?? '') : ''
    if (envVal) return { key: envVal, source: 'env' }
    return { key: '', source: 'none' }
  }

  private endpointReady(c: { enabled: boolean; baseURL?: string; apiKey?: string; apiKeyEnv: string }): boolean {
    return c.enabled && Boolean(c.baseURL?.trim()) && Boolean(this.resolveKey(c).key)
  }

  private endpointConfigured(c: { baseURL?: string; apiKey?: string; apiKeyEnv: string }): boolean {
    return Boolean(c.baseURL?.trim()) && Boolean(this.resolveKey(c).key)
  }

  private toEndpointBaseDetail(ep: EndpointMeta & { baseURL?: string; apiKey?: string; apiKeyEnv: string; model: string }): MediaEndpointDetailBase {
    const resolved = this.resolveKey(ep)
    const h = this.health.get(ep.id)
    const now = Date.now()
    const remaining = h?.cooldownUntil && h.cooldownUntil > now ? h.cooldownUntil - now : 0
    return {
      id: ep.id,
      name: ep.name,
      enabled: ep.enabled,
      weight: ep.weight,
      ready: this.endpointConfigured(ep),
      baseURL: ep.baseURL ?? '',
      model: ep.model,
      apiKeyEnv: ep.apiKeyEnv,
      hasApiKey: Boolean(resolved.key),
      apiKeySource: resolved.source,
      apiKeyMasked: maskApiKey(resolved.key),
      totalRequests: h?.totalRequests ?? 0,
      successCount: h?.successCount ?? 0,
      failCount: h?.failCount ?? 0,
      consecutiveFails: h?.consecutiveFails ?? 0,
      inCooldown: remaining > 0,
      cooldownRemainingMs: remaining,
      ...(h?.lastUsedAt ? { lastUsedAt: h.lastUsedAt } : {}),
      ...(h?.lastError ? { lastError: h.lastError } : {}),
    }
  }

  status(): {
    image: { ready: boolean; model: string; readyCount: number; totalCount: number; strategy: RoutingStrategy }
    video: { ready: boolean; model: string; readyCount: number; totalCount: number; strategy: RoutingStrategy }
    audio: { ready: boolean; model: string; voice: string; readyCount: number; totalCount: number; strategy: RoutingStrategy }
  } {
    const imgReady = this.imagePool.endpoints.filter(ep => this.endpointReady(ep))
    const vidReady = this.videoPool.endpoints.filter(ep => this.endpointReady(ep))
    const audReady = this.audioPool.endpoints.filter(ep => this.endpointReady(ep))
    const imgPrimary = imgReady[0] ?? this.imagePool.endpoints[0] ?? this.defaults.image
    const vidPrimary = vidReady[0] ?? this.videoPool.endpoints[0] ?? this.defaults.video
    const audPrimary = audReady[0] ?? this.audioPool.endpoints[0] ?? this.defaults.audio
    return {
      image: {
        ready: imgReady.length > 0,
        model: imgPrimary.model,
        readyCount: imgReady.length,
        totalCount: this.imagePool.endpoints.length,
        strategy: this.imagePool.strategy,
      },
      video: {
        ready: vidReady.length > 0,
        model: vidPrimary.model,
        readyCount: vidReady.length,
        totalCount: this.videoPool.endpoints.length,
        strategy: this.videoPool.strategy,
      },
      audio: {
        ready: audReady.length > 0,
        model: audPrimary.model,
        voice: audPrimary.voice,
        readyCount: audReady.length,
        totalCount: this.audioPool.endpoints.length,
        strategy: this.audioPool.strategy,
      },
    }
  }

  getConfigDetails(): MediaConfigDetails {
    const imageEndpoints: ImageEndpointDetail[] = this.imagePool.endpoints.map(ep => ({
      ...this.toEndpointBaseDetail(ep),
      size: ep.size,
      flavor: ep.flavor,
    }))
    const videoEndpoints: VideoEndpointDetail[] = this.videoPool.endpoints.map(ep => ({
      ...this.toEndpointBaseDetail(ep),
      flavor: ep.flavor,
      duration: ep.duration,
      ratio: ep.ratio,
    }))
    const audioEndpoints: AudioEndpointDetail[] = this.audioPool.endpoints.map(ep => ({
      ...this.toEndpointBaseDetail(ep),
      voice: ep.voice,
      format: ep.format,
    }))
    const imgReadyCount = this.imagePool.endpoints.filter(ep => this.endpointReady(ep)).length
    const vidReadyCount = this.videoPool.endpoints.filter(ep => this.endpointReady(ep)).length
    const audReadyCount = this.audioPool.endpoints.filter(ep => this.endpointReady(ep)).length
    return {
      image: {
        ready: imgReadyCount > 0,
        readyCount: imgReadyCount,
        enabledCount: this.imagePool.endpoints.filter(ep => ep.enabled).length,
        totalCount: this.imagePool.endpoints.length,
        strategy: this.imagePool.strategy,
        autoFailover: this.imagePool.autoFailover,
        cursor: this.imagePool.cursor,
        endpoints: imageEndpoints,
      },
      video: {
        ready: vidReadyCount > 0,
        readyCount: vidReadyCount,
        enabledCount: this.videoPool.endpoints.filter(ep => ep.enabled).length,
        totalCount: this.videoPool.endpoints.length,
        strategy: this.videoPool.strategy,
        autoFailover: this.videoPool.autoFailover,
        cursor: this.videoPool.cursor,
        endpoints: videoEndpoints,
      },
      audio: {
        ready: audReadyCount > 0,
        readyCount: audReadyCount,
        enabledCount: this.audioPool.endpoints.filter(ep => ep.enabled).length,
        totalCount: this.audioPool.endpoints.length,
        strategy: this.audioPool.strategy,
        autoFailover: this.audioPool.autoFailover,
        cursor: this.audioPool.cursor,
        endpoints: audioEndpoints,
      },
    }
  }

  private mergeApiKey(
    patch: { apiKey?: string; clearApiKey?: boolean; cloneKeyFromId?: string },
    prev?: { apiKey?: string },
    byId?: Map<string, { apiKey?: string }>,
  ): string | undefined {
    if (patch.clearApiKey) return undefined
    if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) return patch.apiKey.trim()
    if (prev?.apiKey) return prev.apiKey
    if (patch.cloneKeyFromId && byId?.get(patch.cloneKeyFromId)?.apiKey) {
      return byId.get(patch.cloneKeyFromId)!.apiKey
    }
    return undefined
  }

  private applyPoolPatch<
    TEp extends EndpointMeta & { baseURL?: string; apiKey?: string },
    TPatch extends { id?: string; baseURL?: string; apiKey?: string; clearApiKey?: boolean; cloneKeyFromId?: string },
  >(
    pool: MediaPool<TEp>,
    kind: MediaKind,
    patch: { strategy?: RoutingStrategy; autoFailover?: boolean; endpoints?: TPatch[] } & TPatch,
    normalize: (ep: Partial<TEp>, idx: number) => TEp,
    makeFallback: () => TEp,
  ): void {
    const prevById = new Map(pool.endpoints.map(ep => [ep.id, ep]))
    if (patch.strategy) pool.strategy = normalizeStrategy(patch.strategy, pool.strategy)
    if (typeof patch.autoFailover === 'boolean') pool.autoFailover = patch.autoFailover
    if (Array.isArray(patch.endpoints)) {
      const next = patch.endpoints.map((ep, idx) => {
        if (typeof ep.baseURL === 'string') validateEndpointBaseUrl(ep.baseURL)
        const id = typeof ep.id === 'string' && ep.id.trim() ? ep.id.trim() : makeEndpointId(kind)
        const prev = prevById.get(id)
        const apiKey = this.mergeApiKey(ep, prev, prevById)
        return normalize({ ...prev, ...ep, id, apiKey } as unknown as Partial<TEp>, idx)
      })
      pool.endpoints = next
      pool.cursor = 0
    } else {
      if (typeof patch.baseURL === 'string') validateEndpointBaseUrl(patch.baseURL)
      const first = pool.endpoints[0] ?? makeFallback()
      const apiKey = this.mergeApiKey(patch, first, prevById)
      pool.endpoints[0] = normalize({ ...first, ...patch, id: first.id, apiKey } as unknown as Partial<TEp>, 0)
    }
    for (const ep of pool.endpoints) this.clearCooldown(ep.id)
  }

  async updateConfig(patch: MediaConfigPatch): Promise<{ status: ReturnType<MediaService['status']>; config: MediaConfigDetails }> {
    if (patch.image) {
      this.applyPoolPatch(
        this.imagePool,
        'image',
        patch.image,
        (ep, idx) => this.normalizeImageEndpoint(ep, idx),
        () => this.makeDefaultImagePool().endpoints[0],
      )
    }
    if (patch.video) {
      this.applyPoolPatch(
        this.videoPool,
        'video',
        patch.video,
        (ep, idx) => this.normalizeVideoEndpoint(ep, idx),
        () => this.makeDefaultVideoPool().endpoints[0],
      )
    }
    if (patch.audio) {
      this.applyPoolPatch(
        this.audioPool,
        'audio',
        patch.audio,
        (ep, idx) => this.normalizeAudioEndpoint(ep, idx),
        () => this.makeDefaultAudioPool().endpoints[0],
      )
    }

    await this.persistConfig()
    return { status: this.status(), config: this.getConfigDetails() }
  }

  private clearCooldown(id: string): void {
    const h = this.health.get(id)
    if (h) {
      delete h.cooldownUntil
      h.consecutiveFails = 0
    }
  }

  resetHealth(kind?: MediaKind): { status: ReturnType<MediaService['status']>; config: MediaConfigDetails } {
    const clearPool = (eps: EndpointMeta[]): void => {
      for (const ep of eps) this.health.delete(ep.id)
    }
    if (!kind || kind === 'image') { clearPool(this.imagePool.endpoints); this.imagePool.cursor = 0 }
    if (!kind || kind === 'video') { clearPool(this.videoPool.endpoints); this.videoPool.cursor = 0 }
    if (!kind || kind === 'audio') { clearPool(this.audioPool.endpoints); this.audioPool.cursor = 0 }
    return { status: this.status(), config: this.getConfigDetails() }
  }

  async resetConfig(kind?: MediaKind): Promise<{ status: ReturnType<MediaService['status']>; config: MediaConfigDetails }> {
    if (!kind || kind === 'image') {
      for (const ep of this.imagePool.endpoints) this.health.delete(ep.id)
      this.imagePool = this.makeDefaultImagePool()
    }
    if (!kind || kind === 'video') {
      for (const ep of this.videoPool.endpoints) this.health.delete(ep.id)
      this.videoPool = this.makeDefaultVideoPool()
    }
    if (!kind || kind === 'audio') {
      for (const ep of this.audioPool.endpoints) this.health.delete(ep.id)
      this.audioPool = this.makeDefaultAudioPool()
    }
    if (!kind) {
      await rm(this.configFile, { force: true }).catch(() => {})
    } else {
      await this.persistConfig()
    }
    return { status: this.status(), config: this.getConfigDetails() }
  }

  /**
   * 按当前池的调度策略生成本次请求的候选接口队列：
   *  - 仅包含已启用且具备 Base URL + 有效 API Key 的接口；
   *  - 优先调度未处于熔断冷却期（healthy）的接口，冷却中接口按最早解冻时间排在末尾兜底；
   *  - round_robin：支持权重平滑交错轮询，每次调用推进游标；
   *  - failover：严格按列表优先级顺序尝试；
   *  - random：按权重随机选择首选接口，其余按随机顺序作为容错备选。
   */
  private selectCandidates<T extends EndpointMeta & { baseURL?: string; apiKey?: string; apiKeyEnv: string }>(
    pool: MediaPool<T>,
    kindLabel: '图片' | '视频' | '音频',
  ): Array<{ ep: T; base: string; key: string }> {
    const label = kindLabel === '图片' ? '生图' : kindLabel === '视频' ? '视频' : '配音'
    const readyList = pool.endpoints.filter(ep => this.endpointReady(ep))
    if (readyList.length === 0) {
      throw new MediaConfigError(`${kindLabel}生成未配置：请点击左下角「${label}」状态图标至少启用并配置一个有效接口与 API Key`)
    }
    const now = Date.now()
    const healthy: T[] = []
    const cooling: T[] = []
    for (const ep of readyList) {
      const h = this.health.get(ep.id)
      if (h?.cooldownUntil && h.cooldownUntil > now) {
        cooling.push(ep)
      } else {
        healthy.push(ep)
      }
    }
    cooling.sort((a, b) => (this.health.get(a.id)?.cooldownUntil ?? 0) - (this.health.get(b.id)?.cooldownUntil ?? 0))

    let orderedHealthy: T[]
    if (healthy.length <= 1) {
      orderedHealthy = healthy
    } else if (pool.strategy === 'failover') {
      orderedHealthy = healthy
    } else if (pool.strategy === 'random') {
      const remaining = [...healthy]
      orderedHealthy = []
      while (remaining.length > 0) {
        const totalW = remaining.reduce((acc, it) => acc + clampWeight(it.weight, 1), 0)
        let r = Math.random() * totalW
        let pickIdx = 0
        for (let i = 0; i < remaining.length; i++) {
          r -= clampWeight(remaining[i].weight, 1)
          if (r <= 0) { pickIdx = i; break }
        }
        orderedHealthy.push(remaining.splice(pickIdx, 1)[0])
      }
    } else {
      // round_robin：平滑权重动态轮询，同时把其余健康接口按轮询序排在后面供故障切换
      const slots = buildInterleavedSlots(healthy)
      const start = pool.cursor % slots.length
      pool.cursor = (start + 1) % slots.length
      const seen = new Set<string>()
      orderedHealthy = []
      for (let i = 0; i < slots.length; i++) {
        const cand = slots[(start + i) % slots.length]
        if (!seen.has(cand.id)) {
          seen.add(cand.id)
          orderedHealthy.push(cand)
        }
      }
    }

    const combined = [...orderedHealthy, ...cooling]
    const limited = pool.autoFailover ? combined : combined.slice(0, 1)
    return limited.map(ep => {
      const { key } = this.resolveKey(ep)
      const base = (ep.baseURL?.trim() ?? '').replace(/\/+$/, '')
      return { ep, base, key }
    })
  }

  private async runWithPool<T extends EndpointMeta & { baseURL?: string; apiKey?: string; apiKeyEnv: string; model: string }, R>(
    pool: MediaPool<T>,
    kindLabel: '图片' | '视频' | '音频',
    signal: AbortSignal | undefined,
    exec: (ep: T, creds: { base: string; key: string }) => Promise<R>,
  ): Promise<R> {
    const candidates = this.selectCandidates(pool, kindLabel)
    const errors: string[] = []
    for (const { ep, base, key } of candidates) {
      if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : new DOMException('已取消', 'AbortError'))
      try {
        const result = await exec(ep, { base, key })
        this.recordSuccess(ep.id)
        return result
      } catch (error) {
        if (isAbortError(error, signal)) throw error
        this.recordFailure(ep.id, error)
        const msg = error instanceof Error ? error.message : String(error)
        errors.push(`[${ep.name}] ${msg}`)
      }
    }
    if (errors.length === 1) {
      throw new MediaUpstreamError(errors[0])
    }
    throw new MediaUpstreamError(`${kindLabel}生成失败（已轮询尝试 ${errors.length} 个接口）：${errors.join('；')}`)
  }

  /** 解析本地资产绝对文件路径；外链返回 null。 */
  resolveAssetFile(url: string): string | null {
    if (!url.startsWith(ASSET_PREFIX)) return null
    const name = decodeURIComponent(url.slice(ASSET_PREFIX.length))
    if (!name || name.includes('/') || name.includes(String.fromCharCode(92)) || name.includes('..')) {
      throw new MediaUpstreamError(`非法资产路径：${url}`)
    }
    return join(this.assetsDir, name)
  }

  /** 确保媒体落在本地资产目录（若为外链则下载落盘），返回本地文件路径与资产 URL。 */
  async ensureLocalFile(url: string, fallbackExt: string, signal?: AbortSignal): Promise<{ file: string; url: string }> {
    const local = this.resolveAssetFile(url)
    if (local !== null) return { file: local, url }
    const saved = await this.download(url, fallbackExt, signal)
    const savedFile = this.resolveAssetFile(saved)
    if (savedFile === null) throw new MediaUpstreamError(`无法落盘媒体：${url}`)
    return { file: savedFile, url: saved }
  }

  /** 保存字节为本地资产，返回可访问 URL。 */
  async saveAsset(bytes: Uint8Array, ext: string): Promise<string> {
    await mkdir(this.assetsDir, { recursive: true })
    const safeExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
    const name = `${Date.now()}-${randomUUID().slice(0, 8)}${safeExt}`
    await writeFile(join(this.assetsDir, name), bytes)
    return ASSET_PREFIX + name
  }

  /** 把节点里的媒体地址转换成上游可读的形式：本地资产转 data URL，外链原样。 */
  async toUpstreamRef(url: string): Promise<string> {
    const file = this.resolveAssetFile(url)
    if (file === null) return url
    const bytes = await readFile(file)
    return `data:${mimeOf(file)};base64,${bytes.toString('base64')}`
  }

  /** 收集当前已配置的媒体端点 origin（用于放行本地 Mock / 自建推理服务，同时继续拦截任意第三方 SSRF）。 */
  private getAllowedDownloadOrigins(): Set<string> {
    const origins = new Set<string>()
    const all = [
      ...this.imagePool.endpoints,
      ...this.videoPool.endpoints,
      ...this.audioPool.endpoints,
    ]
    for (const ep of all) {
      if (!ep.baseURL?.trim()) continue
      try {
        origins.add(new URL(ep.baseURL.trim()).origin)
      } catch { /* ignore invalid */ }
    }
    return origins
  }

  private async download(url: string, fallbackExt: string, signal?: AbortSignal, limitBytes = maxDownloadBytes()): Promise<string> {
    if (url.startsWith('data:')) {
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url)
      if (m === null) throw new MediaUpstreamError('上游返回了无法解析的 data URL')
      const bytes = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
      if (bytes.byteLength > limitBytes) {
        throw new MediaUpstreamError(`上游返回的 data URL 体积超限（超过 ${limitBytes} 字节）`)
      }
      return this.saveAsset(bytes, extFromMime(m[1] ?? null, fallbackExt))
    }
    await assertSafeRemoteUrl(url, { allowedOrigins: this.getAllowedDownloadOrigins(), label: '下载生成结果' })
    const res = await fetch(url, { signal })
    if (!res.ok) throw new MediaUpstreamError(`下载生成结果失败：HTTP ${res.status}`)
    const bytes = await readResponseBytesWithLimit(res, limitBytes, '下载生成结果')
    return this.saveAsset(bytes, extFromMime(res.headers.get('content-type'), fallbackExt))
  }

  /** 生成一张图片；refs 为参考图 URL（本地资产或外链）。支持多接口动态轮询与失败自动切换。 */
  async generateImage(input: { prompt: string; size?: string; refs?: string[] }, signal?: AbortSignal): Promise<{ url: string; model: string }> {
    const rawRefs = input.refs ?? []
    const refs = await Promise.all(rawRefs.map(r => this.toUpstreamRef(r)))
    return this.runWithPool(this.imagePool, '图片', signal, async (ep, { base, key }) => {
      const size = input.size ?? ep.size
      let res: Response
      if (rawRefs.length > 0 && ep.flavor === 'openai') {
        const form = new FormData()
        form.set('model', ep.model)
        form.set('prompt', input.prompt)
        form.set('size', size)
        for (const [i, rawRef] of rawRefs.entries()) {
          const { blob, filename } = await this.loadRefBlob(rawRef, signal)
          const ext = extname(filename) || '.png'
          form.append('image[]', blob, `ref-${i}${ext}`)
        }
        res = await fetch(`${base}/images/edits`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal })
      } else {
        const body: Record<string, unknown> = { model: ep.model, prompt: input.prompt, size, n: 1 }
        if (ep.flavor === 'ark') {
          body.response_format = 'url'
          body.watermark = false
          if (refs.length > 0) body.image = refs.length === 1 ? refs[0] : refs
        }
        res = await fetch(`${base}/images/generations`, {
          method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
        })
      }
      const json = await readJson(res, '图片生成')
      const item = (json.data as Array<{ url?: string; b64_json?: string }> | undefined)?.[0]
      if (item?.b64_json) return { url: await this.saveAsset(Buffer.from(item.b64_json, 'base64'), '.png'), model: ep.model }
      if (item?.url) return { url: await this.download(item.url, '.png', signal), model: ep.model }
      throw new MediaUpstreamError(`图片生成返回中没有图片：${truncate(JSON.stringify(json))}`)
    })
  }

  /** 把本地资产、data URL 或外链加载为 Blob（供 OpenAI multipart 接口提交首帧/参考图）。 */
  private async loadRefBlob(url: string, signal?: AbortSignal): Promise<{ blob: Blob; filename: string }> {
    const limitBytes = maxDownloadBytes(DEFAULT_MAX_REF_BYTES)
    const file = this.resolveAssetFile(url)
    if (file !== null) {
      const bytes = await readFile(file)
      if (bytes.byteLength > limitBytes) {
        throw new MediaUpstreamError(`本地参考图体积超限（超过 ${limitBytes} 字节）`)
      }
      const mime = mimeOf(file)
      const ext = extname(file) || extFromMime(mime, '.png')
      return { blob: new Blob([bytes], { type: mime }), filename: `ref${ext}` }
    }
    if (url.startsWith('data:')) {
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url)
      if (!m) throw new MediaUpstreamError('参考图 data URL 格式无效')
      const mime = m[1] || 'image/png'
      const bytes = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
      if (bytes.byteLength > limitBytes) {
        throw new MediaUpstreamError(`参考图 data URL 体积超限（超过 ${limitBytes} 字节）`)
      }
      return { blob: new Blob([bytes], { type: mime }), filename: `ref${extFromMime(mime, '.png')}` }
    }
    await assertSafeRemoteUrl(url, { allowedOrigins: this.getAllowedDownloadOrigins(), label: '参考图' })
    const res = await fetch(url, { signal })
    if (!res.ok) throw new MediaUpstreamError(`读取参考图失败：HTTP ${res.status}`)
    const mime = res.headers.get('content-type') || 'image/png'
    const bytes = await readResponseBytesWithLimit(res, limitBytes, '参考图')
    return { blob: new Blob([bytes.buffer as ArrayBuffer], { type: mime }), filename: `ref${extFromMime(mime, '.png')}` }
  }

  /** 生成一段视频（阻塞到完成或超时）；支持多接口动态轮询与失败自动切换。 */
  async generateVideo(
    input: { prompt: string; duration?: number; ratio?: string; firstFrame?: string; extraRefs?: string[] },
    signal?: AbortSignal,
  ): Promise<{ url: string; model: string; durationMs?: number }> {
    const firstFrameRef = input.firstFrame ? await this.toUpstreamRef(input.firstFrame) : undefined
    const extraRefs = await Promise.all((input.extraRefs ?? []).slice(0, 4).map(r => this.toUpstreamRef(r)))
    const openaiPrimaryRef = input.firstFrame ?? input.extraRefs?.[0]

    return this.runWithPool(this.videoPool, '视频', signal, async (ep, { base, key }) => {
      const duration = input.duration ?? ep.duration
      const ratio = input.ratio ?? ep.ratio
      const auth = { authorization: `Bearer ${key}` }
      const deadline = Date.now() + ep.timeoutMs

      if (ep.flavor === 'ark') {
        const content: unknown[] = [{ type: 'text', text: `${input.prompt} --duration ${duration} --ratio ${ratio}` }]
        if (firstFrameRef) {
          content.push({ type: 'image_url', image_url: { url: firstFrameRef }, role: 'first_frame' })
        }
        for (const ref of extraRefs) {
          content.push({ type: 'image_url', image_url: { url: ref }, role: 'reference_image' })
        }
        const created = await readJson(await fetch(`${base}/contents/generations/tasks`, {
          method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ model: ep.model, content }), signal,
        }), '视频提交')
        const taskId = String(created.id ?? '')
        if (!taskId) throw new MediaUpstreamError(`视频提交未返回任务 id：${truncate(JSON.stringify(created))}`)
        for (;;) {
          await sleep(ep.pollIntervalMs, signal)
          const task = await readJson(await fetch(`${base}/contents/generations/tasks/${encodeURIComponent(taskId)}`, { headers: auth, signal }), '视频查询')
          const status = String(task.status ?? '')
          if (status === 'succeeded') {
            const url = (task.content as { video_url?: string } | undefined)?.video_url
            if (!url) throw new MediaUpstreamError('视频任务成功但没有 video_url')
            const saved = await this.download(url, '.mp4', signal)
            const probed = await this.probeMedia(saved).catch(() => null)
            return { url: saved, model: ep.model, durationMs: probed?.durationMs ?? duration * 1000 }
          }
          if (status === 'failed' || status === 'cancelled' || status === 'expired') {
            throw new MediaUpstreamError(`视频任务${status}：${truncate(JSON.stringify(task.error ?? task))}`)
          }
          if (Date.now() > deadline) throw new MediaUpstreamError(`视频任务超时（${taskId}）`)
        }
      }

      const size = ratio === '9:16' ? '720x1280' : ratio === '1:1' ? '1024x1024' : '1280x720'
      let submitRes: Response
      if (openaiPrimaryRef) {
        const { blob, filename } = await this.loadRefBlob(openaiPrimaryRef, signal)
        const form = new FormData()
        form.set('model', ep.model)
        form.set('prompt', input.prompt)
        form.set('seconds', String(duration))
        form.set('size', size)
        form.set('input_reference', blob, filename)
        submitRes = await fetch(`${base}/videos`, {
          method: 'POST',
          headers: auth,
          body: form,
          signal,
        })
      } else {
        submitRes = await fetch(`${base}/videos`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ model: ep.model, prompt: input.prompt, seconds: String(duration), size }),
          signal,
        })
      }
      const created = await readJson(submitRes, '视频提交')
      const videoId = String(created.id ?? '')
      if (!videoId) throw new MediaUpstreamError(`视频提交未返回 id：${truncate(JSON.stringify(created))}`)
      for (;;) {
        await sleep(ep.pollIntervalMs, signal)
        const job = await readJson(await fetch(`${base}/videos/${encodeURIComponent(videoId)}`, { headers: auth, signal }), '视频查询')
        if (job.status === 'completed') {
          const res = await fetch(`${base}/videos/${encodeURIComponent(videoId)}/content`, { headers: auth, signal })
          if (!res.ok) throw new MediaUpstreamError(`下载视频失败：HTTP ${res.status}`)
          const bytes = await readResponseBytesWithLimit(res, maxDownloadBytes(), '下载视频')
          const saved = await this.saveAsset(bytes, '.mp4')
          const probed = await this.probeMedia(saved).catch(() => null)
          return { url: saved, model: ep.model, durationMs: probed?.durationMs ?? duration * 1000 }
        }
        if (job.status === 'failed') throw new MediaUpstreamError(`视频生成失败：${truncate(JSON.stringify(job.error ?? job))}`)
        if (Date.now() > deadline) throw new MediaUpstreamError(`视频任务超时（${videoId}）`)
      }
    })
  }

  /** 生成一段语音（TTS / 配音）；兼容二进制音频流返回与 JSON URL/b64 返回。支持多接口动态轮询与失败自动切换。 */
  async generateAudio(
    input: { prompt: string; voice?: string; speed?: number },
    signal?: AbortSignal,
  ): Promise<{ url: string; model: string; durationMs?: number }> {
    return this.runWithPool(this.audioPool, '音频', signal, async (ep, { base, key }) => {
      const voice = input.voice?.trim() || ep.voice
      const format = ep.format
      const res = await fetch(`${base}/audio/speech`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: ep.model,
          input: input.prompt,
          voice,
          response_format: format,
          ...(input.speed ? { speed: input.speed } : {}),
        }),
        signal,
      })
      if (!res.ok) {
        const errText = await res.text()
        throw new MediaUpstreamError(`音频生成失败：HTTP ${res.status} ${truncate(errText)}`)
      }
      const ct = res.headers.get('content-type') ?? ''
      let saved: string
      if (ct.includes('application/json')) {
        const json = (await res.json()) as Record<string, unknown>
        const b64 = (json.b64_json ?? json.audio_base64 ?? (json.data as Array<{ b64_json?: string }> | undefined)?.[0]?.b64_json) as string | undefined
        const remoteUrl = (json.url ?? json.audio_url ?? (json.data as Array<{ url?: string }> | undefined)?.[0]?.url) as string | undefined
        if (typeof b64 === 'string' && b64) {
          saved = await this.saveAsset(Buffer.from(b64, 'base64'), `.${format}`)
        } else if (typeof remoteUrl === 'string' && remoteUrl) {
          saved = await this.download(remoteUrl, `.${format}`, signal)
        } else {
          throw new MediaUpstreamError(`音频生成 JSON 未包含音频数据：${truncate(JSON.stringify(json))}`)
        }
      } else {
        const bytes = await readResponseBytesWithLimit(res, maxDownloadBytes(DEFAULT_MAX_REF_BYTES), '下载音频')
        if (bytes.byteLength === 0) throw new MediaUpstreamError('音频生成返回空内容')
        saved = await this.saveAsset(bytes, extFromMime(ct, `.${format}`))
      }
      const probed = await this.probeMedia(saved).catch(() => null)
      return { url: saved, model: ep.model, ...(probed?.durationMs ? { durationMs: probed.durationMs } : {}) }
    })
  }

  /** 用 ffprobe 探测本地资产目录内的媒体时长、尺寸与是否有音轨（严格限制在 assetsDir 边界内）。 */
  async probeMedia(urlOrFile: string): Promise<ProbedMedia> {
    let file: string | null = null
    if (urlOrFile.startsWith(ASSET_PREFIX)) {
      file = this.resolveAssetFile(urlOrFile)
    } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(urlOrFile)) {
      const assetsRoot = resolve(this.assetsDir)
      const resolved = resolve(urlOrFile)
      if (resolved.startsWith(assetsRoot + sep)) {
        file = resolved
      }
    }
    if (!file) throw new MediaUpstreamError(`无法探测资产目录以外的路径或外链：${urlOrFile}`)
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,width,height',
      '-of', 'json',
      file,
    ])
    const info = JSON.parse(stdout) as {
      format?: { duration?: string }
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>
    }
    const durSec = Number(info.format?.duration ?? 0)
    const vStream = info.streams?.find(s => s.codec_type === 'video')
    const hasAudio = Boolean(info.streams?.some(s => s.codec_type === 'audio'))
    return {
      durationMs: Number.isFinite(durSec) && durSec > 0 ? Math.round(durSec * 1000) : 5000,
      width: vStream?.width ?? 1280,
      height: vStream?.height ?? 720,
      hasAudio,
    }
  }

  /** 从视频资产抽取最后一帧 PNG 作为下一段同镜续拍的首帧；若视频并非真实编码（如极简字节 mock），优雅回退返回 null。 */
  async extractLastFrame(videoUrl: string): Promise<string | null> {
    const { file } = await this.ensureLocalFile(videoUrl, '.mp4')
    await mkdir(this.assetsDir, { recursive: true })
    const outName = `${Date.now()}-${randomUUID().slice(0, 8)}-tail.png`
    const outPath = join(this.assetsDir, outName)
    try {
      await execFileAsync(FFMPEG_BIN, [
        '-y', '-sseof', '-0.15', '-i', file, '-frames:v', '1', '-q:v', '2', outPath,
      ])
      const bytes = await readFile(outPath)
      if (bytes.byteLength > 0) return ASSET_PREFIX + outName
    } catch {
      await rm(outPath, { force: true }).catch(() => {})
    }
    return null
  }

  /**
   * 使用 FFmpeg 将多段视频按顺序标准化并拼接为一个完整 MP4 成片。
   * 支持不同分辨率/帧率/有无音轨混拼（统一缩放到首段或指定画幅、30fps、AAC 44.1kHz）、
   * 单段内多条配音按偏移混流，以及可选 SRT 字幕硬烧录。
   */
  async concatVideos(
    clips: Array<{
      url: string
      durationMs?: number
      audioUrl?: string
      audioClips?: Array<{ url: string; startOffsetMs?: number; durationMs?: number }>
    }>,
    options?: { width?: number; height?: number; subtitleSrt?: string; burnSubtitles?: boolean },
  ): Promise<{ url: string; durationMs: number; width: number; height: number; subtitlesBurned: boolean }> {
    if (clips.length === 0) throw new MediaUpstreamError('没有可合成的视频片段')
    await mkdir(this.assetsDir, { recursive: true })

    const localFiles: Array<{
      file: string
      meta: ProbedMedia
      audioFiles: Array<{ file: string; startOffsetMs: number }>
    }> = []
    for (const clip of clips) {
      const { file } = await this.ensureLocalFile(clip.url, '.mp4')
      let meta: ProbedMedia
      try {
        meta = await this.probeMedia(file)
      } catch {
        throw new MediaUpstreamError(`视频片段无法解码（请确保是真实有效的 MP4/视频文件）：${clip.url}`)
      }
      const rawAudios = clip.audioClips && clip.audioClips.length > 0
        ? clip.audioClips
        : clip.audioUrl
          ? [{ url: clip.audioUrl, startOffsetMs: 0 }]
          : []
      const audioFiles: Array<{ file: string; startOffsetMs: number }> = []
      for (const aud of rawAudios) {
        if (!aud.url) continue
        const ensured = await this.ensureLocalFile(aud.url, '.mp3')
        audioFiles.push({ file: ensured.file, startOffsetMs: Math.max(0, Math.round(aud.startOffsetMs ?? 0)) })
      }
      localFiles.push({ file, meta, audioFiles })
    }

    const targetW = options?.width ?? (localFiles[0].meta.width || 1280)
    const targetH = options?.height ?? (localFiles[0].meta.height || 720)
    const evenW = targetW % 2 === 0 ? targetW : targetW + 1
    const evenH = targetH % 2 === 0 ? targetH : targetH + 1

    const normalizedPaths: string[] = []
    const outName = `${Date.now()}-${randomUUID().slice(0, 8)}-final.mp4`
    const outPath = join(this.assetsDir, outName)
    const mergedPath = join(this.assetsDir, `${outName}.merged.mp4`)
    const listPath = join(this.assetsDir, `${outName}.concat.txt`)
    const burnSrtPath = join(this.assetsDir, `${outName}.burn.srt`)

    try {
      for (const [idx, item] of localFiles.entries()) {
        const segPath = join(this.assetsDir, `${outName}.seg-${idx}.mp4`)
        normalizedPaths.push(segPath)
        const vf = `scale=${evenW}:${evenH}:force_original_aspect_ratio=decrease,pad=${evenW}:${evenH}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30`
        const durSec = Math.max(0.5, item.meta.durationMs / 1000)

        if (item.audioFiles.length > 0) {
          const args: string[] = ['-y', '-i', item.file]
          const filterParts: string[] = [`[0:v]${vf}[v]`]
          const labels: string[] = []
          for (const [aIdx, aud] of item.audioFiles.entries()) {
            args.push('-i', aud.file)
            const delayPart = aud.startOffsetMs > 0 ? `,adelay=${aud.startOffsetMs}|${aud.startOffsetMs}` : ''
            filterParts.push(`[${aIdx + 1}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo${delayPart}[a${aIdx}]`)
            labels.push(`[a${aIdx}]`)
          }
          if (labels.length === 1) {
            filterParts.push(`${labels[0]}apad=whole_dur=${durSec.toFixed(3)},atrim=0:${durSec.toFixed(3)}[a]`)
          } else {
            filterParts.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0,apad=whole_dur=${durSec.toFixed(3)},atrim=0:${durSec.toFixed(3)}[a]`)
          }
          args.push(
            '-filter_complex', filterParts.join(';'),
            '-map', '[v]', '-map', '[a]',
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k',
            '-t', durSec.toFixed(3),
            segPath,
          )
          await execFileAsync(FFMPEG_BIN, args)
        } else if (item.meta.hasAudio) {
          await execFileAsync(FFMPEG_BIN, [
            '-y', '-i', item.file,
            '-vf', vf,
            '-af', 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo',
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k',
            segPath,
          ])
        } else {
          await execFileAsync(FFMPEG_BIN, [
            '-y', '-i', item.file,
            '-f', 'lavfi', '-t', durSec.toFixed(3), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-vf', vf,
            '-map', '0:v:0', '-map', '1:a:0',
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k', '-shortest',
            segPath,
          ])
        }
      }

      const nl = String.fromCharCode(10)
      const bs = String.fromCharCode(92)
      const listBody = normalizedPaths.map(p => `file '${p.replaceAll("'", `'${bs}''`)}'`).join(nl) + nl
      await writeFile(listPath, listBody, 'utf8')

      const wantBurn = Boolean(options?.burnSubtitles && options.subtitleSrt?.trim())
      const concatTarget = wantBurn ? mergedPath : outPath
      await execFileAsync(FFMPEG_BIN, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', concatTarget])

      let subtitlesBurned = false
      if (wantBurn && options?.subtitleSrt) {
        await writeFile(burnSrtPath, options.subtitleSrt, 'utf8')
        const escapedSrt = burnSrtPath
          .replaceAll(bs, `${bs}${bs}`)
          .replaceAll(':', `${bs}:`)
          .replaceAll("'", `${bs}'`)
        try {
          await execFileAsync(FFMPEG_BIN, [
            '-y', '-i', mergedPath,
            '-vf', `subtitles='${escapedSrt}':force_style='FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=1.5'`,
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
            '-c:a', 'copy', '-movflags', '+faststart',
            outPath,
          ])
          subtitlesBurned = true
        } catch {
          // 若当前系统 FFmpeg 未编入 libass / subtitles 滤镜，则优雅回退到未烧录成片（SRT 仍会独立落盘）
          await execFileAsync(FFMPEG_BIN, ['-y', '-i', mergedPath, '-c', 'copy', '-movflags', '+faststart', outPath])
        }
      }

      const finalMeta = await this.probeMedia(outPath)
      return { url: ASSET_PREFIX + outName, durationMs: finalMeta.durationMs, width: evenW, height: evenH, subtitlesBurned }
    } finally {
      await rm(listPath, { force: true }).catch(() => {})
      await rm(mergedPath, { force: true }).catch(() => {})
      await rm(burnSrtPath, { force: true }).catch(() => {})
      for (const p of normalizedPaths) await rm(p, { force: true }).catch(() => {})
    }
  }
}

async function readJson(res: Response, what: string): Promise<Record<string, unknown>> {
  const text = await res.text()
  if (!res.ok) throw new MediaUpstreamError(`${what}失败：HTTP ${res.status} ${truncate(text)}`)
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new MediaUpstreamError(`${what}返回非 JSON：${truncate(text)}`)
  }
}

function truncate(s: string, n = 400): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason as Error); return }
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = (): void => { clearTimeout(t); reject(signal?.reason as Error) }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
