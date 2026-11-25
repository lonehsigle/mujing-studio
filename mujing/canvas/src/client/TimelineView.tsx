import { useState, type ReactNode } from "react"
import type { TimelineClip } from "../host/types.ts"
import { call, type ProjectWithHistory } from "./studio-bus.ts"
import css from "./style.css"

/* ───────────────────────── 视图 3：时间线剪辑合成 & 剪映专业版草稿导出 ───────────────────────── */

export function TimelineView({ project, onError, onNotify }: {
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
  const [draftResult, setDraftResult] = useState<{
    draftDir: string
    clipCount: number
    audioCount?: number
    captionCount: number
    writtenToDisk?: boolean
    reason?: string
  } | null>(null)
  const burnSubtitles = Boolean(project.timeline?.burnSubtitles)

  const saveClips = async (next: TimelineClip[], nextBurn?: boolean): Promise<void> => {
    try {
      await call(`/projects/${project.id}/timeline`, {
        method: 'PUT',
        body: {
          clips: next,
          ...(nextBurn !== undefined ? { burnSubtitles: nextBurn } : {}),
        },
      })
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
      const res = await call<{
        draftDir: string
        clipCount: number
        audioCount?: number
        captionCount: number
        writtenToDisk: boolean
        reason?: string
      }>(`/projects/${project.id}/timeline/export-jianying`, {
        method: 'POST',
        body: {
          ...(draftRoot.trim() ? { draftRoot: draftRoot.trim() } : {}),
          ...(draftName.trim() ? { draftName: draftName.trim() } : {}),
        },
      })
      setDraftResult(res)
      if (!res.writtenToDisk) {
        onError(`剪映草稿未写入本机磁盘：${res.reason ?? '请填写与当前服务器操作系统匹配的绝对路径'}`)
      } else {
        const audioPart = res.audioCount ? `、${res.audioCount} 条配音` : ''
        onNotify(`剪映草稿导出成功（${res.clipCount} 段视频${audioPart}，${res.captionCount} 条字幕）`)
      }
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
                <div className={css.actions}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={burnSubtitles}
                      onChange={e => void saveClips(clips, e.target.checked)}
                    />
                    硬烧录字幕
                  </label>
                  <button type="button" className={css.btnPrimary} disabled={clips.length === 0 || busy !== null} onClick={() => void renderMp4()}>
                    合成 MP4 成片
                  </button>
                </div>
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
                  剪映草稿目录（留空写当前系统默认目录）
                  <input value={draftRoot} onChange={e => setDraftRoot(e.target.value)} placeholder="留空自动使用本机剪映草稿目录（支持 macOS / Windows）" />
                </label>
              </div>
              {draftResult && (
                <div className={draftResult.writtenToDisk === false ? css.errText : css.tip} style={{ margin: 0 }}>
                  {draftResult.writtenToDisk === false ? (
                    <div><b>⚠ 未写入磁盘：</b>{draftResult.reason ?? '目标路径与服务器操作系统不匹配，请检查草稿目录格式。'}</div>
                  ) : (
                    <div>
                      <b>✓ 导出完成：</b>写入 {draftResult.clipCount} 段视频
                      {draftResult.audioCount ? `、${draftResult.audioCount} 条配音轨` : ''}
                      、{draftResult.captionCount} 条字幕轨。
                    </div>
                  )}
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

