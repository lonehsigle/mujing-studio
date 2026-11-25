import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import type { CanvasNode, CanvasProject, NodeType } from "../host/types.ts"
import { LF, STATUS_LABEL, TYPE_LABEL, VOICES } from "./constants.ts"
import { call, uploadLocalFile, type ProjectWithHistory } from "./studio-bus.ts"
import css from "./style.css"

/* ───────────────────────── 视图 2：无限画布（支持图/视/音/文本 + 本地上传拖拽） ───────────────────────── */

type Drag =
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number }
  | { kind: 'node'; id: string; sx: number; sy: number; nx: number; ny: number; moved: boolean }
  | { kind: 'link'; source: string; x: number; y: number }

export function BoardView({ project, onError, onNotify }: {
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

  const pos = useCallback((n: CanvasNode): { x: number; y: number } => local[n.id] ?? n, [local])
  const byId = useMemo(() => new Map(project.nodes.map(n => [n.id, n])), [project.nodes])
  const selectedNode = selected !== null ? byId.get(selected) : undefined

  // 动态计算连线 SVG 包围盒，避免节点拖到负坐标或超过 8000px 时连线被裁剪
  const linkDragX = drag?.kind === 'link' ? drag.x : null
  const linkDragY = drag?.kind === 'link' ? drag.y : null
  const svgBounds = useMemo(() => {
    let minX = 0
    let minY = 0
    let maxX = 2000
    let maxY = 1400
    for (const n of project.nodes) {
      const p = local[n.id] ?? n
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x + n.width > maxX) maxX = p.x + n.width
      if (p.y + n.height > maxY) maxY = p.y + n.height
    }
    if (linkDragX !== null && linkDragY !== null) {
      if (linkDragX < minX) minX = linkDragX
      if (linkDragY < minY) minY = linkDragY
      if (linkDragX > maxX) maxX = linkDragX
      if (linkDragY > maxY) maxY = linkDragY
    }
    const pad = 400
    const left = Math.floor(minX - pad)
    const top = Math.floor(minY - pad)
    const width = Math.max(800, Math.ceil(maxX - minX + pad * 2))
    const height = Math.max(600, Math.ceil(maxY - minY + pad * 2))
    return { left, top, width, height }
  }, [project.nodes, local, linkDragX, linkDragY])

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
          <svg
            className={css.edges}
            style={{ left: svgBounds.left, top: svgBounds.top, overflow: 'visible' }}
            width={svgBounds.width}
            height={svgBounds.height}
            viewBox={`${svgBounds.left} ${svgBounds.top} ${svgBounds.width} ${svgBounds.height}`}
          >
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

