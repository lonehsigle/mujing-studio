import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildEpisodeCaptions,
  buildEpisodeSegments,
  collectShotCastRefs,
  compileSegmentPrompt,
  defaultDrama,
} from '../src/host/drama.ts'
import type { CanvasProject, DramaData, DramaEpisode } from '../src/host/types.ts'

function makeDrama(overrides?: Partial<DramaData>): DramaData {
  return {
    ...defaultDrama(),
    style: '赛博雨夜写实',
    aspectRatio: '9:16',
    segmentTargetSec: 8,
    casts: [
      {
        id: 'cast_lin',
        kind: 'character',
        name: '林默',
        appearance: '深灰风衣，左眉细疤',
        imagePrompt: '林默三视图',
        voice: 'onyx',
        imageUrl: '/mujing/assets/lin.png',
        locked: true,
      },
      {
        id: 'cast_su',
        kind: 'character',
        name: '苏晚',
        appearance: '暗红旗袍披黑皮衣',
        imagePrompt: '苏晚三视图',
        voice: 'nova',
        imageUrl: '/mujing/assets/su.png',
        locked: true,
      },
    ],
    episodes: [],
    ...overrides,
  }
}

describe('drama segment compilation & handoff inference', () => {
  it('auto-segments shots by duration and scene changes and infers handoff modes', () => {
    const drama = makeDrama({ segmentTargetSec: 6 })
    const ep: DramaEpisode = {
      id: 'ep1',
      number: 1,
      title: '雨夜交接',
      synopsis: '交接芯片',
      shots: [
        { id: 's1', segmentIndex: 0, scene: '酒吧', shotSize: '中景', camera: '缓推', action: '林默推门进入', speaker: '林默', dialogue: '久等了。', durationMs: 4000 },
        { id: 's2', segmentIndex: 0, scene: '酒吧', shotSize: '近景', camera: '固定', action: '林默低头看表', speaker: '林默', dialogue: '东西呢？', durationMs: 4000 },
        { id: 's3', segmentIndex: 0, scene: '酒吧', shotSize: '近景', camera: '固定', action: '苏晚推过芯片', speaker: '苏晚', dialogue: '在这里。', durationMs: 4000 },
        { id: 's4', segmentIndex: 0, scene: '天台', shotSize: '特写', camera: '急推', action: '狙击手扣动扳机', durationMs: 3000 },
      ],
      segments: [],
    }

    const segs = buildEpisodeSegments(drama, ep)
    assert.equal(segs.length, 4)
    assert.equal(segs[0].handoff, 'scene_cut')
    // 同场景同说话人 -> continue（尾帧续拍）
    assert.equal(segs[1].handoff, 'continue')
    // 同场景切换说话人 -> reverse_angle（正反打换镜）
    assert.equal(segs[2].handoff, 'reverse_angle')
    // 场景变化 -> scene_cut（跨场景硬切）
    assert.equal(segs[3].handoff, 'scene_cut')
  })

  it('preserves explicit manual segmentIndex assignments', () => {
    const drama = makeDrama({ segmentTargetSec: 12 })
    const ep: DramaEpisode = {
      id: 'ep1',
      number: 1,
      title: '手工分段',
      synopsis: '',
      shots: [
        { id: 's1', segmentIndex: 0, scene: '酒吧', shotSize: '中景', camera: '固定', action: '镜头1', durationMs: 2000 },
        { id: 's2', segmentIndex: 1, scene: '酒吧', shotSize: '近景', camera: '固定', action: '镜头2', durationMs: 2000 },
        { id: 's3', segmentIndex: 1, scene: '酒吧', shotSize: '特写', camera: '缓推', action: '镜头3', durationMs: 2500 },
      ],
      segments: [],
    }

    const segs = buildEpisodeSegments(drama, ep)
    assert.equal(segs.length, 2)
    assert.equal(ep.shots[0].segmentIndex, 0)
    assert.equal(ep.shots[1].segmentIndex, 1)
    assert.equal(ep.shots[2].segmentIndex, 1)
    assert.equal(segs[1].durationMs, 4500)
  })

  it('compiles structured segment prompts with cast refs, voices, and tail hold instruction', () => {
    const drama = makeDrama()
    const ep: DramaEpisode = {
      id: 'ep1',
      number: 1,
      title: '雨夜交接',
      synopsis: '',
      shots: [
        { id: 's1', segmentIndex: 0, scene: '酒吧', shotSize: '中景', camera: '缓推', action: '林默推门进入', speaker: '林默', dialogue: '把东西交出来。', durationMs: 3500 },
      ],
      segments: [],
    }

    const prompt = compileSegmentPrompt({
      drama,
      episode: ep,
      shots: ep.shots,
      index: 0,
      totalCount: 2,
      handoff: 'scene_cut',
    })
    assert.match(prompt, /林默（参考图1）/)
    assert.match(prompt, /林默音色：onyx/)
    assert.match(prompt, /把东西交出来/)
    assert.match(prompt, /作为第2段的接续基准/)
  })

  it('generates aligned SRT captions and collects active cast ref URLs without duplicates', () => {
    const drama = makeDrama()
    const ep: DramaEpisode = {
      id: 'ep1',
      number: 1,
      title: '测试',
      synopsis: '',
      shots: [
        { id: 's1', segmentIndex: 0, scene: '酒吧', shotSize: '中景', camera: '固定', action: '林默走向苏晚', speaker: '林默', dialogue: '小心！', durationMs: 3000 },
        { id: 's2', segmentIndex: 0, scene: '酒吧', shotSize: '近景', camera: '固定', action: '林默转身', speaker: '旁白', dialogue: '雨越下越大。', durationMs: 2000 },
      ],
      segments: [],
    }
    const { captions, srt } = buildEpisodeCaptions(ep)
    assert.equal(captions.length, 2)
    assert.equal(captions[0].text, '林默：小心！')
    assert.equal(captions[1].text, '雨越下越大。')
    assert.match(srt, /00:00:00,100 --> 00:00:02,850/)
    assert.match(srt, /00:00:03,100 --> 00:00:04,850/)

    const proj: CanvasProject = {
      id: 'p1',
      title: 'test',
      createdAt: 0,
      updatedAt: 0,
      rev: 1,
      nodes: [],
      edges: [],
      drama,
    }
    const refs = collectShotCastRefs(proj, ep.shots)
    assert.deepEqual(refs, ['/mujing/assets/lin.png', '/mujing/assets/su.png'])
  })
})
