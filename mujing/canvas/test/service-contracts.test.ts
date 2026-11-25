import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// Register lightweight in-memory stubs for Cordis/Schemastery so service.ts tests
// run cleanly under `node --test` without requiring harness node_modules.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/cordis') {
      return { url: 'mujing-stub://cordis', shortCircuit: true }
    }
    if (specifier === '@deepseek-ai/schemastery') {
      return { url: 'mujing-stub://schemastery', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === 'mujing-stub://cordis') {
      return {
        format: 'module',
        shortCircuit: true,
        source: `export class Service { constructor(ctx, _name, _imm) { this.ctx = ctx; } }`,
      }
    }
    if (url === 'mujing-stub://schemastery') {
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

const { MujingService, mapWithConcurrency } = await import('../src/host/service.ts')
const { ProjectStore } = await import('../src/host/store.ts')
const { MediaService } = await import('../src/host/media.ts')

function makeTestService(dir: string) {
  const svc = Object.create(MujingService.prototype) as InstanceType<typeof MujingService>
  Object.assign(svc, {
    dataDir: dir,
    store: new ProjectStore(dir),
    media: new MediaService(
      dir,
      { apiKeyEnv: 'NONE', model: 'img', size: '1024x1024', flavor: 'openai' },
      { apiKeyEnv: 'NONE', model: 'vid', flavor: 'ark', duration: 5, ratio: '9:16', pollIntervalMs: 100, timeoutMs: 5000 },
      { apiKeyEnv: 'NONE', model: 'tts', voice: 'alloy', format: 'mp3' },
    ),
  })
  return svc
}

test('mapWithConcurrency bounds max parallel execution and preserves order', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const items = [1, 2, 3, 4, 5, 6, 7, 8]
  const out = await mapWithConcurrency(items, 3, async (x) => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise(r => setTimeout(r, 15))
    inFlight--
    return x * 10
  })
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60, 70, 80])
  assert.ok(maxInFlight <= 3, `expected max concurrency <= 3, got ${maxInFlight}`)
  assert.ok(maxInFlight >= 2, `expected parallel execution, got ${maxInFlight}`)
})

test('updateDramaShot preserves manual segmentIndex unless resegment=true', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mujing-svc-'))
  try {
    const svc = makeTestService(dir)
    const proj = await svc.store.create('分镜测试')
    await svc.saveDrama(proj.id, {
      aspectRatio: '9:16',
      episodes: [{
        number: 1,
        title: '第一集',
        shots: [
          { action: '镜头一', durationMs: 3000 },
          { action: '镜头二', durationMs: 3000 },
          { action: '镜头三', durationMs: 3000 },
        ],
      }],
    })
    let cur = await svc.store.get(proj.id)
    const ep = cur.drama!.episodes[0]
    // Manually place shot 1 into segment 1
    await svc.updateDramaShot(proj.id, ep.id, { shotId: ep.shots[1].id, patch: { segmentIndex: 1 } })
    cur = await svc.store.get(proj.id)
    assert.equal(cur.drama!.episodes[0].shots[1].segmentIndex, 1)

    // Updating dialogue on shot 0 must NOT wipe shot 1's manual segmentIndex
    await svc.updateDramaShot(proj.id, ep.id, { shotId: ep.shots[0].id, patch: { dialogue: '你好' } })
    cur = await svc.store.get(proj.id)
    assert.equal(cur.drama!.episodes[0].shots[1].segmentIndex, 1)

    // Explicit resegment=true rebuilds segment packing
    await svc.updateDramaShot(proj.id, ep.id, {
      shotId: ep.shots[0].id,
      patch: { durationMs: 4000 },
      resegment: true,
    })
    cur = await svc.store.get(proj.id)
    assert.equal(cur.drama!.episodes[0].shots[0].durationMs, 4000)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('syncDramaToCanvas wires sequential edges using previous segment videoNodeId', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mujing-sync-'))
  try {
    const svc = makeTestService(dir)
    const proj = await svc.store.create('画布连线测试')
    await svc.saveDrama(proj.id, {
      aspectRatio: '9:16',
      segmentTargetSec: 6,
      episodes: [{
        number: 1,
        title: '第一集',
        shots: [
          { scene: '场景A', action: '镜头A', durationMs: 6000 },
          { scene: '场景B', action: '镜头B', durationMs: 6000 },
        ],
      }],
    })
    // Customize segment 0's videoNodeId to verify syncDramaToCanvas doesn't hardcode ep1_seg1
    await svc.store.updateDomain(proj.id, p => {
      p.drama!.episodes[0].segments[0].videoNodeId = 'custom_seg_0_node'
      p.edges = []
    }, false)

    const synced = await svc.syncDramaToCanvas(proj.id)
    const seg0Id = synced.drama!.episodes[0].segments[0].videoNodeId
    const seg1Id = synced.drama!.episodes[0].segments[1].videoNodeId
    assert.equal(seg0Id, 'custom_seg_0_node')
    assert.ok(
      synced.edges.some(e => e.source === seg0Id && e.target === seg1Id),
      `expected edge ${seg0Id} -> ${seg1Id}, got ${JSON.stringify(synced.edges)}`,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('populateTimelineFromEpisode preserves all per-shot audioClips and exportJianyingDraft writes audio track', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mujing-tl-'))
  const exportRoot = await mkdtemp(join(tmpdir(), 'mujing-jy-'))
  try {
    const svc = makeTestService(dir)
    const assetsDir = join(dir, 'assets')
    await mkdir(assetsDir, { recursive: true })
    await writeFile(join(assetsDir, 'seg0.mp4'), Buffer.from('fake-mp4'))
    await writeFile(join(assetsDir, 'shot1.mp3'), Buffer.from('fake-mp3-1'))
    await writeFile(join(assetsDir, 'shot2.mp3'), Buffer.from('fake-mp3-2'))

    const proj = await svc.store.create('多配音测试')
    await svc.saveDrama(proj.id, {
      aspectRatio: '9:16',
      episodes: [{
        number: 1,
        title: '第一集',
        shots: [
          { action: '镜头一', dialogue: '第一句台词', durationMs: 3000 },
          { action: '镜头二', dialogue: '第二句台词', durationMs: 4000 },
        ],
      }],
    })
    await svc.store.updateDomain(proj.id, p => {
      const ep = p.drama!.episodes[0]
      ep.shots[0].audioUrl = '/mujing/assets/shot1.mp3'
      ep.shots[1].audioUrl = '/mujing/assets/shot2.mp3'
      const vNode = p.nodes.find(n => n.id === ep.segments[0].videoNodeId)!
      vNode.url = '/mujing/assets/seg0.mp4'
      vNode.status = 'success'
    }, false)

    const populated = await svc.populateTimelineFromEpisode(proj.id, 1, false)
    assert.equal(populated.timeline?.clips.length, 1)
    const clip = populated.timeline!.clips[0]
    assert.equal(clip.audioClips?.length, 2)
    assert.equal(clip.audioClips?.[0].startOffsetMs, 0)
    assert.equal(clip.audioClips?.[1].startOffsetMs, 3000)

    const exported = await svc.exportJianyingDraft(proj.id, { draftRoot: exportRoot })
    assert.equal(exported.writtenToDisk, true)
    assert.equal(exported.clipCount, 1)
    assert.equal(exported.audioCount, 2)
    assert.equal(exported.captionCount, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(exportRoot, { recursive: true, force: true })
  }
})
