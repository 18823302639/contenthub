import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecordWrites } from '../../app/useRecordWrites'
import { isWorkflowStatus } from '../../types/schema'
import { WriteReadbackError } from '../../api'
import type { ContentHubApi } from '../../api'
import type { ProductionItem } from '../../types/schema'

interface WorkingDocument {
  record: ProductionItem
  markdown: string
  incoming: string | null
}

interface Notice {
  text: string
  error?: boolean
  rewriteComplete?: boolean
}

interface PendingJob {
  status: '已确认-待核对' | '需AI润色'
  note?: string
  receipt: 'existing' | 'notSent' | 'unconfirmed' | 'accepted'
}

type Operation = 'reading' | 'saving' | 'publishing' | 'rewriting' | 'benchmarking'

const rewriteStatus = '需AI润色'
const rewriteAccepted = 'Webhook 已受理，等待改稿回写。'

function savedMarkdown(record: ProductionItem) {
  return record.final_md?.trim() ? record.final_md : record.draft_md ?? ''
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败。'
}

function mergeRecord(current: WorkingDocument | null, record: ProductionItem, submitted?: string): WorkingDocument {
  const latest = savedMarkdown(record)
  if (!current || (submitted === undefined && current.markdown === savedMarkdown(current.record))) {
    return { record, markdown: latest, incoming: null }
  }

  const hasIncoming = current.markdown !== latest && latest !== submitted &&
    (current.incoming !== null || latest !== savedMarkdown(current.record))
  return { record, markdown: current.markdown, incoming: hasIncoming ? latest : null }
}

function pendingJob(record: ProductionItem): PendingJob | null {
  if (record.workflow_status === '已确认-待核对') return { status: '已确认-待核对', receipt: 'existing' }
  if (record.workflow_status === rewriteStatus) {
    return { status: rewriteStatus, note: record.revision_note, receipt: 'existing' }
  }
  return null
}

function matchesPending(record: ProductionItem, expected: PendingJob) {
  return record.workflow_status === expected.status &&
    (expected.status === '已确认-待核对' || record.revision_note === expected.note)
}

