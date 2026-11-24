import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import type { To } from 'react-router-dom'
import type { ProductionItem } from '../../types/schema'
import { initialDraftPendingStatus } from '../../api/workflowPolling'

const editableStatuses = new Set([initialDraftPendingStatus, '生成中', 'AI初稿完成', '初稿已生成', '需AI润色', '精修中', '待人工审核', '待人工终审', '已定稿'])
const lastEditedKey = 'contenthub.lastWorkbenchId'

export function lastWorkbenchId() {
  try { return Number(window.localStorage.getItem(lastEditedKey)) } catch { return 0 }
}

export function rememberWorkbench(id: number) {
  try { window.localStorage.setItem(lastEditedKey, String(id)) } catch { /* 禁用存储时仍可使用工作区。 */ }
}

function recordTime(record: ProductionItem) {
  return Date.parse(record.updated_at?.replace(' ', 'T') ?? '') ||
    Date.parse(record.created_at.replace(' ', 'T')) || 0
}

export function workbenchQueue(items: ProductionItem[]) {
  return items.filter(item => editableStatuses.has(item.workflow_status.trim()))
    .sort((a, b) => recordTime(b) - recordTime(a) || b.id - a.id)
}

export function WorkbenchQueue({ items, id, loading, error, refresh, navigate, state }: {
  items: ProductionItem[]
  id?: number
  loading: boolean
  error: string | null
  refresh: () => void
  navigate: (target: To) => void
  state: unknown
}) {
  const [expanded, setExpanded] = useState(true)
  const [keyword, setKeyword] = useState('')
  const term = keyword.trim().toLocaleLowerCase()
  const visible = items.filter(item => !term || [item.zh_title, item.raw_title, item.workflow_status]
    .some(value => value.toLocaleLowerCase().includes(term)))
  const [choice, setChoice] = useState(id ?? 0)
  const selectId = useId()
  useEffect(() => setChoice(id ?? 0), [id])
  const target = (recordId: number) => ({ pathname: '/workbench', search: '?id=' + recordId })

  return <aside className="wb-queue" aria-label="待改稿列表">
    <div className="wb-queue-head">
      <button type="button" className="button button--quiet" aria-expanded={expanded} aria-controls={selectId + '-list'}
        onClick={() => setExpanded(value => !value)}>
        {expanded ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        待改稿列表（{items.length}）
      </button>
      <button type="button" className="button button--quiet" aria-label="刷新改稿队列" disabled={loading} onClick={refresh}>
        <RefreshCw size={15} aria-hidden />
      </button>
    </div>
    {items.length > 8 && <div className="wb-queue-filter">
      <label htmlFor={selectId + '-search'}>搜索待改稿件</label>
      <input id={selectId + '-search'} type="search" value={keyword} onChange={event => setKeyword(event.target.value)} />
      {term && !visible.length && <small role="status">没有匹配的待改稿件。</small>}
    </div>}
    <div className="wb-queue-desktop" id={selectId + '-list'} hidden={!expanded}>
      {visible.map(item => <Link key={item.id} to={target(item.id)} state={state}
        aria-current={id === item.id ? 'true' : undefined}
        onClick={event => { if (id === item.id) event.preventDefault() }}>
        <strong>{item.zh_title || item.raw_title || `选题 #${item.id}`}</strong>
        <span className="wb-queue-status">{item.workflow_status}</span>
      </Link>)}
    </div>
    <form className="wb-queue-mobile" onSubmit={event => {
      event.preventDefault()
      if (!choice || choice === id) return
      navigate(target(choice))
      setChoice(id ?? 0)
    }}>
      <label htmlFor={selectId}>切换待改稿件（共 {items.length} 篇）</label>
      <select id={selectId} value={visible.some(item => item.id === choice) ? choice : ''} disabled={!visible.length}
        onChange={event => setChoice(Number(event.target.value))}>
        <option value="" disabled>选择待改稿件</option>
        {visible.map(item => <option key={item.id} value={item.id}>{item.zh_title || item.raw_title} · {item.workflow_status}</option>)}
      </select>
      <button className="button button--secondary" type="submit" disabled={!choice || choice === id || !visible.some(item => item.id === choice)}>打开</button>
    </form>
    {loading && <small role="status">正在读取改稿队列…</small>}
    {error && <small className="desk-muted">改稿队列读取失败。{error}</small>}
  </aside>
}
