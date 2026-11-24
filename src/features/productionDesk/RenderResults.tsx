import { Copy, Download, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ContentHubApi } from '../../api'
import type { ProductionItem } from '../../types/schema'
import './renderResults.css'

type RenderPhase = 'idle' | 'rendering' | 'completed' | 'failed'
type Tracker = { record: ProductionItem; previous: string | null | undefined }

function phaseOf(value: string | undefined): RenderPhase {
  switch (value?.trim().toLowerCase()) {
    case 'queued': case 'rendering': case '排队中': case '渲染中': return 'rendering'
    case 'completed': case '已完成': case '渲染完成': return 'completed'
    case 'failed': case '失败': case '渲染失败': return 'failed'
    default: return 'idle'
  }
}

function fingerprint(record: ProductionItem) {
  return JSON.stringify([phaseOf(record.render_status), record.video_url ?? '', record.cards_urls ?? [], record.render_error ?? ''])
}

function observe(current: Tracker, record: ProductionItem): Tracker {
  if (current.previous === undefined) return { record, previous: undefined }
  const phase = phaseOf(record.render_status)
  if (phase === 'rendering') return { record, previous: null }
  if ((phase === 'completed' || phase === 'failed') && current.previous !== fingerprint(record)) {
    return { record, previous: undefined }
  }
  return current
}

function mediaUrl(value: string | undefined) {
  if (!value || /[\s\u0000-\u001f\u007f\\]/u.test(value)) return null
  if (value.startsWith('/') && !value.startsWith('//')) return value
  if (!/^https:\/\/[^/?#]/i.test(value)) return null
  try {
    const url = new URL(value)
    return url.username || url.password ? null : value
  } catch {
    return null
  }
}

export function useRenderResults(api: ContentHubApi, record: ProductionItem | undefined, enabled: boolean) {
  const [tracker, setTracker] = useState<Tracker | null>(() => record ? { record, previous: undefined } : null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const live = useRef(true)
  const busy = useRef(false)
  const readVersion = useRef(0)
  const id = record?.id
  const phase = tracker && (tracker.previous !== undefined ? 'rendering' : phaseOf(tracker.record.render_status))

  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])
  useEffect(() => {
    if (record) setTracker(current => current ? observe(current, record) : { record, previous: undefined })
  }, [record])

  const refresh = useCallback(async () => {
    if (!enabled || id === undefined || busy.current) return
    busy.current = true
    const version = ++readVersion.current
    setReading(true)
    setError(null)
    try {
      const latest = await api.getProductionItem(id)
      if (latest.id !== id) throw new Error('返回记录与当前稿件不一致。')
      if (live.current && readVersion.current === version) {
        setTracker(current => current ? observe(current, latest) : { record: latest, previous: undefined })
      }
    } catch (cause) {
      if (live.current && readVersion.current === version) {
        setError('渲染状态读取失败，可重试。' + (cause instanceof Error ? cause.message : ''))
      }
    } finally {
      if (readVersion.current === version) {
        busy.current = false
        if (live.current) setReading(false)
      }
    }
  }, [api, id, enabled])

  useEffect(() => {
    if (!enabled || phase !== 'rendering') return
    const timer = window.setInterval(() => void refresh(), 10_000)
    return () => window.clearInterval(timer)
  }, [enabled, phase, refresh])

  function accepted(baseline: ProductionItem) {
    readVersion.current++
    busy.current = false
    setReading(false)
    setError(null)
    setTracker({ record: baseline, previous: fingerprint(baseline) })
  }

  function confirmSubmission(latest: ProductionItem) {
    const inProgress = phase === 'rendering' || phaseOf(latest.render_status) === 'rendering'
    return !inProgress || window.confirm('任务仍显示渲染中，重新提交可能产生重复任务。确定重试吗？')
  }

  const submitLabel = phase === 'rendering' || phase === 'failed' ? '重试 Remotion 渲染' : '提交 Remotion 渲染'
  return { record: tracker?.record, phase: phase || 'idle', refresh, reading, error, accepted, confirmSubmission, submitLabel }
}

const states: Record<RenderPhase, string> = { idle: '未开始', rendering: '渲染中', completed: '已完成', failed: '失败' }

export function RenderResults({ model }: { model: ReturnType<typeof useRenderResults> }) {
  const [copy, setCopy] = useState('')
  const { phase, record, reading, refresh, error } = model
  const video = phase === 'completed' ? mediaUrl(record?.video_url) : null
  const cardUrls = (record?.cards_urls ?? []).map(mediaUrl).filter((url): url is string => url !== null)
  const cards = phase === 'completed' ? [...new Set(cardUrls)] : []
  const [copySource, setCopySource] = useState<string | null>(null)

  return <section className="render-results" aria-label="渲染状态与成片">
    <div className="render-results-head">
      <strong role="status">渲染状态 · {states[phase]}</strong>
      <button className="button button--secondary" type="button" disabled={reading} onClick={() => void refresh()}>
        <RefreshCw size={14} aria-hidden />刷新渲染状态
      </button>
    </div>
    {error && <p role="alert" className="topic-feedback topic-feedback--warning">{error}</p>}
    {phase === 'failed' && <p role="alert" className="topic-feedback topic-feedback--warning">
      {record?.render_error || '渲染失败，服务端未提供原因。'} 可以重新提交。
    </p>}
    {phase === 'completed' && !video && <p className="results-count">渲染已完成，暂未提供可用的视频地址。</p>}
    {video && <>
      <video src={video} controls preload="none" playsInline aria-label="成片预览" />
      <div className="render-results-head">
        <a className="button button--secondary" href={video} target="_blank" rel="noopener noreferrer" download>
          <Download size={15} aria-hidden />下载视频
        </a>
        <button type="button" className="button button--secondary" onClick={async () => {
          setCopySource(video)
          try {
            await navigator.clipboard.writeText(video.startsWith('/') ? new URL(video, window.location.origin).href : video)
            setCopy('已复制视频链接。')
          } catch {
            setCopy('无法访问剪贴板，可手动复制下载链接。')
          }
        }}><Copy size={15} aria-hidden />复制视频链接</button>
        {copySource === video && <span role="status">{copy}</span>}
      </div>
    </>}
    {phase === 'completed' && (record?.cards_urls ?? []).length > cardUrls.length &&
      <p className="results-count">部分静态图未提供可用链接。</p>}
    {cards.length > 0 && <ul className="render-cards">
      {cards.map((url, index) => <li key={url}>
        <img src={url} alt={`静态数据图 ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" />
        <a className="button button--secondary" href={url} target="_blank" rel="noopener noreferrer" download>
          下载数据图 {index + 1}
        </a>
      </li>)}
    </ul>}
  </section>
}
