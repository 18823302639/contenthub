import { ArrowUpRight, Inbox, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { NewRssSource } from '../../api'
import { poolTypes } from '../../types/schema'
import type { PoolType, RssSource } from '../../types/schema'
import { RssSyncControls } from '../rssSync/RssSyncControls'
import type { useRssSync } from '../rssSync/useRssSync'
import { AddSourceDialog } from './AddSourceDialog'
import { poolLabels, rssUrl } from './sourceFields'
import type { useSources } from './useSources'
import './sources.css'

type SourcesModel = ReturnType<typeof useSources>

const compactSourcesQuery = '(max-width: 960px)'

function compactSourceLayout() {
  return window.matchMedia?.(compactSourcesQuery).matches ?? false
}

function SourceEntry({ row, compact, model }: { row: RssSource; compact: boolean; model: SourcesModel }) {
  const feedbackId = useId()
  const url = rssUrl(row.rss_url)
  const feedback = model.rowFeedback[row.id]
  const unavailable = model.loading || feedback?.kind === 'saving' || feedback?.kind === 'unverified'
  const poolType = poolTypes.find(option => option === row.pool_type)
  const name = row.name.trim() || '未命名信源'
  const group = (
    <span className={poolType === 'production' ? 'source-group pill pill--violet' : 'source-group pill pill--neutral'}>
      {poolType ? poolLabels[poolType] : row.pool_type || '未分组'}
    </span>
  )
  const link = url ? (
    <a className="source-link" href={url} target="_blank" rel="noopener noreferrer" title={url} data-source-control={'link-' + row.id}>
      <span>{url}</span><ArrowUpRight size={14} aria-hidden />
    </a>
  ) : <span className="source-invalid">链接无效</span>
  const control = (
    <button type="button" className="source-switch" role="switch" aria-label={'启用 ' + name}
      data-source-control={'switch-' + row.id}
      aria-checked={row.is_active} aria-disabled={unavailable} aria-describedby={feedback ? feedbackId : undefined}
      onClick={() => { if (!unavailable) void model.toggle(row) }}>
      <span className="source-switch-track" aria-hidden><span /></span>
      <span>{row.is_active ? '已启用' : '已停用'}</span>
    </button>
  )
  const notice = feedback && (
    <p id={feedbackId} className={feedback.kind === 'saving' ? 'source-row-note' : 'source-row-error'}
      role={feedback.kind === 'saving' ? 'status' : 'alert'}>
      {feedback.message}
    </p>
  )

  if (compact) {
    return (
      <li className="source-card">
        <div className="source-card-header">
          <h2>{name}</h2>
          {control}
        </div>
        {notice}
        <div className="source-card-meta">{group}<span>{row.track_tag || '未标注赛道'}</span></div>
        {link}
      </li>
    )
  }

  return (
    <tr>
      <th scope="row">{name}</th>
      <td>{group}</td>
      <td>{row.track_tag || '未标注赛道'}</td>
      <td>{link}</td>
      <td>{control}{notice}</td>
    </tr>
  )
}

function SourceEntries({ rows, model }: { rows: RssSource[]; model: SourcesModel }) {
  const container = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef<string>()
  const [compact, setCompact] = useState(compactSourceLayout)

  useLayoutEffect(() => {
    const query = window.matchMedia?.(compactSourcesQuery)
    if (!query) return
    const changeLayout = () => {
      const active = document.activeElement
      restoreFocus.current = active instanceof HTMLElement && container.current?.contains(active)
        ? active.dataset.sourceControl
        : undefined
      setCompact(query.matches)
    }
    query.addEventListener('change', changeLayout)
    changeLayout()
    return () => query.removeEventListener('change', changeLayout)
  }, [])

  useLayoutEffect(() => {
    const control = restoreFocus.current
    restoreFocus.current = undefined
    if (control) container.current?.querySelector<HTMLElement>(`[data-source-control="${control}"]`)?.focus()
  }, [compact])

  const entries = rows.map(row => <SourceEntry key={row.id} row={row} compact={compact} model={model} />)
  if (compact) return <div ref={container}><ul className="source-card-list" role="list" aria-label="RSS 信源">{entries}</ul></div>

  return (
    <div ref={container} className="source-table-wrap" tabIndex={0} aria-label="RSS 信源表格" role="region">
      <table className="source-table" aria-label="RSS 信源">
        <thead>
          <tr>
            <th scope="col">信源名称</th>
            <th scope="col">分组</th>
            <th scope="col">赛道</th>
            <th scope="col">RSS 链接</th>
            <th scope="col">启用状态</th>
          </tr>
        </thead>
        <tbody>{entries}</tbody>
      </table>
    </div>
  )
}

export function SourcesPage({ model, rssSync }: {
  model: SourcesModel
  rssSync: ReturnType<typeof useRssSync>
}) {
  const { ensureLoaded, rows, loading, loadError, refresh, notice } = model
  const [query, setQuery] = useSearchParams()
  const [dialogId, setDialogId] = useState<number | null>(null)
  const activeDialog = useRef<number | null>(null)
  const dialogSequence = useRef(0)
  const opener = useRef<HTMLButtonElement>(null)
  const visible = useRef(true)
  const pool = poolTypes.find(option => option === query.get('pool'))
  const filtered = (rows ?? []).filter(row => !pool || row.pool_type === pool)
  const dialogBusy = model.savingCreate || model.checkingCreate

  useEffect(() => {
    visible.current = true
    ensureLoaded()
    return () => { visible.current = false }
  }, [ensureLoaded])

  function choose(filter?: PoolType) {
    const next = new URLSearchParams(query)
    if (filter) next.set('pool', filter)
    else next.delete('pool')
    setQuery(next, { replace: true })
  }

  function openDialog() {
    model.clearCreateError()
    const next = ++dialogSequence.current
    activeDialog.current = next
    setDialogId(next)
  }

  function closeDialog() {
    activeDialog.current = null
    setDialogId(null)
  }

  function saved(source: RssSource | null, requestDialog: number | null) {
    if (!source || !visible.current || requestDialog !== activeDialog.current) return
    if (pool && pool !== source.pool_type) choose(poolTypes.find(option => option === source.pool_type))
    closeDialog()
  }

  async function save(input: NewRssSource) {
    const requestDialog = activeDialog.current
    saved(await model.create(input), requestDialog)
  }

  async function check() {
    const requestDialog = activeDialog.current
    saved(await model.verifyCreation(), requestDialog)
  }

  return (
    <section aria-labelledby="sources-title">
      <header className="page-header">
        <div>
          <h1 id="sources-title">信源管理</h1>
          <p>维护生产池和雷达池的 RSS 信源。</p>
        </div>
        <div className="page-actions">
          <button className="button button--secondary" onClick={() => { void refresh(); void rssSync.refreshSettings() }} disabled={loading || model.writing}>
            <RefreshCw size={15} className={loading ? 'refresh-spinning' : undefined} aria-hidden />刷新信源
          </button>
          <button className="button button--primary" ref={opener} disabled={!rows} aria-disabled={dialogBusy || undefined}
            onClick={() => { if (!dialogBusy) openDialog() }}>
            <Plus size={16} aria-hidden />新增信源
          </button>
        </div>
      </header>

      <RssSyncControls model={rssSync} />
      <div className="sources-filters" role="group" aria-label="按分组筛选">
        <button className="button button--quiet" aria-pressed={!pool} onClick={() => choose()}>全部</button>
        {poolTypes.map(option => (
          <button className="button button--quiet" key={option} aria-pressed={pool === option} onClick={() => choose(option)}>
            {poolLabels[option]}
          </button>
        ))}
      </div>
      {loadError && (
        <div className="read-error" role="alert">
          <strong>{rows ? '刷新失败，以下为上次读取的信源。' : '信源加载失败。'}</strong>
          <span>{loadError}</span>
        </div>
      )}
      {notice && <p className="topic-feedback sources-notice" role="status">{notice}</p>}
      {dialogId === null && dialogBusy && (
        <p className="topic-feedback sources-notice" role="status">
          {model.savingCreate ? '正在保存信源…' : '正在核对列表…'}
        </p>
      )}
      {dialogId === null && model.createError && (
        <p className="topic-feedback topic-feedback--warning sources-notice" role="alert">
          {model.createError}{model.pendingInput && '打开「新增信源」可继续核对。'}
        </p>
      )}

      <div aria-busy={loading}>
        {!rows && loading && <p className="source-loading" role="status">正在加载信源…</p>}
        {rows && (
          <>
            <p className="results-count" role="status">{filtered.length} 条信源</p>
            {filtered.length > 0 ? (
              <SourceEntries rows={filtered} model={model} />
            ) : (
              <div className="empty-state">
                <Inbox size={24} strokeWidth={1.6} aria-hidden />
                <h2>{pool ? '当前分组暂无信源。' : '暂无信源。'}</h2>
                {pool && <button className="button button--secondary" onClick={() => choose()}>查看全部信源</button>}
              </div>
            )}
          </>
        )}
      </div>

      {dialogId !== null && (
        <AddSourceDialog
          key={dialogId}
          opener={opener} defaultPool={pool ?? 'production'} pendingInput={model.pendingInput} error={model.createError}
          saving={model.savingCreate} checking={model.checkingCreate} unavailable={loading} mayCheck={!loading && !model.writing}
          onCancel={closeDialog} onSave={save} onCheck={check}
          onOtherSource={() => { model.deferCreation(); openDialog() }}
        />
      )}
    </section>
  )
}
