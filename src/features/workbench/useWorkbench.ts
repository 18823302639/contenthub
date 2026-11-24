import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecordWrites } from '../../app/useRecordWrites'
import { isWorkflowStatus } from '../../types/schema'
import { WriteReadbackError } from '../../api'
import type { ContentHubApi } from '../../api'
import { initialDraftPendingStatus, pollWorkflow } from '../../api/workflowPolling'
import type { ProductionItem } from '../../types/schema'
import { needsRemotion } from '../productionDesk/editingRules'
import { parseRemotion, remotionText, remotionWriteValue, sameRemotion } from '../productionDesk/remotion'
import { requestAiDraft } from './requestAiDraft'
import { renderMarkdownHtml } from './MarkdownPreview'

interface WorkingDocument {
  record: ProductionItem
  markdown: string
  script?: string
  remotion?: string
  incoming: string | null
  preferredDraft: string | null
  backups: string[]
}

interface Notice {
  text: string
  error?: boolean
  rewriteComplete?: boolean
}

interface PendingJob {
  status: '已确认-待核对' | '需AI润色'
  note?: string
  draftBefore?: string
  finalBefore?: string
  loadedDraft?: boolean
  startedAt?: number
  receipt: 'existing' | 'notSent' | 'unconfirmed' | 'accepted'
}

export interface WorkbenchSession {
  document: WorkingDocument | null
  job: PendingJob | null
  generation: number
}

type Operation = 'reading' | 'saving' | 'publishing' | 'rewriting' | 'benchmarking' | 'polishing'

const rewriteStatus = '需AI润色'
const rewriteAccepted = 'Webhook 已受理，等待改稿回写。'

function savedMarkdown(record: ProductionItem) {
  return record.final_md?.trim() ? record.final_md : record.draft_md ?? ''
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败。'
}

function displayedMarkdown(doc: WorkingDocument) {
  return doc.preferredDraft ?? savedMarkdown(doc.record)
}

function mergeRecord(current: WorkingDocument | null, record: ProductionItem, submitted?: string): WorkingDocument {
  const preferredDraft = current?.preferredDraft != null && record.final_md === current.record.final_md &&
    (submitted === undefined || record.final_md !== submitted)
    ? (record.draft_md?.trim() ? record.draft_md : current.preferredDraft)
    : null
  const latest = preferredDraft ?? savedMarkdown(record)
  const backups = current?.backups ?? []
  const script = current?.script !== undefined && current.script !== (current.record.video_script ?? '')
    ? current.script : record.video_script
  const remotion = current?.remotion !== undefined && current.remotion !== remotionText(current.record.remotion_data)
    ? current.remotion : remotionText(record.remotion_data)
  if (!current || (submitted === undefined && current.markdown === displayedMarkdown(current))) {
    return { record, markdown: latest, script, remotion, incoming: null, preferredDraft, backups }
  }

  const hasIncoming = current.markdown !== latest && latest !== submitted &&
    (current.incoming !== null || latest !== displayedMarkdown(current))
  return { record, markdown: current.markdown, script, remotion, incoming: hasIncoming ? latest : null, preferredDraft, backups }
}

function withDraft(current: WorkingDocument | null, record: ProductionItem, draft: string): WorkingDocument {
  const backups = current?.backups ?? []
  const shouldBackUp = current && current.markdown !== displayedMarkdown(current) &&
    current.markdown !== draft && !backups.includes(current.markdown)
  return {
    ...mergeRecord(current, record), markdown: draft, preferredDraft: draft, incoming: null,
    backups: shouldBackUp ? [...backups, current.markdown] : backups,
  }
}

function pendingJob(record: ProductionItem): PendingJob | null {
  if (record.workflow_status === '已确认-待核对') return { status: '已确认-待核对', receipt: 'existing' }
  if (record.workflow_status === rewriteStatus) {
    return {
      status: rewriteStatus, note: record.revision_note ?? '', draftBefore: record.draft_md ?? '',
      finalBefore: record.final_md ?? '', receipt: 'existing',
    }
  }
  return null
}

