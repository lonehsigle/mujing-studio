import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/cordis') {
      return { url: 'mujing-web-stub://cordis', shortCircuit: true }
    }
    if (specifier === '@deepseek-ai/schemastery') {
      return { url: 'mujing-web-stub://schemastery', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === 'mujing-web-stub://cordis') {
      return {
        format: 'module',
        shortCircuit: true,
        source: `export class Service { constructor(ctx, _name, _imm) { this.ctx = ctx; } }`,
      }
    }
    if (url === 'mujing-web-stub://schemastery') {
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          const chain = () => {
            const fn = () => chain();
            return new Proxy(fn, { get: (_t, p) => p === 'then' ? undefined : () => chain() });
          };
          export default chain();
        `,
      }
    }
    return nextLoad(url, context)
  },
})

const { apply: applyWeb, parseByteRange } = await import('../src/host/web.ts')
const { MujingService } = await import('../src/host/service.ts')
const { ProjectStore } = await import('../src/host/store.ts')
const { MediaService } = await import('../src/host/media.ts')

test('parseByteRange handles standard, open-ended, suffix (-N), and unsatisfiable ranges', () => {
  assert.deepEqual(parseByteRange('bytes=0-3', 10), { kind: 'ok', start: 0, end: 3 })
  assert.deepEqual(parseByteRange('bytes=6-', 10), { kind: 'ok', start: 6, end: 9 })
  assert.deepEqual(parseByteRange('bytes=-4', 10), { kind: 'ok', start: 6, end: 9 })
  assert.deepEqual(parseByteRange('bytes=-999', 10), { kind: 'ok', start: 0, end: 9 })
  assert.deepEqual(parseByteRange('bytes=-0', 10), { kind: 'unsatisfiable' })
  assert.deepEqual(parseByteRange('bytes=10-12', 10), { kind: 'unsatisfiable' })
  assert.deepEqual(parseByteRange('bytes=5-2', 10), { kind: 'unsatisfiable' })
  assert.deepEqual(parseByteRange('bytes=-', 10), { kind: 'unsatisfiable' })
  assert.deepEqual(parseByteRange('items=0-5', 10), { kind: 'ignore' })
})

test('web.ts HTTP routes handle assets Range/malformed URI, project CRUD, undo/redo, and Jianying path checks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mujing-web-test-'))
  const exportRoot = await mkdtemp(join(tmpdir(), 'mujing-web-jy-'))

  const svc = Object.create(MujingService.prototype) as InstanceType<typeof MujingService>
  Object.assign(svc, {
    dataDir: dir,
    store: new ProjectStore(dir),
    media: new MediaService(
      dir,
      { apiKeyEnv: 'NONE', model: 'img', size: '1024x1024', flavor: 'openai' },
      { apiKeyEnv: 'NONE', model: 'vid', flavor: 'openai', duration: 4, ratio: '9:16', pollIntervalMs: 10, timeoutMs: 5000 },
      { apiKeyEnv: 'NONE', model: 'tts', voice: 'alloy', format: 'mp3' },
    ),
  })

  const routes: Array<{ path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }> = []
  const fakeCtx = {
    mujing: svc,
    effect(fn: () => unknown) { fn() },
    webServer: {
      register(route: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }) {
        routes.push(route)
        return () => {}
      },
    },
  }
  applyWeb(fakeCtx as never)

  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://local').pathname
    const hit = routes.find(r => pathname === r.path || pathname.startsWith(`${r.path}/`))
    if (!hit) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    void Promise.resolve(hit.handler(req, res))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`

  try {
    // 1. Asset malformed percent-encoding -> 400 (no uncaught URIError)
    const badUri = await fetch(`${base}/mujing/assets/%E0%A4%A`)
    assert.equal(badUri.status, 400)

    // 2. Asset Range: suffix bytes=-4 & unsatisfiable 416
    await mkdir(svc.media.assetsDir, { recursive: true })
    await writeFile(join(svc.media.assetsDir, 'sample.bin'), Buffer.from('0123456789'))

    const suffixRes = await fetch(`${base}/mujing/assets/sample.bin`, { headers: { range: 'bytes=-4' } })
    assert.equal(suffixRes.status, 206)
    assert.equal(suffixRes.headers.get('content-range'), 'bytes 6-9/10')
    assert.equal(await suffixRes.text(), '6789')

    const badRange = await fetch(`${base}/mujing/assets/sample.bin`, { headers: { range: 'bytes=50-60' } })
    assert.equal(badRange.status, 416)
    assert.equal(badRange.headers.get('content-range'), 'bytes */10')

    // 3. Project create + ops + undo/redo
    const createRes = await fetch(`${base}/mujing/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '路由集成测试' }),
    })
    assert.equal(createRes.status, 201)
    const proj = await createRes.json() as { id: string }

    const opRes = await fetch(`${base}/mujing/api/projects/${proj.id}/ops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops: [{ op: 'add_node', type: 'text', x: 100, y: 100, title: 'N1', content: 'hi' }] }),
    })
    assert.equal(opRes.status, 200)

    const undoRes = await fetch(`${base}/mujing/api/projects/${proj.id}/undo`, { method: 'POST' })
    const undoJson = await undoRes.json() as { changed: boolean; undone: boolean }
    assert.equal(undoRes.status, 200)
    assert.equal(undoJson.changed, true)
    assert.equal(undoJson.undone, true)

    // 4. Jianying protected directory rejected with 400
    await writeFile(join(svc.media.assetsDir, 'v1.mp4'), Buffer.from('mp4'))
    await fetch(`${base}/mujing/api/projects/${proj.id}/timeline`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clips: [{ title: 'c1', url: '/mujing/assets/v1.mp4', durationMs: 3000 }] }),
    })
    const blockedJy = await fetch(`${base}/mujing/api/projects/${proj.id}/timeline/export-jianying`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftRoot: '/etc/jianying' }),
    })
    assert.equal(blockedJy.status, 400)

    const okJy = await fetch(`${base}/mujing/api/projects/${proj.id}/timeline/export-jianying`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftRoot: exportRoot }),
    })
    assert.equal(okJy.status, 200)
    const okJyJson = await okJy.json() as { writtenToDisk: boolean; clipCount: number }
    assert.equal(okJyJson.writtenToDisk, true)
    assert.equal(okJyJson.clipCount, 1)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
    await rm(exportRoot, { recursive: true, force: true })
  }
})
