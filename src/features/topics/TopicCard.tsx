import { ArrowUpRight, Star } from 'lucide-react'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import type { ProductionItem, WorkflowStatus } from '../../types/schema'
import { canAbandon, canConfirm, describeActivity, isActivityError, isMutationBlocked } from './useTopicBoard'
import type { TopicActivity } from './useTopicBoard'

const statusTones: Record<WorkflowStatus, string> = {
  '待筛选': 'neutral',
  '已确认-待核对': 'amber',
  'AI初稿完成': 'green',
  '需AI润色': 'amber',
  '待人工终审': 'violet',
  '已发布': 'green',
  '已放弃': 'neutral',
}
const riskTones = { 低: 'green', 中: 'amber', 高: 'red' }

function externalUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

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

export function TopicCard({ item, activity, onConfirm, onAbandon }: {
  item: ProductionItem
  activity?: TopicActivity
  onConfirm: (item: ProductionItem) => Promise<void>
  onAbandon: (item: ProductionItem) => Promise<void>
}) {
  const headingId = useId()
  const url = externalUrl(item.url)
  const blocked = isMutationBlocked(activity)

  return (
    <article className="topic-card" aria-labelledby={headingId}>
      <div className="topic-card-header">
        <span className="topic-track"><span aria-hidden />{item.track_tag}</span>
        <span className={`pill pill--${statusTones[item.workflow_status]}`}>{item.workflow_status}</span>
      </div>
      <h2 id={headingId}>{item.zh_title}</h2>
      <p className="topic-source">{item.source_name}</p>
      <div className="topic-meta">
        <span className="pill pill--score" title="选题评分"><Star size={13} aria-hidden />{item.score} / 5</span>
        <span className={`pill pill--${riskTones[item.compliance_risk]}`}>{item.compliance_risk}风险</span>
        {url && <a className="topic-origin" href={url} target="_blank" rel="noopener noreferrer">原文<ArrowUpRight size={14} aria-hidden /></a>}
      </div>
      <div className="topic-summary">
        <h3>核心数据点</h3>
        <p>{item.key_data_points.trim() || '暂无核心数据点。'}</p>
      </div>
      {activity && <TopicFeedback activity={activity} />}
      <div className="topic-actions">
        {item.workflow_status === '待筛选' && (
          <button className="button button--primary" disabled={!canConfirm(item, activity)} onClick={() => void onConfirm(item)}>
            确认选题
          </button>
        )}
        <Link className="button button--secondary" to={`/workbench/${item.id}`}>进入改稿台</Link>
        {canAbandon(item) && (
          <button className="button button--quiet" disabled={blocked} onClick={() => void onAbandon(item)}>放弃</button>
        )}
      </div>
    </article>
  )
}
