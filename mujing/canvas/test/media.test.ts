import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  MediaConfigError,
  MediaService,
  MediaUpstreamError,
  assertSafeRemoteUrl,
  readResponseBytesWithLimit,
  validateEndpointBaseUrl,
} from '../src/host/media.ts'

async function startMockServer(): Promise<{
  server: Server
  port: number
  hits: Array<{ path: string; method: string; contentType: string; raw: Buffer; json?: Record<string, unknown> }>
  close: () => Promise<void>
}> {
  const hits: Array<{ path: string; method: string; contentType: string; raw: Buffer; json?: Record<string, unknown> }> = []
  let failPrimary = false

  // Tiny 1x1 PNG
  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks)
    const ct = req.headers['content-type'] ?? ''
    let json: Record<string, unknown> | undefined
    if (ct.includes('application/json') && raw.length > 0) {
      try { json = JSON.parse(raw.toString('utf8')) as Record<string, unknown> } catch {}
    }
    const url = req.url ?? '/'
    hits.push({ path: url, method: req.method ?? 'GET', contentType: ct, raw, json })

    if (url.startsWith('/fail/')) {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'simulated upstream error' }))
      return
    }

    if (url.endsWith('/images/generations') || url.endsWith('/images/edits')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ b64_json: TINY_PNG.toString('base64') }] }))
      return
    }

    if (req.method === 'POST' && url.endsWith('/videos')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'vid_openai_1', status: 'queued' }))
      return
    }

    if (req.method === 'GET' && url.endsWith('/videos/vid_openai_1')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'vid_openai_1', status: 'completed' }))
      return
    }

    if (req.method === 'GET' && url.endsWith('/videos/vid_openai_1/content')) {
      res.writeHead(200, { 'content-type': 'video/mp4' })
      res.end(Buffer.from('mock-video-bytes'))
      return
    }

    res.writeHead(404)
    res.end(String(failPrimary))
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    server,
    port,
    hits,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

function findFfmpeg(): string | null {
  for (const bin of [process.env.MUJING_FFMPEG_BIN, process.env.FFMPEG_PATH, 'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    if (!bin) continue
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore', timeout: 10000 })
      return bin
    } catch { /* try next */ }
  }
  return null
}

const FFMPEG_BIN = findFfmpeg()

