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
  type ReactNode,
} from 'react'
import type {
  CanvasProject,
  ProjectSummary,
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
  STUDIO_TAB_ID,
  STUDIO_TAB_KIND,
  subscribeAppShell,
  subscribeStudioIntent,
  summarizeProject,
  triggerAppImport,
  updateMediaStatus,
  upsertAppProjectSummary,
  type AppShellSnapshot,
  type MediaKind,
  type MediaStatus,
  type ProjectWithHistory,
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

import { BoardView } from "./BoardView.tsx"
import { DramaView } from "./DramaView.tsx"
import { MediaConfigModal } from "./MediaConfigModal.tsx"
import { CreateProjectModal, ProjectHub } from "./ProjectHub.tsx"
import { TimelineView } from "./TimelineView.tsx"
import { STRATEGY_LABEL } from "./constants.ts"

function useAppShell(): AppShellSnapshot {
  return useSyncExternalStore(subscribeAppShell, getAppShellState, getAppShellState)
}

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
      const r = await call<{ changed?: boolean; undone?: boolean; project: ProjectWithHistory; history: { canUndo: boolean; canRedo: boolean } }>(`/projects/${project.id}/undo`, { method: 'POST' })
      if (r.changed ?? r.undone) setProject({ ...r.project, history: r.history })
    } catch (e) { setErr((e as Error).message) }
  }, [project])

  const redo = useCallback(async (): Promise<void> => {
    if (!project) return
    try {
      const r = await call<{ changed?: boolean; redone?: boolean; project: ProjectWithHistory; history: { canUndo: boolean; canRedo: boolean } }>(`/projects/${project.id}/redo`, { method: 'POST' })
      if (r.changed ?? r.redone) setProject({ ...r.project, history: r.history })
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

