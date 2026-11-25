import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { ProjectStore } from '../src/host/store.ts'
import type { CanvasProject } from '../src/host/types.ts'

describe('ProjectStore atomic persistence, undo/redo, and import validation', () => {
  it('supports atomic apply, concurrent serial updates, and undo/redo returning changed flag', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mujing-store-test-'))
    try {
      const store = new ProjectStore(dir)
      const p = await store.create('测试画布')

      // Concurrent writes on the same project should be serialized without lost updates
      await Promise.all([
        store.apply(p.id, [{ op: 'add_node', id: 'n1', type: 'text', title: '剧本', content: 'A' }]),
        store.apply(p.id, [{ op: 'add_node', id: 'n2', type: 'image', title: '角色', prompt: 'B' }]),
        store.apply(p.id, [{ op: 'add_node', id: 'n3', type: 'video', title: '分段', prompt: 'C' }]),
      ])
      const after = await store.get(p.id)
      assert.equal(after.nodes.length, 3)

      // Undo returns both undone & changed = true
      const u1 = await store.undo(p.id)
      assert.equal(u1.undone, true)
      assert.equal(u1.changed, true)
      assert.equal(u1.project.nodes.length, 2)

      // Redo returns both redone & changed = true
      const r1 = await store.redo(p.id)
      assert.equal(r1.redone, true)
      assert.equal(r1.changed, true)
      assert.equal(r1.project.nodes.length, 3)

      // Empty redo returns changed = false
      const r2 = await store.redo(p.id)
      assert.equal(r2.redone, false)
      assert.equal(r2.changed, false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('sanitizes malformed drama and timeline payloads during importProject', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mujing-import-test-'))
    try {
      const store = new ProjectStore(dir)
      const malformed = {
        title: '外部导入',
        nodes: [
          { id: 'v1', type: 'video', x: Number.NaN, y: 20, width: -10, height: 0, status: 'loading', url: '/mujing/assets/a.mp4' },
          { id: 'bad', type: 'unknown_type', x: 0, y: 0, width: 100, height: 100 },
        ],
        edges: [
          { id: 'e1', source: 'v1', target: 'bad' },
          { id: 'e2', source: 'v1', target: 'v1' },
        ],
        drama: {
          aspectRatio: 'invalid-ratio',
          segmentTargetSec: 999,
          casts: [
            null,
            { name: '', kind: 'character' },
            { name: '林默', kind: 'unknown', appearance: '黑风衣' },
          ],
          episodes: [
            {
              number: -5,
              title: '第一集',
              shots: [
                { scene: '酒吧', action: '推门', durationMs: -100, segmentIndex: -3 },
                'not-an-object',
              ],
              segments: [
                { index: 0, status: 'loading', handoff: 'invalid', durationMs: 0 },
              ],
            },
          ],
        },
        timeline: {
          status: 'loading',
          burnSubtitles: 'yes',
          clips: [
            { title: '坏片段没有url' },
            {
              url: '/mujing/assets/a.mp4',
              durationMs: -50,
              audioClips: [
                { url: '/mujing/assets/a.mp3', startOffsetMs: 1200 },
                { startOffsetMs: 500 },
              ],
            },
          ],
        },
      } as unknown as Partial<CanvasProject>

      const imported = await store.importProject(malformed)
      assert.equal(imported.nodes.length, 1)
      assert.equal(imported.nodes[0].status, 'idle')
      assert.equal(imported.nodes[0].width, 384)
      assert.equal(imported.edges.length, 0)

      assert.ok(imported.drama)
      assert.equal(imported.drama.aspectRatio, '9:16')
      assert.equal(imported.drama.segmentTargetSec, 15)
      assert.equal(imported.drama.casts.length, 1)
      assert.equal(imported.drama.casts[0].kind, 'character')
      assert.equal(imported.drama.episodes[0].number, 1)
      assert.equal(imported.drama.episodes[0].shots.length, 1)
      assert.equal(imported.drama.episodes[0].shots[0].durationMs, 3500)
      assert.equal(imported.drama.episodes[0].shots[0].segmentIndex, 0)
      assert.equal(imported.drama.episodes[0].segments[0].status, 'idle')
      assert.equal(imported.drama.episodes[0].segments[0].handoff, 'scene_cut')

      assert.ok(imported.timeline)
      assert.equal(imported.timeline.status, 'idle')
      assert.equal(imported.timeline.clips.length, 1)
      assert.equal(imported.timeline.clips[0].durationMs, 5000)
      assert.equal(imported.timeline.clips[0].audioClips?.length, 1)
      assert.equal(imported.timeline.clips[0].audioClips?.[0].startOffsetMs, 1200)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
