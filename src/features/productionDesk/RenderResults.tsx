import { ArrowUpRight, Copy, Download, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ContentHubApi } from '../../api'
import { isDefiniteRenderRejection } from '../../app/renderSubmissionChecks'
import type { RenderSubmissionChecks } from '../../app/renderSubmissionChecks'
import type { ProductionItem } from '../../types/schema'
import './renderResults.css'

type RenderPhase = 'idle' | 'rendering' | 'completed' | 'failed'
type Tracker = { record: ProductionItem; previous: string | null | undefined; jobId?: string }

const renderReadTimeout = 8_000

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
  const phase = phaseOf(record.render_status)
  if (current.previous === undefined && record.render_job_id && record.render_job_id === current.record.render_job_id) {
    const previousPhase = phaseOf(current.record.render_status)
    if ((previousPhase === 'completed' || previousPhase === 'failed') && phase !== previousPhase) return current
    if (previousPhase === 'completed' && mediaUrl(current.record.video_url) && !mediaUrl(record.video_url)) return current
  }
  if (current.jobId) {
    if (record.render_job_id !== current.jobId || (current.previous !== undefined && phase === 'idle')) return current
    return { record, previous: undefined, jobId: current.jobId }
  }
  if (current.previous === undefined) return { record, previous: undefined }
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

export function useRenderResults(api: ContentHubApi, record: ProductionItem | undefined, enabled: boolean, checks?: RenderSubmissionChecks) {
  const [tracker, setTracker] = useState<Tracker | null>(() => record ? { record, previous: undefined } : null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeRead = useRef<AbortController | null>(null)
  const id = record?.id
  const check = id === undefined ? undefined : checks?.checks['remotion:' + id]
  const { get: getCheck, observe: observeCheck } = checks ?? {}
  const needsVerification = Boolean(check && (!check.jobId || check.jobId !== tracker?.record.render_job_id))
  const phase: RenderPhase | 'unknown' | 'submitting' = check?.sending ? 'submitting' : needsVerification ? 'unknown'
    : tracker?.previous !== undefined ? 'rendering' : phaseOf(tracker?.record.render_status)

  const observeRecord = useCallback((latest: ProductionItem) => {
    if (getCheck?.('remotion', latest.id)) {
      const result = phaseOf(latest.render_status)
      const jobId = latest.render_job_id
      if (result === 'idle' || !jobId || !observeCheck?.(latest.id, jobId, result !== 'rendering')) return
      setTracker(current => current?.jobId === jobId
        ? observe(current, latest) : { record: latest, previous: undefined, jobId })
      return
    }
    setTracker(current => current ? observe(current, latest) : { record: latest, previous: undefined })
  }, [getCheck, observeCheck])

  useEffect(() => () => {
    const read = activeRead.current
    activeRead.current = null
    read?.abort()
  }, [])
  useEffect(() => {
    if (record) observeRecord(record)
  }, [record, observeRecord])

  const refresh = useCallback(async () => {
    if (!enabled || id === undefined || activeRead.current) return
    const read = new AbortController()
    activeRead.current = read
    setReading(true)
    setError(null)
    const cancelled = new Promise<never>((_resolve, reject) => {
      read.signal.addEventListener('abort', () => reject(read.signal.reason), { once: true })
    })
    const timer = window.setTimeout(() => read.abort(), renderReadTimeout)
    try {
      const latest = await Promise.race([api.getProductionItem(id, read.signal), cancelled])
      if (latest.id !== id) throw new Error('返回记录与当前稿件不一致。')
      if (activeRead.current === read) {
        observeRecord(latest)
      }
    } catch (cause) {
      if (activeRead.current === read) {
        setError(read.signal.aborted ? '渲染状态读取超时，请刷新状态重试。' :
          '渲染状态读取失败，请刷新状态重试。' + (cause instanceof Error ? cause.message : ''))
      }
    } finally {
      window.clearTimeout(timer)
      if (activeRead.current === read) {
        activeRead.current = null
        setReading(false)
      }
    }
  }, [api, id, enabled, observeRecord])

  useEffect(() => {
    if (!enabled || (phase !== 'rendering' && phase !== 'unknown')) return
    const timer = window.setInterval(() => void refresh(), 10_000)
    return () => window.clearInterval(timer)
  }, [enabled, phase, refresh])

  async function submit(baseline: ProductionItem) {
    const finish = checks?.begin('remotion', baseline.id, baseline.render_job_id)
    if (checks && !finish) return false
    const read = activeRead.current
    activeRead.current = null
    read?.abort()
    setReading(false)
    setError(null)
    try {
      const receipt = await api.triggerRender(baseline.id)
      const jobId = baseline.render_job_id === undefined ? undefined : receipt.jobId
      setTracker({ record: baseline, previous: fingerprint(baseline), jobId })
      finish?.(false)
      return true
    } catch (error) {
      finish?.(!isDefiniteRenderRejection(error))
      throw error
    }
  }

  function confirmSubmission(latest: ProductionItem) {
    const inProgress = phase === 'rendering' || phaseOf(latest.render_status) === 'rendering'
    return !inProgress || window.confirm('任务仍显示渲染中，重新提交可能产生重复任务。确定重试吗？')
  }

  const submitLabel = check ? 'Remotion 渲染待核对'
    : phase === 'rendering' || phase === 'failed' ? '重试 Remotion 渲染' : '提交 Remotion 渲染'
  const jobId = check ? check.jobId : tracker?.jobId ?? (tracker?.previous === undefined ? tracker?.record.render_job_id : undefined)
  return { record: tracker?.record, jobId, phase, refresh, reading, error, submit, confirmSubmission, submitLabel, blocked: Boolean(check) }
}

const states: Record<RenderPhase | 'unknown' | 'submitting', string> = {
  idle: '未开始', rendering: '渲染中', completed: '已完成', failed: '失败', unknown: '提交结果未知', submitting: '正在提交',
}

export function RenderResults({ model }: { model: ReturnType<typeof useRenderResults> }) {
  const [copy, setCopy] = useState('')
  const { phase, record, jobId, reading, refresh, error, blocked } = model
  const video = phase === 'completed' ? mediaUrl(record?.video_url) : null
  const sameOriginVideo = video !== null && new URL(video, window.location.href).origin === window.location.origin
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
    {phase === 'unknown' && <p className="topic-feedback topic-feedback--warning">
      上游可能已接收。请刷新渲染状态或核对 n8n 执行记录，确认新任务结束前暂停再次提交。
    </p>}
    {blocked && phase === 'rendering' && <p className="results-count">已读到新任务，等待该任务结束后方可再次提交。</p>}
    {jobId && <p className="results-count">任务 ID <code>{jobId}</code></p>}
    {error && <p role="alert" className="topic-feedback topic-feedback--warning">{error}</p>}
    {phase === 'failed' && <p role="alert" className="topic-feedback topic-feedback--warning">
      {record?.render_error || '渲染失败，服务端未提供原因。'} 可以重新提交。
    </p>}
    {phase === 'completed' && !video && <p className="results-count">渲染已完成，暂未提供可用的视频地址。</p>}
    {video && <>
      <video src={video} controls preload="none" playsInline aria-label="成片预览" />
      <div className="render-results-head">
        <a className="button button--secondary" href={video} target="_blank" rel="noopener noreferrer" download={sameOriginVideo}>
          {sameOriginVideo ? <><Download size={15} aria-hidden />下载视频</>
            : <><ArrowUpRight size={15} aria-hidden />打开视频</>}
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
      {!sameOriginVideo && <p className="results-count">跨域视频在新标签页打开，是否自动保存由视频服务决定。</p>}
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
