/**
 * 剪映专业版（JianyingPro / CapCut）明文草稿导出与 SRT 字幕生成。
 * 对标原项目 backend/internal/jianying/draft.go：生成 draft_content.json（Windows）、
 * draft_info.json（macOS）与 draft_meta_info.json，并将视频片段复制到草稿 materials/ 目录。
 */

import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { CanvasOpError } from './store.ts'

export const MATERIALS_DIR = 'materials'

export interface JianyingClip {
  fileName: string
  sourceFile: string
  name: string
  durationUs: number
  width: number
  height: number
}

export interface JianyingAudioClip {
  fileName: string
  sourceFile: string
  name: string
  startUs: number
  durationUs: number
}

export interface JianyingCaption {
  text: string
  startUs: number
  durationUs: number
}

export interface JianyingDraftInput {
  name: string
  root: string
  width: number
  height: number
  fps?: number
  clips: JianyingClip[]
  audios?: JianyingAudioClip[]
  captions: JianyingCaption[]
}

/** 跨平台默认剪映专业版草稿目录（Windows / macOS / Linux）。 */
export function defaultJianyingDraftRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA?.trim() || `${home}\\AppData\\Local`
    return `${base.replace(/[\\/]+$/, '')}\\JianyingPro\\User Data\\Projects\\com.lveditor.draft`
  }
  if (platform === 'darwin') {
    return join(home, 'Movies', 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft')
  }
  return join(home, 'JianyingPro', 'Drafts')
}

