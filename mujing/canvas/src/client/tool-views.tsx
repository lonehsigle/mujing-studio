import { useEffect, useState, type ReactNode } from 'react'
import {
  emitStudioIntent,
  getStudioBridge,
  STARTER_TEMPLATES,
  type StarterTemplate,
  type WorkspaceTab,
} from './studio-bus.ts'
import css from './style.css'

/* ───────────────────────── 对话快速启动模板（空白会话与 AI 导演副驾快速开拍条） ───────────────────────── */

export interface StarterDockProps {
  session?: { blank?: boolean; awaitingFirstTurn?: boolean; running?: boolean }
  input?: { draft?: string; phase?: string }
  inputActions?: { setDraft: (text: string) => void; submit: () => void }
}

export function MujingStarterDock({ session, input, inputActions }: StarterDockProps): ReactNode {
  const [dismissed, setDismissed] = useState(false)
  const isBlank = Boolean(session?.blank || session?.awaitingFirstTurn)
  const isRunning = Boolean(session?.running) || (input?.phase !== undefined && input.phase !== 'plain')

  if (dismissed || !isBlank || !inputActions) return null

  const inStudio = Boolean(getStudioBridge()?.isStudioActive())

  const triggerStarter = (item: StarterTemplate): void => {
    if (isRunning) return
    emitStudioIntent({ tab: item.tab, openSplit: !inStudio })
    inputActions.setDraft(item.prompt)
    setTimeout(() => {
      try { inputActions.submit() } catch {}
    }, 30)
  }

  return (
    <div className={css.starterDock}>
      <div className={css.starterHead}>
        <span className={css.starterBrand}>🎬 {inStudio ? 'AI 导演 · 一键开拍样板' : '幕境 AI 影视导演工坊 · 一键开拍样板'}</span>
        <div className={css.starterHeadRight}>
          {!inStudio && (
            <button
              type="button"
              className={css.starterStudioBtn}
              onClick={() => emitStudioIntent({ tab: 'drama', openFullscreen: true })}
            >
              进入幕境工作台
            </button>
          )}
          <button
            type="button"
            className={css.starterClose}
            title="收起样板推荐"
            onClick={() => setDismissed(true)}
          >
            ×
          </button>
        </div>
      </div>
      <div className={css.starterGrid}>
        {STARTER_TEMPLATES.map(item => (
          <button
            key={item.id}
            type="button"
            disabled={isRunning}
            className={css.starterCard}
            onClick={() => triggerStarter(item)}
          >
            <span className={css.starterBadge}>{item.badge}</span>
            <span className={css.starterTitle}>{item.title}</span>
            <span className={css.starterDesc}>{item.desc}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ───────────────────────── 会话顶栏工作台入口（DSH 经典对话视图可见） ───────────────────────── */

export function SessionHeaderStudioButton(): ReactNode {
  return (
    <div className={css.headerActionGroup}>
      <button
        type="button"
        className={css.headerStudioBtn}
        title="返回幕境 AI 影视主工作台"
        onClick={() => emitStudioIntent({ openFullscreen: true })}
      >
        <span className={css.headerStudioDot} />
        <span>返回幕境工作台</span>
      </button>
      <button
        type="button"
        className={css.headerFullBtn}
        title="在当前对话右侧展开/折叠幕境分屏工作台"
        onClick={() => {
          const bridge = getStudioBridge()
          if (bridge) bridge.toggleSplit()
        }}
      >
        分屏
      </button>
    </div>
  )
}

/* ───────────────────────── 12 个幕境导演工具的富媒体对话卡片 ───────────────────────── */

export const MUJING_TOOL_NAMES = [
  'canvas_list_projects',
  'canvas_create_project',
  'canvas_get_state',
  'canvas_apply_ops',
  'generate_media',
  'drama_save_plan',
  'drama_generate_casts',
  'drama_generate_shot_media',
  'drama_run_episode',
  'timeline_compose',
  'timeline_export_jianying',
  'media_status',
] as const

const TOOL_META: Record<string, { label: string; badge: string; tab: WorkspaceTab }> = {
  canvas_list_projects: { label: '读取幕境项目列表', badge: '项目管理', tab: 'drama' },
  canvas_create_project: { label: '创建影视短剧工程', badge: '新建工程', tab: 'drama' },
  canvas_get_state: { label: '同步画布与剧本快照', badge: '状态快照', tab: 'canvas' },
  canvas_apply_ops: { label: '编排无限画布节点与连线', badge: '画布编排', tab: 'canvas' },
  generate_media: { label: '多模态资产生成', badge: '媒体生成', tab: 'canvas' },
  drama_save_plan: { label: '拆解分集剧本与角色资产表', badge: '剧本分镜', tab: 'drama' },
  drama_generate_casts: { label: '生成并锁定角色/场景三视图', badge: '资产锁定', tab: 'drama' },
  drama_generate_shot_media: { label: '生成分镜关键帧 / 角色配音', badge: '故事板精修', tab: 'drama' },
  drama_run_episode: { label: '尾帧接续生视频 & 成片合成', badge: '连续出片', tab: 'drama' },
  timeline_compose: { label: 'FFmpeg 多轨混流合成成片', badge: '时间线合成', tab: 'timeline' },
  timeline_export_jianying: { label: '导出剪映专业版工程草稿', badge: '剪映导出', tab: 'timeline' },
  media_status: { label: '检查多模态生成引擎配置', badge: '引擎自检', tab: 'drama' },
}

function safeParseJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const val = JSON.parse(raw) as unknown
    return typeof val === 'object' && val !== null && !Array.isArray(val) ? (val as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export interface RawToolViewProps {
  toolName: string
  phase: 'preparing' | 'start' | 'result'
  block: {
    kind?: string
    isError?: boolean
    error?: { name?: string; code?: string; message?: string }
    argsRaw?: string
    call?: { argsRaw?: string }
    content?: ReadonlyArray<{ type: string; text?: string }>
  }
  inspect?: () => void
}

export function MujingToolCard(props: RawToolViewProps): ReactNode {
  const { toolName, phase, block, inspect } = props
  const [showRaw, setShowRaw] = useState(false)
  const meta = TOOL_META[toolName] ?? { label: toolName, badge: '幕境工具', tab: 'drama' as WorkspaceTab }

  const settled = phase === 'result' || 'kind' in block
  const isError = settled && Boolean(block.isError || block.error)
  const isRunning = !settled

  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  const argsObj = safeParseJson(argsRaw)
  const resultText = settled && Array.isArray(block.content)
    ? block.content.map(c => (c.type === 'text' ? (c.text ?? '') : JSON.stringify(c))).join('\n')
    : ''
  const resultObj = safeParseJson(resultText)

  const projectId = (typeof resultObj?.project_id === 'string' ? resultObj.project_id : undefined)
    ?? (typeof argsObj?.project_id === 'string' ? argsObj.project_id : undefined)

  // 当导演在对话中创建或更新项目时，自动通知右侧工作台刷新列表并聚焦该项目
  useEffect(() => {
    if (settled && !isError && (toolName === 'canvas_create_project' || toolName === 'drama_save_plan')) {
      emitStudioIntent({
        projectId,
        tab: meta.tab,
        reloadProjects: true,
      })
    }
  }, [settled, isError, toolName, projectId, meta.tab])

  const openInStudio = (targetTab: WorkspaceTab = meta.tab): void => {
    emitStudioIntent({ projectId, tab: targetTab, openSplit: true, reloadProjects: true })
  }

  return (
    <div className={css.toolCard} data-tool={toolName} data-state={isRunning ? 'running' : isError ? 'error' : 'ok'}>
      <div className={css.toolCardHead}>
        <span className={isRunning ? css.toolDotRun : isError ? css.toolDotErr : css.toolDotOk} />
        <span className={css.toolBadge}>{meta.badge}</span>
        <span className={css.toolTitle}>{meta.label}</span>
        <span className={css.toolStatusText}>
          {isRunning ? '执行中…' : isError ? '异常' : '完成'}
        </span>
        <div className={css.toolHeadBtns}>
          <button type="button" className={css.toolActionBtn} onClick={() => openInStudio(meta.tab)}>
            查看 ↗
          </button>
          {(resultText || argsRaw) && (
            <button type="button" className={css.toolGhostBtn} onClick={() => setShowRaw(v => !v)}>
              {showRaw ? '收起' : '参数'}
            </button>
          )}
          {inspect && (
            <button type="button" className={css.toolGhostBtn} onClick={inspect}>
              轨迹
            </button>
          )}
        </div>
      </div>

      <ToolCardSummary
        toolName={toolName}
        isRunning={isRunning}
        isError={isError}
        argsObj={argsObj}
        resultObj={resultObj}
        errorText={block.error?.message ?? resultText}
        onOpenTab={openInStudio}
      />

      {showRaw && (
        <pre className={css.toolRawBox}>
          {argsRaw ? `// 调用参数\n${argsRaw}\n\n` : ''}
          {resultText ? `// 返回结果\n${resultText}` : ''}
        </pre>
      )}
    </div>
  )
}

function ToolCardSummary({
  toolName,
  isRunning,
  isError,
  argsObj,
  resultObj,
  errorText,
  onOpenTab,
}: {
  toolName: string
  isRunning: boolean
  isError: boolean
  argsObj: Record<string, unknown> | null
  resultObj: Record<string, unknown> | null
  errorText: string
  onOpenTab: (t: WorkspaceTab) => void
}): ReactNode {
  if (isError) {
    return <div className={css.toolErrBody}>{errorText || '工具调用返回错误'}</div>
  }

  if (toolName === 'canvas_create_project') {
    const title = (resultObj?.title as string | undefined) ?? (argsObj?.title as string | undefined) ?? '新剧目'
    return (
      <div className={css.toolBodyRow}>
        <span>已建立短剧/画布工程：<b>《{title}》</b></span>
        {resultObj?.project_id ? <code className={css.toolCode}>{String(resultObj.project_id)}</code> : null}
      </div>
    )
  }

  if (toolName === 'drama_save_plan') {
    const eps = Array.isArray(resultObj?.episodes) ? (resultObj.episodes as Array<Record<string, unknown>>) : []
    const castCount = typeof resultObj?.cast_count === 'number'
      ? resultObj.cast_count
      : Array.isArray(argsObj?.casts) ? argsObj.casts.length : 0
    const style = typeof argsObj?.style === 'string' ? argsObj.style : ''
    const ratio = typeof argsObj?.aspect_ratio === 'string' ? argsObj.aspect_ratio : '9:16'
    return (
      <div className={css.toolBodyCol}>
        <div className={css.toolPills}>
          <span className={css.toolPill}>画幅 {ratio}</span>
          <span className={css.toolPill}>角色/场景卡 {castCount} 个</span>
          <span className={css.toolPill}>共 {eps.length || (Array.isArray(argsObj?.episodes) ? argsObj.episodes.length : 0)} 集</span>
        </div>
        {style && <div className={css.toolDimLine}>美术基准：{style}</div>}
        {eps.map((ep, idx) => (
          <div key={idx} className={css.toolEpRow}>
            <b>第 {String(ep.number ?? idx + 1)} 集《{String(ep.title ?? '')}》</b>
            <span>{String(ep.shot_count ?? 0)} 个分镜 → 聚合为 {String(ep.segment_count ?? 0)} 段连续视频</span>
          </div>
        ))}
      </div>
    )
  }

  if (toolName === 'drama_generate_casts') {
    const list = Array.isArray(resultObj?.generated) ? (resultObj.generated as Array<Record<string, unknown>>) : []
    if (isRunning && list.length === 0) {
      return <div className={css.toolDimLine}>正在并行渲染角色三视图与常驻场景锚点图，并写入一致性锁定池…</div>
    }
    return (
      <div className={css.toolMediaGrid}>
        {list.map((item, idx) => {
          const ok = typeof item.url === 'string' && item.url.length > 0 && !item.error
          return (
            <div key={idx} className={css.toolMediaTile}>
              {ok ? (
                <img src={String(item.url)} alt={String(item.name ?? '')} className={css.toolThumbImg} />
              ) : (
                <div className={css.toolThumbPlaceholder}>{String(item.error ?? '未出图')}</div>
              )}
              <div className={css.toolTileCap}>
                <b>{String(item.name ?? '')}</b>
                {ok ? (
                  <span className={css.badgeOk}>已锁定</span>
                ) : (
                  <span className={css.toolStatusText} style={{ color: '#e11d48' }}>生成失败</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (toolName === 'drama_generate_shot_media') {
    const kind = (resultObj?.kind ?? argsObj?.kind) === 'audio' ? 'audio' : 'keyframe'
    const list = Array.isArray(resultObj?.generated) ? (resultObj.generated as Array<Record<string, unknown>>) : []
    if (isRunning && list.length === 0) {
      return (
        <div className={css.toolDimLine}>
          正在生成第 {String(argsObj?.episode ?? 1)} 集{kind === 'audio' ? '角色台词 TTS 语音轨' : '故事板关键帧画面'}…
        </div>
      )
    }
    return (
      <div className={css.toolMediaGrid}>
        {list.map((item, idx) => (
          <div key={idx} className={css.toolMediaTile}>
            {kind === 'keyframe' && typeof item.url === 'string' ? (
              <img src={item.url} alt={`镜${String(item.shotNumber ?? idx + 1)}`} className={css.toolThumbImg} />
            ) : kind === 'audio' && typeof item.url === 'string' ? (
              <audio src={item.url} controls className={css.toolAudio} />
            ) : (
              <div className={css.toolThumbPlaceholder}>{String(item.error ?? '处理完成')}</div>
            )}
            <div className={css.toolTileCap}>
              <span>镜 #{String(item.shotNumber ?? idx + 1)} {kind === 'audio' ? '配音' : '关键帧'}</span>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (toolName === 'drama_run_episode') {
    const segs = Array.isArray(resultObj?.segments) ? (resultObj.segments as Array<Record<string, unknown>>) : []
    const finalUrl = typeof resultObj?.final_video_url === 'string' ? resultObj.final_video_url : undefined
    if (isRunning && segs.length === 0) {
      return (
        <div className={css.toolDimLine}>
          正在按序执行第 {String(argsObj?.episode ?? 1)} 集连续视频生成（自动抽取上一段尾帧作为下一段首帧 + 注入锁定角色参考图）…
        </div>
      )
    }
    return (
      <div className={css.toolBodyCol}>
        {finalUrl && (
          <div className={css.toolFinalVideoBox}>
            <div className={css.toolBodyRow}>
              <span className={css.badgeOk}>整集成片已由 FFmpeg 自动合成</span>
              <button type="button" className={css.toolActionBtn} onClick={() => onOpenTab('timeline')}>
                打开时间线与导出剪映 ↗
              </button>
            </div>
            <video src={finalUrl} controls playsInline className={css.toolVideoPlayer} />
          </div>
        )}
        {segs.length > 0 && (
          <div className={css.toolMediaGrid}>
            {segs.map((s, idx) => {
              const previewUrl = typeof s.videoUrl === 'string' ? s.videoUrl : typeof s.url === 'string' ? s.url : undefined
              return (
                <div key={idx} className={css.toolMediaTile}>
                  {previewUrl ? (
                    <video src={previewUrl} controls muted playsInline className={css.toolThumbVideo} />
                  ) : (
                    <div className={css.toolThumbPlaceholder}>{String(s.error ?? s.status ?? '待生成')}</div>
                  )}
                  <div className={css.toolTileCap}>
                    <span>分段 S{Number(s.index ?? idx) + 1}</span>
                    <span>{s.status === 'success' ? '✓ 已接续' : String(s.status ?? '')}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  if (toolName === 'generate_media') {
    const kind = String(argsObj?.kind ?? 'image')
    const url = typeof resultObj?.url === 'string' ? resultObj.url : undefined
    const title = typeof argsObj?.title === 'string' ? argsObj.title : kind === 'video' ? '生成视频节点' : kind === 'audio' ? '生成配音节点' : '生成图片节点'
    if (isRunning || !url) {
      return <div className={css.toolDimLine}>{title}：{String(argsObj?.prompt ?? '').slice(0, 90)}</div>
    }
    return (
      <div className={css.toolBodyCol}>
        <div className={css.toolDimLine}><b>{title}</b> · 节点 <code>{String(resultObj?.node_id ?? '')}</code></div>
        {kind === 'image' && <img src={url} alt={title} className={css.toolSingleImg} />}
        {kind === 'video' && <video src={url} controls muted playsInline className={css.toolVideoPlayer} />}
        {kind === 'audio' && <audio src={url} controls className={css.toolAudio} />}
      </div>
    )
  }

  if (toolName === 'timeline_compose') {
    const outUrl = typeof resultObj?.output_url === 'string' ? resultObj.output_url : undefined
    return (
      <div className={css.toolBodyCol}>
        <div className={css.toolBodyRow}>
          <span>时间线共 {String(resultObj?.clip_count ?? 0)} 段素材{resultObj?.has_srt ? ' · 已生成 SRT 字幕' : ''}</span>
        </div>
        {outUrl && <video src={outUrl} controls playsInline className={css.toolVideoPlayer} />}
      </div>
    )
  }

  if (toolName === 'timeline_export_jianying') {
    const draftDir = typeof resultObj?.draftDir === 'string' ? resultObj.draftDir : ''
    const written = resultObj?.writtenToDisk !== false
    const audioCount = Number(resultObj?.audioCount ?? 0)
    return (
      <div className={css.toolBodyCol}>
        <div>
          {written ? (
            <>
              已生成剪映专业版草稿：写入 <b>{String(resultObj?.clipCount ?? 0)}</b> 段视频轨
              {audioCount > 0 ? <>、<b>{audioCount}</b> 条配音轨</> : null}、<b>{String(resultObj?.captionCount ?? 0)}</b> 条字幕轨。
            </>
          ) : (
            <span style={{ color: '#d97706' }}>
              草稿结构已生成，但未写入本机磁盘：{String(resultObj?.reason ?? '目标目录路径与服务器操作系统不匹配')}
            </span>
          )}
        </div>
        {draftDir && <code className={css.toolCode}>{draftDir}</code>}
      </div>
    )
  }

  if (toolName === 'canvas_apply_ops') {
    const opsCount = Array.isArray(argsObj?.ops) ? argsObj.ops.length : 0
    return (
      <div className={css.toolDimLine}>
        已原子执行 {opsCount} 项画布节点/连线变更（当前画布共 {String(resultObj?.node_count ?? '—')} 个节点）。
      </div>
    )
  }

  return null
}
