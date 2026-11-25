import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  buildJianyingDraftJson,
  buildSrt,
  defaultJianyingDraftRoot,
  isWritableLocalDraftPath,
  normalizeDraftRoot,
  safeName,
  writeJianyingDraftToDisk,
} from '../src/host/jianying.ts'

describe('jianying draft export & path safety', () => {
  it('normalizes valid macOS/Windows paths and rejects traversal or system directories', () => {
    assert.equal(normalizeDraftRoot('/Users/alice/Drafts/'), '/Users/alice/Drafts')
    assert.equal(normalizeDraftRoot('D:\\Jianying\\Drafts\\'), 'D:\\Jianying\\Drafts')

    assert.throws(() => normalizeDraftRoot('relative/path'), /绝对路径/)
    assert.throws(() => normalizeDraftRoot('/Users/alice/../etc'), /\.\./)
    assert.throws(() => normalizeDraftRoot('/etc/jianying'), /系统受保护目录/)
    assert.throws(() => normalizeDraftRoot('C:\\Windows\\System32'), /系统受保护目录/)
    assert.throws(() => normalizeDraftRoot('C:\\'), /磁盘根目录/)
  })

  it('recognizes writable local paths per OS (macOS/Linux and Windows)', () => {
    assert.equal(isWritableLocalDraftPath('/Users/alice/Drafts/demo', 'darwin'), true)
    assert.equal(isWritableLocalDraftPath('C:\\Users\\alice\\Drafts\\demo', 'darwin'), false)
    assert.equal(isWritableLocalDraftPath('C:\\Users\\alice\\Drafts\\demo', 'win32'), true)
    assert.equal(isWritableLocalDraftPath('\\\\server\\share\\demo', 'win32'), true)
  })

  it('computes cross-platform default draft root', () => {
    assert.equal(
      defaultJianyingDraftRoot('win32', { LOCALAPPDATA: 'C:\\Users\\Bob\\AppData\\Local' }, 'C:\\Users\\Bob'),
      'C:\\Users\\Bob\\AppData\\Local\\JianyingPro\\User Data\\Projects\\com.lveditor.draft',
    )
    assert.equal(
      defaultJianyingDraftRoot('darwin', {}, '/Users/bob'),
      '/Users/bob/Movies/JianyingPro/User Data/Projects/com.lveditor.draft',
    )
    assert.equal(
      defaultJianyingDraftRoot('linux', {}, '/home/bob'),
      '/home/bob/JianyingPro/Drafts',
    )
  })

  it('sanitizes Windows reserved names and invalid characters', () => {
    assert.equal(safeName('CON', 'fallback'), '_CON')
    assert.equal(safeName('ep1:雨夜/交接?*<>|', 'fallback'), 'ep1-雨夜-交接')
  })

  it('builds draft JSON with video, audio, and subtitle tracks and writes all files to disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mujing-jy-test-'))
    try {
      const videoSrc = join(dir, 'clip1.mp4')
      const audioSrc1 = join(dir, 'voice1.mp3')
      const audioSrc2 = join(dir, 'voice2.mp3')
      await writeFile(videoSrc, Buffer.from('fake-mp4'))
      await writeFile(audioSrc1, Buffer.from('fake-mp3-1'))
      await writeFile(audioSrc2, Buffer.from('fake-mp3-2'))

      const exportRoot = join(dir, 'drafts')
      const res = await writeJianyingDraftToDisk({
        name: '雨夜短剧',
        root: exportRoot,
        width: 720,
        height: 1280,
        clips: [
          { fileName: '01-seg1.mp4', sourceFile: videoSrc, name: '第1段', durationUs: 6_000_000, width: 720, height: 1280 },
        ],
        audios: [
          { fileName: '01-a01.mp3', sourceFile: audioSrc1, name: '林默配音', startUs: 0, durationUs: 2_500_000 },
          { fileName: '01-a02.mp3', sourceFile: audioSrc2, name: '苏晚配音', startUs: 3_000_000, durationUs: 2_000_000 },
        ],
        captions: [
          { text: '林默：小心！', startUs: 100_000, durationUs: 2_000_000 },
        ],
      })

      assert.equal(res.writtenToDisk, true)
      assert.equal(res.filesCount, 1 + 2 + 3 + 1)

      const content = JSON.parse(await readFile(join(res.folderPath, 'draft_content.json'), 'utf8')) as {
        materials: { videos: unknown[]; audios: Array<{ path: string }>; texts: unknown[] }
        tracks: Array<{ type: string; segments: Array<{ target_timerange: { start: number; duration: number } }> }>
      }
      assert.equal(content.materials.videos.length, 1)
      assert.equal(content.materials.audios.length, 2)
      assert.equal(content.materials.texts.length, 1)

      const audioTrack = content.tracks.find(t => t.type === 'audio')
      assert.ok(audioTrack, 'audio track should be generated')
      assert.equal(audioTrack.segments.length, 2)
      assert.equal(audioTrack.segments[1].target_timerange.start, 3_000_000)

      // Verify audio files were copied into materials/
      const copiedAudio = await readFile(join(res.folderPath, 'materials', '01-a02.mp3'), 'utf8')
      assert.equal(copiedAudio, 'fake-mp3-2')

      // Verify non-matching OS path returns writtenToDisk: false with explicit reason
      const builtWin = buildJianyingDraftJson({
        name: 'win-test',
        root: 'D:\\Jianying\\Drafts',
        width: 720,
        height: 1280,
        clips: [{ fileName: '01.mp4', sourceFile: videoSrc, name: 'seg1', durationUs: 3_000_000, width: 720, height: 1280 }],
        captions: [],
      })
      assert.equal(builtWin.folderPath, 'D:\\Jianying\\Drafts\\win-test')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('formats SRT timestamps accurately', () => {
    const srt = buildSrt([
      { text: '第一句', startUs: 100_000, durationUs: 1_900_000 },
      { text: '第二句', startUs: 2_500_000, durationUs: 1_500_000 },
    ])
    assert.match(srt, /1\n00:00:00,100 --> 00:00:02,000\n第一句/)
    assert.match(srt, /2\n00:00:02,500 --> 00:00:04,000\n第二句/)
  })
})
