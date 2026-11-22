import { ArrowUpRight, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { NewAccountMetric } from '../../api'
import { platforms } from '../../types/schema'
import type { AccountMetric, Platform, RadarItem } from '../../types/schema'
import { externalUrl } from '../../utils/externalUrl'
import { metricDay } from '../../utils/metricDays'
import { AddMetricDialog } from './AddMetricDialog'
import { formatMetric, MetricTrends } from './MetricTrends'
import { buildReview } from './review'
import type { ReviewPeriod } from './review'
import type { useAnalytics } from './useAnalytics'
import '../sources/sources.css'
import './analytics.css'

type AnalyticsModel = ReturnType<typeof useAnalytics>
const periods = [7, 30] as const
const indicators = [
  { key: 'views', label: '新增阅读量', aria: '周期新增阅读量' },
  { key: 'impressions', label: '新增展现量', aria: '周期新增展现量' },
  { key: 'ctr', label: '加权 CTR', aria: '周期加权 CTR' },
  { key: 'revenue', label: '收益', aria: '周期收益' },
] as const

function Radar({ model }: { model: AnalyticsModel['radar'] }) {
  const opportunities = model.rows?.filter(row => (row.commercial_score ?? -Infinity) >= 4 && (row.info_gap_score ?? -Infinity) >= 4)

  return (
    <section className="analytics-radar" aria-labelledby="radar-title">
      <header className="analytics-section-heading">
        <h2 id="radar-title">雷达机会</h2>
        <p>商业价值和信息差均至少 4 分。</p>
      </header>
      {model.error && <div className="read-error" role="alert">
        <strong>{model.rows ? '雷达刷新失败，以下为上次结果。' : '雷达读取失败。'}</strong><span>{model.error}</span>
      </div>}
      {!opportunities && !model.error && <p className="analytics-muted" role="status">正在加载雷达机会…</p>}
      {opportunities && (opportunities.length > 0 ? (
        <div className="radar-grid">
          {opportunities.map(row => <RadarCard key={row.id} row={row} />)}
        </div>
      ) : <p className="analytics-empty">暂无同时符合两项阈值的雷达机会。</p>)}
    </section>
  )
}

function RadarCard({ row }: { row: RadarItem }) {
  const url = externalUrl(row.url)
  return (
    <article className="radar-card">
      <div className="radar-tags">
        <span className={row.domain_tag ? 'pill pill--violet' : 'pill pill--neutral'}>{row.domain_tag || '未标注领域'}</span>
        <span className="pill pill--neutral">{row.demand_type || '未标注需求'}</span>
        {row.evergreen && <span className="pill pill--green">常青</span>}
      </div>
      <h3>{row.summary_zh.trim() || row.raw_title.trim() || '未命名雷达机会'}</h3>
      <p className="radar-risk">合规风险：{row.compliance_risk || '待核对'}</p>
      <div className="radar-score">
        <span>商业价值 <strong>{row.commercial_score}</strong></span>
        <span>信息差 <strong>{row.info_gap_score}</strong></span>
        {url && <a className="topic-origin" href={url} target="_blank" rel="noopener noreferrer">原文<ArrowUpRight size={14} aria-hidden /></a>}
      </div>
    </article>
  )
}

export function AnalyticsPage({ model }: { model: AnalyticsModel }) {
  const [platform, setPlatform] = useState<Platform>('公众号')
  const [period, setPeriod] = useState<ReviewPeriod>(7)
  const [dialogId, setDialogId] = useState<number | null>(null)
  const [hiddenDate, setHiddenDate] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const sameView = useRef(true)
  const dialogSequence = useRef(0)
  const activeDialog = useRef<number | null>(null)
  const { refresh, metrics, radar, articles, isDaily, loading, operation, notice } = model

  useEffect(() => {
    sameView.current = true
    void refresh()
    return () => { sameView.current = false }
  }, [refresh])

  const review = buildReview(metrics.rows ?? [], platform, period, Date.now(), isDaily)
  const firstDay = review.points[0].day
  const today = review.points[review.points.length - 1].day

  function choosePlatform(value: Platform) {
    setHiddenDate(false)
    setPlatform(value)
  }

  function openDialog() {
    const id = ++dialogSequence.current
    activeDialog.current = id
    setDialogId(id)
  }

  function closeDialog() {
    activeDialog.current = null
    setDialogId(null)
    model.resetEntry()
  }

  function showRecordedDate(saved: AccountMetric | null, submittedDialog: number | null) {
    if (!saved || !sameView.current || submittedDialog !== activeDialog.current) return
    const savedPlatform = platforms.find(item => item === saved.platform)
    if (savedPlatform) setPlatform(savedPlatform)
    const date = metricDay(saved.recorded_at)
    setHiddenDate(date !== null && date < firstDay)
    closeDialog()
  }

  async function save(input: NewAccountMetric) {
    const submittedDialog = activeDialog.current
    showRecordedDate(await model.save(input), submittedDialog)
  }

  async function verify() {
    const submittedDialog = activeDialog.current
    showRecordedDate(await model.verify(), submittedDialog)
  }

  return (
    <section aria-labelledby="analytics-title">
      <header className="page-header">
        <div>
          <h1 id="analytics-title">运营数据</h1>
          <p>按平台复盘单日新增，查看雷达机会。</p>
        </div>
        <div className="page-actions">
          <button className="button button--secondary" disabled={loading || operation !== null} onClick={() => void refresh()}>
            <RefreshCw size={15} className={loading ? 'refresh-spinning' : undefined} aria-hidden />刷新数据
          </button>
          <button className="button button--primary" disabled={!articles.rows?.length || loading} aria-disabled={operation !== null || undefined}
            ref={opener} onClick={() => { if (operation === null) openDialog() }}>
            <Plus size={16} aria-hidden />录入运营数据
          </button>
        </div>
      </header>

      <div className="analytics-controls">
        <div className="sources-filters" role="group" aria-label="查看平台">
          {platforms.map(item => <button key={item} className="button button--quiet" aria-pressed={platform === item}
            onClick={() => choosePlatform(item)}>{item}</button>)}
        </div>
        <div className="sources-filters" role="group" aria-label="复盘周期">
          {periods.map(item => <button key={item} className="button button--quiet" aria-pressed={period === item}
            onClick={() => { setPeriod(item); setHiddenDate(false) }}>近 {item} 天</button>)}
        </div>
      </div>

      <p className="analytics-range">{firstDay} 至 {today} · UTC+8 · 含今天</p>
      {articles.error && <p className="read-error" role="alert">已发布内容读取失败。{articles.error}</p>}
      {articles.rows?.length === 0 && <p className="analytics-muted">暂无已发布内容，可先在改稿台登记发布。</p>}
      {notice && <p className="topic-feedback analytics-notice" role="status">
        {notice}{hiddenDate && '该日超出当前复盘范围。'}
      </p>}
      {dialogId === null && operation && <p className="analytics-muted" role="status">
        {operation === 'saving' ? '正在保存运营数据…' : '正在核对记录…'}
      </p>}
      {dialogId === null && model.entryError && <p className="read-error" role="alert">{model.entryError}</p>}
      {metrics.error && <div className="read-error" role="alert">
        <strong>{metrics.rows ? '刷新失败，以下为上次读取的数据。' : '运营数据读取失败。'}</strong><span>{metrics.error}</span>
      </div>}
      {!metrics.rows && !metrics.error && <p className="analytics-muted" role="status">正在加载运营数据…</p>}

      {metrics.rows && (
        <section aria-label="周期核心指标">
          <div className="metric-kpis">
            {indicators.map(item => (
              <div className="metric-kpi" aria-label={item.aria} key={item.key}>
                <span>{item.label}</span><strong>{formatMetric(review.totals[item.key], item.key)}</strong>
              </div>
            ))}
          </div>
          <div className="metric-coverage">
            <span>已纳入 {review.coveredDays} / {period} 天</span>
            <span>— 表示缺少可用数据</span>
          </div>
          {(review.unknownRows > 0 || review.invalidDates > 0 || review.invalidRows > 0 ||
            review.duplicateGroups > 0 || review.conflictingGroups > 0) && (
            <ul className="topic-feedback topic-feedback--warning metric-data-notes" aria-label="数据核对提示">
              {review.unknownRows > 0 && <li>历史记录口径未核对，已排除 {review.unknownRows} 条。</li>}
              {review.invalidDates > 0 && <li>{review.invalidDates} 条记录无法确定 UTC+8 日期。</li>}
              {review.invalidRows > 0 && <li>{review.invalidRows} 条记录的指标或内容关联无效，汇总仅计可用数据。</li>}
              {review.duplicateGroups > 0 && <li>{review.duplicateGroups} 组同日相同记录各计一次。</li>}
              {review.conflictingGroups > 0 && <li>已隔离 {review.conflictingGroups} 组同日冲突记录。</li>}
            </ul>
          )}
          <MetricTrends points={review.points} />
        </section>
      )}

      <Radar model={radar} />
      {dialogId !== null && (
        <AddMetricDialog key={dialogId + (model.pendingInput ? '-verify' : '-entry')} opener={opener}
          articles={articles.rows ?? []} platform={platform} pendingInput={model.pendingInput}
          error={model.entryError} operation={operation} onClose={closeDialog} onSave={save} onVerify={verify} />
      )}
    </section>
  )
}
