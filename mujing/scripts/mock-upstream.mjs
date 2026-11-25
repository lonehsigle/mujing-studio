/**
 * 本地联调用的增强版 mock 上游（无需任何真实密钥）：
 *  - POST /v1/chat/completions            OpenAI 兼容流式 chat，验证「幕境导演」全链路工具调用
 *  - GET  /v1/models
 *  - POST /v1/images/generations          返回程序生成的 PNG（b64_json）
 *  - POST /v1/images/edits                返回参考图编辑后的 PNG
 *  - POST /v1/contents/generations/tasks  火山方舟（Seedance）异步视频提交 + 真实可解码 MP4（FFmpeg 生成）
 *  - POST /v1/audio/speech                OpenAI 兼容 TTS 返回真实可解码 WAV/MP3 音频
 * 用法：node scripts/mock-upstream.mjs [port=3199]
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { deflateSync } from 'node:zlib'

const port = Number(process.argv[2] ?? 3199)
const LOG = process.env.MOCK_LOG ?? '/tmp/mujing-mock.log'
const MEDIA_CACHE = join(tmpdir(), 'mujing-mock-media')
mkdirSync(MEDIA_CACHE, { recursive: true })

function resolveFfmpeg() {
  for (const bin of [process.env.MUJING_FFMPEG_BIN, 'ffmpeg', '/Applications/EVCapture.app/Contents/Frameworks/ffmpeg'].filter(Boolean)) {
    try { execFileSync(bin, ['-version'], { stdio: 'ignore', timeout: 3000 }); return bin } catch {}
  }
  return 'ffmpeg'
}
const FFMPEG_BIN = resolveFfmpeg()

const tasks = new Map()
const LF = String.fromCharCode(10)

const SKILL_SLUGS = (() => {
  try { return JSON.parse(readFileSync(new URL('../skills/INDEX.json', import.meta.url), 'utf8')).map(s => s.slug) } catch { return [] }
})()
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...o }) + LF)

/** 生成具有电影感构图色块与高对比度光影的 PNG 样片卡（按尺寸自适应横竖屏，不再是单调小方块）。 */
function png(seed = 0, sizeStr = '1024x1024') {
  const isVertical = sizeStr.includes('x1536') || sizeStr.includes('9:16')
  const isHorizontal = sizeStr.includes('1536x') || sizeStr.includes('16:9')
  const w = isVertical ? 180 : isHorizontal ? 320 : 240
  const h = isVertical ? 320 : isHorizontal ? 180 : 240
  const palettes = [
    [[14, 23, 42], [56, 189, 248], [244, 63, 94]],
    [[24, 16, 48], [168, 85, 247], [251, 191, 36]],
    [[12, 34, 38], [20, 184, 166], [249, 115, 22]],
    [[36, 18, 28], [236, 72, 153], [99, 102, 241]],
  ]
  const [bg, glowA, glowB] = palettes[seed % palettes.length]
  const raw = Buffer.alloc((w * 3 + 1) * h)
  const cx = w * (0.38 + (seed % 3) * 0.12)
  const cy = h * 0.42
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    const ny = y / h
    for (let x = 0; x < w; x++) {
      const nx = x / w
      const o = y * (w * 3 + 1) + 1 + x * 3
      const distA = Math.hypot((x - cx) / w, (y - cy) / h)
      const beamA = Math.max(0, 1 - distA * 2.1)
      const rim = Math.max(0, 1 - Math.abs(nx - 0.72) * 4.5) * (1 - ny * 0.5)
      // 人物剪影主体与霓虹逆光灯带
      const inSilhouette = Math.hypot((x - w * 0.5) / (w * 0.14), (y - h * 0.36) / (h * 0.11)) < 1
        || (Math.abs(x - w * 0.5) < w * 0.19 * (0.7 + ny * 0.5) && y > h * 0.46 && y < h * 0.92)
      const letterbox = y < h * 0.05 || y > h * 0.95
      if (letterbox) {
        raw[o] = 8; raw[o + 1] = 10; raw[o + 2] = 15
      } else if (inSilhouette) {
        const edge = Math.abs(x - w * 0.5) > w * 0.13 ? 0.55 : 0.18
        raw[o] = Math.min(255, Math.round(bg[0] * 0.6 + glowA[0] * edge))
        raw[o + 1] = Math.min(255, Math.round(bg[1] * 0.6 + glowA[1] * edge))
        raw[o + 2] = Math.min(255, Math.round(bg[2] * 0.6 + glowA[2] * edge))
      } else {
        raw[o] = Math.min(255, Math.round(bg[0] + glowA[0] * beamA * 0.75 + glowB[0] * rim * 0.65))
        raw[o + 1] = Math.min(255, Math.round(bg[1] + glowA[1] * beamA * 0.75 + glowB[1] * rim * 0.65))
        raw[o + 2] = Math.min(255, Math.round(bg[2] + glowA[2] * beamA * 0.75 + glowB[2] * rim * 0.65))
      }
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** 使用系统 ffmpeg 生成真实可被 ffprobe/ffmpeg 解码、抽帧、拼接的 MP4 和 MP3 样本。 */
function ensureDemoMp4(variant = 0) {
  const colors = ['0x1e293b', '0x312e81', '0x4c1d95', '0x0f766e']
  const color = colors[variant % colors.length]
  const out = join(MEDIA_CACHE, `demo-${variant % 4}.mp4`)
  if (!existsSync(out)) {
    try {
      execFileSync(FFMPEG_BIN, [
        '-y',
        '-f', 'lavfi', '-i', `color=c=${color}:s=720x1280:r=24:d=2.5`,
        '-f', 'lavfi', '-i', `sine=frequency=${330 + (variant % 4) * 110}:sample_rate=44100:duration=2.5`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-shortest',
        out,
      ], { stdio: 'ignore' })
    } catch {
      return Buffer.from('mock-mp4-bytes')
    }
  }
  return readFileSync(out)
}

function ensureDemoMp3() {
  const out = join(MEDIA_CACHE, 'demo-tts.mp3')
  if (!existsSync(out)) {
    try {
      execFileSync(FFMPEG_BIN, [
        '-y',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2.0',
        '-b:a', '96k',
        out,
      ], { stdio: 'ignore' })
    } catch {
      // 回退：生成最小合法 WAV PCM
      const samples = 8000
      const header = Buffer.alloc(44)
      header.write('RIFF', 0); header.writeUInt32LE(36 + samples * 2, 4); header.write('WAVEfmt ', 8)
      header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
      header.writeUInt32LE(8000, 24); header.writeUInt32LE(16000, 28); header.writeUInt16LE(2, 32)
      header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(samples * 2, 40)
      return Buffer.concat([header, Buffer.alloc(samples * 2)])
    }
  }
  return readFileSync(out)
}

/** 剧本：根据对话里已出现的工具结果决定下一步（支持短剧流水线模式与画布模式）。 */
function nextStep(messages) {
  const toolMsgs = messages.filter(m => m.role === 'tool')
  const calledNames = messages.flatMap(m => (m.tool_calls ?? []).map(c => c.function.name))
  // 过滤掉系统注入的 <mujing_studio_context> 与 <system-reminder>，只提取用户真实输入的创作意图
  const realUserTexts = messages
    .filter(m => m.role === 'user')
    .map(m => {
      const raw = typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map(part => part?.text ?? '').join(' ')
          : JSON.stringify(m.content)
      return raw
        .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
        .replace(/<mujing_studio_context>[\s\S]*?<\/mujing_studio_context>/gi, '')
        .trim()
    })
    .filter(t => t.length > 0 && !t.includes('Time sampled while preparing turn'))
  const latestUserText = realUserTexts.at(-1) ?? ''
  const allUserText = realUserTexts.join(' ')
  const isJianyingOnly = /导出剪映|剪映草稿/.test(latestUserText) && calledNames.includes('drama_run_episode')
  if (isJianyingOnly && !calledNames.includes('timeline_export_jianying')) {
    return { tool: 'timeline_export_jianying', args: {} }
  }
  const isAncient = /古风|仙侠|烬雪|长歌|宫廷/.test(allUserText)
  const isDramaPrompt = /短剧|小说|拆集|三视图|剪映|分镜|雨夜|古风|故事/.test(allUserText)

  if (!calledNames.includes('canvas_create_project')) {
    const title = isAncient ? '烬雪长歌·古风短剧' : isDramaPrompt ? '雨夜芯片·赛博短剧' : '幕境概念短片'
    return { tool: 'canvas_create_project', args: { title } }
  }

  if (isDramaPrompt) {
    if (!calledNames.includes('drama_save_plan')) {
      return {
        tool: 'drama_save_plan',
        args: {
          style: isAncient
            ? '东方古风电影质感，烛火冷雪对比，浅景深，35mm胶片颗粒'
            : '赛博雨夜冷调电影感，霓虹反光，浅景深，35mm胶片颗粒',
          aspect_ratio: '9:16',
          segment_target_sec: 4,
          novel_text: latestUserText || allUserText,
          casts: isAncient
            ? [
              { kind: 'character', name: '沈清辞', role: '女主·亡国公主', appearance: '22岁清冷东亚女性，素白狐裘斗篷，乌发绾玉簪，眉心一点朱砂', voice: 'nova' },
              { kind: 'character', name: '萧烬', role: '男主·镇北将军', appearance: '27岁冷峻男性，玄铁轻甲披暗红战袍，高马尾，眼神凌厉', voice: 'onyx' },
              { kind: 'scene', name: '风雪城楼·夜', role: '核心场景', appearance: '暴雪纷飞的古代青砖城楼，红灯笼在寒风中摇晃，火盆火星四溅' },
            ]
            : [
              { kind: 'character', name: '林默', role: '男主·冷面侦探', appearance: '28岁黑短发东亚男性，深灰风衣立领，左眉细疤，冷峻克制', voice: 'onyx' },
              { kind: 'character', name: '苏晚', role: '女主·神秘线人', appearance: '26岁盘发东亚女性，暗红丝绒旗袍披黑色皮衣，耳戴银坠', voice: 'nova' },
              { kind: 'scene', name: '蓝调酒吧·雨夜', role: '常驻主场景', appearance: '霓虹穿透落地雨窗的复古爵士酒吧，木质吧台倒映蓝紫冷光' },
            ],
          episodes: [
            {
              number: 1,
              title: isAncient ? '城楼重逢' : '雨夜交接',
              synopsis: isAncient
                ? '风雪城楼之上，沈清辞执剑拦住班师入城的萧烬，揭开三年前灭门军令真相。'
                : '林默与苏晚在雨夜酒吧秘密交接记忆芯片，窗外红外狙击骤然锁定两人。',
              hook: isAncient ? '暴雪夜长剑出鞘，斩断战旗一角' : '暴雨推门，染血记忆芯片滑过吧台',
              cliffhanger: isAncient ? '萧烬徒手握住剑锋，鲜血滴落白雪' : '窗外红外瞄准红点骤然锁定林默眉心',
              shots: isAncient
                ? [
                  { scene: '风雪城楼·夜', shotSize: '中景', camera: '缓推', action: '漫天飞雪中沈清辞立于城楼石阶，拔出寒霜长剑直指前方', speaker: '沈清辞', dialogue: '萧将军，这一剑你躲了三年。', durationMs: 3500 },
                  { scene: '风雪城楼·夜', shotSize: '近景', camera: '缓推', action: '萧烬翻身下马踏雪逼近，徒手握住锋利剑刃，目光深沉凝视沈清辞', speaker: '萧烬', dialogue: '虎符在此，当年的账今日算清。', durationMs: 3500 },
                  { scene: '风雪城楼·夜', shotSize: '特写', camera: '急推', action: '鲜血顺着剑锋滴落在洁白积雪上，城下战鼓骤然轰鸣', speaker: '沈清辞', dialogue: '城门已锁，谁也别想退！', durationMs: 3500 },
                ]
                : [
                  { scene: '蓝调酒吧·雨夜', shotSize: '中景', camera: '缓推', action: '林默推开酒吧玻璃门抖落雨水，苏晚坐在吧台高脚凳转身将芯片推过桌面', speaker: '苏晚', dialogue: '三年前实验室的原始录像都在里面。', durationMs: 3500 },
                  { scene: '蓝调酒吧·雨夜', shotSize: '近景', camera: '固定', action: '林默按住发光芯片抬头审视苏晚，窗外霓虹雨水在两人脸上流动', speaker: '林默', dialogue: '你冒这么大风险，到底想要什么？', durationMs: 3500 },
                  { scene: '蓝调酒吧·雨夜', shotSize: '特写', camera: '急推', action: '一束刺眼红外激光穿过雨幕玻璃落在威士忌酒杯上，林默猛然揽住苏晚扑向吧台掩体', speaker: '林默', dialogue: '趴下！对面天台有狙击手！', durationMs: 3500 },
                ],
            },
          ],
        },
      }
    }
    if (!calledNames.includes('drama_generate_casts')) {
      return { tool: 'drama_generate_casts', args: {} }
    }
    if (!calledNames.includes('drama_generate_shot_media')) {
      return { tool: 'drama_generate_shot_media', args: { episode: 1, kind: 'keyframe', shot_index: 0 } }
    }
    if (!calledNames.includes('drama_run_episode')) {
      return { tool: 'drama_run_episode', args: { episode: 1, auto_compose: true } }
    }
    return {
      text: [
        '已完成短剧全流程制作并同步至右侧 **幕境影视工作台**：',
        '1. **剧本与角色资产锁定**：已拆解第 1 集 3 镜剧本，并为全部核心角色与常驻场景生成锁定设定卡；',
        '2. **分镜关键帧与尾帧接续视频**：已生成首镜故事板关键帧，并按分段通过 FFmpeg 抽取上一段真实尾帧无缝续拍下一段视频；',
        '3. **多轨成片合成**：已自动推送至时间线并合成完整 MP4 成片与时间轴对齐的 SRT 字幕。你可以在右侧分屏直接预览单镜配音、调整分镜或一键导出剪映专业版草稿！',
      ].join('\n'),
    }
  }

  if (!calledNames.includes('canvas_apply_ops')) {
    return { tool: 'canvas_apply_ops', args: { ops: [
      { op: 'add_node', id: 'script', type: 'text', title: '剧本', content: '第1集：雨夜，侦探推开酒吧的门。' },
      { op: 'add_node', id: 'hero', type: 'image', title: '角色·侦探', prompt: '黑色风衣侦探，三视图' },
      { op: 'connect', source: 'script', target: 'hero' },
    ] } }
  }
  const generated = calledNames.filter(n => n === 'generate_media').length
  if (generated === 0) {
    return { tool: 'generate_media', args: { kind: 'image', node_id: 'hero', prompt: '黑色风衣侦探，雨夜霓虹，电影感' } }
  }
  if (generated === 1) {
    return { tool: 'generate_media', args: { kind: 'video', title: '镜头1·推门', prompt: '侦探推开酒吧门，雨水飞溅，缓慢推镜', reference_node_ids: ['hero'], duration: 5 } }
  }
  if (!calledNames.includes('canvas_get_state')) {
    return { tool: 'canvas_get_state', args: {} }
  }
  const last = toolMsgs.at(-1)?.content
  return { text: `完成：已建画布、写剧本、出角色图与视频。最后的画布状态摘要：${String(typeof last === 'string' ? last : JSON.stringify(last)).slice(0, 120)}` }
}

function sse(res, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}${LF}${LF}`)
  res.end(`data: [DONE]${LF}${LF}`)
}

let imgSeq = 0
let vidSeq = 0

const server = createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const rawBuf = Buffer.concat(chunks)
  const ct = req.headers['content-type'] ?? ''
  let body = {}
  if (rawBuf.length && ct.includes('application/json')) {
    try { body = JSON.parse(rawBuf.toString('utf8')) } catch { body = {} }
  }
  const url = req.url ?? ''

  if (req.method === 'GET' && url.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-director', object: 'model' }] }))
    return
  }

  if (req.method === 'POST' && (url.endsWith('/images/generations') || url.endsWith('/images/edits'))) {
    const seed = imgSeq++
    log({ kind: 'image', prompt: body.prompt ?? '(multipart-edit)', model: body.model, size: body.size })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ created: Date.now(), data: [{ b64_json: png(seed, String(body.size ?? '1024x1024')).toString('base64') }] }))
    return
  }

  if (req.method === 'POST' && url.endsWith('/audio/speech')) {
    log({ kind: 'audio', input: body.input, voice: body.voice, model: body.model })
    const bytes = ensureDemoMp3()
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': String(bytes.length) })
    res.end(bytes)
    return
  }

  // 火山方舟（Seedance）视频任务：提交即返回 id，查询第 2 次起返回真实 MP4
  if (req.method === 'POST' && url.endsWith('/contents/generations/tasks')) {
    const variant = vidSeq++
    const id = `cgt-${Date.now()}-${variant}`
    tasks.set(id, { polls: 0, variant })
    log({ kind: 'video-submit', id, model: body.model, contentCount: Array.isArray(body.content) ? body.content.length : 0 })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id }))
    return
  }

  const tm = /\/contents\/generations\/tasks\/([^/?]+)$/.exec(url)
  if (req.method === 'GET' && tm) {
    const rec = tasks.get(tm[1]) ?? { polls: 0, variant: 0 }
    rec.polls += 1
    tasks.set(tm[1], rec)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(
      rec.polls < 2
        ? { id: tm[1], status: 'running' }
        : { id: tm[1], status: 'succeeded', content: { video_url: `http://127.0.0.1:${port}/files/demo-${rec.variant % 4}.mp4` } },
    ))
    return
  }

  const fm = /^\/files\/demo-(\d+)\.mp4$/.exec(url)
  if (req.method === 'GET' && fm) {
    const bytes = ensureDemoMp4(Number(fm[1]))
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(bytes.length) })
    res.end(bytes)
    return
  }

  if (req.method === 'POST' && url.endsWith('/chat/completions')) {
    const tools = (body.tools ?? []).map(t => t.function?.name)
    const system = (body.messages ?? []).filter(m => m.role === 'system' || m.role === 'developer').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join(LF)
    const everything = JSON.stringify(body)
    log({
      kind: 'system', chars: system.length, hasPersona: system.includes('幕境导演'),
      skillsSeen: SKILL_SLUGS.filter(s => everything.includes(s)).length, skillsTotal: SKILL_SLUGS.length,
    })
    const step = nextStep(body.messages ?? [])
    log({ kind: 'chat', tools, step, lastRole: body.messages?.at(-1)?.role })
    const base = { id: `mock-${Date.now()}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model }
    if (step.text) {
      sse(res, [
        { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: step.text }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } },
      ])
    } else {
      sse(res, [
        { ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.args) } }] }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } },
      ])
    }
    return
  }

  res.writeHead(404); res.end()
})

server.listen(port, '127.0.0.1', () => console.log(`mock upstream on http://127.0.0.1:${port}/v1 (log: ${LOG})`))