const WINDOWS_ROOT = /^[A-Za-z]:[\\/]/
const UNSAFE_NAME = /[\\/:*?"<>|\x00-\x1f]+/g

function reservedWindowsName(name: string): boolean {
  const base = name.split('.')[0]?.toUpperCase() ?? ''
  if (base === 'CON' || base === 'PRN' || base === 'AUX' || base === 'NUL') return true
  return base.length === 4 && (base.startsWith('COM') || base.startsWith('LPT')) && base[3] >= '1' && base[3] <= '9'
}

export function safeName(raw: string, fallback: string, limit = 80): string {
  let name = raw.replace(UNSAFE_NAME, '-').trim().replace(/^[. -]+|[. -]+$/g, '')
  if (!name) name = fallback
  const chars = [...name]
  if (chars.length > limit) name = chars.slice(0, limit).join('').trim().replace(/^[. -]+|[. -]+$/g, '')
  if (!name) name = fallback
  if (reservedWindowsName(name)) name = `_${name}`
  return name
}

const BS = String.fromCharCode(92)
const UNC_PREFIX = BS + BS

const FORBIDDEN_POSIX_PREFIXES = ['/etc', '/usr', '/bin', '/sbin', '/System', '/Library', '/private/etc', '/var/root', '/boot', '/proc', '/sys']
const FORBIDDEN_WIN_PREFIXES = ['c:/windows', 'c:/program files', 'c:/program files (x86)', 'c:/programdata']

function isForbiddenSystemRoot(canonical: string, windows: boolean): boolean {
  const lower = canonical.toLowerCase()
  if (windows) {
    return FORBIDDEN_WIN_PREFIXES.some(p => lower === p || lower.startsWith(`${p}/`))
  }
  return FORBIDDEN_POSIX_PREFIXES.some(p => {
    const lp = p.toLowerCase()
    return lower === lp || lower.startsWith(`${lp}/`)
  })
}

export function normalizeDraftRoot(raw: string): string {
  const root = raw.trim()
  if (!root) throw new CanvasOpError('请填写剪映草稿目录（本机绝对路径）')
  if (root.includes('你的用户名')) throw new CanvasOpError('请把路径里的「你的用户名」换成电脑上的实际用户名')
  if ([...root].length > 400 || root.includes('"') || /[\x00-\x1f]/.test(root)) {
    throw new CanvasOpError('剪映草稿目录包含无效字符')
  }
  const windows = WINDOWS_ROOT.test(root)
  const unc = root.startsWith(UNC_PREFIX) || root.startsWith('//')
  if (!windows && !unc && !root.startsWith('/')) {
    throw new CanvasOpError('剪映草稿目录必须是 macOS 或 Windows 的绝对路径')
  }
  const canonical = windows || unc ? root.replaceAll(BS, '/') : root
  for (const part of canonical.split('/')) {
    if (part === '.' || part === '..') throw new CanvasOpError('剪映草稿目录不能包含 . 或 .. 路径段')
  }
  const trimmed = canonical.replace(/\/+$/, '')
  if (!trimmed || (windows && trimmed.length <= 2)) {
    throw new CanvasOpError('剪映草稿目录不能是磁盘根目录')
  }
  if (isForbiddenSystemRoot(trimmed, windows)) {
    throw new CanvasOpError('剪映草稿目录不能指向系统受保护目录')
  }
  const allowedEnv = process.env.MUJING_ALLOWED_EXPORT_ROOTS?.trim()
  if (allowedEnv) {
    const allowedList = allowedEnv.split(',').map(s => s.trim().replaceAll(BS, '/').replace(/\/+$/, '')).filter(Boolean)
    const lower = trimmed.toLowerCase()
    const ok = allowedList.some(a => {
      const la = a.toLowerCase()
      return lower === la || lower.startsWith(`${la}/`)
    })
    if (!ok) throw new CanvasOpError('剪映草稿目录不在允许导出的路径白名单内（MUJING_ALLOWED_EXPORT_ROOTS）')
  }
  return windows || unc ? trimmed.replaceAll('/', BS) : trimmed
}

function newUpperUUID(): string {
  const raw = randomBytes(16)
  raw[6] = (raw[6] & 0x0f) | 0x40
  raw[8] = (raw[8] & 0x3f) | 0x80
  const hex = raw.toString('hex').toUpperCase()
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function timerange(start: number, duration: number): Record<string, number> {
  return { start, duration }
}

function speedMaterial(): { id: string; curve_speed: null; mode: number; speed: number; type: string } {
  return { curve_speed: null, id: newUpperUUID(), mode: 0, speed: 1.0, type: 'speed' }
}

function clipSettings(transformY: number): Record<string, unknown> {
  return {
    alpha: 1.0,
    flip: { horizontal: false, vertical: false },
    rotation: 0.0,
    scale: { x: 1.0, y: 1.0 },
    transform: { x: 0.0, y: transformY },
  }
}

function baseSegment(materialId: string, start: number, duration: number, renderIndex: number, refs: string[], clip: Record<string, unknown>): Record<string, unknown> {
  return {
    enable_adjust: true, enable_color_correct_adjust: false, enable_color_curves: true, enable_color_match_adjust: false,
    enable_color_wheels: true, enable_lut: true, enable_smart_color_adjust: false, last_nonzero_volume: 1.0, reverse: false,
    track_attribute: 0, track_render_index: 0, visible: true, id: newUpperUUID(), material_id: materialId,
    target_timerange: timerange(start, duration), common_keyframes: [], keyframe_refs: [],
    speed: 1.0, volume: 1.0, extra_material_refs: refs, is_tone_modify: false,
    clip, uniform_scale: { on: true, value: 1.0 }, render_index: renderIndex,
  }
}

function subtitleMaterial(id: string, text: string): Record<string, unknown> {
  const content = JSON.stringify({
    styles: [{
      fill: { alpha: 1.0, content: { render_type: 'solid', solid: { alpha: 1.0, color: [1, 1, 1] } } },
      range: [0, [...text].length],
      size: 6.0, bold: false, italic: false, underline: false,
      strokes: [{ content: { solid: { alpha: 1.0, color: [0, 0, 0] } }, width: 0.08 }],
    }],
    text,
  })
  return {
    id, content, typesetting: 0, alignment: 1, letter_spacing: 0.0, line_spacing: 0.02,
    line_feed: 1, line_max_width: 0.82, force_apply_line_max_width: false, check_flag: 15, type: 'subtitle', global_alpha: 1.0,
  }
}

function emptyMaterials(): Record<string, unknown[]> {
  const keys = [
    'ai_translates', 'audio_balances', 'audio_effects', 'audio_fades', 'audio_track_indexes', 'audios', 'beats', 'canvases', 'chromas',
    'color_curves', 'digital_humans', 'drafts', 'effects', 'flowers', 'green_screens', 'handwrites', 'hsl', 'images', 'log_color_wheels',
    'loudnesses', 'manual_deformations', 'masks', 'material_animations', 'material_colors', 'multi_language_refs', 'placeholders',
    'plugin_effects', 'primary_color_wheels', 'realtime_denoises', 'shapes', 'smart_crops', 'smart_relights', 'sound_channel_mappings',
    'speeds', 'stickers', 'tail_leaders', 'text_templates', 'texts', 'time_marks', 'transitions', 'video_effects', 'video_trackings',
    'videos', 'vocal_beautifys', 'vocal_separations',
  ]
  return Object.fromEntries(keys.map(k => [k, []]))
}

export function buildJianyingDraftJson(input: JianyingDraftInput): {
  folderPath: string
  contentJson: string
  metaJson: string
  srtText: string
} {
  const root = normalizeDraftRoot(input.root)
  const draftName = safeName(input.name, '幕境成片草稿', 100)
  if (input.clips.length === 0) throw new CanvasOpError('没有可导出到剪映的视频片段')
  const sep = WINDOWS_ROOT.test(root) || root.startsWith(UNC_PREFIX) ? BS : '/'
  const folderPath = `${root}${sep}${draftName}`
  const materialPath = (fileName: string): string => `${folderPath}${sep}${MATERIALS_DIR}${sep}${fileName}`

  const draftId = newUpperUUID()
  const fps = input.fps && input.fps > 0 ? input.fps : 30
  const nowSec = Math.floor(Date.now() / 1000)
  const nowUs = Date.now() * 1000

  const materials = emptyMaterials()
  const videos: unknown[] = []
  const speeds: unknown[] = []
  const videoSegments: unknown[] = []
  let cursorUs = 0

  for (const clip of input.clips) {
    const durUs = Math.max(100_000, Math.round(clip.durationUs))
    const width = clip.width > 0 ? clip.width : input.width
    const height = clip.height > 0 ? clip.height : input.height
    const materialId = newUpperUUID()
    videos.push({
      audio_fade: null, category_id: '', category_name: 'local', check_flag: 63487,
      crop: { upper_left_x: 0.0, upper_left_y: 0.0, upper_right_x: 1.0, upper_right_y: 0.0, lower_left_x: 0.0, lower_left_y: 1.0, lower_right_x: 1.0, lower_right_y: 1.0 },
      crop_ratio: 'free', crop_scale: 1.0, duration: durUs, height, width,
      id: materialId, local_material_id: '', material_id: materialId, material_name: clip.name || clip.fileName,
      media_path: '', path: materialPath(clip.fileName), type: 'video',
    })
    const spd = speedMaterial()
    speeds.push(spd)
    const seg = baseSegment(materialId, cursorUs, durUs, 0, [spd.id], clipSettings(0))
    seg.source_timerange = timerange(0, durUs)
    seg.hdr_settings = { intensity: 1.0, mode: 1, nits: 1000 }
    videoSegments.push(seg)
    cursorUs += durUs
  }

  const tracks: unknown[] = [{
    attribute: 0, flag: 0, id: newUpperUUID(), is_default_name: true, name: '', segments: videoSegments, type: 'video',
  }]

  const audios: unknown[] = []
  if (input.audios && input.audios.length > 0) {
    const audioSegments: unknown[] = []
    for (const aud of input.audios) {
      if (aud.durationUs <= 0 || aud.startUs < 0 || aud.startUs >= cursorUs) continue
      const durUs = Math.min(Math.max(100_000, Math.round(aud.durationUs)), Math.max(100_000, cursorUs - Math.round(aud.startUs)))
      const materialId = newUpperUUID()
      audios.push({
        app_id: 0,
        category_id: '',
        category_name: 'local',
        check_flag: 1,
        duration: durUs,
        effect_id: '',
        formula_id: '',
        id: materialId,
        intensifies_path: '',
        local_material_id: '',
        music_id: materialId,
        name: aud.name || aud.fileName,
        path: materialPath(aud.fileName),
        query: '',
        request_id: '',
        resource_id: '',
        search_id: '',
        source_platform: 0,
        team_id: '',
        text_id: '',
        tone_category_id: '',
        tone_category_name: '',
        tone_effect_id: '',
        tone_effect_name: '',
        tone_speaker: '',
        tone_type: '',
        type: 'extract_music',
        video_id: '',
        wave_points: [],
      })
      const spd = speedMaterial()
      speeds.push(spd)
      const seg = baseSegment(materialId, Math.round(aud.startUs), durUs, 0, [spd.id], clipSettings(0))
      seg.source_timerange = timerange(0, durUs)
      seg.clip = null
      audioSegments.push(seg)
    }
    if (audioSegments.length > 0) {
      tracks.push({
        attribute: 0, flag: 0, id: newUpperUUID(), is_default_name: false, name: '角色配音', segments: audioSegments, type: 'audio',
      })
    }
  }

  const texts: unknown[] = []
  if (input.captions.length > 0) {
    const textSegments: unknown[] = []
    for (const cap of input.captions) {
      const text = cap.text.trim()
      if (!text || cap.durationUs <= 0 || cap.startUs < 0 || cap.startUs >= cursorUs) continue
      const durUs = Math.min(Math.round(cap.durationUs), cursorUs - Math.round(cap.startUs))
      const materialId = newUpperUUID()
      texts.push(subtitleMaterial(materialId, text))
      const spd = speedMaterial()
      speeds.push(spd)
      const seg = baseSegment(materialId, Math.round(cap.startUs), durUs, 1, [spd.id], clipSettings(-0.8))
      seg.source_timerange = null
      textSegments.push(seg)
    }
    if (textSegments.length > 0) {
      tracks.push({
        attribute: 0, flag: 0, id: newUpperUUID(), is_default_name: false, name: '台词字幕', segments: textSegments, type: 'text',
      })
    }
  }

  materials.videos = videos
  materials.audios = audios
  materials.speeds = speeds
  materials.texts = texts

  const platform = { app_id: 3704, app_source: 'lv', app_version: '5.9.0', os: sep === BS ? 'windows' : 'mac' }
  const content = {
    canvas_config: { height: input.height, ratio: 'original', width: input.width },
    color_space: 0,
    config: {
      adjust_max_index: 1, attachment_info: [], combination_max_index: 1, export_range: null, extract_audio_last_index: 1,
      lyrics_recognition_id: '', lyrics_sync: true, lyrics_taskinfo: [], maintrack_adsorb: true, material_save_mode: 0,
      multi_language_current: 'none', multi_language_list: [], multi_language_main: 'none', multi_language_mode: 'none',
      original_sound_last_index: 1, record_audio_last_index: 1, sticker_max_index: 1, subtitle_keywords_config: null,
      subtitle_recognition_id: '', subtitle_sync: true, subtitle_taskinfo: [], system_font_list: [], video_mute: false,
      zoom_info_params: null,
    },
    cover: null, create_time: nowSec, duration: cursorUs, extra_info: null, fps,
    free_render_index_mode_on: false, group_container: null, id: draftId, keyframe_graph_list: [],
    keyframes: { adjusts: [], audios: [], effects: [], filters: [], handwrites: [], stickers: [], texts: [], videos: [] },
    last_modified_platform: platform, platform, materials, mutable_config: null, name: draftName,
    new_version: '110.0.0', relationships: [], render_index_track_mode_on: false, retouch_cover: null, source: 'default',
    static_cover_image_path: '', time_marks: null, tracks, update_time: nowSec, version: 360000,
  }

  const meta = {
    cloud_package_completed_time: '', draft_cloud_capcut_purchase_info: '', draft_cloud_last_action_download: false,
    draft_cloud_materials: [], draft_cloud_purchase_info: '', draft_cloud_template_id: '', draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '', draft_cover: '', draft_deeplink_url: '',
    draft_enterprise_info: { draft_enterprise_extra: '', draft_enterprise_id: '', draft_enterprise_name: '', enterprise_material: [] },
    draft_fold_path: folderPath, draft_id: draftId, draft_is_ai_packaging_used: false, draft_is_ai_shorts: false,
    draft_is_ai_translate: false, draft_is_article_video_draft: false, draft_is_from_deeplink: 'false', draft_is_invisible: false,
    draft_materials: [0, 1, 2, 3, 6, 7, 8].map(type => ({ type, value: [] })),
    draft_materials_copied_info: [], draft_name: draftName, draft_new_version: '', draft_removable_storage_device: '',
    draft_root_path: root, draft_segment_extra_info: [], draft_type: '', tm_draft_cloud_completed: '',
    tm_draft_cloud_modified: 0, tm_draft_create: nowUs, tm_draft_modified: nowUs, tm_draft_removed: 0,
    tm_duration: cursorUs,
  }

  return {
    folderPath,
    contentJson: JSON.stringify(content, null, 2),
    metaJson: JSON.stringify(meta, null, 2),
    srtText: buildSrt(input.captions),
  }
}

/** 判断目标草稿目录是否与当前运行操作系统匹配且可安全落盘。 */
export function isWritableLocalDraftPath(folderPath: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'win32') {
    return WINDOWS_ROOT.test(folderPath) || folderPath.startsWith(UNC_PREFIX) || isAbsolute(folderPath)
  }
  return folderPath.startsWith('/')
}

/** 若运行在本机且路径格式匹配当前 OS（macOS / Linux / Windows），直接把剪映草稿文件夹与素材写入目标目录。 */
export async function writeJianyingDraftToDisk(input: JianyingDraftInput): Promise<{
  folderPath: string
  writtenToDisk: boolean
  filesCount: number
  srtText: string
  reason?: string
}> {
  const built = buildJianyingDraftJson(input)
  if (!isWritableLocalDraftPath(built.folderPath)) {
    return {
      folderPath: built.folderPath,
      writtenToDisk: false,
      filesCount: 0,
      srtText: built.srtText,
      reason: `目标路径与当前服务器操作系统（${process.platform}）不匹配，未能直接写入磁盘`,
    }
  }
  // 防御性校验：解析后的落盘路径必须严格位于 root 之下
  const resolvedRoot = resolve(normalizeDraftRoot(input.root))
  const resolvedFolder = resolve(built.folderPath)
  const sep = process.platform === 'win32' ? BS : '/'
  if (!resolvedFolder.startsWith(resolvedRoot + sep)) {
    throw new CanvasOpError('草稿落盘路径越界，已拒绝写入')
  }

  const materialsDir = join(built.folderPath, MATERIALS_DIR)
  await mkdir(materialsDir, { recursive: true })
  for (const clip of input.clips) {
    await copyFile(clip.sourceFile, join(materialsDir, clip.fileName))
  }
  const audios = input.audios ?? []
  for (const aud of audios) {
    await copyFile(aud.sourceFile, join(materialsDir, aud.fileName))
  }
  await writeFile(join(built.folderPath, 'draft_content.json'), built.contentJson, 'utf8')
  await writeFile(join(built.folderPath, 'draft_info.json'), built.contentJson, 'utf8')
  await writeFile(join(built.folderPath, 'draft_meta_info.json'), built.metaJson, 'utf8')
  if (built.srtText) {
    await writeFile(join(built.folderPath, 'subtitles.srt'), built.srtText, 'utf8')
  }
  return {
    folderPath: built.folderPath,
    writtenToDisk: true,
    filesCount: input.clips.length + audios.length + 3 + (built.srtText ? 1 : 0),
    srtText: built.srtText,
  }
}

export function buildSrt(captions: JianyingCaption[]): string {
  const nl = String.fromCharCode(10)
  const lines: string[] = []
  let idx = 0
  for (const cap of captions) {
    const text = cap.text.trim()
    if (!text || cap.durationUs <= 0 || cap.startUs < 0) continue
    idx += 1
    lines.push([String(idx), `${srtTime(cap.startUs)} --> ${srtTime(cap.startUs + cap.durationUs)}`, text, ''].join(nl))
  }
  return lines.join(nl)
}

function srtTime(us: number): string {
  const ms = Math.max(0, Math.floor(us / 1000))
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, '0')
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0')
  const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')
  const rem = String(ms % 1000).padStart(3, '0')
  return `${h}:${m}:${s},${rem}`
}