describe('MediaService multi-endpoint pool, OpenAI video input_reference, and FFmpeg multi-audio', () => {
  it('supports weighted round_robin, failover with circuit breaker cooldown, and resetHealth', async () => {
    const mock = await startMockServer()
    const dir = await mkdtemp(join(tmpdir(), 'mujing-media-pool-'))
    try {
      const media = new MediaService(
        dir,
        { apiKeyEnv: 'NONE', model: 'img-default', size: '1024x1024', flavor: 'openai' },
        { apiKeyEnv: 'NONE', model: 'sora-2', flavor: 'openai', duration: 4, ratio: '9:16', pollIntervalMs: 10, timeoutMs: 5000 },
        { apiKeyEnv: 'NONE', model: 'tts-1', voice: 'nova', format: 'mp3' },
      )

      await media.updateConfig({
        image: {
          strategy: 'round_robin',
          autoFailover: true,
          endpoints: [
            { id: 'img_a', name: 'A', baseURL: `http://127.0.0.1:${mock.port}/a/v1`, apiKey: 'sk-a', model: 'model-a', weight: 2, enabled: true, size: '1024x1024', flavor: 'openai' },
            { id: 'img_b', name: 'B', baseURL: `http://127.0.0.1:${mock.port}/b/v1`, apiKey: 'sk-b', model: 'model-b', weight: 1, enabled: true, size: '1024x1024', flavor: 'openai' },
          ],
        },
      })

      const r1 = await media.generateImage({ prompt: 'p1' })
      const r2 = await media.generateImage({ prompt: 'p2' })
      const r3 = await media.generateImage({ prompt: 'p3' })
      const models = [r1.model, r2.model, r3.model]
      assert.equal(models.filter(m => m === 'model-a').length, 2)
      assert.equal(models.filter(m => m === 'model-b').length, 1)

      // Test failover & cooldown
      await media.updateConfig({
        image: {
          strategy: 'failover',
          autoFailover: true,
          endpoints: [
            { id: 'img_bad', name: 'Bad', baseURL: `http://127.0.0.1:${mock.port}/fail/v1`, apiKey: 'sk-bad', model: 'model-bad', weight: 1, enabled: true, size: '1024x1024', flavor: 'openai' },
            { id: 'img_ok', name: 'Good', baseURL: `http://127.0.0.1:${mock.port}/ok/v1`, apiKey: 'sk-ok', model: 'model-ok', weight: 1, enabled: true, size: '1024x1024', flavor: 'openai' },
          ],
        },
      })
      const rFailover = await media.generateImage({ prompt: 'p4' })
      assert.equal(rFailover.model, 'model-ok')
      const details = media.getConfigDetails()
      const badEp = details.image.endpoints.find(e => e.id === 'img_bad')
      assert.ok(badEp && badEp.consecutiveFails >= 1)

      media.resetHealth('image')
      const afterReset = media.getConfigDetails().image.endpoints.find(e => e.id === 'img_bad')
      assert.equal(afterReset?.consecutiveFails, 0)
    } finally {
      await mock.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('sends firstFrame / extraRefs as multipart input_reference for OpenAI /videos branch', async () => {
    const mock = await startMockServer()
    const dir = await mkdtemp(join(tmpdir(), 'mujing-media-vid-'))
    try {
      const media = new MediaService(
        dir,
        { apiKeyEnv: 'NONE', model: 'img', size: '1024x1024', flavor: 'openai' },
        { apiKeyEnv: 'NONE', model: 'sora-2', flavor: 'openai', duration: 4, ratio: '9:16', pollIntervalMs: 10, timeoutMs: 5000 },
        { apiKeyEnv: 'NONE', model: 'tts-1', voice: 'nova', format: 'mp3' },
      )
      await media.updateConfig({
        video: {
          endpoints: [
            { id: 'vid_oai', name: 'OpenAI Video', baseURL: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'sk-v', model: 'sora-2', flavor: 'openai', duration: 4, ratio: '9:16', enabled: true, weight: 1 },
          ],
        },
      })

      const refUrl = await media.saveAsset(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), '.png')
      const out = await media.generateVideo({ prompt: '雨夜推门', firstFrame: refUrl, duration: 4, ratio: '9:16' })
      assert.equal(out.model, 'sora-2')

      const submitHit = mock.hits.find(h => h.method === 'POST' && h.path.endsWith('/videos'))
      assert.ok(submitHit, 'should POST /videos')
      assert.match(submitHit.contentType, /multipart\/form-data/)
      assert.ok(submitHit.raw.includes(Buffer.from('name="input_reference"')), 'multipart payload should contain input_reference')
      assert.ok(submitHit.raw.includes(Buffer.from('sora-2')), 'multipart payload should contain model')
    } finally {
      await mock.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('concatenates video with multiple offset audio tracks without truncating video duration', { skip: !FFMPEG_BIN }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mujing-media-ffmpeg-'))
    try {
      const media = new MediaService(
        dir,
        { apiKeyEnv: 'NONE', model: 'img', size: '1024x1024', flavor: 'openai' },
        { apiKeyEnv: 'NONE', model: 'v', flavor: 'ark', duration: 4, ratio: '9:16', pollIntervalMs: 10, timeoutMs: 5000 },
        { apiKeyEnv: 'NONE', model: 'tts-1', voice: 'nova', format: 'mp3' },
      )

      // Generate a 3.0s silent MP4 and two short 0.8s MP3 audio files
      const rawVid = join(dir, 'v.mp4')
      const rawA1 = join(dir, 'a1.mp3')
      const rawA2 = join(dir, 'a2.mp3')
      const ff = FFMPEG_BIN!
      execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'color=c=0x1e293b:s=360x640:r=24:d=3.0', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', rawVid], { stdio: 'ignore' })
      execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=0.8', '-b:a', '96k', rawA1], { stdio: 'ignore' })
      execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100:duration=0.8', '-b:a', '96k', rawA2], { stdio: 'ignore' })

      const vidUrl = await media.saveAsset(await readFile(rawVid), '.mp4')
      const a1Url = await media.saveAsset(await readFile(rawA1), '.mp3')
      const a2Url = await media.saveAsset(await readFile(rawA2), '.mp3')

      const srt = '1\n00:00:00,100 --> 00:00:02,800\n多音轨与字幕烧录验证\n'
      const out = await media.concatVideos(
        [{
          url: vidUrl,
          audioClips: [
            { url: a1Url, startOffsetMs: 0 },
            { url: a2Url, startOffsetMs: 1500 },
          ],
        }],
        { width: 360, height: 640, subtitleSrt: srt, burnSubtitles: true },
      )

      // Video must remain ~3.0s (NOT truncated to 0.8s by -shortest!) and must have an audio stream
      assert.ok(out.durationMs >= 2800 && out.durationMs <= 3400, `expected ~3000ms, got ${out.durationMs}ms`)
      const probed = await media.probeMedia(out.url)
      assert.equal(probed.hasAudio, true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('migrates legacy v1 media-config.json transparently', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mujing-media-legacy-'))
    try {
      await writeFile(join(dir, 'media-config.json'), JSON.stringify({
        image: { baseURL: 'https://legacy.example/v1', apiKey: 'sk-legacy', model: 'seedream-4' },
      }), 'utf8')
      const media = new MediaService(
        dir,
        { apiKeyEnv: 'NONE', model: 'default-img', size: '1024x1024', flavor: 'ark' },
        { apiKeyEnv: 'NONE', model: 'default-vid', flavor: 'ark', duration: 5, ratio: '9:16', pollIntervalMs: 100, timeoutMs: 5000 },
        { apiKeyEnv: 'NONE', model: 'tts-1', voice: 'nova', format: 'mp3' },
      )
      const details = media.getConfigDetails()
      assert.equal(details.image.endpoints.length, 1)
      assert.equal(details.image.endpoints[0].baseURL, 'https://legacy.example/v1')
      assert.equal(details.image.endpoints[0].model, 'seedream-4')
      assert.equal(details.image.endpoints[0].hasApiKey, true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reuses loadRefBlob in OpenAI /images/edits with local assets and preserves extension', async () => {
    const mock = await startMockServer()
    const dir = await mkdtemp(join(tmpdir(), 'mujing-media-edit-'))
    try {
      const media = new MediaService(
        dir,
        { apiKeyEnv: 'NONE', model: 'gpt-image-1', size: '1024x1024', flavor: 'openai' },
        { apiKeyEnv: 'NONE', model: 'sora-2', flavor: 'openai', duration: 4, ratio: '9:16', pollIntervalMs: 10, timeoutMs: 5000 },
        { apiKeyEnv: 'NONE', model: 'tts-1', voice: 'nova', format: 'mp3' },
      )
      await media.updateConfig({
        image: {
          endpoints: [
            { id: 'img_edit', name: 'OpenAI Edit', baseURL: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'sk-e', model: 'gpt-image-1', flavor: 'openai', size: '1024x1024', enabled: true, weight: 1 },
          ],
        },
      })
      const refUrl = await media.saveAsset(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), '.jpg')
      const out = await media.generateImage({ prompt: '换背景', refs: [refUrl] })
      assert.equal(out.model, 'gpt-image-1')
      const editHit = mock.hits.find(h => h.method === 'POST' && h.path.endsWith('/images/edits'))
      assert.ok(editHit, 'should POST /images/edits')
      assert.match(editHit.contentType, /multipart\/form-data/)
      assert.ok(editHit.raw.includes(Buffer.from('filename="ref-0.jpg"')), 'should preserve .jpg extension from loadRefBlob')
    } finally {
      await mock.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('enforces SSRF guards, download size limits, endpoint baseURL checks, and probeMedia boundary', async () => {
    await assert.rejects(() => assertSafeRemoteUrl('file:///etc/passwd'), MediaUpstreamError)
    await assert.rejects(() => assertSafeRemoteUrl('http://169.254.169.254/latest/meta-data/'), MediaUpstreamError)
    await assert.rejects(() => assertSafeRemoteUrl('http://127.0.0.1:8080/secret'), MediaUpstreamError)
    await assert.rejects(() => assertSafeRemoteUrl('http://10.0.0.5/internal'), MediaUpstreamError)
    // Explicitly configured origin is permitted for local mock / self-hosted services
    const allowed = new Set(['http://127.0.0.1:3199'])
    const parsed = await assertSafeRemoteUrl('http://127.0.0.1:3199/v1/file.png', { allowedOrigins: allowed })
    assert.equal(parsed.origin, 'http://127.0.0.1:3199')

    assert.throws(() => validateEndpointBaseUrl('file:///tmp'), MediaConfigError)
    assert.throws(() => validateEndpointBaseUrl('http://169.254.169.254/v1'), MediaConfigError)
    assert.doesNotThrow(() => validateEndpointBaseUrl('https://api.openai.com/v1'))

    // Response byte limit enforcement (both content-length and streamed chunks)
    const oversizedByHeader = new Response(new Uint8Array(10), { headers: { 'content-length': '999999' } })
    await assert.rejects(() => readResponseBytesWithLimit(oversizedByHeader, 1024, '测试'), MediaUpstreamError)
    const oversizedStream = new Response(new Uint8Array(2048))
    await assert.rejects(() => readResponseBytesWithLimit(oversizedStream, 1024, '测试'), MediaUpstreamError)
    const okResp = new Response(new Uint8Array([1, 2, 3, 4]))
    const okBytes = await readResponseBytesWithLimit(okResp, 1024, '测试')
    assert.deepEqual(Array.from(okBytes), [1, 2, 3, 4])

    // probeMedia rejects paths outside assetsDir and remote URLs
    const dir = await mkdtemp(join(tmpdir(), 'mujing-probe-guard-'))
    try {
      const media = new MediaService(
        dir,
        { apiKeyEnv: 'NONE', model: 'img', size: '1024x1024', flavor: 'openai' },
        { apiKeyEnv: 'NONE', model: 'v', flavor: 'ark', duration: 4, ratio: '9:16', pollIntervalMs: 10, timeoutMs: 5000 },
        { apiKeyEnv: 'NONE', model: 'tts', voice: 'nova', format: 'mp3' },
      )
      await assert.rejects(() => media.probeMedia('/etc/passwd'), MediaUpstreamError)
      await assert.rejects(() => media.probeMedia('http://169.254.169.254/a.mp4'), MediaUpstreamError)
      await assert.rejects(() => media.probeMedia('/mujing/assets/../../etc/passwd'), MediaUpstreamError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