function matchesPending(record: ProductionItem, expected: PendingJob) {
  return record.workflow_status === expected.status &&
    (expected.status === '已确认-待核对' || (record.revision_note ?? '') === expected.note)
}

function isRewriteReview(record: ProductionItem, expected: PendingJob) {
  return expected.status === rewriteStatus && record.workflow_status === '待人工终审' &&
    (record.revision_note ?? '') === expected.note
}

function awaitingResult(record: ProductionItem, expected: PendingJob) {
  if (expected.status === initialDraftPendingStatus && expected.receipt === 'accepted') {
    return !expected.loadedDraft && !['已放弃', '已发布'].includes(record.workflow_status)
  }
  const changedFinal = Boolean(record.final_md?.trim()) && record.final_md !== expected.finalBefore
  return matchesPending(record, expected) || (
    expected.receipt !== 'notSent' && isRewriteReview(record, expected) &&
    !expected.loadedDraft && !changedFinal
  )
}

function changedDraft(record: ProductionItem, expected: PendingJob | null) {
  if (expected?.status === initialDraftPendingStatus && expected.receipt === 'accepted') {
    if (['已放弃', '已发布'].includes(record.workflow_status) ||
        !record.draft_md?.trim() || record.draft_md === expected.draftBefore) return null
    expected.draftBefore = record.draft_md
    expected.loadedDraft = true
    return record.draft_md
  }
  if (expected?.status !== rewriteStatus || expected.receipt === 'notSent' ||
    (record.revision_note ?? '') !== expected.note ||
    (record.workflow_status !== rewriteStatus && record.workflow_status !== '待人工终审') ||
    !record.draft_md?.trim() || record.draft_md === expected.draftBefore) return null

  expected.draftBefore = record.draft_md
  expected.loadedDraft = true
  return record.draft_md
}

