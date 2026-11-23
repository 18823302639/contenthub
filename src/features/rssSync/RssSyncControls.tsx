import { ChevronDown, LoaderCircle, RefreshCw } from 'lucide-react'
import { useId } from 'react'
import { rssSyncIntervals } from '../../types/schema'
import type { useRssSync } from './useRssSync'
import './rssSync.css'

export function RssSyncControls({ model }: { model: ReturnType<typeof useRssSync> }) {
  const intervalId = useId()
  const hours = model.pendingInterval ?? model.settings?.sync_interval_hours
  const lastSynced = model.settings?.last_synced_at
  const lastSyncDate = lastSynced ? new Date(lastSynced.replace(' ', 'T')) : null
  const formattedTime = lastSyncDate && Number.isFinite(lastSyncDate.getTime())
    ? lastSyncDate.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
    : null
  const notices = [model.syncNotice, model.frequencyNotice]

  return (
    <div className="rss-sync" role="group" aria-label="RSS 采集">
      <div className="rss-sync-actions">
        <button type="button" className="button button--secondary" disabled={model.syncing} aria-busy={model.syncing}
          onClick={() => void model.syncNow()}>
          {model.syncing ? <LoaderCircle size={15} className="refresh-spinning" aria-hidden />
            : <RefreshCw size={15} aria-hidden />}
          {model.syncing ? '采集中...' : '立即采集'}
        </button>
        <div className="rss-sync-frequency">
          <label htmlFor={intervalId}>自动采集频率</label>
          <div className="filter-control">
            <select id={intervalId} value={hours ?? ''} aria-busy={model.pendingInterval !== null}
              disabled={!model.settings || model.reading || model.pendingInterval !== null}
              onChange={event => {
                const interval = rssSyncIntervals.find(option => String(option) === event.target.value)
                if (interval !== undefined) void model.changeInterval(interval)
              }}>
              {hours == null && <option value="" disabled>{model.reading ? '读取中…' : '未读取到支持的频率'}</option>}
              {rssSyncIntervals.map(option => (
                <option key={option} value={option}>{option === 0 ? '暂停自动采集（0）' : `每 ${option} 小时`}</option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden />
          </div>
        </div>
        <p className="rss-sync-time">上次采集时间 {formattedTime
          ? <time dateTime={lastSynced ?? undefined}>{formattedTime}</time>
          : model.settings ? '暂无记录' : '未读取'}</p>
      </div>
      {model.readError && <p className="topic-feedback topic-feedback--warning" role="alert">{model.readError}</p>}
      {notices.map((notice, index) => notice && (
        <p key={index} className={'topic-feedback' + (notice.error ? ' topic-feedback--warning' : '')}
          role={notice.error ? 'alert' : 'status'}>{notice.text}</p>
      ))}
    </div>
  )
}
