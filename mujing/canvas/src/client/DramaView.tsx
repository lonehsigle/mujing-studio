import { useEffect, useState, type ReactNode } from "react"
import type {
  DramaCast,
  DramaCastKind,
  DramaEpisode,
  DramaShot,
  HandoffMode,
} from "../host/types.ts"
import {
  CAMERA_MOVES,
  CAST_KIND_LABEL,
  HANDOFF_LABEL,
  SHOT_SIZES,
  STATUS_LABEL,
  STYLE_PRESETS,
  VOICES,
} from "./constants.ts"
import {
  call,
  dispatchDirectorPrompt,
  type ProjectWithHistory,
  type WorkspaceTab,
} from "./studio-bus.ts"
import css from "./style.css"

/* ───────────────────────── 视图 1：小说 → 短剧全流程故事板工作台 ───────────────────────── */

export function DramaView({ project, onError, onNotify, onSwitchTab }: {
  project: ProjectWithHistory
  onError: (m: string) => void
  onNotify: (m: string) => void
  onSwitchTab: (t: WorkspaceTab) => void
}): ReactNode {
  const drama = project.drama
  const [style, setStyle] = useState(drama?.style ?? STYLE_PRESETS[0].style)
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>(drama?.aspectRatio ?? '9:16')
  const [segmentTargetSec, setSegmentTargetSec] = useState<number>(drama?.segmentTargetSec ?? 10)
  const [novelText, setNovelText] = useState(drama?.novelText ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [showBible, setShowBible] = useState(false)

  // 添加角色/场景抽屉状态
  const [addingCast, setAddingCast] = useState(false)
  const [castKind, setCastKind] = useState<DramaCastKind>('character')
  const [castName, setCastName] = useState('')
  const [castRole, setCastRole] = useState('')
  const [castVoice, setCastVoice] = useState<string>('nova')
  const [castAppearance, setCastAppearance] = useState('')

  // 分镜单镜内联编辑 / 新增状态
  const [editingShotKey, setEditingShotKey] = useState<string | null>(null)
  const [shotDraft, setShotDraft] = useState<{
    scene: string
    shotSize: string
    camera: string
    action: string
    speaker: string
    dialogue: string
    durationSec: number
  }>({ scene: '', shotSize: '中景', camera: '缓推', action: '', speaker: '', dialogue: '', durationSec: 3.5 })

  // 分段提示词折叠展开编辑状态
  const [editingSegKey, setEditingSegKey] = useState<string | null>(null)
  const [segPromptDraft, setSegPromptDraft] = useState('')

  useEffect(() => {
    setStyle(project.drama?.style ?? STYLE_PRESETS[0].style)
    setAspectRatio(project.drama?.aspectRatio ?? '9:16')
    setSegmentTargetSec(project.drama?.segmentTargetSec ?? 10)
    setNovelText(project.drama?.novelText ?? '')
  }, [project.id, project.drama?.style, project.drama?.aspectRatio, project.drama?.segmentTargetSec, project.drama?.novelText])

  const saveMeta = async (): Promise<void> => {
    setBusy('保存短剧设定…')
    try {
      await call(`/projects/${project.id}/drama`, {
        method: 'PUT',
        body: { style, aspectRatio, segmentTargetSec, novelText, syncCanvasNodes: true },
      })
      onNotify('短剧全局设定与小说剧本已保存')
    } catch (e) { onError((e as Error).message) } finally { setBusy(null) }
  }

  const loadDemoDrama = async (): Promise<void> => {
    setBusy('初始化样片短剧工程…')
    try {
      await call(`/projects/${project.id}/drama`, {
        method: 'PUT',
        body: {
          genre: '赛博悬疑短剧',
          style: '赛博雨夜冷调电影感，霓虹反光，35mm胶片质感，浅景深',
          aspectRatio: '9:16',
          segmentTargetSec: 8,
          novelText: '暴雨倾盆的江城深夜，私家侦探林默推开“蓝调残响”酒吧大门。吧台尽头，身穿绯红丝绒旗袍的苏晚缓缓转过身，将一枚刻有旧日徽记的加密芯片推到他面前：“三年前那桩失踪案，真相就在里面。”话音未落，窗外闪过狙击镜的红点。',
          casts: [
            {
              kind: 'character',
              name: '林默',
              role: '男主·冷峻私家侦探',
              appearance: '28岁东亚男性，利落黑短发微湿，深灰色翻领长风衣，内搭炭黑高领毛衣，眼神锐利，左眉骨有一道细浅旧疤',
              voice: 'onyx',
            },
            {
              kind: 'character',
              name: '苏晚',
              role: '女主·神秘线人',
              appearance: '26岁东亚女性，复古盘发配珍珠发簪，暗绯红丝绒修身旗袍外披黑色羊绒披肩，神情冷静克制',
              voice: 'nova',
            },
            {
              kind: 'scene',
              name: '蓝调酒吧·雨夜室内',
              role: '常驻主场景',
              appearance: '霓虹穿透落地雨窗的复古爵士酒吧，木质吧台倒映蓝紫与绯红冷暖光影',
            },
          ],
          episodes: [
            {
              number: 1,
              title: '雨夜芯片',
              synopsis: '林默赴约蓝调酒吧，苏晚交出关键加密芯片，危机骤临。',
              hook: '暴雨夜推门瞬间，一枚染血徽记芯片滑过吧台',
              cliffhanger: '玻璃幕墙外红外激光锁定眉心',
              shots: [
                {
                  scene: '蓝调酒吧·雨夜室内',
                  shotSize: '中景',
                  camera: '缓推',
                  action: '林默推开木门走入霓虹昏暗的酒吧，抖落风衣肩头雨水，目光锁向吧台深处',
                  durationMs: 4000,
                },
                {
                  scene: '蓝调酒吧·雨夜室内',
                  shotSize: '近景',
                  camera: '横摇',
                  action: '苏晚从吧台高脚凳缓缓转身，纤指将一枚金属加密芯片推向桌面',
                  speaker: '苏晚',
                  dialogue: '三年前那桩失踪案，真相就在里面。',
                  durationMs: 4000,
                },
                {
                  scene: '蓝调酒吧·雨夜室内',
                  shotSize: '特写',
                  camera: '急推',
                  action: '林默伸手按住芯片，突然瞳孔骤缩，一束刺眼红点透过雨幕玻璃落在吧台酒杯上，林默猛地扑倒苏晚',
                  speaker: '林默',
                  dialogue: '趴下！外面有狙击手！',
                  durationMs: 4500,
                },
              ],
            },
          ],
          syncCanvasNodes: true,
        },
      })
      onNotify('已载入短剧样片工程《雨夜芯片》角色/场景卡与分镜表')
    } catch (e) { onError((e as Error).message) } finally { setBusy(null) }
  }

  const submitAddCast = async (): Promise<void> => {
    if (!castName.trim() || !castAppearance.trim()) {
      onError('请填写资产名称与固定视觉外貌/场景锚点描述')
      return
    }
    const nextCasts: Array<Partial<DramaCast> & { name: string }> = [
      ...(drama?.casts ?? []),
      {
        kind: castKind,
        name: castName.trim(),
        role: castRole.trim() || undefined,
        appearance: castAppearance.trim(),
        ...(castKind === 'character' ? { voice: castVoice } : {}),
      },
    ]
    setBusy('添加视觉资产卡…')
    try {
      await call(`/projects/${project.id}/drama`, { method: 'PUT', body: { casts: nextCasts, syncCanvasNodes: true } })
      setAddingCast(false)
      setCastName('')
      setCastRole('')
      setCastAppearance('')
      onNotify(`已添加${CAST_KIND_LABEL[castKind]}设定卡「${castName.trim()}」`)
    } catch (e) { onError((e as Error).message) } finally { setBusy(null) }
  }

  const removeCast = async (castId: string): Promise<void> => {
    const nextCasts = (drama?.casts ?? []).filter(c => c.id !== castId)
    try {
      await call(`/projects/${project.id}/drama`, { method: 'PUT', body: { casts: nextCasts, syncCanvasNodes: true } })
    } catch (e) { onError((e as Error).message) }
  }

  const generateCasts = async (castId?: string): Promise<void> => {
    setBusy(castId ? '正在渲染设定图…' : '正在批量生成并锁定全部角色/场景三视图…')
    try {
      await call(`/projects/${project.id}/drama/generate-casts`, { method: 'POST', body: castId ? { castId } : {} })
      onNotify('视觉设定图已生成并锁定（生关键帧与生视频将自动带入参考图保持一致）')
    } catch (e) { onError((e as Error).message) } finally { setBusy(null) }
  }

  const generateShotMedia = async (epNumber: number, kind: 'keyframe' | 'audio', shotId?: string): Promise<void> => {
    const label = kind === 'keyframe'
      ? (shotId ? '正在生成该镜故事板关键帧…' : `正在批量生成第 ${epNumber} 集全部分镜关键帧…`)
      : (shotId ? '正在合成该镜角色配音 TTS…' : `正在批量合成第 ${epNumber} 集全部台词配音…`)
    setBusy(label)
    try {
      const res = await call<{ generated: Array<{ shotNumber: number; url?: string; error?: string }> }>(
        `/projects/${project.id}/drama/shot-media`,
        { method: 'POST', body: { episode: epNumber, kind, ...(shotId ? { shotId } : {}) } },
      )
      onNotify(`已完成 ${res.generated.length} 个镜头的${kind === 'keyframe' ? '关键帧出图' : '角色配音合成'}`)
    } catch (e) { onError((e as Error).message) } finally { setBusy(null) }
  }

  const startEditShot = (epNumber: number, shot?: DramaShot): void => {
    if (shot) {
      setEditingShotKey(`${epNumber}:${shot.id}`)
      setShotDraft({
        scene: shot.scene,
        shotSize: shot.shotSize || '中景',
        camera: shot.camera || '固定',
        action: shot.action,
        speaker: shot.speaker ?? '',
        dialogue: shot.dialogue ?? '',
        durationSec: Number(((shot.durationMs || 3500) / 1000).toFixed(1)),
      })
    } else {
      const ep = drama?.episodes.find(x => x.number === epNumber)
      setEditingShotKey(`${epNumber}:new`)
      setShotDraft({
        scene: ep?.shots.at(-1)?.scene ?? drama?.casts.find(c => c.kind === 'scene')?.name ?? '主场景',
        shotSize: '近景',
        camera: '缓推',
        action: '',
        speaker: '',
        dialogue: '',
        durationSec: 3.5,
      })
    }
  }

  const saveShotEdit = async (epNumber: number, shotId?: string): Promise<void> => {
    if (!shotDraft.action.trim()) {
      onError('分镜画面动作描述不能为空')
      return
    }
    setBusy('保存分镜并重编译连续视频段…')
    try {
      await call(`/projects/${project.id}/drama/shot`, {
        method: 'PATCH',
        body: {
          episode: epNumber,
          ...(shotId ? { shotId } : {}),
          patch: {
            scene: shotDraft.scene.trim(),
            shotSize: shotDraft.shotSize,
            camera: shotDraft.camera,
            action: shotDraft.action.trim(),
            speaker: shotDraft.speaker.trim(),
            dialogue: shotDraft.dialogue.trim(),
            durationMs: Math.max(1500, Math.round((shotDraft.durationSec || 3.5) * 1000)),
          },
        },
      })
      setEditingShotKey(null)
      onNotify(shotId ? '分镜已更新并自动重排分段提示词' : '已新增分镜')
    } catch (e) { onError((e as Error).message) } finally { setBusy(null) }
  }

  const deleteShot = async (epNumber: number, shotId: string): Promise<void> => {
    if (!window.confirm('确认删除这个分镜镜头？')) return
    setBusy('删除分镜…')
    try {
      await call(`/projects/${project.id}/drama/shot`, {
        method: 'PATCH',
        body: { episode: epNumber, shotId, delete: true },
      })
      onNotify('已删除分镜并同步更新分段')
    } catch (e) { onError((e as Error).message) } finally { setBusy(null) }
  }

  const saveSegmentPatch = async (ep: DramaEpisode, segIdx: number, patch: { handoff?: HandoffMode; prompt?: string }): Promise<void> => {
    try {
      await call(`/projects/${project.id}/drama/segment`, {
        method: 'PATCH',
        body: { episodeId: ep.id, segmentIndex: segIdx, ...patch },
      })
      if (patch.prompt !== undefined) {
        setEditingSegKey(null)
        onNotify(`分段 S${segIdx + 1} 视频提示词已更新`)
      }
    } catch (e) { onError((e as Error).message) }
  }

  const runEpisode = async (epNumber: number, segmentIndex?: number): Promise<void> => {
    setBusy(segmentIndex !== undefined ? `正在生成第 ${epNumber} 集分段 S${segmentIndex + 1}…` : `正在按尾帧接续顺序生成第 ${epNumber} 集全部视频分段…`)
    try {
      await call(`/projects/${project.id}/drama/run-episode`, {
        method: 'POST',
        body: { episode: epNumber, ...(segmentIndex !== undefined ? { segmentIndex, forceRegenerate: true } : { forceRegenerate: false }) },
      })
      onNotify(`第 ${epNumber} 集视频分段生成完成`)
    } catch (e) { onError((e as Error).message) } finally { setBusy(null) }
  }

  const sendEpisodeToTimeline = async (epNumber: number, autoRender: boolean): Promise<void> => {
    setBusy(autoRender ? '正在混流配音并用 FFmpeg 合成整集 MP4…' : '正在推送片段与配音到时间线…')
    try {
      await call(`/projects/${project.id}/drama/to-timeline`, { method: 'POST', body: { episode: epNumber, autoRender } })
      onNotify(autoRender ? '已合成整集 MP4 成片与 SRT 字幕' : '已推送到时间线')
      if (!autoRender) onSwitchTab('timeline')
    } catch (e) { onError((e as Error).message) } finally { setBusy(null) }
  }

  const casts = drama?.casts ?? []
  const episodes = drama?.episodes ?? []
  const lockedCount = casts.filter(c => c.locked && c.imageUrl).length
  const totalShots = episodes.reduce((sum, ep) => sum + ep.shots.length, 0)
  const bibleExpanded = showBible || (casts.length === 0 && episodes.length === 0)

  return (
    <div className={css.panelScroll}>
      <div className={css.panelInner}>
        {/* 模块 1：全剧设定与小说原稿（有内容时自动折叠为一行视觉设定摘要条，释放首屏给角色与分镜） */}
        <div className={css.sectionCard}>
          {!bibleExpanded ? (
            <div className={css.bibleBar}>
              <div className={css.bibleBarLeft}>
                <span className={css.ratioTag}>{aspectRatio}</span>
                <span className={css.badge}>单段 {segmentTargetSec}s</span>
                <span className={css.bibleStyleText} title={style}>{style || '未设置统一视觉风格'}</span>
              </div>
              <div className={css.bibleBarRight}>
                <span className={css.bibleStats}>{lockedCount}/{casts.length} 锁定 · {episodes.length} 集 {totalShots} 镜</span>
                {busy && <span className={css.badgeAccent}>{busy}</span>}
                <button type="button" className={css.btn} onClick={() => setShowBible(true)}>✎ 剧本与画风</button>
              </div>
            </div>
          ) : (
            <>
              <div className={css.sectionHead}>
                <div className={css.sectionTitle}>
                  <span className={css.stepNum}>1</span>
                  <span>剧本原稿与全剧美术设定（Style Bible）</span>
                  {busy && <span className={css.badgeAccent}>{busy}</span>}
                </div>
                <div className={css.actions}>
                  {episodes.length === 0 && (
                    <button type="button" className={css.btn} disabled={busy !== null} onClick={() => void loadDemoDrama()}>
                      ✨ 载入《雨夜芯片》样片
                    </button>
                  )}
                  <button type="button" className={css.btnPrimary} disabled={busy !== null} onClick={() => void saveMeta()}>
                    保存设定
                  </button>
                  {(casts.length > 0 || episodes.length > 0) && (
                    <button type="button" className={css.btn} onClick={() => setShowBible(false)}>收起</button>
                  )}
                </div>
              </div>

              <div className={css.gridRow}>
                <label className={css.field}>
                  全剧统一视觉风格（Style Bible）
                  <input value={style} onChange={e => setStyle(e.target.value)} placeholder="如：电影级冷调写实 / 国风3D动画…" />
                </label>
                <label className={css.field}>
                  目标画幅
                  <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value as '16:9' | '9:16' | '1:1')}>
                    <option value="9:16">9:16 竖屏短剧（抖音/红果）</option>
                    <option value="16:9">16:9 横屏漫剧/影视</option>
                    <option value="1:1">1:1 方形画幅</option>
                  </select>
                </label>
                <label className={css.field}>
                  单段视频上限（秒）
                  <input type="number" min={4} max={15} value={segmentTargetSec} onChange={e => setSegmentTargetSec(Number(e.target.value) || 10)} />
                </label>
              </div>

              <label className={css.field}>
                小说原文 / 故事梗概（在左侧发送给「幕境导演」即可全自动拆集、锁定角色三视图并生成成片）
                <textarea
                  rows={3}
                  value={novelText}
                  onChange={e => setNovelText(e.target.value)}
                  placeholder="在此粘贴网文小说章节或故事梗概，或在左侧直接对「幕境导演」口述剧情创意…"
                />
              </label>
            </>
          )}
        </div>

        {/* 模块 2：角色 / 场景 / 道具视觉资产锁定池 */}
        <div className={css.sectionCard}>
          <div className={css.sectionHead}>
            <div className={css.sectionTitle}>
              <span className={css.stepNum}>2</span>
              <span>角色与场景资产锁定</span>
              <span className={css.badge}>{lockedCount}/{casts.length} 已锁定</span>
            </div>
            <div className={css.actions}>
              <button type="button" className={css.btn} onClick={() => setAddingCast(v => !v)}>
                {addingCast ? '收起' : '＋ 添加资产'}
              </button>
              <button type="button" className={css.btnPrimary} disabled={casts.length === 0 || busy !== null} onClick={() => void generateCasts()}>
                批量锁定设定图
              </button>
            </div>
          </div>

          {addingCast && (
            <div className={css.inlineEditorBox}>
              <div className={css.gridRow}>
                <label className={css.field}>
                  资产类型
                  <select value={castKind} onChange={e => setCastKind(e.target.value as DramaCastKind)}>
                    <option value="character">👤 核心角色（三视图）</option>
                    <option value="scene">🏛️ 常驻场景（空镜锚点）</option>
                    <option value="prop">🗡️ 关键道具（特写设定）</option>
                  </select>
                </label>
                <label className={css.field}>
                  名称
                  <input value={castName} onChange={e => setCastName(e.target.value)} placeholder="如：沈清辞 / 风雪城楼·夜" />
                </label>
                <label className={css.field}>
                  身份定位
                  <input value={castRole} onChange={e => setCastRole(e.target.value)} placeholder="如：女主·亡国公主" />
                </label>
                {castKind === 'character' && (
                  <label className={css.field}>
                    绑定音色（TTS）
                    <select value={castVoice} onChange={e => setCastVoice(e.target.value)}>
                      {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <label className={css.field}>
                固定视觉外貌 / 场景光影锚点描述
                <input value={castAppearance} onChange={e => setCastAppearance(e.target.value)} placeholder="年龄、发型发色、标志性服饰材质，或建筑光影氛围…" />
              </label>
              <div className={css.actions}>
                <button type="button" className={css.btnPrimary} disabled={busy !== null} onClick={() => void submitAddCast()}>保存资产</button>
                <button type="button" className={css.btn} onClick={() => setAddingCast(false)}>取消</button>
              </div>
            </div>
          )}

          {casts.length === 0 ? (
            <div className={css.dim}>暂无视觉设定卡。点击上方「载入样片」或在左侧让「幕境导演」自动提炼。</div>
          ) : (
            <div className={css.castGrid}>
              {casts.map(c => (
                <div key={c.id} className={css.castCard}>
                  <div className={css.castPreview}>
                    {c.imageUrl ? <img src={c.imageUrl} alt={c.name} /> : <span>待生成设定图</span>}
                    <span className={css.castOverlayKind} data-kind={c.kind}>{CAST_KIND_LABEL[c.kind]}</span>
                    <span className={c.locked && c.imageUrl ? css.castOverlayLock : css.castOverlayPending}>
                      {c.locked && c.imageUrl ? '✓ 已锁定' : '待出图'}
                    </span>
                  </div>
                  <div className={css.castMetaBody}>
                    <div className={css.castHeadLine}>
                      <b className={css.castName}>{c.name}</b>
                      {c.voice && <span className={css.voiceTag}>🎙 {c.voice}</span>}
                    </div>
                    {c.role && <div className={css.castRoleLine}>{c.role}</div>}
                    <div className={css.castAppearanceText} title={c.appearance}>{c.appearance}</div>
                    <div className={css.castFootActions}>
                      <button type="button" className={css.miniBtn} disabled={busy !== null} onClick={() => void generateCasts(c.id)}>
                        {c.imageUrl ? '↻ 重绘' : '生成'}
                      </button>
                      <button type="button" className={css.miniBtnDanger} disabled={busy !== null} onClick={() => void removeCast(c.id)}>
                        移除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 模块 3：分镜故事板 · 单镜关键帧与配音 · 尾帧接续生视频 */}
        <div className={css.sectionCard}>
          <div className={css.sectionHead}>
            <div className={css.sectionTitle}>
              <span className={css.stepNum}>3</span>
              <span>分镜故事板与连续出片</span>
              <span className={css.badge}>{episodes.length} 集</span>
            </div>
          </div>

          {episodes.length === 0 ? (
            <div className={css.dim}>暂无分集分镜。让左侧「幕境导演」自动规划分镜，或点击上方载入样片。</div>
          ) : (
            episodes.map(ep => {
              const hasDialogues = ep.shots.some(s => Boolean(s.dialogue?.trim()))
              const isPortrait = aspectRatio === '9:16'
              return (
                <div key={ep.id} className={css.epCard}>
                  <div className={css.sectionHead}>
                    <div className={css.sectionTitle}>
                      <span>第 {ep.number} 集 · 《{ep.title}》</span>
                      <span className={css.badge}>{ep.shots.length} 镜 · {ep.segments.length} 段</span>
                    </div>
                    <div className={css.actions}>
                      <button
                        type="button"
                        className={css.btnPrimary}
                        disabled={busy !== null || ep.shots.length === 0}
                        onClick={() => void runEpisode(ep.number)}
                      >
                        ▶ 尾帧接续出片
                      </button>
                      <button
                        type="button"
                        className={css.btn}
                        disabled={busy !== null}
                        onClick={() => void sendEpisodeToTimeline(ep.number, true)}
                      >
                        🎞 合成 MP4
                      </button>
                    </div>
                  </div>

                  {/* 成片直出监视卡（两栏紧凑布局，杜绝大面积黑边留白） */}
                  {ep.finalVideoUrl ? (
                    <div className={css.epHeroCard}>
                      <video
                        className={isPortrait ? css.epHeroVideoPortrait : css.epHeroVideoLandscape}
                        src={ep.finalVideoUrl}
                        controls
                        playsInline
                      />
                      <div className={css.epHeroInfo}>
                        <div className={css.sectionHead}>
                          <span className={css.badgeOk}>✓ 第 {ep.number} 集成片已就绪</span>
                          <span className={css.dim} style={{ fontSize: 11 }}>FFmpeg 音画混流 + SRT 字幕</span>
                        </div>
                        {ep.synopsis && <div className={css.epHeroSynopsis}>{ep.synopsis}</div>}
                        <div className={css.epHeroTags}>
                          {ep.hook && <div className={css.epTagLine}><span>⚡ 钩子</span>{ep.hook}</div>}
                          {ep.cliffhanger && <div className={css.epTagLine}><span>🔥 悬念</span>{ep.cliffhanger}</div>}
                        </div>
                        <div className={css.actions} style={{ marginTop: 'auto' }}>
                          <button type="button" className={css.btnPrimary} onClick={() => onSwitchTab('timeline')}>
                            去时间线 / 导出剪映 ↗
                          </button>
                          <a className={css.btn} href={ep.finalVideoUrl} download={`${project.title}-EP${ep.number}.mp4`}>
                            下载 MP4
                          </a>
                        </div>
                      </div>
                    </div>
                  ) : (ep.synopsis || ep.hook || ep.cliffhanger) ? (
                    <div className={css.epMetaBanner}>
                      {ep.synopsis && <div><b>剧情梗概：</b>{ep.synopsis}</div>}
                      <div className={css.epHookRow}>
                        {ep.hook && <span>⚡ <b>开场钩子：</b>{ep.hook}</span>}
                        {ep.cliffhanger && <span>🔥 <b>集尾悬念：</b>{ep.cliffhanger}</span>}
                      </div>
                    </div>
                  ) : null}

                  {/* 横向专业分镜故事板列表 */}
                  <div className={css.subSectionHeader}>
                    <b>分镜故事板（{ep.shots.length} 镜）</b>
                    <div className={css.actions}>
                      <button type="button" className={css.miniBtn} onClick={() => startEditShot(ep.number)}>＋ 加镜</button>
                      <button
                        type="button"
                        className={css.miniBtn}
                        disabled={busy !== null || ep.shots.length === 0}
                        onClick={() => void generateShotMedia(ep.number, 'keyframe')}
                      >
                        🖼 全部关键帧
                      </button>
                      <button
                        type="button"
                        className={css.miniBtn}
                        disabled={busy !== null || !hasDialogues}
                        onClick={() => void generateShotMedia(ep.number, 'audio')}
                      >
                        🎙 全部配音
                      </button>
                    </div>
                  </div>

                  {editingShotKey === `${ep.number}:new` && (
                    <ShotEditorForm
                      draft={shotDraft}
                      casts={casts}
                      busy={busy !== null}
                      title="新增分镜镜头"
                      onChange={setShotDraft}
                      onSave={() => void saveShotEdit(ep.number)}
                      onCancel={() => setEditingShotKey(null)}
                    />
                  )}

                  <div className={css.shotStripList}>
                    {ep.shots.map((sh, idx) => {
                      const isEditing = editingShotKey === `${ep.number}:${sh.id}`
                      if (isEditing) {
                        return (
                          <ShotEditorForm
                            key={sh.id}
                            draft={shotDraft}
                            casts={casts}
                            busy={busy !== null}
                            title={`编辑镜头 #${idx + 1}`}
                            onChange={setShotDraft}
                            onSave={() => void saveShotEdit(ep.number, sh.id)}
                            onCancel={() => setEditingShotKey(null)}
                          />
                        )
                      }
                      return (
                        <div key={sh.id} className={css.shotStrip}>
                          <div className={css.shotStripThumbCol}>
                            <div className={css.shotKfBox}>
                              {sh.keyframeUrl ? (
                                <img src={sh.keyframeUrl} alt={`镜${idx + 1}关键帧`} />
                              ) : (
                                <span className={css.shotKfEmpty}>未出图</span>
                              )}
                              <span className={css.shotThumbBadge}>#{idx + 1}</span>
                            </div>
                            <button
                              type="button"
                              className={css.miniBtn}
                              style={{ width: '100%', justifyContent: 'center' }}
                              disabled={busy !== null}
                              onClick={() => void generateShotMedia(ep.number, 'keyframe', sh.id)}
                            >
                              {sh.keyframeUrl ? '↻ 重绘' : '🖼 关键帧'}
                            </button>
                          </div>

                          <div className={css.shotStripBody}>
                            <div className={css.shotCardTop}>
                              <span className={css.shotIdxBadge}>S{sh.segmentIndex + 1}</span>
                              <span className={css.shotCameraMeta}>{sh.shotSize} · {sh.camera} · {(sh.durationMs / 1000).toFixed(1)}s</span>
                              <span className={css.shotSceneChip}>📍 {sh.scene}</span>
                              <div className={css.shotMiniBtns}>
                                <button type="button" className={css.miniBtn} onClick={() => startEditShot(ep.number, sh)}>编辑</button>
                                <button type="button" className={css.miniBtnDanger} onClick={() => void deleteShot(ep.number, sh.id)}>×</button>
                              </div>
                            </div>

                            <div className={css.shotActionText}>{sh.action}</div>

                            {sh.dialogue ? (
                              <div className={css.shotDialogueBox}>
                                <div className={css.shotDialogueRow}>
                                  <span className={css.shotDialogueText}>
                                    <b>{sh.speaker || '角色'}：</b>「{sh.dialogue}」
                                  </span>
                                  <button
                                    type="button"
                                    className={css.miniBtn}
                                    disabled={busy !== null}
                                    onClick={() => void generateShotMedia(ep.number, 'audio', sh.id)}
                                  >
                                    {sh.audioUrl ? '↻ 重录' : '🎙 生成配音'}
                                  </button>
                                </div>
                                {sh.audioUrl && (
                                  <audio src={sh.audioUrl} controls className={css.shotAudioPlayer} />
                                )}
                              </div>
                            ) : (
                              <div className={css.dim} style={{ fontSize: 11 }}>（无台词 · 纯动作镜头）</div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* 连续视频生成段 */}
                  <div className={css.subSectionHeader}>
                    <b>连续视频段（FFmpeg 尾帧接续）</b>
                    <span className={css.dim} style={{ fontSize: 11 }}>同场景自动抽上段尾帧接续首帧</span>
                  </div>

                  <div className={css.segList}>
                    {ep.segments.map(seg => {
                      const vNode = seg.videoNodeId ? project.nodes.find(n => n.id === seg.videoNodeId) : undefined
                      const videoUrl = vNode?.url
                      const segKey = `${ep.id}:${seg.index}`
                      const isEditingPrompt = editingSegKey === segKey
                      return (
                        <div key={seg.id} className={css.segCard}>
                          <div className={css.sectionHead}>
                            <b style={{ fontSize: 12.5 }}>{seg.title}</b>
                            <span className={seg.status === 'success' ? css.badgeOk : css.badge}>
                              {STATUS_LABEL[seg.status]} · {(seg.durationMs / 1000).toFixed(1)}s
                            </span>
                          </div>

                          {videoUrl ? (
                            <video className={css.segVideo} src={videoUrl} controls muted playsInline />
                          ) : (
                            <div className={css.segPlaceholder}>
                              {seg.firstFrameUrl ? (
                                <img src={seg.firstFrameUrl} alt="承接首帧" />
                              ) : (
                                <span>待生成连续视频段</span>
                              )}
                            </div>
                          )}

                          {seg.index > 0 && (
                            <div className={css.segHandoffRow}>
                              <span className={css.dim} style={{ fontSize: 11 }}>衔接：</span>
                              <select
                                className={css.segHandoffSelect}
                                value={seg.handoff}
                                onChange={e => void saveSegmentPatch(ep, seg.index, { handoff: e.target.value as HandoffMode })}
                              >
                                {Object.entries(HANDOFF_LABEL).map(([k, label]) => (
                                  <option key={k} value={k}>{label}</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {isEditingPrompt ? (
                            <div className={css.field}>
                              <textarea rows={3} value={segPromptDraft} onChange={e => setSegPromptDraft(e.target.value)} />
                              <div className={css.actions}>
                                <button type="button" className={css.btnPrimary} onClick={() => void saveSegmentPatch(ep, seg.index, { prompt: segPromptDraft })}>保存</button>
                                <button type="button" className={css.btn} onClick={() => setEditingSegKey(null)}>取消</button>
                              </div>
                            </div>
                          ) : (
                            <div className={css.segPromptPreview} title={seg.prompt}>
                              {seg.prompt}
                            </div>
                          )}

                          {seg.error && <div className={css.errText}>{seg.error}</div>}

                          <div className={css.actions} style={{ marginTop: 'auto' }}>
                            <button type="button" className={css.miniBtn} disabled={busy !== null} onClick={() => void runEpisode(ep.number, seg.index)}>
                              {videoUrl ? '↻ 重跑此段' : '▶ 生成此段'}
                            </button>
                            <button
                              type="button"
                              className={css.miniBtn}
                              onClick={() => { setEditingSegKey(segKey); setSegPromptDraft(seg.prompt) }}
                            >
                              提示词
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function ShotEditorForm({
  draft,
  casts,
  busy,
  title,
  onChange,
  onSave,
  onCancel,
}: {
  draft: { scene: string; shotSize: string; camera: string; action: string; speaker: string; dialogue: string; durationSec: number }
  casts: DramaCast[]
  busy: boolean
  title: string
  onChange: (next: typeof draft) => void
  onSave: () => void
  onCancel: () => void
}): ReactNode {
  const charNames = casts.filter(c => c.kind === 'character').map(c => c.name)
  return (
    <div className={css.inlineEditorBox}>
      <b>{title}</b>
      <div className={css.gridRow}>
        <label className={css.field}>
          场景地点与光影
          <input value={draft.scene} onChange={e => onChange({ ...draft, scene: e.target.value })} placeholder="同场景名会自动触发尾帧续拍" />
        </label>
        <label className={css.field}>
          景别
          <select value={draft.shotSize} onChange={e => onChange({ ...draft, shotSize: e.target.value })}>
            {SHOT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className={css.field}>
          运镜方式
          <select value={draft.camera} onChange={e => onChange({ ...draft, camera: e.target.value })}>
            {CAMERA_MOVES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className={css.field}>
          单镜时长（秒）
          <input type="number" step="0.5" min={1.5} max={12} value={draft.durationSec} onChange={e => onChange({ ...draft, durationSec: Number(e.target.value) || 3.5 })} />
        </label>
      </div>
      <label className={css.field}>
        画面动作与表演细节（必填）
        <textarea rows={2} value={draft.action} onChange={e => onChange({ ...draft, action: e.target.value })} placeholder="描述角色神态、肢体动作与环境光影变化…" />
      </label>
      <div className={css.gridRow}>
        <label className={css.field}>
          说话角色（可选，匹配角色卡自动选用对应音色）
          <input
            list="mj-cast-speakers"
            value={draft.speaker}
            onChange={e => onChange({ ...draft, speaker: e.target.value })}
            placeholder="如：林默 / 旁白"
          />
          <datalist id="mj-cast-speakers">
            {charNames.map(n => <option key={n} value={n} />)}
            <option value="旁白" />
          </datalist>
        </label>
        <label className={css.field}>
          角色台词 / 画外音（将自动生成配音与 SRT 字幕）
          <input value={draft.dialogue} onChange={e => onChange({ ...draft, dialogue: e.target.value })} placeholder="无台词可留空" />
        </label>
      </div>
      <div className={css.actions}>
        <button type="button" className={css.btnPrimary} disabled={busy} onClick={onSave}>保存分镜</button>
        <button type="button" className={css.btn} onClick={onCancel}>取消</button>
      </div>
    </div>
  )
}

