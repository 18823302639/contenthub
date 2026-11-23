import { ChevronDown, Inbox, RefreshCw } from 'lucide-react'
import { useEffect, useId } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { matchesProductionFilters } from '../../api'
import { productionTracks, workflowStatuses } from '../../types/schema'
import { RssSyncControls } from '../rssSync/RssSyncControls'
import type { useRssSync } from '../rssSync/useRssSync'
import { TopicCard, TopicFeedback } from './TopicCard'
import { isActivityError, isMutationBlocked } from './useTopicBoard'
import type { useTopicBoard } from './useTopicBoard'

const scores = ['1', '2', '3', '4', '5']

function FilterField({ label, value, onChange, children }: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  const id = useId()
  return (
    <div className="filter-field">
      <label htmlFor={id}>{label}</label>
      <div className="filter-control">
        <select id={id} value={value} onChange={event => onChange(event.target.value)}>{children}</select>
        <ChevronDown size={14} aria-hidden />
      </div>
    </div>
  )
}

export function TopicsPage({ board, rssSync }: {
  board: ReturnType<typeof useTopicBoard>
  rssSync: ReturnType<typeof useRssSync>
}) {
  const { ensureLoaded, items, loading, loadError, activities, lastActivityId, refresh } = board
  const [query, setQuery] = useSearchParams()

  useEffect(() => ensureLoaded(), [ensureLoaded])

  const track = query.get('track') ?? ''
  const minimum = scores.find(option => option === query.get('score')) ?? ''
  const status = query.get('status') ?? ''
  const tracks = new Set([...productionTracks, ...(items ?? []).map(item => item.track_tag), track].filter(Boolean))
  const statuses = new Set([...workflowStatuses, ...(items ?? []).map(item => item.workflow_status), status].filter(Boolean))
  const filtersActive = Boolean(track || minimum || status)
  const visible = (items ?? []).filter(item => matchesProductionFilters(item, {
    trackTag: track || undefined,
    minScore: minimum ? Number(minimum) : undefined,
    status: status || undefined,
  }))

  const visibleIds = new Set(visible.map(item => item.id))
  const hiddenActivities = Object.entries(activities).filter(([id, activity]) => (
    activity && !visibleIds.has(Number(id)) && (
      Number(id) === lastActivityId || activity.kind === 'waiting' ||
      isActivityError(activity) || isMutationBlocked(activity)
    )
  ))

  function select(key: string, value: string) {
    const next = new URLSearchParams(query)
    if (value) next.set(key, value)
    else next.delete(key)
    setQuery(next, { replace: true })
  }

  function clear() {
    setQuery({}, { replace: true })
  }

  return (
    <section aria-labelledby="topics-title">
      <header className="page-header">
        <div>
          <h1 id="topics-title">选题看板</h1>
          <p>筛选候选选题，确认后交给 AI 生成初稿。</p>
        </div>
        <button className="button button--secondary refresh-button" onClick={() => { void refresh(); void rssSync.refreshSettings() }} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'refresh-spinning' : undefined} aria-hidden />刷新列表
        </button>
      </header>

      <RssSyncControls model={rssSync} />
      <div className="filters" aria-label="筛选选题" role="group">
        <FilterField label="赛道" value={track} onChange={value => select('track', value)}>
          <option value="">全部赛道</option>
          {Array.from(tracks, option => <option key={option} value={option}>{option}</option>)}
        </FilterField>
        <FilterField label="最低评分" value={minimum} onChange={value => select('score', value)}>
          <option value="">不限评分</option>
          {scores.map(option => <option value={option} key={option}>{option} 分及以上</option>)}
        </FilterField>
        <FilterField label="流程状态" value={status} onChange={value => select('status', value)}>
          <option value="">全部状态</option>
          {Array.from(statuses, option => <option key={option} value={option}>{option}</option>)}
        </FilterField>
        {filtersActive && visible.length > 0 && <button className="button button--quiet clear-filters" onClick={clear}>清除筛选</button>}
      </div>

      {hiddenActivities.map(([id, activity]) => activity && (
        <div className="activity-banner" key={id}><TopicFeedback activity={activity} hidden /></div>
      ))}
      {loadError && (
        <div className="read-error" role="alert">
          <strong>{items ? '刷新失败，以下为上次读取的记录。' : '选题加载失败'}</strong>
          <span>{loadError}</span>
        </div>
      )}

      <div aria-busy={loading}>
        {items === null && loading && (
          <div className="loading-state" role="status">
            <p>正在加载选题…</p>
            <div className="topic-grid" aria-hidden>
              {[1, 2, 3].map(index => <div className="topic-skeleton" key={index}><span /><span /><span /></div>)}
            </div>
          </div>
        )}
        {items !== null && (
          <>
            <p className="results-count" role="status">
              {filtersActive ? `${visible.length} / ${items.length} 条选题` : `${visible.length} 条选题`}
            </p>
            {visible.length > 0 ? (
              <div className="topic-grid">
                {visible.map(item => (
                  <TopicCard key={item.id} item={item} activity={activities[item.id]} writeBusy={board.lockedIds.has(item.id)} onConfirm={board.confirm} onAbandon={board.abandon} />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Inbox size={24} strokeWidth={1.6} aria-hidden />
                <h2>{filtersActive ? '没有符合条件的选题' : '暂无选题'}</h2>
                {filtersActive && <button className="button button--secondary" onClick={clear}>清除筛选</button>}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
