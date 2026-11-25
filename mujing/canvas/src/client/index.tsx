/**
 * 幕境 AI 影视工作台（基于 DeepSeek Harness 底层引擎的永久独立主壳）：
 *  1. 启动即接管全局应用外壳（html[data-mujing-app="1"] + shell.overlay 常驻左侧主导航栏），
 *     无论是「剧目广场 / 分镜台 / 无限画布 / 成片」还是「技能与插件 / 导演会话 / 系统设置」，
 *     全部统一运行在幕境主壳内，永不退回 DSH 原始双栏布局
 *  2. 内置可折叠右侧「✨ AI 导演副驾」抽屉（直接嵌入 DSH 原生 conversation.content），支持抽屉内切换/新建会话
 *  3. 保留 DSH 原生右侧分屏与 12 类导演工具富媒体卡片能力
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type {
  CanvasNode,
  CanvasProject,
  DramaCast,
  DramaCastKind,
  DramaEpisode,
  DramaShot,
  HandoffMode,
  NodeType,
  ProjectSummary,
  TimelineClip,
} from '../host/types.ts'
import {
  API,
  call,
  dispatchDirectorPrompt,
  emitStudioIntent,
  getAppShellState,
  getDesiredStudioState,
  getStudioBridge,
  openAppHub,
  openMediaConfigModal,
  PANEL_ID,
  patchAppShellState,
  refreshAppProjects,
  registerDirectorSender,
  registerImportTrigger,
  selectAppProject,
  setStudioBridge,
  STARTER_TEMPLATES,
  STUDIO_TAB_ID,
  STUDIO_TAB_KIND,
  subscribeAppShell,
  subscribeStudioIntent,
  summarizeProject,
  triggerAppImport,
  updateMediaStatus,
  uploadLocalFile,
  upsertAppProjectSummary,
  type AppShellSnapshot,
  type AudioEndpointDetail,
  type ImageEndpointDetail,
  type MediaConfigDetails,
  type MediaKind,
  type MediaStatus,
  type ProjectWithHistory,
  type RoutingStrategy,
  type VideoEndpointDetail,
  type WorkspaceTab,
} from './studio-bus.ts'
import {
  MUJING_TOOL_NAMES,
  MujingStarterDock,
  MujingToolCard,
  SessionHeaderStudioButton,
  type RawToolViewProps,
  type StarterDockProps,
} from './tool-views.tsx'
import css from './style.css'

const LF = String.fromCharCode(10)

function useAppShell(): AppShellSnapshot {
  return useSyncExternalStore(subscribeAppShell, getAppShellState, getAppShellState)
}

const TYPE_LABEL: Record<NodeType, string> = { text: '文本', image: '图片', video: '视频', audio: '配音' }
const STATUS_LABEL = { idle: '待生成', loading: '生成中…', success: '已完成', error: '失败' } as const
const CAST_KIND_LABEL: Record<DramaCastKind, string> = { character: '角色', scene: '场景', prop: '道具' }
const HANDOFF_LABEL: Record<HandoffMode, string> = {
  continue: '同场尾帧续拍',
  reverse_angle: '同场正反打换镜',
  scene_cut: '跨场景硬切',
}
const VOICES = ['alloy', 'nova', 'shimmer', 'onyx', 'echo', 'fable'] as const
const SHOT_SIZES = ['远景', '全景', '中景', '近景', '特写'] as const
const CAMERA_MOVES = ['固定', '缓推', '急推', '拉远', '横摇', '跟拍', '环绕'] as const
const STRATEGY_LABEL: Record<RoutingStrategy, string> = {
  round_robin: '动态轮询',
  failover: '主备容灾',
  random: '随机均衡',
}

const STYLE_PRESETS = [
  { label: '赛博雨夜写实', genre: '赛博悬疑短剧', style: '赛博雨夜冷调电影感，霓虹反光，35mm胶片质感，浅景深，人物五官服装稳定统一' },
  { label: '东方古风电影', genre: '古风权谋/虐恋', style: '东方古风电影质感，烛火冷雪对比，丝绸刺绣细节清晰，35mm胶片颗粒，浅景深' },
  { label: '国风3D仙侠漫剧', genre: '玄幻修仙漫剧', style: '高精度国风3D动画电影质感，体积光与流光粒子，精致建模，色彩通透' },
  { label: '都市高奢短剧', genre: '现代都市豪门', style: '现代都市商业大片光影，暖金与冷灰高级配色，85mm人像电影镜头，肤质自然真实' },
] as const

/* ───────────────────────── 品牌标识、常驻全局幕境导航栏与嵌入 AI 导演副驾 ───────────────────────── */