export function useWorkbench(
  api: ContentHubApi,
  id: number,
  writes: RecordWrites,
  onWrite: (record: ProductionItem) => void,
  refreshBoard: () => void,
) {
  const [doc, setDoc] = useState<WorkingDocument | null>(null)
  const [note, setNote] = useState('')
  const [operation, setOperation] = useState<Operation | null>('reading')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [copyNotice, setCopyNotice] = useState<Notice | null>(null)
  const [needsRead, setNeedsRead] = useState(false)
  const lock = useRef(false)
  const live = useRef(true)
  const generation = useRef(0)
  const job = useRef<PendingJob | null>(null)

  const read = useCallback(async () => {
    const record = await api.getProductionItem(id)
    if (record.id !== id) throw new Error('读取结果与请求的选题 ID 不一致。')
    return record
  }, [api, id])

  useEffect(() => {
    let stale = false
    live.current = true
    void read().then(record => {
      if (stale) return
      setDoc(mergeRecord(null, record))
      setNote(record.revision_note ?? '')
      const existing = pendingJob(record)
      if (existing) {
        job.current = existing
        void watch(existing)
      }
    }).catch(error => {
      if (!stale) setNotice({ text: errorMessage(error), error: true })
    }).finally(() => {
      if (!stale) setOperation(null)
    })
    return () => {
      stale = true
      live.current = false
    }
  }, [read])

  const record = doc?.record
  const dirty = Boolean(doc && doc.markdown !== savedMarkdown(doc.record))
  const pending = record?.workflow_status === rewriteStatus || record?.workflow_status === '已确认-待核对'
  const terminal = record?.workflow_status === '已发布' || record?.workflow_status === '已放弃'
  const canChangeStatus = record !== undefined && isWorkflowStatus(record.workflow_status) && !terminal
  const blocked = operation !== null || needsRead || pending || writes.lockedIds.has(id)
  const canSave = Boolean(doc?.markdown.trim()) && !blocked && (dirty || !record?.final_md?.trim())
  const canPublish = Boolean(record?.final_md?.trim()) && !dirty && !blocked && canChangeStatus
  const canRewrite = Boolean(record && savedMarkdown(record).trim() && note.trim()) && !dirty && !blocked && canChangeStatus
  const canToggleBenchmark = Boolean(record) && !blocked

  function display(text: string, error = false) {
    if (live.current) setNotice({ text, error })
  }

  function acceptWrite(record: ProductionItem, submitted?: string) {
    if (record.id !== id) throw new Error('写入回读与请求的选题 ID 不一致。')
    onWrite(record)
    if (live.current) setDoc(current => mergeRecord(current, record, submitted))
  }

  function observeRead(record: ProductionItem) {
    refreshBoard()
    if (live.current) setDoc(current => mergeRecord(current, record))
  }

  function inspectJob(record: ProductionItem, expected: PendingJob) {
    if (matchesPending(record, expected)) return false
    job.current = null
    if (expected.receipt === 'notSent') {
      display('已读取最新记录。本次未发送 Webhook。')
    } else if (expected.status === '已确认-待核对' && record.workflow_status === 'AI初稿完成') {
      display('初稿已回写。')
    } else if (expected.status === rewriteStatus && record.revision_note === expected.note && record.workflow_status === '待人工终审') {
      if (live.current) setNotice({ text: '改稿结果已回写。', rewriteComplete: true })
    } else {
      display('记录已进入其他流程状态。请核对稿件与修改意见。', true)
    }
    return true
  }

  async function watch(expected: PendingJob) {
    const version = ++generation.current
    const active = () => (live.current || expected.receipt === 'accepted') &&
      version === generation.current && job.current === expected
    const interval = api.mode === 'mock' ? 420 : 3_000
    const limit = api.mode === 'mock' ? 10 : 20
    const acknowledged = expected.receipt === 'accepted'
    try {
      for (let attempt = 0; attempt < limit; attempt++) {
        await new Promise(resolve => setTimeout(resolve, interval))
        if (!active()) return
        const latest = await read()
        if (!active()) return
        if (matchesPending(latest, expected)) continue
        observeRead(latest)
        inspectJob(latest, expected)
        return
      }
      if (active()) {
        display((acknowledged ? 'Webhook 已受理，' : '') + '暂未读到回写结果。可刷新记录继续核对。', true)
      }
    } catch (error) {
      if (active()) display((acknowledged ? 'Webhook 已受理，' : '') + '读取回写失败。' + errorMessage(error), true)
    }
  }

  async function run(kind: Operation, task: () => Promise<void>) {
    if (lock.current || operation !== null) return
    const release = kind === 'reading' ? null : writes.acquire(id)
    if (kind !== 'reading' && !release) return
    lock.current = true
    setOperation(kind)
    try {
      await task()
    } finally {
      lock.current = false
      release?.()
      if (live.current) setOperation(null)
    }
  }

  function writeUnverified(error: unknown, rewrite = false) {
    if (live.current) setNeedsRead(true)
    refreshBoard()
    const prefix = error instanceof WriteReadbackError ? '写入已返回成功，但回读失败。' : '写入结果未确认。'
    const next = rewrite ? '本次未发送 Webhook。请刷新记录核对。' : '请刷新记录核对。'
    display(prefix + next + errorMessage(error), true)
  }

  async function refresh() {
    await run('reading', async () => {
      generation.current++
      display('正在读取最新记录…')
      try {
        const latest = await read()
        if (!live.current) return
        observeRead(latest)
        setNeedsRead(false)
        if (!doc) setNote(latest.revision_note ?? '')
        const expected = job.current ?? pendingJob(latest)
        job.current = expected
        if (!expected) {
          display('已读取最新记录。')
        } else if (!inspectJob(latest, expected)) {
          if (expected.receipt === 'notSent') {
            display('记录仍为「需AI润色」。本次未发送 Webhook，请核对工作流。', true)
            return
          }
          if (expected.receipt === 'accepted') display(rewriteAccepted)
          else if (expected.receipt === 'unconfirmed') {
            display('修改意见已保存，但 Webhook 受理未确认。请核对执行记录。', true)
          } else {
            display('已读取最新记录，等待回写。')
          }
          void watch(expected)
        }
      } catch (error) {
        display(errorMessage(error), true)
      }
    })
  }

  async function save() {
    if (!doc || !canSave) return
    const markdown = doc.markdown
    await run('saving', async () => {
      display('正在保存定稿…')
      try {
        const saved = await api.updateProductionItem(id, { final_md: markdown })
        acceptWrite(saved, markdown)
        if (saved.final_md === markdown) display('定稿已保存。')
        else display('回读稿件与本次保存内容不同。请核对当前记录。', true)
      } catch (error) {
        writeUnverified(error)
      }
    })
  }

  async function publish() {
    if (!canPublish) return
    await run('publishing', async () => {
      display('正在记录发布状态…')
      try {
        const saved = await api.updateProductionItem(id, {
          workflow_status: '已发布', published_at: new Date().toISOString(),
        })
        acceptWrite(saved)
        if (saved.workflow_status === '已发布' && Number.isFinite(Date.parse(saved.published_at))) {
          display('已记录发布状态和时间。')
        } else {
          display('回读未确认发布登记。请核对当前记录。', true)
        }
      } catch (error) {
        writeUnverified(error)
      }
    })
  }

  async function toggleBenchmark() {
    if (!record || !canToggleBenchmark) return
    const next = !record.is_benchmark
    await run('benchmarking', async () => {
      display('正在保存标杆样本状态…')
      try {
        const saved = await api.updateProductionItem(id, { is_benchmark: next })
        acceptWrite(saved)
        if (saved.is_benchmark === next) {
          display(next ? '已标记为标杆样本。' : '已取消标杆样本。')
        } else {
          if (live.current) setNeedsRead(true)
          display('回读未确认标杆样本状态。请刷新记录核对。', true)
        }
      } catch (error) {
        writeUnverified(error)
      }
    })
  }

  async function rewrite() {
    if (!canRewrite) return
    const revision = note.trim()
    await run('rewriting', async () => {
      display('正在保存修改意见…')
      try {
        const saved = await api.updateProductionItem(id, { workflow_status: rewriteStatus, revision_note: revision })
        acceptWrite(saved)
        if (saved.workflow_status !== rewriteStatus || saved.revision_note !== revision) {
          display('回读未确认本次修改意见和流程状态。本次未发送 Webhook。', true)
          return
        }
      } catch (error) {
        job.current = { status: rewriteStatus, note: revision, receipt: 'notSent' }
        writeUnverified(error, true)
        return
      }

      display('修改意见已保存，正在请求 Webhook…')
      const expected: PendingJob = { status: rewriteStatus, note: revision, receipt: 'unconfirmed' }
      job.current = expected
      try {
        await api.triggerWebhook('rewrite-draft', { production_id: id, revision_note: revision })
        expected.receipt = 'accepted'
        display(rewriteAccepted)
        void watch(expected)
      } catch (error) {
        display('修改意见已保存，但 Webhook 受理未确认。请核对执行记录。' + errorMessage(error), true)
      }
    })
  }

  function edit(markdown: string) {
    setDoc(current => current && {
      ...current, markdown, incoming: markdown === savedMarkdown(current.record) ? null : current.incoming,
    })
  }

  async function copy() {
    if (!doc?.markdown.trim()) return
    try {
      await navigator.clipboard.writeText(doc.markdown)
      if (live.current) setCopyNotice({ text: '已复制全文。' })
    } catch {
      if (live.current) setCopyNotice({ text: '无法访问剪贴板，请在编辑区手动复制。', error: true })
    }
  }

  function adoptIncoming() {
    setDoc(current => current?.incoming != null
      ? { ...current, markdown: current.incoming, incoming: null }
      : current)
  }

  return {
    doc, note, setNote, dirty, pending, operation, notice, copyNotice, canSave, canPublish, canRewrite, canToggleBenchmark,
    refresh, edit, save, publish, rewrite, toggleBenchmark, copy, adoptIncoming,
  }
}