export function useWorkbench(
  api: ContentHubApi,
  id: number,
  writes: RecordWrites,
  onWrite: (record: ProductionItem) => void,
  refreshBoard: () => void,
  sessions: Map<number, WorkbenchSession>,
) {
  const [session] = useState<WorkbenchSession>(() => sessions.get(id) ?? { document: null, job: null, generation: 0 })
  const [doc, setDoc] = useState(session.document)
  const [note, setNote] = useState('')
  const [operation, setOperation] = useState<Operation | null>('reading')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [copyNotice, setCopyNotice] = useState<Notice | null>(null)
  const [needsRead, setNeedsRead] = useState(false)
  const [watching, setWatching] = useState(false)
  const lock = useRef(false)
  const live = useRef(true)

  const read = useCallback(async () => {
    const record = await api.getProductionItem(id)
    if (record.id !== id) throw new Error('读取结果与请求的选题 ID 不一致。')
    return record
  }, [api, id])

  useEffect(() => {
    let stale = false
    live.current = true
    sessions.set(id, session)
    session.generation++
    void read().then(record => {
      if (stale) return
      const existing = session.job ?? pendingJob(record)
      session.job = existing
      const draft = changedDraft(record, existing)
      updateDocument(current => draft === null ? mergeRecord(current, record) : withDraft(current, record, draft))
      setNote(record.revision_note ?? '')
      if (existing && !inspectJob(record, existing) && existing.receipt !== 'notSent') {
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
  }, [id, read, session, sessions])

  const record = doc?.record
  const script = doc?.script ?? record?.video_script ?? ''
  const remotion = doc?.remotion ?? remotionText(record?.remotion_data)
  const scriptChanged = script !== (record?.video_script ?? '')
  const parsedRemotion = parseRemotion(remotion)
  const savedRemotion = remotionText(record?.remotion_data)
  const changedRemotion = remotion !== savedRemotion && (() => {
    const saved = parseRemotion(savedRemotion)
    return Boolean(parsedRemotion.error || saved.error) || !sameRemotion(parsedRemotion.value, saved.value)
  })()
  const dirty = Boolean(doc && (
    (doc.markdown !== savedMarkdown(doc.record) && doc.markdown !== (doc.record.draft_md ?? '')) ||
    scriptChanged || changedRemotion
  ))
  const pending = record?.workflow_status === rewriteStatus || record?.workflow_status === '已确认-待核对'
  const terminal = record?.workflow_status === '已发布' || record?.workflow_status === '已放弃'
  const canChangeStatus = record !== undefined && isWorkflowStatus(record.workflow_status) && !terminal
  const blocked = operation !== null || needsRead || pending || watching ||
    record?.workflow_status === '生成中' || writes.lockedIds.has(id)
  const canPublish = Boolean(record?.final_md?.trim()) && !dirty && !blocked && canChangeStatus
  const canRewrite = Boolean(doc?.markdown.trim()) && !dirty && !blocked && canChangeStatus
  const canToggleBenchmark = Boolean(record) && !blocked
  const canPolish = !blocked && canChangeStatus && Boolean(doc?.markdown.trim() || script.trim())
  const video = Boolean(record && needsRemotion(record))
  const writeScript = video || scriptChanged
  const writeRemotion = video || changedRemotion
  const canSaveDraft = !blocked && Boolean(doc && (doc.markdown.trim() || scriptChanged || changedRemotion)) &&
    !(writeRemotion && parsedRemotion.error)

  function display(text: string, error = false) {
    if (live.current) setNotice({ text, error })
  }

  function updateDocument(update: (current: WorkingDocument | null) => WorkingDocument | null) {
    session.document = update(session.document)
    if (live.current) setDoc(session.document)
  }

  function acceptWrite(record: ProductionItem, submitted?: string) {
    if (record.id !== id) throw new Error('写入回读与请求的选题 ID 不一致。')
    onWrite(record)
    updateDocument(current => mergeRecord(current, record, submitted))
  }

  function observeRead(record: ProductionItem, draft: string | null = null) {
    refreshBoard()
    updateDocument(current => draft === null ? mergeRecord(current, record) : withDraft(current, record, draft))
  }

  function inspectJob(record: ProductionItem, expected: PendingJob) {
    if (awaitingResult(record, expected)) return false
    session.job = null
    if (expected.receipt === 'notSent') {
      display('已读取最新记录。本次未发送 Webhook。')
    } else if (expected.status === initialDraftPendingStatus && (expected.loadedDraft || record.workflow_status === 'AI初稿完成')) {
      display('初稿已回写。')
    } else if (isRewriteReview(record, expected)) {
      const text = expected.loadedDraft ? '改稿结果已回写，已加载最新初稿。' : '改稿结果已回写。'
      if (live.current) setNotice({ text, rewriteComplete: true })
    } else {
      display('记录已进入其他流程状态。请核对稿件与修改意见。', true)
    }
    return true
  }

  async function watch(expected: PendingJob) {
    const version = ++session.generation
    expected.startedAt ??= Date.now()
    const active = () => (live.current || expected.receipt === 'accepted') &&
      version === session.generation && session.job === expected
    const acknowledged = expected.receipt === 'accepted'
    if (live.current) setWatching(true)
    try {
      const finished = await pollWorkflow(api.mode, active, read, latest => {
        const draft = changedDraft(latest, expected)
        if (awaitingResult(latest, expected)) {
          if (draft !== null) {
            observeRead(latest, draft)
            display('已加载最新初稿，等待流程状态回写。')
          }
          return false
        }
        observeRead(latest, draft)
        return inspectJob(latest, expected)
      }, expected.startedAt)
      if (!finished && active()) {
        display((acknowledged ? 'Webhook 已受理，' : '') + '暂未读到回写结果。可刷新记录继续核对。', true)
      }
    } catch (error) {
      if (active()) display((acknowledged ? 'Webhook 已受理，' : '') + '读取回写失败。' + errorMessage(error), true)
    } finally {
      if (live.current && version === session.generation) setWatching(false)
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

  async function refresh(restartDraftWatch = false) {
    await run('reading', async () => {
      session.generation++
      setWatching(false)
      display('正在读取最新记录…')
      try {
        const latest = await read()
        if (!live.current) return
        const expected: PendingJob | null = restartDraftWatch
          ? { status: initialDraftPendingStatus, receipt: 'accepted', draftBefore: session.document?.record.draft_md ?? '' }
          : session.job ?? pendingJob(latest)
        observeRead(latest, changedDraft(latest, expected))
        setNeedsRead(false)
        if (!doc) setNote(latest.revision_note ?? '')
        session.job = expected
        if (!expected) {
          display('已读取最新记录。')
        } else if (!inspectJob(latest, expected)) {
          if (expected.receipt === 'notSent') {
            display('记录仍为「需AI润色」。本次未发送 Webhook，请核对工作流。', true)
            return
          }
          if (expected.receipt === 'accepted') {
            display(expected.status === initialDraftPendingStatus ? 'Webhook 已受理，等待初稿回写。' : rewriteAccepted)
          }
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

  async function saveDraft(finalize = false, markLow = false, onVerified?: (record: ProductionItem) => void) {
    if (!doc || !canSaveDraft) return
    const markdown = doc.markdown
    if (finalize && !markdown.trim()) return
    await run('saving', async () => {
      display(finalize ? '正在定稿…' : '正在保存草稿…')
      try {
        const saved = await api.updateProductionItem(id, {
          draft_md: markdown,
          ...(writeScript ? { video_script: script } : {}),
          ...(writeRemotion ? { remotion_data: remotionWriteValue(parsedRemotion.value) } : {}),
          ...(finalize ? {
            final_md: markdown, final_content: markdown, workflow_status: '已定稿' as const,
            ...(markLow ? { compliance_risk: '低风险' } : {}),
          } : {}),
        })
        acceptWrite(saved, markdown)
        const storedRemotion = writeRemotion ? parseRemotion(remotionText(saved.remotion_data)) : null
        if ((saved.draft_md ?? '') !== markdown ||
            (writeScript && (saved.video_script ?? '') !== script) ||
            (storedRemotion && (storedRemotion.error || !sameRemotion(storedRemotion.value, parsedRemotion.value))) ||
            (finalize && (saved.workflow_status !== '已定稿' || saved.final_md !== markdown || saved.final_content !== markdown ||
              (markLow && saved.compliance_risk !== '低风险' && saved.compliance_risk !== '低')))) {
          display('写入结果与回读不一致，当前编辑已保留。', true)
          return
        }
        updateDocument(current => current && {
          ...current, preferredDraft: finalize ? null : markdown,
          remotion: current.remotion === remotion ? remotionText(saved.remotion_data) : current.remotion,
        })
        onVerified?.(saved)
        display(finalize ? '已保存并定稿。' : '草稿已保存。')
      } catch (error) {
        writeUnverified(error)
      }
    })
  }

  async function polish(revision: string) {
    if (!doc || !canPolish) return
    const original = doc
    await run('polishing', async () => {
      display('正在请求 AI 挑刺去味…')
      try {
        const video = needsRemotion(original.record)
        const result = await requestAiDraft(api, id, original.markdown, video ? script : '', revision)
        if (!result.article && (!video || !result.script)) throw new Error('回执未包含当前赛道可用的稿件。')
        let conflicted = false
        updateDocument(current => {
          if (!current) return current
          const textChanged = current.markdown !== original.markdown
          const scriptChanged = (current.script ?? current.record.video_script ?? '') !== script
          conflicted = Boolean((result.article && textChanged) || (video && result.script && scriptChanged))
          return {
            ...current,
            markdown: textChanged ? current.markdown : result.article ?? current.markdown,
            incoming: textChanged ? result.article ?? current.incoming : null,
            script: video && !scriptChanged ? result.script ?? current.script : current.script,
            backups: result.article && !textChanged && current.markdown !== displayedMarkdown(current) &&
              !current.backups.includes(current.markdown) ? [...current.backups, current.markdown] : current.backups,
          }
        })
        display(conflicted ? 'AI 已返回稿件。提交后的人工编辑已保留，可在回写稿中核对正文。' : 'AI 改稿已写入草稿，请人工核对')
      } catch (error) {
        display(errorMessage(error), true)
      }
    })
  }

  function editScript(value: string) {
    updateDocument(current => current && { ...current, script: value })
  }

  function editRemotion(value: string) {
    updateDocument(current => current && { ...current, remotion: value })
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
      let draftBefore: string
      let finalBefore: string
      display('正在保存修改意见…')
      try {
        const saved = await api.updateProductionItem(id, { workflow_status: rewriteStatus, revision_note: revision })
        acceptWrite(saved)
        if (saved.workflow_status !== rewriteStatus || (saved.revision_note ?? '') !== revision) {
          display('回读未确认本次修改意见和流程状态。本次未发送 Webhook。', true)
          return
        }
        draftBefore = saved.draft_md ?? ''
        finalBefore = saved.final_md ?? ''
      } catch (error) {
        session.job = { status: rewriteStatus, note: revision, receipt: 'notSent' }
        writeUnverified(error, true)
        return
      }

      display('修改意见已保存，正在请求 Webhook…')
      const expected: PendingJob = { status: rewriteStatus, note: revision, draftBefore, finalBefore, receipt: 'unconfirmed' }
      session.job = expected
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
    updateDocument(current => current && {
      ...current, markdown, incoming: markdown === displayedMarkdown(current) ? null : current.incoming,
    })
  }

  async function copy(format: 'rich' | 'markdown') {
    const markdown = doc?.markdown
    if (!markdown?.trim()) return
    try {
      if (format === 'rich' && navigator.clipboard?.write && typeof ClipboardItem === 'function') {
        try {
          const html = renderMarkdownHtml(markdown).then(markup => new Blob([markup], { type: 'text/html' }))
          // 直接响应点击发起写入。即使浏览器拒绝构造 ClipboardItem，也接住延迟加载失败。
          void html.catch(() => {})
          const write = navigator.clipboard.write([new ClipboardItem({
            'text/html': html,
            'text/plain': new Blob([markdown], { type: 'text/plain' }),
          })])
          await Promise.all([write, html])
          if (live.current) setCopyNotice({ text: '已复制全文（富文本）。' })
          return
        } catch {
          // 浏览器或权限不支持富文本时，继续尝试写入原始 Markdown。
        }
      }
      await navigator.clipboard.writeText(markdown)
      if (live.current) setCopyNotice({ text: format === 'markdown' ? '已复制 Markdown。' : '已复制全文。' })
    } catch {
      if (live.current) setCopyNotice({ text: '无法访问剪贴板，请在编辑区手动复制。', error: true })
    }
  }

  function adoptIncoming() {
    updateDocument(current => current?.incoming != null
      ? { ...current, markdown: current.incoming, incoming: null }
      : current)
  }

  function restoreBackup(index: number) {
    updateDocument(current => {
      const backup = current?.backups[index]
      if (!current || backup === undefined) return current
      const backups = current.backups.filter((_, i) => i !== index)
      if (current.markdown !== displayedMarkdown(current) && current.markdown !== backup && !backups.includes(current.markdown)) {
        backups.push(current.markdown)
      }
      return { ...current, markdown: backup, incoming: null, backups }
    })
  }

  return {
    doc, note, setNote, dirty, pending, watching, operation, notice, copyNotice, canPublish, canRewrite, canToggleBenchmark,
    refresh, edit, publish, rewrite, toggleBenchmark, copy, adoptIncoming, restoreBackup,
    script, remotion, parsedRemotion, canSaveDraft, canPolish, saveDraft, polish, editScript, editRemotion,
  }
}