function NavIcon({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4" />
      <polygon points="10.5,9.5 14.5,12 10.5,14.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function MujingBrandMark({ size = 24 }: { size?: number }): ReactNode {
  return (
    <span className={css.brandSlotMark} style={{ width: size, height: size }}>
      <NavIcon size={Math.max(14, Math.round(size * 0.64))} />
    </span>
  )
}

function MujingBrandName(): ReactNode {
  return <span className={css.brandSlotName}>幕境 · Mujing</span>
}

function FixedChatConversationView(props: {
  renderSlot: (name: string, ownerProps: Record<string, unknown>) => ReactNode
}): ReactNode {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

interface SessionListItem {
  readonly id: string
  readonly title?: string
  readonly displayTitle?: string
  readonly updatedAt: number
  readonly running: boolean
  readonly blank: boolean
  readonly origin?: string
  readonly retainedBy?: Readonly<Record<string, number | undefined>>
}

interface SessionListStateLike {
  readonly ids: readonly string[]
  readonly byId: Record<string, SessionListItem | undefined>
}

interface DirectorChatSlotProps {
  sessionId?: string
  useSession: <T>(selector: (s: {
    blank: boolean
    awaitingFirstTurn: boolean
    running: boolean
    promptAttempted: boolean
    openState: string
  } | undefined) => T) => T
  useConversation: <T>(selector: (c: { activeTargets: { size: number } } | undefined) => T) => T
  useSessions: <T>(selector: (state: SessionListStateLike) => T) => T
  inputActions?: {
    setDraft(text: string): void
    submit(): void
  }
  renderFactorySlot: (
    name: string,
    ownerProps: Record<string, unknown>,
    options?: { slots?: Record<string, unknown> },
  ) => ReactNode
  openWorkspace: (workspaceId: string, beforeOpen?: (sessionId: string) => void) => Promise<void>
}

/** 嵌入在幕境右侧抽屉内的 DSH 实时对话引擎（支持在工作台内直接切换/新建导演会话） */
function MujingDirectorChat(props: DirectorChatSlotProps): ReactNode {
  const {
    sessionId,
    useSession,
    useConversation,
    useSessions,
    inputActions,
    renderFactorySlot,
    openWorkspace,
  } = props

  const session = useSession(s => s)
  const conversation = useConversation(c => c)
  const sessionsState = useSessions(state => state)
  const summaryBlank = sessionId === undefined ? undefined : sessionsState.byId[sessionId]?.blank

  const recentSessions = useMemo(() => {
    const items: SessionListItem[] = []
    for (const id of sessionsState.ids) {
      const row = sessionsState.byId[id]
      if (!row || row.origin === 'subagent') continue
      if (row.blank && row.id !== sessionId) continue
      items.push(row)
    }
    return items.slice(0, 20)
  }, [sessionsState, sessionId])

  useEffect(() => {
    if (!inputActions || sessionId === undefined) {
      registerDirectorSender(null)
      return () => registerDirectorSender(null)
    }
    registerDirectorSender(text => {
      try {
        inputActions.setDraft(text)
        setTimeout(() => {
          try { inputActions.submit() } catch {}
        }, 40)
        return true
      } catch {
        return false
      }
    })
    return () => registerDirectorSender(null)
  }, [inputActions, sessionId])

  const active = session !== undefined && conversation !== undefined && (
    conversation.activeTargets.size > 0
    || (!session.blank && !session.awaitingFirstTurn)
    || session.running
  )
  const shellPhase = session === undefined || conversation === undefined
    ? 'blank'
    : active
      ? 'active'
      : session.promptAttempted
        ? 'engaging'
        : 'blank'
  const openState = session?.openState
  const settling = sessionId !== undefined && shellPhase === 'blank' && openState === 'loading' && summaryBlank !== true
  const hero = sessionId === undefined || (shellPhase === 'blank' && (openState === 'open' || summaryBlank === true))
  const phase = settling ? 'settling' : hero ? 'hero' : 'active'

  return (
    <div className={css.directorChatHost} data-phase={phase}>
      {recentSessions.length > 0 && (
        <div className={css.directorSessionBar}>
          <select
            className={css.directorSessionSelect}
            aria-label="切换历史导演会话"
            value={sessionId ?? ''}
            onChange={e => {
              if (e.target.value) getStudioBridge()?.openSessionInStudio(e.target.value)
            }}
          >
            {recentSessions.map(item => (
              <option key={item.id} value={item.id}>
                {item.blank ? '✨ 当前新对话' : (item.title || item.displayTitle || item.id).slice(0, 32)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className={css.directorChatInner}>
        {renderFactorySlot(
          'conversation.content',
          {
            variant: 'embedded',
            phase,
            hero,
            onWorkspaceSelected: openWorkspace,
          },
          {
            slots: { views: FixedChatConversationView },
          },
        )}
      </div>
    </div>
  )
}

interface MujingAppRailProps {
  usePanelInfo: <T>(selector: (info: { activePanelId: string | null }) => T) => T
  useSessions: <T>(selector: (state: SessionListStateLike) => T) => T
}

/** 常驻全局左侧导航壳（挂载于 shell.overlay，跨 幕境工作台 / 技能与插件 / 导演会话 永不卸载） */
function MujingAppRail({ usePanelInfo, useSessions }: MujingAppRailProps): ReactNode {
  const activePanelId = usePanelInfo(info => info.activePanelId)
  const sessionsState = useSessions(state => state)
  const shell = useAppShell()
  const importInputRef = useRef<HTMLInputElement>(null)
  const [railErr, setRailErr] = useState<string | null>(null)

  const panelKind = activePanelId === PANEL_ID
    ? 'studio'
    : activePanelId === 'plugins'
      ? 'plugins'
      : activePanelId === null
        ? 'chat'
        : 'other'

  // 全局同步左侧栏折叠态、当前页面类型与浏览器标题，防止 DSH 覆盖为 "DSH 本地构建"
  useEffect(() => {
    document.documentElement.dataset.mujingRail = shell.railCollapsed ? 'collapsed' : 'expanded'
  }, [shell.railCollapsed])

  useEffect(() => {
    document.documentElement.dataset.mujingPanel = panelKind
    const title = panelKind === 'plugins'
      ? '技能与插件 · 幕境工作台'
      : panelKind === 'chat'
        ? '导演会话 · 幕境工作台'
        : '幕境 · AI 影视工作台'
    document.title = title
    const timer = setTimeout(() => { document.title = title }, 120)
    return () => clearTimeout(timer)
  }, [panelKind])

  useEffect(() => {
    refreshAppProjects().catch(e => setRailErr((e as Error).message))
    registerImportTrigger(() => importInputRef.current?.click())
    return () => registerImportTrigger(null)
  }, [])

  const visibleSessions = useMemo(() => {
    const items: SessionListItem[] = []
    for (const id of sessionsState.ids) {
      const row = sessionsState.byId[id]
      if (!row || row.origin === 'subagent' || row.blank) continue
      items.push(row)
    }
    return items.slice(0, 12)
  }, [sessionsState])

  const activeSessionId = useMemo(() => {
    for (const id of sessionsState.ids) {
      const row = sessionsState.byId[id]
      if (row && (row.retainedBy?.mainView ?? 0) > 0) return row.id
    }
    return undefined
  }, [sessionsState])

  const handleCreateProject = async (payload: {
    title: string
    aspectRatio: '9:16' | '16:9' | '1:1'
    style: string
    genre: string
  }): Promise<void> => {
    try {
      const created = await call<CanvasProject>('/projects', { method: 'POST', body: payload })
      patchAppShellState({ createModalOpen: false, showHub: false })
      await refreshAppProjects()
      await selectAppProject(created.id, { focusStudio: true })
      emitStudioIntent({ tab: 'drama', projectId: created.id, exitHub: true, openFullscreen: true })
    } catch (e) {
      setRailErr((e as Error).message)
    }
  }

  const removeProject = async (id: string, title: string): Promise<void> => {
    if (!window.confirm(`删除剧目「${title}」？此操作不可恢复。`)) return
    try {
      await call(`/projects/${id}`, { method: 'DELETE' })
      if (shell.activeId === id) patchAppShellState({ activeId: null })
      await refreshAppProjects()
    } catch (e) {
      setRailErr((e as Error).message)
    }
  }

  const onImportJson = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const parsed = JSON.parse(await f.text()) as unknown
      const imported = await call<CanvasProject>('/projects/import', { method: 'POST', body: { project: parsed } })
      await refreshAppProjects()
      await selectAppProject(imported.id, { focusStudio: true })
      emitStudioIntent({ projectId: imported.id, exitHub: true, openFullscreen: true })
    } catch (ex) {
      setRailErr(`导入失败：${(ex as Error).message}`)
    }
  }

  const isStudio = panelKind === 'studio'
  const isPlugins = panelKind === 'plugins'
  const isChat = panelKind === 'chat'
  const inHub = isStudio && (shell.showHub || (shell.projectsLoaded && shell.projects.length === 0))

  return (
    <>
      <input ref={importInputRef} type="file" accept=".json,application/json" hidden onChange={e => void onImportJson(e)} />

      <aside className={shell.railCollapsed ? css.appRailCollapsed : css.appRail} aria-label="幕境主导航">
        {shell.railCollapsed ? (
          <>
            <div className={css.railCollapsedTop}>
              <button
                type="button"
                className={css.brandBadgeBtn}
                title="展开幕境左侧栏"
                onClick={() => patchAppShellState({ railCollapsed: false })}
              >
                <NavIcon size={16} />
              </button>
              <button
                type="button"
                className={css.railIconBtn}
                title="展开左侧栏"
                onClick={() => patchAppShellState({ railCollapsed: false })}
              >
                ▷
              </button>
              <button
                type="button"
                className={inHub ? css.railIconBtnActive : css.railIconBtn}
                title="剧目广场 · 模板开拍"
                onClick={() => openAppHub()}
              >
                🏠
              </button>
              <button
                type="button"
                className={css.railIconBtn}
                title="新建剧目工程"
                onClick={() => patchAppShellState({ createModalOpen: true })}
              >
                ＋
              </button>
            </div>

            <div className={css.railCollapsedProjects}>
              {shell.projects.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className={isStudio && !inHub && p.id === shell.activeId ? css.railIconProjActive : css.railIconProj}
                  title={p.title}
                  onClick={() => void selectAppProject(p.id, { focusStudio: true })}
                >
                  {p.coverUrl ? (
                    <img src={p.coverUrl} alt="" className={css.railIconThumb} />
                  ) : (
                    <span>🎬</span>
                  )}
                </button>
              ))}
            </div>

            <div className={css.railCollapsedFoot}>
              <button
                type="button"
                className={isChat ? css.railIconBtnActive : css.railIconBtn}
                title="导演会话记录"
                onClick={() => getStudioBridge()?.openClassicChat()}
              >
                💬
              </button>
              <button
                type="button"
                className={isPlugins ? css.railIconBtnActive : css.railIconBtn}
                title="技能与插件中心"
                onClick={() => getStudioBridge()?.openPlugins()}
              >
                🧩
              </button>
              <button
                type="button"
                className={
                  shell.media && (!shell.media.image.ready || !shell.media.video.ready || !shell.media.audio.ready)
                    ? css.railIconBtnErr
                    : css.railIconBtn
                }
                title={
                  shell.media
                    ? `多模态模型配置\n生图：${shell.media.image.ready ? shell.media.image.model : '未配置'}\n视频：${shell.media.video.ready ? shell.media.video.model : '未配置'}\n配音：${shell.media.audio.ready ? shell.media.audio.model : '未配置'}`
                    : '配置生图 / 视频 / 配音模型'
                }
                onClick={() => openMediaConfigModal(
                  shell.media && !shell.media.image.ready ? 'image'
                    : shell.media && !shell.media.video.ready ? 'video'
                    : shell.media && !shell.media.audio.ready ? 'audio'
                    : 'image',
                )}
              >
                🎛
              </button>
              <button
                type="button"
                className={css.railIconBtn}
                title="系统设置"
                onClick={() => getStudioBridge()?.openSettings()}
              >
                ⚙
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={css.projectsHead}>
              <div className={css.brandWrap}>
                <span className={css.brandBadge}><NavIcon size={15} /></span>
                <div className={css.brandTextCol}>
                  <span className={css.brand}>幕境工作台</span>
                  <span className={css.brandSub}>AI 影视与漫剧制片</span>
                </div>
              </div>
              <div className={css.headActions}>
                <button
                  type="button"
                  className={css.btnPrimary}
                  onClick={() => patchAppShellState({ createModalOpen: true })}
                  title="新建剧目或无限画布工程"
                >
                  ＋ 新建
                </button>
                <button
                  type="button"
                  className={css.iconBtn}
                  title="收起左侧导航栏"
                  onClick={() => patchAppShellState({ railCollapsed: true })}
                >
                  ◁
                </button>
              </div>
            </div>

            {railErr && (
              <div className={css.railErrBar} onClick={() => setRailErr(null)}>{railErr} ×</div>
            )}

            <div className={css.railNavGroup}>
              <button
                type="button"
                className={inHub ? css.railNavBtnActive : css.railNavBtn}
                onClick={() => openAppHub()}
              >
                <span>🏠 剧目广场 · 模板开拍</span>
              </button>
              <button
                type="button"
                className={css.railNavBtn}
                onClick={() => importInputRef.current?.click()}
              >
                <span>📥 导入 .mujing.json 工程</span>
              </button>
            </div>

            <div className={css.railSectionLabel}>
              <span>我的剧目工程</span>
              <span>{shell.projects.length}</span>
            </div>

            <ul className={css.projectList}>
              {shell.projects.map(p => (
                <li key={p.id} className={isStudio && !inHub && p.id === shell.activeId ? css.projectActive : css.projectItem}>
                  <button type="button" className={css.projectMain} onClick={() => void selectAppProject(p.id, { focusStudio: true })}>
                    <div className={css.projectRowTop}>
                      {p.coverUrl ? (
                        <img src={p.coverUrl} alt="" className={css.projectThumb} />
                      ) : (
                        <span className={css.projectThumbEmpty}>🎬</span>
                      )}
                      <div className={css.projectTextCol}>
                        <span className={css.projectTitle}>{p.title}</span>
                        <span className={css.projectMeta}>
                          {p.aspectRatio && <span className={css.ratioTag}>{p.aspectRatio}</span>}
                          {Boolean(p.castCount) && <span>{p.castCount}资产</span>}
                          {Boolean(p.episodeCount) && <span>· {p.episodeCount}集</span>}
                          <span>· {p.nodeCount}节点</span>
                        </span>
                      </div>
                    </div>
                  </button>
                  <button type="button" className={css.iconBtn} title="删除剧目" aria-label="删除剧目" onClick={() => void removeProject(p.id, p.title)}>×</button>
                </li>
              ))}
              {shell.projectsLoaded && shell.projects.length === 0 && (
                <li className={css.empty}>暂无工程，可在右侧「剧目广场」输入创意或一键选用模板开拍。</li>
              )}
            </ul>

            {/* 切到「导演会话」视图时，在幕境侧栏内原生提供历史会话切换与新建，彻底摆脱 DSH 原侧栏 */}
            {isChat && (
              <div className={css.railSessionsBox}>
                <div className={css.railSessionsHead}>
                  <span>导演历史会话</span>
                  <button
                    type="button"
                    className={css.linkBtn}
                    onClick={() => getStudioBridge()?.newChatSession()}
                  >
                    ＋ 新会话
                  </button>
                </div>
                <div className={css.railSessionsList}>
                  {visibleSessions.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      className={s.id === activeSessionId ? css.railSessionBtnActive : css.railSessionBtn}
                      title={s.title || s.displayTitle || s.id}
                      onClick={() => getStudioBridge()?.openSessionInChat(s.id)}
                    >
                      <span className={css.railSessionTitle}>{s.title || s.displayTitle || s.id}</span>
                    </button>
                  ))}
                  {visibleSessions.length === 0 && (
                    <div className={css.railSessionEmpty}>暂无历史对话</div>
                  )}
                </div>
              </div>
            )}

            {/* 底部常驻系统区：可点击的多模态模型状态 + 统一壳内的 会话 / 插件 / 设置 */}
            <div className={css.railFooter}>
              {shell.media && (
                <div className={css.engineBar} role="group" aria-label="多模态模型配置入口">
                  <button
                    type="button"
                    data-media-kind="image"
                    data-media-ready={shell.media.image.ready ? '1' : '0'}
                    className={shell.media.image.ready ? css.engineBtnOk : css.engineBtnErr}
                    title={
                      shell.media.image.ready
                        ? `生图模型已就绪：${shell.media.image.model}（${shell.media.image.readyCount}/${shell.media.image.totalCount} 个接口 · ${STRATEGY_LABEL[shell.media.image.strategy]}）\n点击配置多接口与轮询策略`
                        : '生图模型未配置\n点击配置接口地址与 API Key'
                    }
                    onClick={() => openMediaConfigModal('image')}
                  >
                    <span>● 生图</span>
                    {shell.media.image.readyCount > 1 && <span className={css.engineCount}>{shell.media.image.readyCount}</span>}
                  </button>
                  <button
                    type="button"
                    data-media-kind="video"
                    data-media-ready={shell.media.video.ready ? '1' : '0'}
                    className={shell.media.video.ready ? css.engineBtnOk : css.engineBtnErr}
                    title={
                      shell.media.video.ready
                        ? `视频模型已就绪：${shell.media.video.model}（${shell.media.video.readyCount}/${shell.media.video.totalCount} 个接口 · ${STRATEGY_LABEL[shell.media.video.strategy]}）\n点击配置多接口与轮询策略`
                        : '视频模型未配置\n点击配置接口地址与 API Key'
                    }
                    onClick={() => openMediaConfigModal('video')}
                  >
                    <span>● 视频</span>
                    {shell.media.video.readyCount > 1 && <span className={css.engineCount}>{shell.media.video.readyCount}</span>}
                  </button>
                  <button
                    type="button"
                    data-media-kind="audio"
                    data-media-ready={shell.media.audio.ready ? '1' : '0'}
                    className={shell.media.audio.ready ? css.engineBtnOk : css.engineBtnErr}
                    title={
                      shell.media.audio.ready
                        ? `配音模型已就绪：${shell.media.audio.model}（${shell.media.audio.readyCount}/${shell.media.audio.totalCount} 个接口 · ${STRATEGY_LABEL[shell.media.audio.strategy]}）\n点击配置多接口与轮询策略`
                        : '配音模型未配置\n点击配置接口地址与 API Key'
                    }
                    onClick={() => openMediaConfigModal('audio')}
                  >
                    <span>● 配音</span>
                    {shell.media.audio.readyCount > 1 && <span className={css.engineCount}>{shell.media.audio.readyCount}</span>}
                  </button>
                </div>
              )}
              <div className={css.runtimeBar}>
                <button
                  type="button"
                  className={isChat ? css.runtimeBtnActive : css.runtimeBtn}
                  title="查看完整 AI 导演会话与历史记录"
                  onClick={() => getStudioBridge()?.openClassicChat()}
                >
                  💬 会话
                </button>
                <button
                  type="button"
                  className={isPlugins ? css.runtimeBtnActive : css.runtimeBtn}
                  title="管理影视技能与底层插件"
                  onClick={() => getStudioBridge()?.openPlugins()}
                >
                  🧩 插件
                </button>
                <button
                  type="button"
                  className={css.runtimeBtn}
                  title="配置模型、API Key 与偏好设置"
                  onClick={() => getStudioBridge()?.openSettings()}
                >
                  ⚙ 设置
                </button>
              </div>
            </div>
          </>
        )}
      </aside>

      {shell.createModalOpen && (
        <div className={css.railModalRoot}>
          <CreateProjectModal
            onClose={() => patchAppShellState({ createModalOpen: false })}
            onImport={() => { patchAppShellState({ createModalOpen: false }); importInputRef.current?.click() }}
            onSubmit={payload => void handleCreateProject(payload)}
          />
        </div>
      )}

      {shell.mediaConfigTab !== null && (
        <div className={css.railModalRoot}>
          <MediaConfigModal
            initialTab={shell.mediaConfigTab}
            onClose={() => patchAppShellState({ mediaConfigTab: null })}
          />
        </div>
      )}
    </>
  )
}

interface FullscreenStudioPageProps {
  renderSlot: (name: string, ownerProps: Record<string, unknown>) => ReactNode
}

function FullscreenStudioPage({ renderSlot }: FullscreenStudioPageProps): ReactNode {
  return (
    <StudioShell
      mode="fullscreen"
      renderDirectorChat={() => renderSlot('mujing.director.chat', {})}
    />
  )
}

function RightSidebarStudioPane(): ReactNode {
  return <StudioShell mode="split" />
}

/* ───────────────────────── 核心工作台主舞台（与常驻 MujingAppRail 共享全局剧目状态） ───────────────────────── */

function StudioShell({ mode, renderDirectorChat }: {
  mode: 'fullscreen' | 'split'
  renderDirectorChat?: () => ReactNode
}): ReactNode {
  const initialDesired = getDesiredStudioState()
  const isSplit = mode === 'split'
  const shell = useAppShell()
  const { projects, projectsLoaded, activeId, showHub, media } = shell

  const [project, setProject] = useState<ProjectWithHistory | null>(null)
  const [tab, setTabState] = useState<WorkspaceTab>(initialDesired.tab)
  const [directorOpen, setDirectorOpen] = useState(false)
  const [directorEverOpened, setDirectorEverOpened] = useState(false)
  const [renamingTitle, setRenamingTitle] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const openDirectorDrawer = useCallback((): void => {
    setDirectorEverOpened(true)
    setDirectorOpen(true)
  }, [])

  const toggleDirectorDrawer = useCallback((): void => {
    setDirectorEverOpened(true)
    setDirectorOpen(v => !v)
  }, [])

  const setTab = useCallback((next: WorkspaceTab): void => {
    setTabState(next)
    patchAppShellState({ showHub: false })
    emitStudioIntent({ tab: next })
  }, [])

  const notify = useCallback((msg: string): void => {
    setToast(msg)
    setTimeout(() => setToast(prev => (prev === msg ? null : prev)), 3800)
  }, [])

  useEffect(() => {
    if (!projectsLoaded) {
      refreshAppProjects().catch(e => setErr((e as Error).message))
    }
  }, [projectsLoaded])

  const selectProject = useCallback(async (id: string): Promise<void> => {
    setRenamingTitle(null)
    await selectAppProject(id, { focusStudio: !isSplit })
  }, [isSplit])

  // 监听来自对话工具卡片、剧目广场或顶栏的联动聚焦意图
  useEffect(() => {
    return subscribeStudioIntent(intent => {
      if (intent.tab) setTabState(intent.tab)
      if (intent.openDirector && !isSplit) {
        setDirectorEverOpened(true)
        setDirectorOpen(true)
      }
      if (intent.exitHub) patchAppShellState({ showHub: false })
      if (intent.reloadProjects) {
        void refreshAppProjects().then(() => {
          if (intent.projectId) void selectProject(intent.projectId)
        }).catch(() => {})
      } else if (intent.projectId) {
        void selectProject(intent.projectId)
      }
    })
  }, [isSplit, selectProject])

  // 当没有选中项目或 AI 导演抽屉正在广场内运行时，轻量检测新创建的剧目并自动聚焦
  useEffect(() => {
    if (activeId !== null && !(directorOpen && showHub)) return
    const timer = setInterval(() => {
      void refreshAppProjects({ autoSelectNew: directorOpen }).catch(() => {})
    }, 2500)
    return () => clearInterval(timer)
  }, [activeId, directorOpen, showHub])

  // SSE 订阅当前项目实时状态（含画布、短剧流水线、分镜配音、时间线与撤销栈）
  useEffect(() => {
    if (!activeId) { setProject(null); return }
    let closed = false
    const es = new EventSource(`${API}/projects/${activeId}/events`, { withCredentials: true })
    es.addEventListener('snapshot', e => {
      if (closed) return
      const snap = JSON.parse((e as MessageEvent<string>).data) as ProjectWithHistory
      setProject(snap)
      upsertAppProjectSummary(summarizeProject(snap))
    })
    es.addEventListener('deleted', () => {
      if (!closed) { setProject(null); void refreshAppProjects() }
    })
    return () => { closed = true; es.close() }
  }, [activeId])

  const undo = useCallback(async (): Promise<void> => {
    if (!project) return
    try {
      const r = await call<{ changed: boolean; project: ProjectWithHistory; history: { canUndo: boolean; canRedo: boolean } }>(`/projects/${project.id}/undo`, { method: 'POST' })
      if (r.changed) setProject({ ...r.project, history: r.history })
    } catch (e) { setErr((e as Error).message) }
  }, [project])

  const redo = useCallback(async (): Promise<void> => {
    if (!project) return
    try {
      const r = await call<{ changed: boolean; project: ProjectWithHistory; history: { canUndo: boolean; canRedo: boolean } }>(`/projects/${project.id}/redo`, { method: 'POST' })
      if (r.changed) setProject({ ...r.project, history: r.history })
    } catch (e) { setErr((e as Error).message) }
  }, [project])

  // 键盘快捷键 ⌘Z / ⇧⌘Z 撤销重做（避开输入框与富文本编辑器）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      e.preventDefault()
      if (e.shiftKey) void redo()
      else void undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  const saveRenamedTitle = async (): Promise<void> => {
    if (!project || renamingTitle === null) return
    const next = renamingTitle.trim()
    setRenamingTitle(null)
    if (!next || next === project.title) return
    try {
      await call(`/projects/${project.id}`, { method: 'PATCH', body: { title: next } })
      await refreshAppProjects()
      notify('已更新剧目名称')
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const removeProject = async (id: string, title: string): Promise<void> => {
    if (!window.confirm(`删除剧目「${title}」？此操作不可恢复。`)) return
    try {
      await call(`/projects/${id}`, { method: 'DELETE' })
      if (activeId === id) patchAppShellState({ activeId: null })
      await refreshAppProjects()
    } catch (e) { setErr((e as Error).message) }
  }

  const launchDirectorWithPrompt = useCallback((prompt: string, targetTab: WorkspaceTab): void => {
    openDirectorDrawer()
    dispatchDirectorPrompt(prompt, { tab: targetTab })
  }, [openDirectorDrawer])

  const inHubView = !isSplit && (showHub || (projectsLoaded && projects.length === 0))

  return (
    <div className={`${css.page} ${isSplit ? css.pageSplit : ''}`} data-studio-mode={mode}>
      <section className={css.stage}>
        {err !== null && <div className={css.errorBar} onClick={() => setErr(null)}>{err}（点击关闭）</div>}
        {toast !== null && <div className={css.toastBar} onClick={() => setToast(null)}>{toast}</div>}

        {/* 统一顶部工具栏：全屏以当前剧目与「✨ AI 导演」为主角，分屏采用规整双层栏 */}
        <header className={isSplit ? css.topBarSplit : css.topBar}>
          <div className={css.topBarRow}>
            {isSplit ? (
              <div className={css.splitProjectBar}>
                <select
                  className={css.projectSelect}
                  aria-label="选择剧目工程"
                  value={activeId ?? ''}
                  onChange={e => { if (e.target.value) void selectProject(e.target.value) }}
                >
                  {projects.length === 0 && <option value="">暂无剧目工程</option>}
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.title}{p.aspectRatio ? ` (${p.aspectRatio})` : ''}
                    </option>
                  ))}
                </select>
                <button type="button" className={css.btnPrimary} onClick={() => patchAppShellState({ createModalOpen: true })} title="新建短剧/画布工程">＋ 新建</button>
              </div>
            ) : inHubView ? (
              <div className={css.boardTitle}>
                <span>🏠 剧目广场</span>
                <span className={css.ratioTag}>AI 导演驱动</span>
              </div>
            ) : project ? (
              renamingTitle !== null ? (
                <input
                  className={css.renameInput}
                  autoFocus
                  value={renamingTitle}
                  onChange={e => setRenamingTitle(e.target.value)}
                  onBlur={() => void saveRenamedTitle()}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void saveRenamedTitle()
                    if (e.key === 'Escape') setRenamingTitle(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={css.boardTitleBtn}
                  title="点击重命名剧目"
                  onClick={() => setRenamingTitle(project.title)}
                >
                  <span>{project.title}</span>
                  {project.drama?.aspectRatio && <span className={css.ratioTag}>{project.drama.aspectRatio}</span>}
                </button>
              )
            ) : (
              <span className={css.boardTitle}>幕境工作台</span>
            )}

            {!isSplit && !inHubView && project && (
              <div className={css.modeTabs}>
                <button type="button" className={tab === 'drama' ? css.tabActive : css.tabBtn} onClick={() => setTab('drama')}>
                  🎬 短剧分镜台 ({project.drama?.episodes.length ?? 0}集)
                </button>
                <button type="button" className={tab === 'canvas' ? css.tabActive : css.tabBtn} onClick={() => setTab('canvas')}>
                  ✦ 无限画布 ({project.nodes.length})
                </button>
                <button type="button" className={tab === 'timeline' ? css.tabActive : css.tabBtn} onClick={() => setTab('timeline')}>
                  🎞 成片与剪映 ({project.timeline?.clips.length ?? 0})
                </button>
              </div>
            )}

            <div className={css.topRight}>
              {!inHubView && project && (
                <>
                  <button type="button" className={css.btnIcon} disabled={!project.history?.canUndo} onClick={() => void undo()} title="撤销 (⌘Z)">↶</button>
                  <button type="button" className={css.btnIcon} disabled={!project.history?.canRedo} onClick={() => void redo()} title="重做 (⇧⌘Z)">↷</button>
                  <a className={css.btn} href={`${API}/projects/${project.id}/export`} download title="导出 .mujing.json 工程包">导出</a>
                </>
              )}
              {isSplit ? (
                <button
                  type="button"
                  className={css.btnAccentGhost}
                  title="返回全屏幕境工作台"
                  onClick={() => getStudioBridge()?.openFullscreen()}
                >
                  ⛶ 独立工作台
                </button>
              ) : (
                <button
                  type="button"
                  className={directorOpen ? css.btnDirectorActive : css.btnDirector}
                  title={directorOpen ? '收起右侧 AI 导演副驾抽屉' : '展开右侧 AI 导演副驾，用自然语言编排短剧、画布与成片'}
                  onClick={toggleDirectorDrawer}
                >
                  <span>✨ AI 导演</span>
                  <span className={css.directorBadge}>{directorOpen ? '收起' : '副驾'}</span>
                </button>
              )}
            </div>
          </div>

          {isSplit && project && (
            <div className={css.splitNavBar}>
              <button type="button" className={tab === 'drama' ? css.splitTabActive : css.splitTabBtn} onClick={() => setTab('drama')}>
                <span>🎬 短剧分镜台</span>
                <span className={css.tabCount}>{project.drama?.episodes.length ?? 0}集</span>
              </button>
              <button type="button" className={tab === 'canvas' ? css.splitTabActive : css.splitTabBtn} onClick={() => setTab('canvas')}>
                <span>✦ 无限画布</span>
                <span className={css.tabCount}>{project.nodes.length}</span>
              </button>
              <button type="button" className={tab === 'timeline' ? css.splitTabActive : css.splitTabBtn} onClick={() => setTab('timeline')}>
                <span>🎞 成片与剪映</span>
                <span className={css.tabCount}>{project.timeline?.clips.length ?? 0}</span>
              </button>
            </div>
          )}
        </header>

        {/* 主体区域：左侧/中央为幕境工作台（广场 / 分镜台 / 画布 / 成片），右侧为可折叠 AI 导演副驾抽屉 */}
        <div className={css.studioBody}>
          <div className={css.studioMain}>
            {inHubView ? (
              <ProjectHub
                projects={projects}
                media={media}
                onSelectProject={id => void selectProject(id)}
                onDeleteProject={(id, title) => void removeProject(id, title)}
                onCreateProject={() => patchAppShellState({ createModalOpen: true })}
                onImportJson={() => triggerAppImport()}
                onRunPrompt={launchDirectorWithPrompt}
              />
            ) : activeId === null || project === null ? (
              <div className={css.emptyStageCard}>
                <div className={css.emptyStageIcon}><NavIcon size={32} /></div>
                <h3>欢迎来到幕境 AI 影视工作台</h3>
                <p>
                  对标专业漫剧与短剧制片流程：支持 <b>角色/场景三视图资产锁定</b>、<b>单镜故事板关键帧与角色 TTS 配音</b>、<b>FFmpeg 尾帧接首帧无缝续拍</b>，以及 <b>剪映专业版草稿一键交付</b>。
                </p>
                <div className={css.actions}>
                  <button type="button" className={css.btnPrimary} onClick={() => patchAppShellState({ createModalOpen: true })}>＋ 新建影视工程</button>
                  <button type="button" className={css.btn} onClick={() => triggerAppImport()}>导入本地工程 JSON</button>
                </div>
              </div>
            ) : (
              <>
                {tab === 'drama' && (
                  <DramaView project={project} onError={setErr} onNotify={notify} onSwitchTab={setTab} />
                )}
                {tab === 'canvas' && (
                  <BoardView project={project} onError={setErr} onNotify={notify} />
                )}
                {tab === 'timeline' && (
                  <TimelineView project={project} onError={setErr} onNotify={notify} />
                )}
              </>
            )}
          </div>

          {!isSplit && renderDirectorChat && directorEverOpened && (
            <aside className={directorOpen ? css.directorDrawer : css.directorDrawerClosed} aria-label="AI 导演副驾">
              <div className={css.directorHeader}>
                <div className={css.directorTitle}>
                  <span>✨ AI 导演副驾</span>
                  <span className={css.directorSub}>Agent 编排</span>
                </div>
                <div className={css.headActions}>
                  <button
                    type="button"
                    className={css.btn}
                    title="开启一轮新的导演对话（保持在幕境工作台内）"
                    onClick={() => getStudioBridge()?.newDirectorSession()}
                  >
                    ＋ 新对话
                  </button>
                  <button
                    type="button"
                    className={css.iconBtn}
                    title="收起 AI 导演副驾"
                    onClick={() => setDirectorOpen(false)}
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className={css.directorBody}>
                {renderDirectorChat()}
              </div>
            </aside>
          )}
        </div>
      </section>
    </div>
  )
}

/* ───────────────────────── 剧目广场（幕境独立首页 / 一键模板开拍） ───────────────────────── */

function ProjectHub({
  projects,
  media,
  onSelectProject,
  onDeleteProject,
  onCreateProject,
  onImportJson,
  onRunPrompt,
}: {
  projects: ProjectSummary[]
  media: MediaStatus | null
  onSelectProject: (id: string) => void
  onDeleteProject: (id: string, title: string) => void
  onCreateProject: () => void
  onImportJson: () => void
  onRunPrompt: (prompt: string, tab: WorkspaceTab) => void
}): ReactNode {
  const [prompt, setPrompt] = useState('')

  const submitPrompt = (): void => {
    const clean = prompt.trim()
    if (!clean) return
    setPrompt('')
    onRunPrompt(clean, 'drama')
  }

  return (
    <div className={css.hubWrap}>
      <section className={css.hubHero}>
        <div className={css.hubBadge}>🎬 幕境 AI 影视工作台 · DeepSeek Harness 驱动</div>
        <h2 className={css.hubHeading}>一句话或一段小说，全自动拍出多镜头有声短剧</h2>
        <p className={css.hubSub}>
          从剧本拆集、角色/场景三视图资产锁定、故事板关键帧与角色配音，到 FFmpeg 尾帧续拍成片与剪映草稿一键交付。
        </p>

        <div className={css.hubComposer}>
          <textarea
            className={css.hubPromptInput}
            rows={3}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                submitPrompt()
              }
            }}
            placeholder="输入你的短剧灵感、小说段落或分镜需求，例如：拍一部 9:16 赛博雨夜悬疑短剧，侦探林默与线人苏晚在蓝调酒吧接头遭遇红外狙击……"
          />
          <div className={css.hubComposerBar}>
            {media ? (
              <div className={css.hubEngineRow}>
                <span className={css.hubEngineLabel}>模型引擎：</span>
                <button
                  type="button"
                  className={media.image.ready ? css.hubEngineChipOk : css.hubEngineChipErr}
                  title="点击配置生图多接口与轮询策略"
                  onClick={() => openMediaConfigModal('image')}
                >
                  ● 生图 · {media.image.ready ? `${media.image.model}${media.image.readyCount > 1 ? ` (${media.image.readyCount}接口·${STRATEGY_LABEL[media.image.strategy]})` : ''}` : '未配置'}
                </button>
                <button
                  type="button"
                  className={media.video.ready ? css.hubEngineChipOk : css.hubEngineChipErr}
                  title="点击配置视频多接口与轮询策略"
                  onClick={() => openMediaConfigModal('video')}
                >
                  ● 视频 · {media.video.ready ? `${media.video.model}${media.video.readyCount > 1 ? ` (${media.video.readyCount}接口·${STRATEGY_LABEL[media.video.strategy]})` : ''}` : '未配置'}
                </button>
                <button
                  type="button"
                  className={media.audio.ready ? css.hubEngineChipOk : css.hubEngineChipErr}
                  title="点击配置配音多接口与轮询策略"
                  onClick={() => openMediaConfigModal('audio')}
                >
                  ● 配音 · {media.audio.ready ? `${media.audio.model}${media.audio.readyCount > 1 ? ` (${media.audio.readyCount}接口·${STRATEGY_LABEL[media.audio.strategy]})` : ''}` : '未配置'}
                </button>
              </div>
            ) : (
              <span className={css.hubComposerHint}>按 ⌘/Ctrl + Enter 直接召唤 AI 导演副驾开拍</span>
            )}
            <div className={css.actions}>
              <button type="button" className={css.btn} onClick={onCreateProject}>＋ 手动建工程</button>
              <button type="button" className={css.btnPrimary} disabled={!prompt.trim()} onClick={submitPrompt}>
                ✨ 让 AI 导演开拍
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className={css.hubSection}>
        <div className={css.hubSectionHead}>
          <div>
            <h3>一键片单样板</h3>
            <span>点击任意样板将自动唤起右侧 AI 导演副驾，并实时生成角色资产、分镜故事板与成片</span>
          </div>
        </div>
        <div className={css.hubGrid3}>
          {STARTER_TEMPLATES.map(tpl => (
            <button
              key={tpl.id}
              type="button"
              className={css.hubTemplateCard}
              onClick={() => onRunPrompt(tpl.prompt, tpl.tab)}
            >
              <div className={css.hubTemplateCover} style={{ background: tpl.accent }}>
                <span className={css.hubTemplateBadge}>{tpl.badge}</span>
                <span className={css.hubTemplateRatio}>{tpl.ratio}</span>
              </div>
              <div className={css.hubTemplateBody}>
                <div className={css.hubTemplateTitle}>{tpl.title}</div>
                <div className={css.hubTemplateDesc}>{tpl.desc}</div>
                <div className={css.hubTemplateCta}>✨ 立即由 AI 导演开拍 →</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className={css.hubSection}>
        <div className={css.hubSectionHead}>
          <div>
            <h3>我的剧目工程 ({projects.length})</h3>
            <span>点击进入分镜台、无限画布或成片时间线继续制作</span>
          </div>
          <div className={css.actions}>
            <button type="button" className={css.btn} onClick={onImportJson}>📥 导入工程 JSON</button>
            <button type="button" className={css.btnPrimary} onClick={onCreateProject}>＋ 新建空白剧目</button>
          </div>
        </div>
        <div className={css.hubProjectGrid}>
          {projects.map(p => (
            <div key={p.id} className={css.hubProjectCard} onClick={() => onSelectProject(p.id)}>
              <div className={css.hubProjectCover}>
                {p.coverUrl ? (
                  <img src={p.coverUrl} alt={p.title} className={css.hubProjectCoverImg} />
                ) : (
                  <div className={css.hubProjectCoverEmpty}>🎬</div>
                )}
                {p.aspectRatio && <span className={css.hubProjectRatio}>{p.aspectRatio}</span>}
                <button
                  type="button"
                  className={css.hubProjectDel}
                  title="删除剧目"
                  onClick={e => { e.stopPropagation(); onDeleteProject(p.id, p.title) }}
                >
                  ×
                </button>
              </div>
              <div className={css.hubProjectInfo}>
                <div className={css.hubProjectTitle}>{p.title}</div>
                <div className={css.hubProjectMeta}>
                  <span>{p.castCount ?? 0} 资产</span>
                  <span>· {p.episodeCount ?? 0} 集</span>
                  <span>· {p.nodeCount} 节点</span>
                  <span>· {p.clipCount ?? 0} 片段</span>
                </div>
              </div>
            </div>
          ))}
          <button type="button" className={css.hubNewCard} onClick={onCreateProject}>
            <span className={css.hubNewPlus}>＋</span>
            <span>新建短剧 / 漫剧工程</span>
          </button>
        </div>
      </section>
    </div>
  )
}

/* ───────────────────────── 新建影视剧目模态窗 ───────────────────────── */

function CreateProjectModal({ onClose, onImport, onSubmit }: {
  onClose: () => void
  onImport: () => void
  onSubmit: (payload: { title: string; aspectRatio: '9:16' | '16:9' | '1:1'; style: string; genre: string }) => void
}): ReactNode {
  const [title, setTitle] = useState('未命名短剧工程')
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16')
  const [genre, setGenre] = useState<string>(STYLE_PRESETS[0].genre)
  const [style, setStyle] = useState<string>(STYLE_PRESETS[0].style)

  return (
    <div className={css.modalBackdrop} onClick={onClose}>
      <div className={css.modalCard} onClick={e => e.stopPropagation()}>
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>新建幕境影视 / 短剧工程</span>
          <button type="button" className={css.iconBtn} onClick={onClose}>×</button>
        </div>

        <label className={css.field}>
          剧目名称
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="例如：《雨夜芯片》第一季" />
        </label>

        <div className={css.field}>
          <span>目标画幅比例</span>
          <div className={css.pillRow}>
            {([
              ['9:16', '9:16 竖屏短剧（抖音/红果）'],
              ['16:9', '16:9 横屏漫剧/电影'],
              ['1:1', '1:1 方形社媒画幅'],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={aspectRatio === val ? css.pillActive : css.pillBtn}
                onClick={() => setAspectRatio(val)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={css.field}>
          <span>视觉风格预设（一键填充 Style Bible）</span>
          <div className={css.pillRow}>
            {STYLE_PRESETS.map(preset => (
              <button
                key={preset.label}
                type="button"
                className={style === preset.style ? css.pillActive : css.pillBtn}
                onClick={() => { setGenre(preset.genre); setStyle(preset.style) }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className={css.gridRow}>
          <label className={css.field}>
            题材类型
            <input value={genre} onChange={e => setGenre(e.target.value)} placeholder="如：悬疑短剧 / 古风仙侠" />
          </label>
        </div>

        <label className={css.field}>
          全剧美术与摄影基准（Style Bible）
          <textarea rows={2} value={style} onChange={e => setStyle(e.target.value)} />
        </label>

        <div className={css.modalFooter}>
          <button type="button" className={css.btn} style={{ marginRight: 'auto' }} onClick={onImport}>导入 .mujing.json</button>
          <button type="button" className={css.btn} onClick={onClose}>取消</button>
          <button
            type="button"
            className={css.btnPrimary}
            disabled={!title.trim()}
            onClick={() => onSubmit({ title: title.trim(), aspectRatio, style: style.trim(), genre: genre.trim() })}
          >
            创建并进入工作台
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── 多模态模型配置模态窗（生图 / 视频 / 配音） ───────────────────────── */

interface EndpointDraftBase {
  id: string
  name: string
  enabled: boolean
  weight: number
  baseURL: string
  apiKey: string
  clearApiKey: boolean
  cloneKeyFromId?: string
  apiKeyEnv: string
  model: string
}

type ImageEndpointDraft = EndpointDraftBase & { size: string; flavor: 'openai' | 'ark' }
type VideoEndpointDraft = EndpointDraftBase & { flavor: 'openai' | 'ark'; duration: number; ratio: string }
type AudioEndpointDraft = EndpointDraftBase & { voice: string; format: 'mp3' | 'wav' }

interface PoolDraft<T extends EndpointDraftBase> {
  strategy: RoutingStrategy
  autoFailover: boolean
  endpoints: T[]
}

interface MediaFormDraft {
  image: PoolDraft<ImageEndpointDraft>
  video: PoolDraft<VideoEndpointDraft>
  audio: PoolDraft<AudioEndpointDraft>
}

function makeLocalEndpointId(kind: MediaKind): string {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function toDraft(cfg: MediaConfigDetails): MediaFormDraft {
  return {
    image: {
      strategy: cfg.image.strategy,
      autoFailover: cfg.image.autoFailover,
      endpoints: cfg.image.endpoints.map(ep => ({
        id: ep.id,
        name: ep.name,
        enabled: ep.enabled,
        weight: ep.weight,
        baseURL: ep.baseURL,
        apiKey: '',
        clearApiKey: false,
        apiKeyEnv: ep.apiKeyEnv,
        model: ep.model,
        size: ep.size,
        flavor: ep.flavor,
      })),
    },
    video: {
      strategy: cfg.video.strategy,
      autoFailover: cfg.video.autoFailover,
      endpoints: cfg.video.endpoints.map(ep => ({
        id: ep.id,
        name: ep.name,
        enabled: ep.enabled,
        weight: ep.weight,
        baseURL: ep.baseURL,
        apiKey: '',
        clearApiKey: false,
        apiKeyEnv: ep.apiKeyEnv,
        model: ep.model,
        flavor: ep.flavor,
        duration: ep.duration,
        ratio: ep.ratio,
      })),
    },
    audio: {
      strategy: cfg.audio.strategy,
      autoFailover: cfg.audio.autoFailover,
      endpoints: cfg.audio.endpoints.map(ep => ({
        id: ep.id,
        name: ep.name,
        enabled: ep.enabled,
        weight: ep.weight,
        baseURL: ep.baseURL,
        apiKey: '',
        clearApiKey: false,
        apiKeyEnv: ep.apiKeyEnv,
        model: ep.model,
        voice: ep.voice,
        format: ep.format,
      })),
    },
  }
}

const MEDIA_TAB_META: ReadonlyArray<{ key: MediaKind; label: string; icon: string }> = [
  { key: 'image', label: '生图模型', icon: '🖼' },
  { key: 'video', label: '视频模型', icon: '🎬' },
  { key: 'audio', label: '配音模型', icon: '🎙' },
]

const STRATEGY_META: ReadonlyArray<{ key: RoutingStrategy; label: string; desc: string }> = [
  { key: 'round_robin', label: '🔄 动态轮询', desc: '按权重依次轮流分配请求，自动跳过故障冷却中的接口' },
  { key: 'failover', label: '🛡 主备容灾', desc: '按列表顺序优先使用主接口，异常时自动切向备用接口' },
  { key: 'random', label: '🎲 随机均衡', desc: '按权重在健康接口间随机分流，单点故障自动切换' },
]

function MediaConfigModal({ initialTab, onClose }: {
  initialTab: MediaKind
  onClose: () => void
}): ReactNode {
  const [tab, setTab] = useState<MediaKind>(initialTab)
  const [details, setDetails] = useState<MediaConfigDetails | null>(null)
  const [draft, setDraft] = useState<MediaFormDraft | null>(null)
  const [expandedId, setExpandedId] = useState<Record<MediaKind, string | null>>({
    image: null,
    video: null,
    audio: null,
  })
  const [showKeyIds, setShowKeyIds] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErr(null)
    void call<MediaConfigDetails>('/media-config')
      .then(data => {
        if (!alive) return
        setDetails(data)
        setDraft(toDraft(data))
        setExpandedId({
          image: null,
          video: null,
          audio: null,
        })
      })
      .catch(e => {
        if (!alive) return
        setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const patchImageEp = (id: string, fn: (ep: ImageEndpointDraft) => ImageEndpointDraft): void => {
    setDraft(d => d ? ({
      ...d,
      image: { ...d.image, endpoints: d.image.endpoints.map(ep => (ep.id === id ? fn(ep) : ep)) },
    }) : d)
  }

  const patchVideoEp = (id: string, fn: (ep: VideoEndpointDraft) => VideoEndpointDraft): void => {
    setDraft(d => d ? ({
      ...d,
      video: { ...d.video, endpoints: d.video.endpoints.map(ep => (ep.id === id ? fn(ep) : ep)) },
    }) : d)
  }

  const patchAudioEp = (id: string, fn: (ep: AudioEndpointDraft) => AudioEndpointDraft): void => {
    setDraft(d => d ? ({
      ...d,
      audio: { ...d.audio, endpoints: d.audio.endpoints.map(ep => (ep.id === id ? fn(ep) : ep)) },
    }) : d)
  }

  const addEndpoint = (): void => {
    if (!draft) return
    const newId = makeLocalEndpointId(tab)
    if (tab === 'image') {
      const idx = draft.image.endpoints.length + 1
      const next: ImageEndpointDraft = {
        id: newId,
        name: `生图接口 #${idx}`,
        enabled: true,
        weight: 1,
        baseURL: '',
        apiKey: '',
        clearApiKey: false,
        apiKeyEnv: '',
        model: 'gpt-image-1',
        size: '1024x1024',
        flavor: 'openai',
      }
      setDraft({ ...draft, image: { ...draft.image, endpoints: [...draft.image.endpoints, next] } })
    } else if (tab === 'video') {
      const idx = draft.video.endpoints.length + 1
      const next: VideoEndpointDraft = {
        id: newId,
        name: `视频接口 #${idx}`,
        enabled: true,
        weight: 1,
        baseURL: '',
        apiKey: '',
        clearApiKey: false,
        apiKeyEnv: '',
        model: 'doubao-seedance-1-0-pro-250528',
        flavor: 'ark',
        duration: 5,
        ratio: '16:9',
      }
      setDraft({ ...draft, video: { ...draft.video, endpoints: [...draft.video.endpoints, next] } })
    } else {
      const idx = draft.audio.endpoints.length + 1
      const next: AudioEndpointDraft = {
        id: newId,
        name: `配音接口 #${idx}`,
        enabled: true,
        weight: 1,
        baseURL: '',
        apiKey: '',
        clearApiKey: false,
        apiKeyEnv: '',
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
        format: 'mp3',
      }
      setDraft({ ...draft, audio: { ...draft.audio, endpoints: [...draft.audio.endpoints, next] } })
    }
    setExpandedId(prev => ({ ...prev, [tab]: newId }))
    setMsg(null)
    setErr(null)
  }

  const duplicateEndpoint = (idx: number): void => {
    if (!draft) return
    const newId = makeLocalEndpointId(tab)
    if (tab === 'image') {
      const src = draft.image.endpoints[idx]
      if (!src) return
      const copy: ImageEndpointDraft = {
        ...src,
        id: newId,
        name: `${src.name} 副本`,
        cloneKeyFromId: src.clearApiKey ? undefined : (src.cloneKeyFromId ?? src.id),
      }
      const next = [...draft.image.endpoints]
      next.splice(idx + 1, 0, copy)
      setDraft({ ...draft, image: { ...draft.image, endpoints: next } })
    } else if (tab === 'video') {
      const src = draft.video.endpoints[idx]
      if (!src) return
      const copy: VideoEndpointDraft = {
        ...src,
        id: newId,
        name: `${src.name} 副本`,
        cloneKeyFromId: src.clearApiKey ? undefined : (src.cloneKeyFromId ?? src.id),
      }
      const next = [...draft.video.endpoints]
      next.splice(idx + 1, 0, copy)
      setDraft({ ...draft, video: { ...draft.video, endpoints: next } })
    } else {
      const src = draft.audio.endpoints[idx]
      if (!src) return
      const copy: AudioEndpointDraft = {
        ...src,
        id: newId,
        name: `${src.name} 副本`,
        cloneKeyFromId: src.clearApiKey ? undefined : (src.cloneKeyFromId ?? src.id),
      }
      const next = [...draft.audio.endpoints]
      next.splice(idx + 1, 0, copy)
      setDraft({ ...draft, audio: { ...draft.audio, endpoints: next } })
    }
    setExpandedId(prev => ({ ...prev, [tab]: newId }))
  }

  const moveEndpoint = (idx: number, delta: -1 | 1): void => {
    setDraft(d => {
      if (!d) return d
      const pool = d[tab]
      const target = idx + delta
      if (target < 0 || target >= pool.endpoints.length) return d
      const list = [...pool.endpoints]
      const [item] = list.splice(idx, 1)
      list.splice(target, 0, item)
      return { ...d, [tab]: { ...pool, endpoints: list } } as MediaFormDraft
    })
  }

  const removeEndpoint = (id: string): void => {
    setDraft(d => {
      if (!d) return d
      const pool = d[tab]
      if (pool.endpoints.length <= 1) return d
      const nextList = pool.endpoints.filter(ep => ep.id !== id)
      if (expandedId[tab] === id) {
        setExpandedId(prev => ({ ...prev, [tab]: null }))
      }
      return { ...d, [tab]: { ...pool, endpoints: nextList } } as MediaFormDraft
    })
  }

  const handleSave = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    setErr(null)
    setMsg(null)
    try {
      const serializeBase = (ep: EndpointDraftBase) => ({
        id: ep.id,
        name: ep.name,
        enabled: ep.enabled,
        weight: ep.weight,
        baseURL: ep.baseURL,
        ...(ep.clearApiKey
          ? { clearApiKey: true }
          : ep.apiKey.trim()
            ? { apiKey: ep.apiKey.trim() }
            : ep.cloneKeyFromId
              ? { cloneKeyFromId: ep.cloneKeyFromId }
              : {}),
        apiKeyEnv: ep.apiKeyEnv,
        model: ep.model,
      })
      const payload = {
        image: {
          strategy: draft.image.strategy,
          autoFailover: draft.image.autoFailover,
          endpoints: draft.image.endpoints.map(ep => ({
            ...serializeBase(ep),
            size: ep.size,
            flavor: ep.flavor,
          })),
        },
        video: {
          strategy: draft.video.strategy,
          autoFailover: draft.video.autoFailover,
          endpoints: draft.video.endpoints.map(ep => ({
            ...serializeBase(ep),
            flavor: ep.flavor,
            duration: ep.duration,
            ratio: ep.ratio,
          })),
        },
        audio: {
          strategy: draft.audio.strategy,
          autoFailover: draft.audio.autoFailover,
          endpoints: draft.audio.endpoints.map(ep => ({
            ...serializeBase(ep),
            voice: ep.voice,
            format: ep.format,
          })),
        },
      }
      const res = await call<MediaStatus & { config: MediaConfigDetails }>('/media-config', {
        method: 'PUT',
        body: payload,
      })
      setDetails(res.config)
      setDraft(toDraft(res.config))
      updateMediaStatus({ image: res.image, video: res.video, audio: res.audio })
      setMsg('多接口配置与轮询策略已保存并实时生效')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleResetTab = async (): Promise<void> => {
    setSaving(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await call<MediaStatus & { config: MediaConfigDetails }>('/media-config/reset', {
        method: 'POST',
        body: { kind: tab },
      })
      setDetails(res.config)
      setDraft(prev => {
        const fresh = toDraft(res.config)
        if (!prev) return fresh
        return { ...prev, [tab]: fresh[tab] }
      })
      setExpandedId(prev => ({ ...prev, [tab]: null }))
      updateMediaStatus({ image: res.image, video: res.video, audio: res.audio })
      setMsg('已恢复该项默认配置')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleResetHealth = async (): Promise<void> => {
    setSaving(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await call<MediaStatus & { config: MediaConfigDetails }>('/media-config/reset-health', {
        method: 'POST',
        body: { kind: tab },
      })
      setDetails(res.config)
      updateMediaStatus({ image: res.image, video: res.video, audio: res.audio })
      setMsg('已清除熔断冷却与轮询统计')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const curPoolDetail = details ? details[tab] : null
  const curPoolDraft = draft ? draft[tab] : null
  const curDetailById = useMemo(() => {
    const map = new Map<string, ImageEndpointDetail | VideoEndpointDetail | AudioEndpointDetail>()
    if (curPoolDetail) {
      for (const ep of curPoolDetail.endpoints) map.set(ep.id, ep)
    }
    return map
  }, [curPoolDetail])

  const hasAnyStats = Boolean(curPoolDetail?.endpoints.some(ep => ep.totalRequests > 0 || ep.inCooldown))
  const curStrategyDesc = STRATEGY_META.find(s => s.key === (curPoolDraft?.strategy ?? 'round_robin'))?.desc ?? ''

  const toggleShowKey = (id: string): void => {
    setShowKeyIds(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const renderEndpointHeader = (
    ep: EndpointDraftBase,
    idx: number,
    total: number,
    saved: ImageEndpointDetail | VideoEndpointDetail | AudioEndpointDetail | undefined,
    onToggleEnabled: () => void,
  ): ReactNode => {
    const isExpanded = expandedId[tab] === ep.id
    const hasPendingKey = Boolean(ep.apiKey.trim()) || (!ep.clearApiKey && Boolean(saved?.hasApiKey || ep.cloneKeyFromId))
    const isLocallyReady = ep.enabled && Boolean(ep.baseURL.trim()) && hasPendingKey
    return (
      <>
        <div
          className={css.mediaEndpointHead}
          onClick={() => setExpandedId(prev => ({ ...prev, [tab]: isExpanded ? null : ep.id }))}
        >
          <div className={css.mediaEndpointHeadLeft}>
            <span className={css.mediaEndpointIdx}>#{idx + 1}</span>
            <span className={!ep.enabled ? css.mediaFieldHint : isLocallyReady ? css.mediaTabDotOk : css.mediaTabDotErr}>●</span>
            <span className={css.mediaEndpointName} title={ep.name}>{ep.name || `接口 #${idx + 1}`}</span>
            {ep.model && <span className={css.mediaEndpointTag}>{ep.model}</span>}
            {curPoolDraft && curPoolDraft.strategy !== 'failover' && (
              <span className={css.mediaEndpointTag} title="动态调度权重">权重 ×{ep.weight}</span>
            )}
            {saved?.inCooldown ? (
              <span className={css.mediaEndpointTagWarn} title={saved.lastError ?? '失败冷却中'}>
                冷却 {Math.ceil(saved.cooldownRemainingMs / 1000)}s
              </span>
            ) : !ep.enabled ? (
              <span className={css.mediaEndpointTag}>已停用</span>
            ) : isLocallyReady ? (
              <span className={css.mediaEndpointTagOk}>就绪</span>
            ) : (
              <span className={css.mediaEndpointTagErr}>未配置</span>
            )}
            {saved && saved.totalRequests > 0 && (
              <span className={css.mediaEndpointTag} title={`总请求 ${saved.totalRequests}，成功 ${saved.successCount}，失败 ${saved.failCount}`}>
                调用 {saved.successCount}/{saved.totalRequests}
              </span>
            )}
          </div>
          <div className={css.mediaEndpointHeadActions} onClick={e => e.stopPropagation()}>
            <button
              type="button"
              data-ep-toggle={ep.id}
              className={ep.enabled ? css.mediaMiniToggle : css.mediaMiniToggleOff}
              title={ep.enabled ? '点击停用此接口' : '点击启用此接口'}
              onClick={onToggleEnabled}
            >
              {ep.enabled ? '启用' : '停用'}
            </button>
            <button
              type="button"
              className={css.miniBtn}
              title="上移优先级"
              disabled={idx === 0}
              onClick={() => moveEndpoint(idx, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className={css.miniBtn}
              title="下移优先级"
              disabled={idx === total - 1}
              onClick={() => moveEndpoint(idx, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className={css.miniBtn}
              title="复制接口配置"
              onClick={() => duplicateEndpoint(idx)}
            >
              复制
            </button>
            <button
              type="button"
              className={css.miniBtnDanger}
              title={total <= 1 ? '至少保留一个接口（可清空配置）' : '删除此接口'}
              disabled={total <= 1}
              onClick={() => removeEndpoint(ep.id)}
            >
              删除
            </button>
            <button
              type="button"
              className={css.miniBtn}
              onClick={() => setExpandedId(prev => ({ ...prev, [tab]: isExpanded ? null : ep.id }))}
            >
              {isExpanded ? '收起' : '展开'}
            </button>
          </div>
        </div>
        {!isExpanded && (
          <div className={css.mediaEndpointSummary}>
            <span className={css.mediaEndpointUrl} title={ep.baseURL || '未填写地址'}>
              地址：{ep.baseURL || '未填写'}
            </span>
            <span>
              密钥：{ep.clearApiKey ? '待清除' : ep.apiKey.trim() ? '已填写新密钥（待保存）' : saved?.hasApiKey ? saved.apiKeyMasked : '未配置'}
            </span>
          </div>
        )}
      </>
    )
  }

  return (
    <div className={css.modalBackdrop} onClick={onClose} data-media-modal="1">
      <div className={css.mediaModalCard} onClick={e => e.stopPropagation()}>
        <div className={css.sectionHead}>
          <div>
            <div className={css.sectionTitle}>多模态模型配置 · 多接口动态轮询</div>
            <div className={css.mediaModalSub}>可为生图、视频、配音分别配置多个上游接口，支持权重动态轮询与失败自动切换</div>
          </div>
          <button type="button" className={css.iconBtn} title="关闭" onClick={onClose}>×</button>
        </div>

        <div className={css.mediaTabRow} role="tablist">
          {MEDIA_TAB_META.map(item => {
            const p = details ? details[item.key] : null
            const isReady = Boolean(p?.ready)
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                data-media-tab={item.key}
                className={tab === item.key ? css.mediaTabActive : css.mediaTab}
                onClick={() => { setTab(item.key); setMsg(null); setErr(null) }}
              >
                <span className={isReady ? css.mediaTabDotOk : css.mediaTabDotErr}>●</span>
                <span>{item.icon} {item.label}</span>
                {p && <span className={css.mediaTabCount}>{p.readyCount}/{p.totalCount}</span>}
              </button>
            )
          })}
        </div>

        {loading || !draft || !curPoolDetail || !curPoolDraft ? (
          <div className={css.mediaLoadingBox}>正在读取多模态模型配置…</div>
        ) : (
          <>
            <div className={curPoolDetail.ready ? css.mediaStatusOk : css.mediaStatusErr}>
              <div className={css.mediaStatusBar}>
                <span>
                  {curPoolDetail.ready ? (
                    <>
                      ● 已就绪 · <strong>{curPoolDetail.readyCount}/{curPoolDetail.totalCount}</strong> 个接口可用 · 当前策略：<strong>{STRATEGY_LABEL[curPoolDetail.strategy]}</strong>
                      {curPoolDetail.autoFailover ? '（故障自动切换）' : ''}
                    </>
                  ) : (
                    <>● 当前无可用接口 · 请至少为一个已启用接口填写 Base URL 与有效 API Key 后保存</>
                  )}
                </span>
                {hasAnyStats && (
                  <button type="button" className={css.miniBtn} disabled={saving} onClick={() => void handleResetHealth()}>
                    重置熔断/统计
                  </button>
                )}
              </div>
            </div>

            {/* 调度策略与添加接口控制栏 */}
            <div className={css.mediaPoolBar}>
              <div className={css.mediaPoolHead}>
                <span className={css.mediaPoolTitle}>多接口调度策略</span>
                <button
                  type="button"
                  className={css.btnPrimary}
                  data-media-add-endpoint="1"
                  onClick={addEndpoint}
                >
                  ＋ 添加接口
                </button>
              </div>
              <div className={css.mediaStrategyRow}>
                {STRATEGY_META.map(st => (
                  <button
                    key={st.key}
                    type="button"
                    data-media-strategy={st.key}
                    className={curPoolDraft.strategy === st.key ? css.pillActive : css.pillBtn}
                    onClick={() => setDraft(d => d ? ({ ...d, [tab]: { ...d[tab], strategy: st.key } } as MediaFormDraft) : d)}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
              <div className={css.mediaFieldHint}>{curStrategyDesc}</div>
              <label className={css.mediaCheckRow}>
                <input
                  type="checkbox"
                  data-media-autofailover="1"
                  checked={curPoolDraft.autoFailover}
                  onChange={e => setDraft(d => d ? ({ ...d, [tab]: { ...d[tab], autoFailover: e.target.checked } } as MediaFormDraft) : d)}
                />
                <span>失败自动切换下一接口（单接口报错时自动熔断冷却 15–60s，冷却结束后自动恢复参与轮询）</span>
              </label>
            </div>

            {/* 接口池列表 */}
            <div className={css.mediaEndpointList} data-media-endpoint-list={tab}>
              {tab === 'image' && draft.image.endpoints.map((ep, idx) => {
                const saved = curDetailById.get(ep.id) as ImageEndpointDetail | undefined
                const isExpanded = expandedId.image === ep.id
                const showKey = Boolean(showKeyIds[ep.id])
                return (
                  <div key={ep.id} data-media-endpoint={ep.id} className={ep.enabled ? css.mediaEndpointCard : css.mediaEndpointCardDisabled}>
                    {renderEndpointHeader(ep, idx, draft.image.endpoints.length, saved, () =>
                      patchImageEp(ep.id, cur => ({ ...cur, enabled: !cur.enabled })),
                    )}
                    {isExpanded && (
                      <div className={css.mediaEndpointBody}>
                        <div className={css.mediaPresetRow}>
                          <span className={css.mediaFieldHint}>快速填充：</span>
                          <button
                            type="button"
                            className={css.pillBtn}
                            onClick={() => patchImageEp(ep.id, cur => ({ ...cur, flavor: 'openai', baseURL: 'https://api.openai.com/v1', model: 'gpt-image-1', size: '1024x1024' }))}
                          >
                            OpenAI Images
                          </button>
                          <button
                            type="button"
                            className={css.pillBtn}
                            onClick={() => patchImageEp(ep.id, cur => ({ ...cur, flavor: 'ark', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedream-3-0-t2i-250415', size: '1024x1024' }))}
                          >
                            火山方舟 Seedream
                          </button>
                          <button
                            type="button"
                            className={css.pillBtn}
                            onClick={() => patchImageEp(ep.id, cur => ({ ...cur, baseURL: '', apiKey: '', clearApiKey: true, cloneKeyFromId: undefined, apiKeyEnv: '' }))}
                          >
                            清空此接口
                          </button>
                        </div>

                        <div className={css.mediaFieldRow}>
                          <label className={css.field}>
                            接口名称
                            <input
                              data-media-field="name"
                              value={ep.name}
                              onChange={e => patchImageEp(ep.id, cur => ({ ...cur, name: e.target.value }))}
                              placeholder="例如：主力 OpenAI / 备用方舟"
                            />
                          </label>
                          <label className={css.field}>
                            轮询权重（1-10）
                            <input
                              data-media-field="weight"
                              type="number"
                              min={1}
                              max={10}
                              value={ep.weight}
                              onChange={e => patchImageEp(ep.id, cur => ({ ...cur, weight: Math.max(1, Math.min(10, Number(e.target.value) || 1)) }))}
                            />
                          </label>
                        </div>

                        <div className={css.field}>
                          <span>接口协议</span>
                          <div className={css.pillRow}>
                            <button
                              type="button"
                              className={ep.flavor === 'openai' ? css.pillActive : css.pillBtn}
                              onClick={() => patchImageEp(ep.id, cur => ({ ...cur, flavor: 'openai' }))}
                            >
                              OpenAI 兼容（/images/generations）
                            </button>
                            <button
                              type="button"
                              className={ep.flavor === 'ark' ? css.pillActive : css.pillBtn}
                              onClick={() => patchImageEp(ep.id, cur => ({ ...cur, flavor: 'ark' }))}
                            >
                              火山方舟 Seedream
                            </button>
                          </div>
                        </div>

                        <label className={css.field}>
                          接口地址（Base URL）
                          <input
                            data-media-field="baseURL"
                            value={ep.baseURL}
                            onChange={e => patchImageEp(ep.id, cur => ({ ...cur, baseURL: e.target.value }))}
                            placeholder="例如：https://api.openai.com/v1 或 https://ark.cn-beijing.volces.com/api/v3"
                          />
                        </label>

                        <div className={css.field}>
                          <span>API Key（留空则保持现有密钥）</span>
                          <div className={css.secretInputWrap}>
                            <input
                              data-media-field="apiKey"
                              type={showKey ? 'text' : 'password'}
                              value={ep.apiKey}
                              onChange={e => patchImageEp(ep.id, cur => ({ ...cur, apiKey: e.target.value, clearApiKey: false }))}
                              placeholder={
                                ep.clearApiKey
                                  ? '已标记清除自定义密钥'
                                  : saved?.hasApiKey
                                    ? `已配置（${saved.apiKeyMasked}），输入新密钥以替换`
                                    : ep.cloneKeyFromId
                                      ? '留空将沿用原接口密钥，或输入新密钥'
                                      : '请输入 API Key（如 sk-...）'
                              }
                            />
                            <button type="button" className={css.secretToggleBtn} onClick={() => toggleShowKey(ep.id)}>
                              {showKey ? '隐藏' : '显示'}
                            </button>
                            {saved?.apiKeySource === 'custom' && !ep.clearApiKey && (
                              <button
                                type="button"
                                className={css.secretToggleBtn}
                                onClick={() => patchImageEp(ep.id, cur => ({ ...cur, apiKey: '', clearApiKey: true, cloneKeyFromId: undefined }))}
                              >
                                清除
                              </button>
                            )}
                          </div>
                        </div>

                        <div className={css.mediaFieldRow}>
                          <label className={css.field}>
                            模型名称（Model）
                            <input
                              data-media-field="model"
                              value={ep.model}
                              onChange={e => patchImageEp(ep.id, cur => ({ ...cur, model: e.target.value }))}
                              placeholder="例如：gpt-image-1"
                            />
                          </label>
                          <label className={css.field}>
                            默认分辨率（Size）
                            <input
                              data-media-field="size"
                              value={ep.size}
                              onChange={e => patchImageEp(ep.id, cur => ({ ...cur, size: e.target.value }))}
                              placeholder="1024x1024"
                            />
                          </label>
                        </div>

                        <label className={css.field}>
                          备用环境变量名（当未填写上方 API Key 时读取）
                          <input
                            data-media-field="apiKeyEnv"
                            value={ep.apiKeyEnv}
                            onChange={e => patchImageEp(ep.id, cur => ({ ...cur, apiKeyEnv: e.target.value }))}
                            placeholder="MUJING_IMAGE_API_KEY"
                          />
                        </label>

                        {saved?.lastError && (
                          <div className={css.mediaEndpointErrNote}>最近异常：{saved.lastError}</div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {tab === 'video' && draft.video.endpoints.map((ep, idx) => {
                const saved = curDetailById.get(ep.id) as VideoEndpointDetail | undefined
                const isExpanded = expandedId.video === ep.id
                const showKey = Boolean(showKeyIds[ep.id])
                return (
                  <div key={ep.id} data-media-endpoint={ep.id} className={ep.enabled ? css.mediaEndpointCard : css.mediaEndpointCardDisabled}>
                    {renderEndpointHeader(ep, idx, draft.video.endpoints.length, saved, () =>
                      patchVideoEp(ep.id, cur => ({ ...cur, enabled: !cur.enabled })),
                    )}
                    {isExpanded && (
                      <div className={css.mediaEndpointBody}>
                        <div className={css.mediaPresetRow}>
                          <span className={css.mediaFieldHint}>快速填充：</span>
                          <button
                            type="button"
                            className={css.pillBtn}
                            onClick={() => patchVideoEp(ep.id, cur => ({ ...cur, flavor: 'ark', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedance-1-0-pro-250528' }))}
                          >
                            火山方舟 Seedance
                          </button>
                          <button
                            type="button"
                            className={css.pillBtn}
                            onClick={() => patchVideoEp(ep.id, cur => ({ ...cur, flavor: 'openai', baseURL: 'https://api.openai.com/v1', model: 'sora-2' }))}
                          >
                            OpenAI Videos
                          </button>
                          <button
                            type="button"
                            className={css.pillBtn}
                            onClick={() => patchVideoEp(ep.id, cur => ({ ...cur, baseURL: '', apiKey: '', clearApiKey: true, cloneKeyFromId: undefined, apiKeyEnv: '' }))}
                          >
                            清空此接口
                          </button>
                        </div>

                        <div className={css.mediaFieldRow}>
                          <label className={css.field}>
                            接口名称
                            <input
                              data-media-field="name"
                              value={ep.name}
                              onChange={e => patchVideoEp(ep.id, cur => ({ ...cur, name: e.target.value }))}
                              placeholder="例如：主力方舟 / 备用 Sora"
                            />
                          </label>
                          <label className={css.field}>
                            轮询权重（1-10）
                            <input
                              data-media-field="weight"
                              type="number"
                              min={1}
                              max={10}
                              value={ep.weight}
                              onChange={e => patchVideoEp(ep.id, cur => ({ ...cur, weight: Math.max(1, Math.min(10, Number(e.target.value) || 1)) }))}
                            />
                          </label>
                        </div>

                        <div className={css.field}>
                          <span>接口协议</span>
                          <div className={css.pillRow}>
                            <button
                              type="button"
                              className={ep.flavor === 'ark' ? css.pillActive : css.pillBtn}
                              onClick={() => patchVideoEp(ep.id, cur => ({ ...cur, flavor: 'ark' }))}
                            >
                              火山方舟 Seedance（首帧 + 多参考图）
                            </button>
                            <button
                              type="button"
                              className={ep.flavor === 'openai' ? css.pillActive : css.pillBtn}
                              onClick={() => patchVideoEp(ep.id, cur => ({ ...cur, flavor: 'openai' }))}
                            >
                              OpenAI Videos（/videos）
                            </button>
                          </div>
                        </div>

                        <label className={css.field}>
                          接口地址（Base URL）
                          <input
                            data-media-field="baseURL"
                            value={ep.baseURL}
                            onChange={e => patchVideoEp(ep.id, cur => ({ ...cur, baseURL: e.target.value }))}
                            placeholder="例如：https://ark.cn-beijing.volces.com/api/v3"
                          />
                        </label>

                        <div className={css.field}>
                          <span>API Key（留空则保持现有密钥）</span>
                          <div className={css.secretInputWrap}>
                            <input
                              data-media-field="apiKey"
                              type={showKey ? 'text' : 'password'}
                              value={ep.apiKey}
                              onChange={e => patchVideoEp(ep.id, cur => ({ ...cur, apiKey: e.target.value, clearApiKey: false }))}
                              placeholder={
                                ep.clearApiKey
                                  ? '已标记清除自定义密钥'
                                  : saved?.hasApiKey
                                    ? `已配置（${saved.apiKeyMasked}），输入新密钥以替换`
                                    : ep.cloneKeyFromId
                                      ? '留空将沿用原接口密钥，或输入新密钥'
                                      : '请输入 API Key'
                              }
                            />
                            <button type="button" className={css.secretToggleBtn} onClick={() => toggleShowKey(ep.id)}>
                              {showKey ? '隐藏' : '显示'}
                            </button>
                            {saved?.apiKeySource === 'custom' && !ep.clearApiKey && (
                              <button
                                type="button"
                                className={css.secretToggleBtn}
                                onClick={() => patchVideoEp(ep.id, cur => ({ ...cur, apiKey: '', clearApiKey: true, cloneKeyFromId: undefined }))}
                              >
                                清除
                              </button>
                            )}
                          </div>
                        </div>

                        <div className={css.mediaFieldRow}>
                          <label className={css.field}>
                            模型名称（Model）
                            <input
                              data-media-field="model"
                              value={ep.model}
                              onChange={e => patchVideoEp(ep.id, cur => ({ ...cur, model: e.target.value }))}
                              placeholder="doubao-seedance-1-0-pro-250528"
                            />
                          </label>
                          <label className={css.field}>
                            默认时长（秒）
                            <input
                              data-media-field="duration"
                              type="number"
                              min={2}
                              max={20}
                              value={ep.duration}
                              onChange={e => patchVideoEp(ep.id, cur => ({ ...cur, duration: Number(e.target.value) || 5 }))}
                            />
                          </label>
                          <label className={css.field}>
                            默认画幅
                            <select
                              data-media-field="ratio"
                              value={ep.ratio}
                              onChange={e => patchVideoEp(ep.id, cur => ({ ...cur, ratio: e.target.value }))}
                            >
                              <option value="9:16">9:16 竖屏</option>
                              <option value="16:9">16:9 横屏</option>
                              <option value="1:1">1:1 方形</option>
                            </select>
                          </label>
                        </div>

                        <label className={css.field}>
                          备用环境变量名（当未填写上方 API Key 时读取）
                          <input
                            data-media-field="apiKeyEnv"
                            value={ep.apiKeyEnv}
                            onChange={e => patchVideoEp(ep.id, cur => ({ ...cur, apiKeyEnv: e.target.value }))}
                            placeholder="MUJING_VIDEO_API_KEY"
                          />
                        </label>

                        {saved?.lastError && (
                          <div className={css.mediaEndpointErrNote}>最近异常：{saved.lastError}</div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {tab === 'audio' && draft.audio.endpoints.map((ep, idx) => {
                const saved = curDetailById.get(ep.id) as AudioEndpointDetail | undefined
                const isExpanded = expandedId.audio === ep.id
                const showKey = Boolean(showKeyIds[ep.id])
                const firstImageBase = draft.image.endpoints[0]?.baseURL ?? ''
                return (
                  <div key={ep.id} data-media-endpoint={ep.id} className={ep.enabled ? css.mediaEndpointCard : css.mediaEndpointCardDisabled}>
                    {renderEndpointHeader(ep, idx, draft.audio.endpoints.length, saved, () =>
                      patchAudioEp(ep.id, cur => ({ ...cur, enabled: !cur.enabled })),
                    )}
                    {isExpanded && (
                      <div className={css.mediaEndpointBody}>
                        <div className={css.mediaPresetRow}>
                          <span className={css.mediaFieldHint}>快速填充：</span>
                          <button
                            type="button"
                            className={css.pillBtn}
                            onClick={() => patchAudioEp(ep.id, cur => ({ ...cur, baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', voice: 'alloy', format: 'mp3' }))}
                          >
                            OpenAI TTS
                          </button>
                          <button
                            type="button"
                            className={css.pillBtn}
                            onClick={() => patchAudioEp(ep.id, cur => ({ ...cur, baseURL: firstImageBase || cur.baseURL }))}
                          >
                            复用生图接口地址
                          </button>
                          <button
                            type="button"
                            className={css.pillBtn}
                            onClick={() => patchAudioEp(ep.id, cur => ({ ...cur, baseURL: '', apiKey: '', clearApiKey: true, cloneKeyFromId: undefined, apiKeyEnv: '' }))}
                          >
                            清空此接口
                          </button>
                        </div>

                        <div className={css.mediaFieldRow}>
                          <label className={css.field}>
                            接口名称
                            <input
                              data-media-field="name"
                              value={ep.name}
                              onChange={e => patchAudioEp(ep.id, cur => ({ ...cur, name: e.target.value }))}
                              placeholder="例如：主力配音 / 备用配音"
                            />
                          </label>
                          <label className={css.field}>
                            轮询权重（1-10）
                            <input
                              data-media-field="weight"
                              type="number"
                              min={1}
                              max={10}
                              value={ep.weight}
                              onChange={e => patchAudioEp(ep.id, cur => ({ ...cur, weight: Math.max(1, Math.min(10, Number(e.target.value) || 1)) }))}
                            />
                          </label>
                        </div>

                        <label className={css.field}>
                          接口地址（Base URL，OpenAI 兼容 /audio/speech）
                          <input
                            data-media-field="baseURL"
                            value={ep.baseURL}
                            onChange={e => patchAudioEp(ep.id, cur => ({ ...cur, baseURL: e.target.value }))}
                            placeholder="例如：https://api.openai.com/v1"
                          />
                        </label>

                        <div className={css.field}>
                          <span>API Key（留空则保持现有密钥）</span>
                          <div className={css.secretInputWrap}>
                            <input
                              data-media-field="apiKey"
                              type={showKey ? 'text' : 'password'}
                              value={ep.apiKey}
                              onChange={e => patchAudioEp(ep.id, cur => ({ ...cur, apiKey: e.target.value, clearApiKey: false }))}
                              placeholder={
                                ep.clearApiKey
                                  ? '已标记清除自定义密钥'
                                  : saved?.hasApiKey
                                    ? `已配置（${saved.apiKeyMasked}），输入新密钥以替换`
                                    : ep.cloneKeyFromId
                                      ? '留空将沿用原接口密钥，或输入新密钥'
                                      : '请输入 API Key'
                              }
                            />
                            <button type="button" className={css.secretToggleBtn} onClick={() => toggleShowKey(ep.id)}>
                              {showKey ? '隐藏' : '显示'}
                            </button>
                            {saved?.apiKeySource === 'custom' && !ep.clearApiKey && (
                              <button
                                type="button"
                                className={css.secretToggleBtn}
                                onClick={() => patchAudioEp(ep.id, cur => ({ ...cur, apiKey: '', clearApiKey: true, cloneKeyFromId: undefined }))}
                              >
                                清除
                              </button>
                            )}
                          </div>
                        </div>

                        <div className={css.mediaFieldRow}>
                          <label className={css.field}>
                            模型名称（Model）
                            <input
                              data-media-field="model"
                              value={ep.model}
                              onChange={e => patchAudioEp(ep.id, cur => ({ ...cur, model: e.target.value }))}
                              placeholder="gpt-4o-mini-tts"
                            />
                          </label>
                          <label className={css.field}>
                            默认音色（Voice）
                            <input
                              data-media-field="voice"
                              value={ep.voice}
                              onChange={e => patchAudioEp(ep.id, cur => ({ ...cur, voice: e.target.value }))}
                              placeholder="alloy / nova / shimmer"
                            />
                          </label>
                          <label className={css.field}>
                            输出格式
                            <select
                              data-media-field="format"
                              value={ep.format}
                              onChange={e => patchAudioEp(ep.id, cur => ({ ...cur, format: e.target.value === 'wav' ? 'wav' : 'mp3' }))}
                            >
                              <option value="mp3">MP3</option>
                              <option value="wav">WAV</option>
                            </select>
                          </label>
                        </div>

                        <label className={css.field}>
                          备用环境变量名（当未填写上方 API Key 时读取）
                          <input
                            data-media-field="apiKeyEnv"
                            value={ep.apiKeyEnv}
                            onChange={e => patchAudioEp(ep.id, cur => ({ ...cur, apiKeyEnv: e.target.value }))}
                            placeholder="MUJING_AUDIO_API_KEY"
                          />
                        </label>

                        {saved?.lastError && (
                          <div className={css.mediaEndpointErrNote}>最近异常：{saved.lastError}</div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {err && <div className={css.mediaInlineMsgErr}>{err}</div>}
            {msg && <div className={css.mediaInlineMsgOk}>{msg}</div>}
          </>
        )}

        <div className={css.modalFooter}>
          <button
            type="button"
            className={css.btn}
            style={{ marginRight: 'auto' }}
            disabled={loading || saving}
            onClick={() => void handleResetTab()}
          >
            恢复默认配置
          </button>
          <button type="button" className={css.btn} onClick={onClose}>关闭</button>
          <button
            type="button"
            className={css.btnPrimary}
            data-media-save="1"
            disabled={loading || saving || !draft}
            onClick={() => void handleSave()}
          >
            {saving ? '保存中…' : '保存并生效'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── 视图 1：小说 → 短剧全流程故事板工作台 ───────────────────────── */

function DramaView({ project, onError, onNotify, onSwitchTab }: {
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

/* ───────────────────────── 视图 2：无限画布（支持图/视/音/文本 + 本地上传拖拽） ───────────────────────── */

type Drag =
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number }
  | { kind: 'node'; id: string; sx: number; sy: number; nx: number; ny: number; moved: boolean }
  | { kind: 'link'; source: string; x: number; y: number }

function BoardView({ project, onError, onNotify }: {
  project: ProjectWithHistory
  onError: (msg: string) => void
  onNotify: (msg: string) => void
}): ReactNode {
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState({ x: 32, y: 32, z: 0.78 })
  const [drag, setDrag] = useState<Drag | null>(null)
  const [local, setLocal] = useState<Record<string, { x: number; y: number }>>({})
  const [dropping, setDropping] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const autoFittedProjectRef = useRef<string | null>(null)

  useEffect(() => {
    setSelected(null)
    setLocal({})
    autoFittedProjectRef.current = null
  }, [project.id])

  const ops = useCallback(async (list: unknown[]) => {
    try {
      return await call<{ project: CanvasProject; created: string[] }>(`/projects/${project.id}/ops`, { method: 'POST', body: { ops: list } })
    } catch (e) {
      onError((e as Error).message)
      return undefined
    }
  }, [project.id, onError])

  const toWorld = useCallback((cx: number, cy: number) => {
    const r = stageRef.current?.getBoundingClientRect()
    return { x: ((cx - (r?.left ?? 0)) - view.x) / view.z, y: ((cy - (r?.top ?? 0)) - view.y) / view.z }
  }, [view])

  const fitAllNodes = useCallback((): void => {
    const el = stageRef.current
    if (!el || project.nodes.length === 0) {
      setView({ x: 32, y: 32, z: 0.85 })
      return
    }
    const minX = Math.min(...project.nodes.map(n => n.x))
    const minY = Math.min(...project.nodes.map(n => n.y))
    const maxX = Math.max(...project.nodes.map(n => n.x + n.width))
    const maxY = Math.max(...project.nodes.map(n => n.y + n.height))
    const padX = 96
    const padY = 128
    const contentW = Math.max(320, maxX - minX + padX)
    const contentH = Math.max(240, maxY - minY + padY)
    const z = Math.min(1.0, Math.max(0.24, Math.min(el.clientWidth / contentW, (el.clientHeight - 48) / contentH)))
    setView({
      z,
      x: Math.round((el.clientWidth - (maxX - minX) * z) / 2 - minX * z),
      y: Math.round(Math.max(28, (el.clientHeight - 48 - (maxY - minY) * z) / 2) - minY * z),
    })
  }, [project.nodes])

  // 首次进入画布或切换项目时，自动居中适配全部节点视角（解决分屏/全屏初始裁切问题）
  useEffect(() => {
    if (project.nodes.length === 0 || autoFittedProjectRef.current === project.id) return
    autoFittedProjectRef.current = project.id
    const raf = requestAnimationFrame(() => fitAllNodes())
    return () => cancelAnimationFrame(raf)
  }, [project.id, project.nodes.length, fitAllNodes])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if ((e.target as HTMLElement | null)?.closest('[data-scrollable]')) return
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect()
        const mx = e.clientX - r.left, my = e.clientY - r.top
        setView(v => {
          const z = Math.min(2.5, Math.max(0.22, v.z * Math.exp(-e.deltaY * 0.002)))
          return { z, x: mx - ((mx - v.x) / v.z) * z, y: my - ((my - v.y) / v.z) * z }
        })
      } else {
        setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onStageDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return
    setSelected(null)
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, px: view.x, py: view.y })
  }

  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drag) return
    if (drag.kind === 'pan') {
      setView(v => ({ ...v, x: drag.px + (e.clientX - drag.sx), y: drag.py + (e.clientY - drag.sy) }))
    } else if (drag.kind === 'node') {
      const dx = (e.clientX - drag.sx) / view.z, dy = (e.clientY - drag.sy) / view.z
      if (!drag.moved && Math.hypot(dx, dy) < 2) return
      drag.moved = true
      setLocal(l => ({ ...l, [drag.id]: { x: drag.nx + dx, y: drag.ny + dy } }))
    } else {
      setDrag({ ...drag, ...toWorld(e.clientX, e.clientY) })
    }
  }

  const onUp = async (e: ReactPointerEvent<HTMLDivElement>): Promise<void> => {
    const d = drag
    setDrag(null)
    if (d?.kind === 'node' && d.moved) {
      const pos = local[d.id]
      if (pos !== undefined) await ops([{ op: 'update_node', id: d.id, x: Math.round(pos.x), y: Math.round(pos.y) }])
      setLocal(l => { const { [d.id]: _, ...rest } = l; return rest })
    } else if (d?.kind === 'link') {
      const p = toWorld(e.clientX, e.clientY)
      const target = project.nodes.find(n => n.id !== d.source && p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height)
      if (target !== undefined) await ops([{ op: 'connect', source: d.source, target: target.id }])
    }
  }

  const centerWorld = (): { x: number; y: number } => {
    const el = stageRef.current
    return toWorld((el?.getBoundingClientRect().left ?? 0) + (el?.clientWidth ?? 800) / 2 - 160, (el?.getBoundingClientRect().top ?? 0) + (el?.clientHeight ?? 600) / 2 - 120)
  }

  const addNode = async (type: NodeType): Promise<void> => {
    const c = centerWorld()
    const res = await ops([{
      op: 'add_node',
      type,
      x: Math.round(c.x),
      y: Math.round(c.y),
      title: `${TYPE_LABEL[type]}节点`,
      ...(type === 'audio' ? { voice: 'alloy' } : {}),
    }])
    if (res?.created[0]) setSelected(res.created[0])
  }

  const handleFiles = async (files: FileList | null, dropPoint?: { x: number; y: number }): Promise<void> => {
    if (!files || files.length === 0) return
    const base = dropPoint ?? centerWorld()
    let offset = 0
    for (const file of Array.from(files)) {
      try {
        const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name)
        const isAudio = file.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg)$/i.test(file.name)
        const isText = file.type.startsWith('text/') || /\.(txt|md)$/i.test(file.name)
        if (isText) {
          const text = await file.text()
          await ops([{ op: 'add_node', type: 'text', x: Math.round(base.x + offset), y: Math.round(base.y + offset * 0.3), width: 380, height: 260, title: file.name, content: text }])
        } else {
          const nodeType: NodeType = isVideo ? 'video' : isAudio ? 'audio' : 'image'
          const uploaded = await uploadLocalFile(file)
          await ops([{
            op: 'add_node',
            type: nodeType,
            x: Math.round(base.x + offset),
            y: Math.round(base.y + offset * 0.3),
            title: file.name,
            url: uploaded.url,
            status: 'success',
            model: '本地上传',
            ...(uploaded.meta?.durationMs ? { durationMs: uploaded.meta.durationMs } : {}),
          }])
        }
        offset += 360
      } catch (e) {
        onError((e as Error).message)
      }
    }
    if (offset > 0) onNotify('素材已上传并加入画布')
  }

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDropping(false)
    if (e.dataTransfer.files?.length) {
      void handleFiles(e.dataTransfer.files, toWorld(e.clientX, e.clientY))
    }
  }

  const pushNodeToTimeline = async (node: CanvasNode): Promise<void> => {
    if (node.type !== 'video' || !node.url) return
    try {
      const existing = project.timeline?.clips ?? []
      await call(`/projects/${project.id}/timeline`, {
        method: 'PUT',
        body: {
          clips: [
            ...existing,
            { nodeId: node.id, title: node.title ?? node.id, url: node.url, durationMs: node.durationMs ?? 5000 },
          ],
        },
      })
      onNotify(`已将「${node.title ?? node.id}」加入时间线`)
    } catch (e) {
      onError((e as Error).message)
    }
  }

  const pos = (n: CanvasNode): { x: number; y: number } => local[n.id] ?? n
  const byId = new Map(project.nodes.map(n => [n.id, n]))
  const selectedNode = selected !== null ? byId.get(selected) : undefined

  const zoomBy = (factor: number): void => {
    const el = stageRef.current
    const cx = (el?.clientWidth ?? 600) / 2
    const cy = (el?.clientHeight ?? 480) / 2
    setView(v => {
      const z = Math.min(2.2, Math.max(0.22, v.z * factor))
      return { z, x: cx - ((cx - v.x) / v.z) * z, y: cy - ((cy - v.y) / v.z) * z }
    })
  }

  return (
    <div className={css.boardWrap}>
      <input ref={uploadInputRef} type="file" multiple accept="image/*,video/*,audio/*,.txt,.md" hidden onChange={e => { void handleFiles(e.target.files); e.target.value = '' }} />

      <div
        ref={stageRef}
        className={`${css.board} ${dropping ? css.boardDrop : ''}`}
        onPointerDown={onStageDown}
        onPointerMove={onMove}
        onPointerUp={e => void onUp(e)}
        onDragOver={e => { e.preventDefault(); setDropping(true) }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
        style={{ backgroundSize: `${24 * view.z}px ${24 * view.z}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      >
        <div className={css.boardHint}>拖拽空白平移 · ⌘滚轮缩放 · 拖入本地素材</div>
        <div className={css.world} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          <svg className={css.edges} width="8000" height="8000">
            {project.edges.map(edge => {
              const s = byId.get(edge.source), t = byId.get(edge.target)
              if (!s || !t) return null
              const sp = pos(s), tp = pos(t)
              const x1 = sp.x + s.width, y1 = sp.y + s.height / 2, x2 = tp.x, y2 = tp.y + t.height / 2
              const dx = Math.max(60, Math.abs(x2 - x1) * 0.5)
              return (
                <path
                  key={edge.id}
                  className={css.edge}
                  d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                  onClick={ev => { ev.stopPropagation(); if (window.confirm('断开这条连线？')) void ops([{ op: 'disconnect', source: edge.source, target: edge.target }]) }}
                />
              )
            })}
            {drag?.kind === 'link' && (() => {
              const s = byId.get(drag.source)
              if (!s) return null
              const sp = pos(s), x1 = sp.x + s.width, y1 = sp.y + s.height / 2
              return <path className={css.edgeDraft} d={`M ${x1} ${y1} L ${drag.x} ${drag.y}`} />
            })()}
          </svg>

          {project.nodes.map(n => {
            const p = pos(n)
            const styleObj: CSSProperties = { left: p.x, top: p.y, width: n.width, height: n.height }
            return (
              <div
                key={n.id}
                style={styleObj}
                className={n.id === selected ? css.nodeSelected : css.node}
                onPointerDown={e => { e.stopPropagation(); setSelected(n.id) }}
              >
                <div
                  className={css.nodeHead}
                  onPointerDown={e => {
                    e.stopPropagation()
                    setSelected(n.id)
                    stageRef.current?.setPointerCapture(e.pointerId)
                    setDrag({ kind: 'node', id: n.id, sx: e.clientX, sy: e.clientY, nx: p.x, ny: p.y, moved: false })
                  }}
                >
                  <span className={css.nodeType} data-type={n.type}>{TYPE_LABEL[n.type]}</span>
                  <span className={css.nodeTitle}>{n.title ?? n.id}</span>
                  {n.type !== 'text' && <span className={css.nodeStatus} data-status={n.status ?? 'idle'}>{STATUS_LABEL[n.status ?? 'idle']}</span>}
                </div>
                <div className={css.nodeBody} data-scrollable={n.type === 'text' ? '1' : undefined}>
                  <NodeBody node={n} />
                  {n.model && <span className={css.nodeModel}>{n.model}</span>}
                </div>
                <div
                  className={css.handle}
                  title="拖到目标节点以传递参考图/剧本/配音"
                  onPointerDown={e => {
                    e.stopPropagation()
                    stageRef.current?.setPointerCapture(e.pointerId)
                    setDrag({ kind: 'link', source: n.id, ...toWorld(e.clientX, e.clientY) })
                  }}
                />
              </div>
            )
          })}
        </div>

        {project.nodes.length === 0 && (
          <div className={css.boardEmpty}>
            画布还是空的。可用下方悬浮工具栏添加节点、直接拖入本地图片/视频/音频/小说，或切换到「短剧分镜台」一键拆集出片。
          </div>
        )}

        {/* 画布底部悬浮毛玻璃工具胶囊（Figma / TapNow 风格） */}
        <div className={css.boardDock} onPointerDown={e => e.stopPropagation()}>
          <button type="button" className={css.dockBtn} onClick={() => void addNode('text')}>＋ 文本</button>
          <button type="button" className={css.dockBtn} onClick={() => void addNode('image')}>＋ 图片</button>
          <button type="button" className={css.dockBtn} onClick={() => void addNode('video')}>＋ 视频</button>
          <button type="button" className={css.dockBtn} onClick={() => void addNode('audio')}>＋ 配音</button>
          <span className={css.sep} />
          <button type="button" className={css.dockBtn} onClick={() => uploadInputRef.current?.click()}>↑ 上传</button>
          <span className={css.sep} />
          <button type="button" className={css.dockIconBtn} title="缩小" onClick={() => zoomBy(0.84)}>－</button>
          <span className={css.dockZoom}>{Math.round(view.z * 100)}%</span>
          <button type="button" className={css.dockIconBtn} title="放大" onClick={() => zoomBy(1.18)}>＋</button>
          <button type="button" className={css.dockBtn} title="居中适配全部节点" onClick={fitAllNodes}>⊡ 适配</button>
        </div>
      </div>

      {selectedNode !== undefined && (
        <Inspector
          key={`${selectedNode.id}:${selectedNode.status ?? ''}:${selectedNode.url ?? ''}`}
          project={project}
          node={selectedNode}
          ops={ops}
          onError={onError}
          onPushTimeline={() => void pushNodeToTimeline(selectedNode)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function NodeBody({ node }: { node: CanvasNode }): ReactNode {
  if (node.type === 'text') return <div className={css.textBody}>{node.content || <i className={css.dim}>（空）</i>}</div>
  if (node.status === 'loading') return <div className={css.loading}><span className={css.spinner} />生成中…</div>
  if (node.status === 'error') return <div className={css.errText}>{node.error}</div>
  if (node.url) {
    if (node.type === 'image') return <img className={css.media} src={node.url} alt={node.title ?? ''} draggable={false} />
    if (node.type === 'video') return <video className={css.media} src={node.url} controls muted playsInline />
    return (
      <div className={css.audioBody}>
        <audio className={css.audioPlayer} src={node.url} controls />
        {node.prompt && <div className={css.audioCaption} title={node.prompt}>{node.voice ? `[${node.voice}] ` : ''}{node.prompt}</div>}
      </div>
    )
  }
  return (
    <div className={css.promptPreview}>
      {node.prompt || <i className={css.dim}>{node.type === 'audio' ? '点击节点填写台词并选择音色生成配音' : '点击节点填写提示词后生成'}</i>}
    </div>
  )
}

function Inspector({ project, node, ops, onError, onPushTimeline, onClose }: {
  project: CanvasProject
  node: CanvasNode
  ops: (list: unknown[]) => Promise<unknown>
  onError: (m: string) => void
  onPushTimeline: () => void
  onClose: () => void
}): ReactNode {
  const [title, setTitle] = useState(node.title ?? '')
  const [content, setContent] = useState(node.content ?? '')
  const [prompt, setPrompt] = useState(node.prompt ?? '')
  const [voice, setVoice] = useState(node.voice ?? 'alloy')
  const [ratio, setRatio] = useState<'16:9' | '9:16' | '1:1'>(project.drama?.aspectRatio ?? '16:9')
  const [duration, setDuration] = useState<number>(5)

  const refs = useMemo(
    () => project.edges.filter(e => e.target === node.id).map(e => project.nodes.find(n => n.id === e.source)).filter((n): n is CanvasNode => n !== undefined),
    [project, node.id],
  )
  const mediaRefs = refs.filter(r => (r.type === 'image' || r.type === 'video') && r.url)
  const textRefs = refs.filter(r => r.type === 'text' && r.content)

  const save = async (): Promise<void> => {
    await ops([{
      op: 'update_node',
      id: node.id,
      title,
      ...(node.type === 'text' ? { content } : { prompt }),
      ...(node.type === 'audio' ? { voice } : {}),
    }])
  }

  const generate = async (): Promise<void> => {
    const fullPrompt = node.type === 'audio'
      ? (prompt.trim() || textRefs.map(r => r.content ?? '').join(LF).trim())
      : [prompt, ...textRefs.map(r => r.content ?? '')].filter(Boolean).join(LF + LF)
    if (!fullPrompt.trim()) { onError(node.type === 'audio' ? '请先填写待朗读的台词或旁白' : '请先填写提示词'); return }
    await save()
    try {
      await call(`/projects/${project.id}/generate`, {
        method: 'POST',
        body: {
          kind: node.type,
          nodeId: node.id,
          prompt: fullPrompt,
          ...(node.type === 'audio' ? { voice } : {}),
          ...(node.type === 'video' ? { ratio, duration } : {}),
          referenceNodeIds: mediaRefs.map(r => r.id),
        },
      })
    } catch (e) { onError((e as Error).message) }
  }

  const actionLabel = node.type === 'image' ? '图片' : node.type === 'video' ? '视频' : '配音'

  return (
    <aside className={css.inspector}>
      <div className={css.inspectorHead}>
        <span>{TYPE_LABEL[node.type]}节点 · <code>{node.id}</code></span>
        <button type="button" className={css.iconBtn} aria-label="关闭" onClick={onClose}>×</button>
      </div>
      <label className={css.field}>标题<input value={title} onChange={e => setTitle(e.target.value)} onBlur={() => void save()} /></label>
      {node.type === 'text' ? (
        <label className={css.field}>内容<textarea rows={12} value={content} onChange={e => setContent(e.target.value)} onBlur={() => void save()} /></label>
      ) : (
        <>
          <label className={css.field}>
            {node.type === 'audio' ? '朗读台词 / 旁白' : '生成提示词'}
            <textarea
              rows={6}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onBlur={() => void save()}
              placeholder={node.type === 'audio' ? '输入角色对白或画外音旁白文本…' : '主体、动作、景别、机位、光线、风格…'}
            />
          </label>
          {node.type === 'audio' && (
            <label className={css.field}>
              音色（Voice）
              <select value={voice} onChange={e => setVoice(e.target.value)}>
                {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          )}
          {node.type === 'video' && (
            <div className={css.gridRow}>
              <label className={css.field}>
                画幅
                <select value={ratio} onChange={e => setRatio(e.target.value as '16:9' | '9:16' | '1:1')}>
                  <option value="16:9">16:9 横屏</option>
                  <option value="9:16">9:16 竖屏短剧</option>
                  <option value="1:1">1:1 方画幅</option>
                </select>
              </label>
              <label className={css.field}>
                时长（秒）
                <input type="number" min={2} max={15} value={duration} onChange={e => setDuration(Number(e.target.value) || 5)} />
              </label>
            </div>
          )}
          {refs.length > 0 && (
            <div className={css.refs}>
              上游输入：{refs.map(r => <span key={r.id} className={css.refChip}>{TYPE_LABEL[r.type]} · {r.title ?? r.id}</span>)}
              <div className={css.dim}>
                {node.type === 'video' ? '首张图片/视频作为首帧，其余作为角色一致性参考图。' : '上游参考图保持外观一致，文本自动拼接。'}
              </div>
            </div>
          )}
          <div className={css.actions}>
            {node.status === 'loading'
              ? <button type="button" className={css.btn} onClick={() => void call(`/projects/${project.id}/cancel`, { method: 'POST', body: { nodeId: node.id } })}>取消生成</button>
              : <button type="button" className={css.btnPrimary} onClick={() => void generate()}>{node.url ? '重新生成' : '生成'}{actionLabel}</button>}
            {node.type === 'video' && node.url && (
              <button type="button" className={css.btn} onClick={onPushTimeline}>＋ 加入时间线</button>
            )}
          </div>
          {node.error && <div className={css.errText}>{node.error}</div>}
          {node.url && <a className={css.link} href={node.url} target="_blank" rel="noreferrer">在新窗口打开媒体资产</a>}
        </>
      )}
      <div className={css.actions}>
        <button type="button" className={css.btnDanger} onClick={() => { if (window.confirm('删除该节点？')) { void ops([{ op: 'delete_node', id: node.id }]); onClose() } }}>删除节点</button>
      </div>
    </aside>
  )
}

/* ───────────────────────── 视图 3：时间线剪辑合成 & 剪映专业版草稿导出 ───────────────────────── */

function TimelineView({ project, onError, onNotify }: {
  project: ProjectWithHistory
  onError: (m: string) => void
  onNotify: (m: string) => void
}): ReactNode {
  const clips = project.timeline?.clips ?? []
  const videoNodes = project.nodes.filter(n => n.type === 'video' && n.url)
  const audioNodes = project.nodes.filter(n => n.type === 'audio' && n.url)
  const [busy, setBusy] = useState<string | null>(null)
  const [draftRoot, setDraftRoot] = useState('')
  const [draftName, setDraftName] = useState('')
  const [draftResult, setDraftResult] = useState<{ draftDir: string; clipCount: number; captionCount: number } | null>(null)

  const saveClips = async (next: TimelineClip[]): Promise<void> => {
    try {
      await call(`/projects/${project.id}/timeline`, { method: 'PUT', body: { clips: next } })
    } catch (e) { onError((e as Error).message) }
  }

  const addAllCanvasVideos = async (): Promise<void> => {
    if (videoNodes.length === 0) { onError('画布上还没有已生成的视频节点'); return }
    const next: TimelineClip[] = [
      ...clips,
      ...videoNodes
        .filter(v => !clips.some(c => c.nodeId === v.id))
        .map(v => ({
          id: `clip_${v.id}`,
          nodeId: v.id,
          title: v.title ?? v.id,
          url: v.url!,
          durationMs: v.durationMs ?? 5000,
        })),
    ]
    await saveClips(next)
    onNotify('已导入画布上的全部视频节点')
  }

  const moveClip = async (idx: number, dir: -1 | 1): Promise<void> => {
    const target = idx + dir
    if (target < 0 || target >= clips.length) return
    const copy = [...clips]
    const [item] = copy.splice(idx, 1)
    copy.splice(target, 0, item)
    await saveClips(copy)
  }

  const removeClip = async (idx: number): Promise<void> => {
    await saveClips(clips.filter((_, i) => i !== idx))
  }

  const updateClipField = async (idx: number, patch: Partial<TimelineClip>): Promise<void> => {
    const copy = clips.map((c, i) => (i === idx ? { ...c, ...patch } : c))
    await saveClips(copy)
  }

  const renderMp4 = async (): Promise<void> => {
    setBusy('正在通过本地 FFmpeg 标准化并拼接合成完整 MP4 成片…')
    try {
      await call(`/projects/${project.id}/timeline/render`, { method: 'POST' })
      onNotify('FFmpeg 成片合成成功！可直接预览或下载')
    } catch (e) { onError((e as Error).message) } finally { setBusy(null) }
  }

  const exportJianying = async (): Promise<void> => {
    setBusy('正在打包视频素材并写入剪映专业版草稿…')
    try {
      const res = await call<{ draftDir: string; clipCount: number; captionCount: number }>(`/projects/${project.id}/timeline/export-jianying`, {
        method: 'POST',
        body: {
          ...(draftRoot.trim() ? { draftRoot: draftRoot.trim() } : {}),
          ...(draftName.trim() ? { draftName: draftName.trim() } : {}),
        },
      })
      setDraftResult(res)
      onNotify(`剪映草稿导出成功（${res.clipCount} 段视频，${res.captionCount} 条字幕）`)
    } catch (e) { onError((e as Error).message) } finally { setBusy(null) }
  }

  const totalMs = clips.reduce((acc, c) => acc + (c.durationMs || 5000), 0)
  const totalSec = (totalMs / 1000).toFixed(1)

  return (
    <div className={css.panelScroll}>
      <div className={css.panelInner}>
        <div className={css.timelineLayout}>
          {/* 轨道区（全屏居左 / 分屏位于监视器下方） */}
          <div className={`${css.sectionCard} ${css.timelineTracksCol}`}>
            <div className={css.sectionHead}>
              <div className={css.sectionTitle}>
                <span>多轨时间线编排</span>
                <span className={css.badge}>{clips.length} 片段 · {totalSec}s</span>
                {busy && <span className={css.badgeAccent}>{busy}</span>}
              </div>
              <div className={css.actions}>
                <button type="button" className={css.btn} onClick={() => void addAllCanvasVideos()}>
                  ＋ 导入画布视频 ({videoNodes.length})
                </button>
                {clips.length > 0 && (
                  <button type="button" className={css.btnDanger} onClick={() => void saveClips([])}>清空</button>
                )}
              </div>
            </div>

            {/* 可视化等比例时间轴胶片条 */}
            {clips.length > 0 && (
              <div className={css.filmstripBar} title="各分段视频时长占比可视化时间轴">
                {clips.map((c, i) => (
                  <div
                    key={c.id}
                    className={css.filmstripSeg}
                    style={{ flexGrow: Math.max(1, c.durationMs || 5000) }}
                    title={`#${i + 1} ${c.title} (${((c.durationMs || 5000) / 1000).toFixed(1)}s)`}
                  >
                    <span>#{i + 1} · {((c.durationMs || 5000) / 1000).toFixed(1)}s</span>
                    {c.audioUrl && <span className={css.filmstripAudioDot} title="已绑定配音音轨" />}
                  </div>
                ))}
              </div>
            )}

            {clips.length === 0 ? (
              <div className={css.dim}>
                时间线为空。可在「短剧分镜台」一键合成整集推送，或点击上方「导入画布视频」。
              </div>
            ) : (
              clips.map((clip, idx) => (
                <div key={clip.id} className={css.clipRow}>
                  <div className={css.clipThumbWrap}>
                    <video className={css.clipThumb} src={clip.url} muted playsInline />
                    <span className={css.shotThumbBadge}>#{idx + 1}</span>
                  </div>
                  <div className={css.clipInfo}>
                    <div className={css.clipTopLine}>
                      <b className={css.clipTitle}>{clip.title}</b>
                      <span className={css.badge}>{((clip.durationMs || 5000) / 1000).toFixed(1)}s</span>
                      <div className={css.shotMiniBtns}>
                        <button type="button" className={css.miniBtn} disabled={idx === 0} onClick={() => void moveClip(idx, -1)}>↑</button>
                        <button type="button" className={css.miniBtn} disabled={idx === clips.length - 1} onClick={() => void moveClip(idx, 1)}>↓</button>
                        <button type="button" className={css.miniBtnDanger} onClick={() => void removeClip(idx)}>×</button>
                      </div>
                    </div>
                    <div className={css.clipFieldRow}>
                      <input
                        className={css.clipInlineInput}
                        defaultValue={clip.caption ?? ''}
                        placeholder="台词/旁白字幕（自动写入 SRT 与剪映字幕轨）…"
                        onBlur={e => {
                          if (e.target.value !== (clip.caption ?? '')) void updateClipField(idx, { caption: e.target.value })
                        }}
                      />
                      <select
                        className={css.clipAudioSelect}
                        value={clip.audioNodeId ?? ''}
                        onChange={e => {
                          const aNode = audioNodes.find(a => a.id === e.target.value)
                          void updateClipField(idx, { audioNodeId: aNode?.id, audioUrl: aNode?.url })
                        }}
                      >
                        <option value="">原声 / 静音轨</option>
                        {audioNodes.map(a => (
                          <option key={a.id} value={a.id}>🎙 {a.title ?? a.id}</option>
                        ))}
                      </select>
                    </div>
                    {clip.audioUrl && (
                      <audio src={clip.audioUrl} controls className={css.shotAudioPlayer} />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 监视器与剪映交付区（全屏居右 / 分屏优先置顶直出预览） */}
          <div className={css.timelineMonitorCol}>
            <div className={css.sectionCard}>
              <div className={css.sectionHead}>
                <div className={css.sectionTitle}>成片监视器 · FFmpeg 合成</div>
                <button type="button" className={css.btnPrimary} disabled={clips.length === 0 || busy !== null} onClick={() => void renderMp4()}>
                  合成 MP4 成片
                </button>
              </div>
              {project.timeline?.error && <div className={css.errText}>{project.timeline.error}</div>}
              {project.timeline?.outputUrl ? (
                <>
                  <video className={css.monitorVideo} src={project.timeline.outputUrl} controls playsInline />
                  <div className={css.actions}>
                    <a className={css.btnPrimary} href={project.timeline.outputUrl} download={`${project.title}-成片.mp4`}>下载成片 MP4</a>
                    {project.timeline.subtitleAssetUrl && (
                      <a className={css.btn} href={project.timeline.subtitleAssetUrl} download={`${project.title}.srt`}>下载 SRT 字幕</a>
                    )}
                  </div>
                </>
              ) : (
                <div className={css.dim}>
                  点击右上角「合成 MP4 成片」，系统将通过本地 FFmpeg 统一分辨率与帧率、混流配音并生成 SRT 字幕。
                </div>
              )}
              {project.timeline?.subtitleSrt && (
                <details className={css.srtDetails}>
                  <summary className={css.srtSummary}>展开查看 SRT 字幕轨道</summary>
                  <pre className={css.srtBox}>{project.timeline.subtitleSrt}</pre>
                </details>
              )}
            </div>

            <div className={css.sectionCard}>
              <div className={css.sectionHead}>
                <div className={css.sectionTitle}>剪映专业版草稿导出（JianyingPro）</div>
                <button type="button" className={css.btnPrimary} disabled={clips.length === 0 || busy !== null} onClick={() => void exportJianying()}>
                  一键导出到剪映
                </button>
              </div>
              <div className={css.gridRow}>
                <label className={css.field}>
                  草稿名称（可选）
                  <input value={draftName} onChange={e => setDraftName(e.target.value)} placeholder={`${project.title}-幕境草稿`} />
                </label>
                <label className={css.field}>
                  剪映草稿目录（留空写默认目录）
                  <input value={draftRoot} onChange={e => setDraftRoot(e.target.value)} placeholder="~/Movies/JianyingPro/.../com.lveditor.draft" />
                </label>
              </div>
              {draftResult && (
                <div className={css.tip} style={{ margin: 0 }}>
                  <div><b>✓ 导出完成：</b>写入 {draftResult.clipCount} 段视频、{draftResult.captionCount} 条字幕轨。</div>
                  <div style={{ wordBreak: 'break-all', marginTop: 4 }}>路径：<code>{draftResult.draftDir}</code></div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── dsh 插件装配注册 ───────────────────────── */

interface SlotsApi {
  inject(key: string, factory: () => unknown): unknown
  register(options: Record<string, unknown>, component: (props: never) => ReactNode): unknown
}

interface SidebarRightTabsApi {
  register(definition: {
    id: string
    kind: string
    keepMounted?: boolean
    title: (address: string) => string
    guide?: ReadonlyArray<{
      id: string
      order: number
      title: () => string
      description?: () => string
      icon?: (props: { size?: number }) => ReactNode
    }>
  }): () => void
}

interface SidebarRightApi {
  mounted: { getSnapshot(): string | undefined }
  openTab(kind: string): void
  isExpanded(): boolean
  toggleExpanded(): void
  active(): { id: string; kind: string } | undefined
}

interface LayoutApi {
  panelInfo: {
    getSnapshot(): { activePanelId: string | null }
    subscribe(listener: () => void): () => void
  }
  selectPanel(panelId: string | null): void
}

interface UiWorkspaceApi {
  openSession(target: string): void
  openWorkspace(workspaceId: string, beforeOpen?: (sessionId: string) => void): Promise<void>
  startSession(workspaceId?: string, options?: Record<string, unknown>): void
}

interface ShortcutsApi {
  readonly platform?: string
  readonly catalog?: {
    getSnapshot(): ReadonlyArray<{
      readonly id: string
      readonly binding?: {
        readonly code: string
        readonly modifiers: ReadonlyArray<string>
      } | null
    }>
  }
}

interface LocaleApi {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
  setLocale(id: string): void
}

interface ClientContext {
  slots: SlotsApi
  sidebarRightTabs: SidebarRightTabsApi
  sidebarRight: SidebarRightApi
  layout: LayoutApi
  uiWorkspace: UiWorkspaceApi
  shortcuts?: ShortcutsApi
  locale?: LocaleApi
  effect(fn: () => unknown, label?: string): void
}

function triggerDshSettingsDialog(shortcuts?: ShortcutsApi): void {
  // 1. 优先通过 DSH 注册的 settings.open 快捷键绑定（兼容自定义键位、账号菜单占位与所有平台）
  const entry = shortcuts?.catalog?.getSnapshot().find(item => item.id === 'settings.open')
  const isMac = shortcuts?.platform === 'macos' || /Mac|iPhone|iPad/i.test(navigator.platform)
  const mods = entry?.binding?.modifiers ?? ['primary', 'alt']
  const code = entry?.binding?.code ?? 'Comma'
  const ev = new KeyboardEvent('keydown', {
    code,
    key: code === 'Comma' ? ',' : code,
    metaKey: mods.includes('meta') || (mods.includes('primary') && isMac),
    ctrlKey: mods.includes('ctrl') || (mods.includes('primary') && !isMac),
    altKey: mods.includes('alt'),
    shiftKey: mods.includes('shift'),
    bubbles: true,
    cancelable: true,
  })
  window.dispatchEvent(ev)
  if (document.querySelector('[data-shortcut-modal="settings"]')) return

  // 2. 兜底：若本地模式未启用账号菜单，直接触发隐藏侧栏内的设置弹窗按钮
  const dshSidebar = document.querySelector(':has(> [data-shell-bottom]) > :has([data-sidebar-toggle])')
  const btn = dshSidebar?.querySelector('button[aria-haspopup="dialog"][aria-expanded]')
    ?? dshSidebar?.querySelector('button[aria-haspopup="dialog"]')
  if (btn instanceof HTMLButtonElement) btn.click()
}

export default {
  inject: ['slots', 'sidebarRightTabs', 'sidebarRight', 'layout', 'uiWorkspace', 'shortcuts', 'locale'],
  apply(ctx: ClientContext): void {
    let stayInStudioUntil = 0

    // 声明主语言为简体中文（zh-CN）：首次启动默认切至中文并同步 html[lang="zh-CN"]
    ctx.effect(() => {
      const prevLang = document.documentElement.lang
      const syncLang = (): void => {
        const active = ctx.locale?.getSnapshot().active
        if (!active || active === 'zh' || active.toLowerCase() === 'zh-cn') {
          document.documentElement.lang = 'zh-CN'
        }
      }
      try {
        const initKey = 'mujing.locale.initialized'
        if (ctx.locale && !window.localStorage.getItem(initKey)) {
          window.localStorage.setItem(initKey, 'zh-CN')
          const active = ctx.locale.getSnapshot().active
          if (active !== 'zh' && active.toLowerCase() !== 'zh-cn') {
            ctx.locale.setLocale('zh')
          }
        }
      } catch {}
      syncLang()
      const unsub = ctx.locale?.subscribe(syncLang)
      return () => {
        unsub?.()
        document.documentElement.lang = prevLang
      }
    }, 'mujing: default zh-CN locale')

    // 全局永久开启「幕境主应用外壳」模式（跨工作台 / 插件 / 会话永不退回 DSH 原布局）
    ctx.effect(() => {
      document.documentElement.dataset.mujingApp = '1'
      document.documentElement.dataset.mujingRail = getAppShellState().railCollapsed ? 'collapsed' : 'expanded'
      return () => {
        delete document.documentElement.dataset.mujingApp
        delete document.documentElement.dataset.mujingRail
        delete document.documentElement.dataset.mujingPanel
      }
    }, 'mujing: global app shell')

    // 在「幕境工作台内新建/切换 AI 导演会话」期间，拦截 uiWorkspace 切回默认对话页的行为
    ctx.effect(() => {
      return ctx.layout.panelInfo.subscribe(() => {
        if (Date.now() < stayInStudioUntil && ctx.layout.panelInfo.getSnapshot().activePanelId !== PANEL_ID) {
          queueMicrotask(() => {
            try { ctx.layout.selectPanel(PANEL_ID) } catch {}
          })
        }
      })
    }, 'mujing: stay in studio guard')

    // 注入全局跨模式导航桥（供常驻左侧栏、剧目广场、工具卡片与副驾抽屉调用）
    ctx.effect(() => {
      setStudioBridge({
        openSplit: () => {
          stayInStudioUntil = 0
          try { ctx.layout.selectPanel(null) } catch {}
          setTimeout(() => {
            if (ctx.sidebarRight.mounted.getSnapshot() !== undefined) {
              try { ctx.sidebarRight.openTab(STUDIO_TAB_KIND) } catch {}
            }
          }, 0)
        },
        toggleSplit: () => {
          if (ctx.sidebarRight.mounted.getSnapshot() === undefined) {
            try { ctx.layout.selectPanel(null) } catch {}
            return
          }
          const activeTab = ctx.sidebarRight.active()
          if (ctx.sidebarRight.isExpanded() && activeTab?.kind === STUDIO_TAB_KIND) {
            ctx.sidebarRight.toggleExpanded()
          } else {
            try { ctx.sidebarRight.openTab(STUDIO_TAB_KIND) } catch {}
          }
        },
        openFullscreen: () => {
          try { ctx.layout.selectPanel(PANEL_ID) } catch {}
        },
        openClassicChat: () => {
          stayInStudioUntil = 0
          try { ctx.layout.selectPanel(null) } catch {}
          setTimeout(() => {
            try {
              if (ctx.sidebarRight.isExpanded() && ctx.sidebarRight.active()?.kind === STUDIO_TAB_KIND) {
                ctx.sidebarRight.toggleExpanded()
              }
            } catch {}
          }, 40)
        },
        openPlugins: () => {
          stayInStudioUntil = 0
          try { ctx.layout.selectPanel('plugins') } catch {}
        },
        openSettings: () => {
          triggerDshSettingsDialog(ctx.shortcuts)
        },
        newDirectorSession: () => {
          stayInStudioUntil = Date.now() + 2500
          try { ctx.uiWorkspace.startSession() } catch {}
          queueMicrotask(() => {
            try { ctx.layout.selectPanel(PANEL_ID) } catch {}
          })
        },
        newChatSession: () => {
          stayInStudioUntil = 0
          try { ctx.uiWorkspace.startSession() } catch {}
        },
        openSessionInStudio: (sessionId: string) => {
          stayInStudioUntil = Date.now() + 2500
          try { ctx.uiWorkspace.openSession(sessionId) } catch {}
          queueMicrotask(() => {
            try { ctx.layout.selectPanel(PANEL_ID) } catch {}
          })
        },
        openSessionInChat: (sessionId: string) => {
          stayInStudioUntil = 0
          try { ctx.uiWorkspace.openSession(sessionId) } catch {}
        },
        isSplitOpen: () => ctx.sidebarRight.isExpanded() && ctx.sidebarRight.active()?.kind === STUDIO_TAB_KIND,
        isStudioActive: () => ctx.layout.panelInfo.getSnapshot().activePanelId === PANEL_ID,
      })
      return () => setStudioBridge(null)
    }, 'mujing: navigation bridge')

    // 1. 幕境独立工作台主入口（含内置 AI 导演副驾子槽） + 启动自动直达幕境工作台
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist', id: PANEL_ID, order: 1, label: '幕境工作台',
    }, NavIcon as (props: never) => ReactNode))

    ctx.slots.inject('main', () => {
      const disposeMain = ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        children: {
          'mujing.director.chat': {
            kind: 'single',
            scope: 'session-maybe',
            inject: () => ({
              openWorkspace: (workspaceId: string, beforeOpen?: (sessionId: string) => void) =>
                ctx.uiWorkspace.openWorkspace(workspaceId, beforeOpen),
            }),
          },
        },
      }, FullscreenStudioPage as unknown as (props: never) => ReactNode)

      // 启动完成后直接进入幕境 AI 影视工作台
      queueMicrotask(() => {
        try {
          if (ctx.layout.panelInfo.getSnapshot().activePanelId === null) {
            ctx.layout.selectPanel(PANEL_ID)
          }
        } catch {}
      })

      return disposeMain
    })

    ctx.slots.inject('mujing.director.chat', () => ctx.slots.register({
      name: 'mujing.director.chat',
    }, MujingDirectorChat as unknown as (props: never) => ReactNode))

    // 2. 常驻全局左侧导航栏（挂载于 shell.overlay，跨 幕境工作台 / 技能与插件 / 导演会话 永不卸载）
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'mujing.app.rail',
      order: 10,
    }, MujingAppRail as unknown as (props: never) => ReactNode))

    // 3. 本地运行时下弱化 DSH 品牌，将辅助视图也统一为「幕境 · Mujing」品牌标识
    ctx.slots.inject('sidebar.brand.mark', () => {
      try {
        return ctx.slots.register({ name: 'sidebar.brand.mark' }, MujingBrandMark as unknown as (props: never) => ReactNode)
      } catch {
        return undefined
      }
    })
    ctx.slots.inject('sidebar.brand.name', () => {
      try {
        return ctx.slots.register({ name: 'sidebar.brand.name' }, MujingBrandName as unknown as (props: never) => ReactNode)
      } catch {
        return undefined
      }
    })
    ctx.slots.inject('conversation.hero.brand.mark', () => {
      try {
        return ctx.slots.register({ name: 'conversation.hero.brand.mark' }, MujingBrandMark as unknown as (props: never) => ReactNode)
      } catch {
        return undefined
      }
    })

    // 4. 保留 DSH 右侧停靠分屏工作台（用户在原生会话视图仍可随时开启左右分屏）
    ctx.effect(() => ctx.sidebarRightTabs.register({
      id: STUDIO_TAB_ID,
      kind: STUDIO_TAB_KIND,
      keepMounted: true,
      title: () => '幕境影视工作台',
      guide: [{
        id: 'mujing-studio-guide',
        order: 5,
        title: () => '幕境 AI 影视工作台',
        description: () => '角色三视图锁定 · 分镜故事板与配音 · 尾帧接续生视频 · 剪映草稿导出',
        icon: NavIcon,
      }],
    }), 'mujing: right-sidebar tab definition')

    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: STUDIO_TAB_ID,
    }, RightSidebarStudioPane as (props: never) => ReactNode)), 'mujing: right-sidebar tab body')

    // 5. 原生会话顶栏快捷按钮 + 空白会话样板启动条
    ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
      name: 'conversation.session.header.actions', id: 'mujing.header.studio', order: 25,
    }, SessionHeaderStudioButton as (props: never) => ReactNode))

    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
      name: 'conversation.input.dock', id: 'mujing.starter.dock', order: 15,
    }, MujingStarterDock as unknown as (props: never) => ReactNode))

    // 6. 12 个「幕境导演」工具的富媒体对话卡片渲染器（在嵌入式 AI 导演抽屉和原生会话中均生效）
    ctx.slots.inject('tool.call.toolview', () =>
      MUJING_TOOL_NAMES.map(toolName =>
        ctx.slots.register(
          { name: 'tool.call.toolview', key: toolName },
          MujingToolCard as unknown as (props: never) => ReactNode,
        ),
      ),
    )
  },
}
export type { RawToolViewProps, StarterDockProps }
