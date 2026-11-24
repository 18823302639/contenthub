import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import type { ContentHubApi } from '../../api'
import { canRequestInitialDraft, initialDraftPendingStatus, initialDraftRetryAccepted } from '../../api/workflowPolling'
import type { RecordWrites } from '../../app/useRecordWrites'
import type { ProductionItem } from '../../types/schema'

export function DraftGenerationActions({ api, record, writes, busy, editorHasContent, refresh, manualRefresh }: {
  api: ContentHubApi
  record: ProductionItem
  writes: RecordWrites
  busy: boolean
  editorHasContent: boolean
  refresh: (restartWatch: boolean) => Promise<void>
  manualRefresh?: boolean
}) {
  const [operation, setOperation] = useState<'submit' | 'refresh' | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasDraft = Boolean(record.draft_md?.trim())
  const hasContent = hasDraft || editorHasContent || Boolean(record.final_md?.trim() || record.final_content?.trim())
  const prominent = !hasDraft || record.workflow_status === initialDraftPendingStatus
  const disabled = busy || operation !== null || writes.lockedIds.has(record.id)
  const canRequest = canRequestInitialDraft(record)
  const canRefreshManually = manualRefresh && (prominent || accepted || error || record.workflow_status === '生成中')

  async function readDraft(restartWatch: boolean) {
    setOperation('refresh')
    setError(null)
    try {
      await refresh(restartWatch)
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : ''
      setError('读取初稿失败，可以再次刷新。' + detail)
    } finally {
      setOperation(null)
    }
  }

  async function requestDraft() {
    if (disabled || !canRequest) return
    if (hasContent && !window.confirm('重新生成可能覆盖已保存的正文和素材。确定继续吗？')) return
    if (!hasContent && accepted &&
        !window.confirm('上次请求已受理，可能仍在运行。确定再次触发初稿生成吗？')) return
    const release = writes.acquire(record.id)
    if (!release) return
    setOperation('submit')
    setAccepted(false)
    setError(null)
    try {
      await api.triggerWebhook('fetch-and-draft', { production_id: record.id })
      setAccepted(true)
      await readDraft(true)
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : ''
      setError('初稿生成请求未确认。可以先刷新核对。' + detail)
      setOperation(null)
    } finally {
      release()
    }
  }

  async function refreshManually() {
    const release = writes.acquire(record.id)
    if (!release) return
    try {
      await readDraft(false)
    } finally {
      release()
    }
  }

  if (!canRequest && !canRefreshManually && !accepted && !error && operation === null) return null
  return <div className="draft-generation">
    <div className="draft-generation-actions">
      {canRequest && <button type="button" className={'button ' + (prominent ? 'button--primary' : 'button--quiet')}
        aria-busy={operation === 'submit'} disabled={disabled} onClick={() => void requestDraft()}>
        {operation === 'submit' && <LoaderCircle size={15} className="refresh-spinning" aria-hidden />}
        {operation === 'submit' ? '正在触发初稿生成…' : hasContent ? '重新生成初稿' : '生成初稿'}
      </button>}
      {canRefreshManually &&
        <button type="button" className="button button--secondary" disabled={disabled} onClick={() => void refreshManually()}>
          {operation === 'refresh' ? '正在刷新初稿…' : '刷新初稿'}
        </button>}
    </div>
    {accepted && <p role="status" className="topic-feedback">{initialDraftRetryAccepted}</p>}
    {error && <p role="alert" className="topic-feedback topic-feedback--warning">{error}</p>}
  </div>
}
