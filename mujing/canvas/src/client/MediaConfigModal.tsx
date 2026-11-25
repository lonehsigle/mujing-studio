import { useEffect, useMemo, useState, type ReactNode } from "react"
import { STRATEGY_LABEL } from "./constants.ts"
import {
  call,
  updateMediaStatus,
  type AudioEndpointDetail,
  type ImageEndpointDetail,
  type MediaConfigDetails,
  type MediaKind,
  type MediaStatus,
  type RoutingStrategy,
  type VideoEndpointDetail,
} from "./studio-bus.ts"
import css from "./style.css"

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

export function MediaConfigModal({ initialTab, onClose }: {
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

