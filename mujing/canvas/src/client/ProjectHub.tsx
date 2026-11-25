import { useState, type ReactNode } from "react"
import type { ProjectSummary } from "../host/types.ts"
import { STRATEGY_LABEL, STYLE_PRESETS } from "./constants.ts"
import { openMediaConfigModal, STARTER_TEMPLATES, type MediaKind, type MediaStatus, type StarterTemplate, type WorkspaceTab } from "./studio-bus.ts"
import css from "./style.css"

/* ───────────────────────── 剧目广场（幕境独立首页 / 一键模板开拍） ───────────────────────── */

export function ProjectHub({
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

export function CreateProjectModal({ onClose, onImport, onSubmit }: {
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

