import { ArrowUpRight, LoaderCircle, Star } from 'lucide-react'
import { useId } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { aiProcessingLabel } from '../../api/workflowPolling'
import { isWorkflowStatus, productionRiskLabel, productionTracks, wf2Tracks } from '../../types/schema'
import type { ProductionItem, WorkflowStatus } from '../../types/schema'
import { externalUrl } from '../../utils/externalUrl'
import { canAbandon, canConfirm, canGenerateDraft, describeActivity, hasDraft, isActivityError, isGeneratingDraft, isMutationBlocked } from './useTopicBoard'
import type { TopicActivity } from './useTopicBoard'

const statusTones: Record<WorkflowStatus, string> = {
  '待筛选': 'neutral',
  '生成中': 'amber',
  '待人工审核': 'violet',
  '已定稿': 'green',
  '已确认-待核对': 'amber',
  'AI初稿完成': 'green',
  '初稿已生成': 'green',
  '精修中': 'amber',
  '需AI润色': 'amber',
  '待人工终审': 'violet',
  '已发布': 'green',
  '已放弃': 'neutral',
}
const riskTones = { 低风险: 'green', 中风险: 'amber', 高风险: 'red' }
const trackNames: Readonly<Record<string, string>> = { main_overseas: '主赛道', sub_toutiao: '副赛道' }

export function TopicFeedback({ activity, hidden = false }: { activity: TopicActivity; hidden?: boolean }) {
  const error = isActivityError(activity)
  return (
    <div className={error ? 'topic-feedback topic-feedback--warning' : 'topic-feedback'} role={error ? 'alert' : 'status'}>
      {hidden && <strong>{activity.title}</strong>}
      <span>{describeActivity(activity)}</span>
      {activity.detail && <small>{activity.detail}</small>}
    </div>
  )
}

export function TopicCard({ item, activity, writeBusy, onConfirm, onGenerate, onAbandon, onOpen }: {
  item: ProductionItem
  activity?: TopicActivity
  writeBusy: boolean
  onConfirm: (item: ProductionItem) => Promise<void>
  onGenerate: (item: ProductionItem) => Promise<void>
  onOpen: (id: number, opener: HTMLButtonElement) => void
  onAbandon: (item: ProductionItem) => Promise<void>
}) {
  const headingId = useId()
  const { search } = useLocation()
  const url = externalUrl(item.url)
  const blocked = writeBusy || isMutationBlocked(activity)
  const risk = productionRiskLabel(item.compliance_risk)
  const statusTone = isWorkflowStatus(item.workflow_status) ? statusTones[item.workflow_status] : 'neutral'
  const knownTrack = productionTracks.some(track => track === item.track_tag)
  const wf2 = wf2Tracks.some(track => track === item.track_tag)
  const generating = isGeneratingDraft(activity) || item.workflow_status === '生成中'
  const draftExists = hasDraft(item)

  return (
    <article className="topic-card" aria-labelledby={headingId}>
      <div className="topic-card-header">
        {knownTrack ? <span className="topic-track"><span aria-hidden />{wf2 ? trackNames[item.track_tag] + ' · ' : ''}{item.track_tag}</span>
          : <span className="pill pill--neutral">{item.track_tag || '未标注赛道'}</span>}
        <span className={'pill pill--' + statusTone}>{item.workflow_status || '未标注状态'}</span>
      </div>
      <h2 id={headingId}>{item.zh_title.trim() || item.raw_title.trim() || '未命名选题'}</h2>
      <p className="topic-source">{item.source_name}</p>
      <div className="topic-meta">
        <span className={'pill pill--' + (item.score === null ? 'neutral' : 'score')} title="选题评分">
          <Star size={13} aria-hidden />{item.score === null ? '未评分' : item.score + ' / 5'}
        </span>
        <span className={'pill pill--' + (risk ? riskTones[risk] : 'neutral')}>
          {risk ?? (item.compliance_risk || '风险未标注')}
        </span>
        {item.is_benchmark && <span className="pill pill--violet">标杆样本</span>}
        {url && <a className="topic-origin" href={url} target="_blank" rel="noopener noreferrer">原文<ArrowUpRight size={14} aria-hidden /></a>}
      </div>
      <div className="topic-summary">
        <h3>核心数据点</h3>
        <p>{item.key_data_points.trim() || '暂无核心数据点。'}</p>
      </div>
      {activity && <TopicFeedback activity={activity} />}
      <div className="topic-actions">
        {wf2 ? (
          <button type="button" className="button button--primary" disabled={blocked || generating || !canGenerateDraft(item)}
            aria-busy={generating} onClick={() => {
              if (!draftExists || window.confirm('重新生成可能覆盖当前初稿、口播稿和渲染数据。确定继续吗？')) void onGenerate(item)
            }}>
            {generating && <LoaderCircle size={15} className="refresh-spinning" aria-hidden />}
            {generating ? '生成中…' : draftExists ? '重新生成' : '生成初稿'}
          </button>
        ) : activity?.kind === 'waiting' ? (
          <button type="button" className="button button--primary" disabled aria-busy="true">
            <LoaderCircle size={15} className="refresh-spinning" aria-hidden />{aiProcessingLabel}
          </button>
        ) : item.workflow_status === '待筛选' && (
          <button className="button button--primary" disabled={blocked || !canConfirm(item, activity)} onClick={() => void onConfirm(item)}>
            确认选题
          </button>
        )}
        <button type="button" className="button button--secondary" disabled={generating || writeBusy}
          onClick={event => onOpen(item.id, event.currentTarget)}>打开工作台</button>
        {!wf2 && <Link className="button button--secondary" to={`/workbench/${item.id}`} state={{ topicsSearch: search }}>进入改稿台</Link>}
        {canAbandon(item) && (
          <button className="button button--quiet" disabled={blocked} onClick={() => void onAbandon(item)}>放弃</button>
        )}
      </div>
    </article>
  )
}
