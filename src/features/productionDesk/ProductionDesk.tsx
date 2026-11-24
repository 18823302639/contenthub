import { Copy, LoaderCircle, Sparkles, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { ContentHubApi, ProductionUpdate } from '../../api'
import type { RecordWrites } from '../../app/useRecordWrites'
import { productionRiskLabel } from '../../types/schema'
import type { ProductionItem } from '../../types/schema'
import { renderMarkdownHtml } from '../workbench/MarkdownPreview'
import { useUnsavedChanges } from '../../app/UnsavedChanges'
import { requestAiDraft } from '../workbench/requestAiDraft'
import { DraftGenerationActions } from '../workbench/DraftGenerationActions'
import { editorialWarnings, needsRemotion, renderDataWarning, renderRecordIsCurrent, reviewIssue } from './editingRules'
import { RenderResults, useRenderResults } from './RenderResults'
import { EditorialPanels } from '../workbench/EditorTabs'
import type { EditorialTab } from '../workbench/EditorTabs'
import { ComplianceBanner } from './ComplianceBanner'
import { SourceReference } from './SourceReference'
import { parseRemotion, remotionText, remotionWriteValue, sameRemotion } from './remotion'
import './productionDesk.css'

type Operation = 'save' | 'finalize' | 'render' | 'rewrite'
type Notice = { text: string; error?: boolean }

function fields(record: ProductionItem) {
  return {
    title: record.zh_title,
    article: record.draft_md || record.final_md || record.final_content || '',
    script: record.video_script ?? '',
    remotion: remotionText(record.remotion_data),
  }
}

function length(text: string) {
  return Array.from(text.replace(/\s/g, '')).length
}

function message(error: unknown) {
  return error instanceof Error ? error.message : '请求失败。'
}

async function plainArticle(markdown: string) {
  const html = await renderMarkdownHtml(markdown)
  const { body } = new DOMParser().parseFromString(html, 'text/html')
  for (const cell of body.querySelectorAll('th:not(:last-child),td:not(:last-child)')) cell.append('\t')
  for (const node of body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,pre,tr')) node.append('\n')
  for (const node of body.querySelectorAll('br')) node.replaceWith('\n')
  return (body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

function matchesWrite(record: ProductionItem, patch: ProductionUpdate) {
  return (Object.keys(patch) as (keyof ProductionUpdate)[]).every(key => {
    if (key === 'remotion_data') {
      const parsed = parseRemotion(remotionText(record.remotion_data))
      return !parsed.error && sameRemotion(parsed.value, parseRemotion(remotionText(patch.remotion_data)).value)
    }
    return (record[key] ?? '') === patch[key]
  })
}

function DeskEditor({ api, record: initial, writes, onSaved, requestClose, registerClose }: {
  api: ContentHubApi
  record: ProductionItem
  writes: RecordWrites
  onSaved: (record: ProductionItem) => void
  requestClose: () => void
  registerClose: (close: () => void) => void
}) {
  const group = useId()
  const [record, setRecord] = useState(initial)
  const [values, setValues] = useState(() => fields(initial))
  const [tab, selectTab] = useState<EditorialTab>('article')
  const [reviewTicket, setReviewTicket] = useState<string | null>(null)
  const [reviewedFields, setReviewedFields] = useState<string | null>(null)
  const [revisionNote, setRevisionNote] = useState('')
  const [operation, setOperation] = useState<Operation | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const main = needsRemotion(record)
  const render = useRenderResults(api, record, main)
  const parsed = parseRemotion(values.remotion)
  const jsonIssue = parsed.error ?? renderDataWarning(parsed)
  const warnings = editorialWarnings(values)
  const fieldsKey = JSON.stringify(values)
  const markLow = fieldsKey === reviewTicket
  const approvalIssue = reviewIssue(record, warnings, markLow || reviewedFields === fieldsKey)
  const locked = writes.lockedIds.has(record.id)
  const busy = operation !== null || locked || record.workflow_status === '生成中'
  const original = fields(record)
  const originalRender = parseRemotion(original.remotion)
  const remotionChanged = values.remotion !== original.remotion &&
    (Boolean(parsed.error || originalRender.error) || !sameRemotion(parsed.value, originalRender.value))
  const changed = values.title !== original.title || values.article !== original.article ||
    values.script !== original.script || remotionChanged
  const dirty = markLow || changed
  useUnsavedChanges(dirty)
  const finalizeReason = approvalIssue || parsed.error ||
    (!values.title.trim() || !values.article.trim() ? '定稿需要中文标题和图文正文。' : null)
  const renderReason = approvalIssue || parsed.error ||
    (productionRiskLabel(record.compliance_risk) === '高风险' ? '请先用人工复核操作保存低风险等级。' : null) ||
    (changed ? '请先保存当前草稿和渲染数据。' : null)
  const writeRemotion = main || remotionChanged
  const saveDisabled = busy || (writeRemotion && Boolean(parsed.error))
  const seconds = Math.ceil(length(values.script) * 60 / 260)
  const finalizeReasonId = group + '-finalize-reason'
  const renderReasonId = group + '-render-reason'

  useEffect(() => {
    registerClose(() => {
      if (operation !== null) return
      if (!dirty || window.confirm('尚有未保存的修改，确定关闭工作台吗？')) requestClose()
    })
  }, [dirty, operation, registerClose, requestClose])

  function change(key: keyof typeof values, value: string) {
    setValues(current => ({ ...current, [key]: value }))
  }

  async function copy(text: string, label: string, plain = false) {
    try {
      await navigator.clipboard.writeText(plain ? await plainArticle(text) : text)
      setNotice({ text: '已复制' + label })
    } catch {
      setNotice({ text: '复制失败，请在编辑器中选中内容后手动复制。', error: true })
    }
  }

  async function save(finalize: boolean) {
    if (saveDisabled || (finalize && finalizeReason)) return
    const release = writes.acquire(record.id)
    if (!release) return
    const patch: ProductionUpdate = { zh_title: values.title.trim(), draft_md: values.article }
    if (main || values.script !== original.script) patch.video_script = values.script
    if (writeRemotion) patch.remotion_data = remotionWriteValue(parsed.value)
    if (finalize) Object.assign(patch, {
      final_md: values.article, final_content: values.article, workflow_status: '已定稿',
      ...(markLow ? { compliance_risk: '低风险' } : {}),
    })

    setNotice(null)
    setOperation(finalize ? 'finalize' : 'save')
    try {
      const updated = await api.updateProductionItem(record.id, patch)
      onSaved(updated)
      setRecord(updated)
      if (!matchesWrite(updated, patch)) {
        setNotice({ text: '写入结果待核对，回读值与本次内容不一致。当前编辑已保留。', error: true })
        return
      }
      setValues(fields(updated))
      if (finalize) {
        if (markLow) setReviewedFields(JSON.stringify(fields(updated)))
        setReviewTicket(null)
      }
      setNotice({ text: finalize ? '已保存并定稿' : '草稿已保存' })
    } catch (error) {
      setNotice({ text: '保存结果未确认。' + message(error), error: true })
    } finally {
      setOperation(null)
      release()
    }
  }

  async function refreshDraft() {
    const latest = await api.getProductionItem(record.id)
    if (latest.id !== record.id) throw new Error('读取结果与当前选题不一致。')
    const next = fields(latest)
    setValues(current => ({
      title: current.title === original.title ? next.title : current.title,
      article: current.article === original.article ? next.article : current.article,
      script: current.script === original.script ? next.script : current.script,
      remotion: current.remotion === original.remotion ? next.remotion : current.remotion,
    }))
    setRecord(latest)
    onSaved(latest)
  }

  async function renderVideo() {
    if (!main || renderReason || busy) return
    const release = writes.acquire(record.id)
    if (!release) return
    setNotice(null)
    setOperation('render')
    try {
      const latest = await api.getProductionItem(record.id)
      if (!renderRecordIsCurrent(record, latest, parsed)) {
        setRecord(latest)
        setNotice({ text: '记录已更新或不满足渲染条件。请核对风险等级和已保存的渲染数据。', error: true })
        return
      }
      if (!render.confirmSubmission(latest)) return
      const receipt = await api.triggerRender(record.id)
      render.accepted(latest, receipt.jobId)
      setNotice({ text: 'Remotion 渲染请求已受理' })
    } catch (error) {
      setNotice({ text: message(error), error: true })
    } finally {
      setOperation(null)
      release()
    }
  }

  async function rewrite() {
    if (busy || (!values.article.trim() && !values.script.trim())) return
    const release = writes.acquire(record.id)
    if (!release) return
    setNotice(null)
    setOperation('rewrite')
    try {
      const draft = await requestAiDraft(api, record.id, values.article, main ? values.script : '', revisionNote)
      if (!draft.article && (!main || !draft.script)) throw new Error('回执未包含当前赛道可用的稿件。')
      setValues(current => ({
        ...current, article: draft.article ?? current.article, script: main ? draft.script ?? current.script : current.script,
      }))
      setNotice({ text: 'AI 改稿已写入草稿，请人工核对' })
    } catch (error) {
      setNotice({ text: message(error), error: true })
    } finally {
      setOperation(null)
      release()
    }
  }

  return (
    <>
      <div className="desk-body">
        <ComplianceBanner record={record} />
        {warnings.length > 0 && <p className="topic-feedback topic-feedback--warning" role="status">
          高危词待核对 · {warnings.join('；')}
        </p>}
        <span className="desk-status">{record.track_tag || '未标注赛道'} · {record.workflow_status || '未标注状态'} · {productionRiskLabel(record.compliance_risk) ?? (record.compliance_risk || '风险未标注')}</span>
        <div className="desk-title">
          <label htmlFor={group + '-title'}>中文标题</label>
          <div>
            <input id={group + '-title'} value={values.title} disabled={busy} onChange={event => change('title', event.target.value)} />
            <button type="button" className="button button--secondary" disabled={!values.title.trim()}
              onClick={() => void copy(values.title, '标题')}><Copy size={14} aria-hidden />一键复制标题</button>
          </div>
          {record.suggested_titles.length > 0 && (
            <div className="desk-title-chips" aria-label="备选标题" role="group">
              {record.suggested_titles.map((title, index) => (
                <button type="button" key={index} className="button button--secondary"
                  disabled={busy} onClick={() => change('title', title)}>{title}</button>
              ))}
            </div>
          )}
        </div>

        <DraftGenerationActions api={api} record={record} writes={writes} busy={operation !== null}
          editorHasContent={Boolean(values.article.trim()) || changed} refresh={refreshDraft} manualRefresh />
        <EditorialPanels group={group} value={tab} select={selectTab} tabsClassName="desk-tabs" panelClassName="desk-panel">
          {tab === 'article' && (
            <>
              <div className="desk-editor-toolbar">
                <label htmlFor={group + '-article-editor'}>图文正文</label><span>{length(values.article)} 字</span>
                <button className="button button--secondary" type="button" disabled={!values.article.trim()}
                  onClick={() => void copy(values.article, ' Markdown')}>一键复制 Markdown</button>
                <button className="button button--secondary" type="button" disabled={!values.article.trim()}
                  onClick={() => void copy(values.article, '纯文本', true)}>复制纯文本</button>
              </div>
              <textarea id={group + '-article-editor'} value={values.article} disabled={busy}
                onChange={event => change('article', event.target.value)} />
            </>
          )}
          {tab === 'script' && (
            <>
              <div className="desk-editor-toolbar">
                <label htmlFor={group + '-script-editor'}>口播脚本</label>
                <span>{length(values.script)} 字 · 约 {Math.floor(seconds / 60)} 分 {seconds % 60} 秒</span>
                <button className="button button--secondary" type="button" disabled={!values.script.trim()}
                  onClick={() => void copy(values.script, '脚本')}>一键复制脚本</button>
              </div>
              <textarea id={group + '-script-editor'} value={values.script} disabled={busy}
                onChange={event => change('script', event.target.value)} />
            </>
          )}
          {tab === 'remotion' && (
            <>
              <div className="desk-editor-toolbar">
                <label htmlFor={group + '-json-editor'}>Remotion JSON</label>
                <button className="button button--secondary" type="button" disabled={busy || !values.remotion.trim() || Boolean(parsed.error)}
                  onClick={() => change('remotion', JSON.stringify(parsed.value, null, 2))}>格式化 JSON</button>
              </div>
              {!main && <p className="desk-muted">当前选题未启用渲染，仍可编辑并保存数据。</p>}
              {main && !values.remotion.trim() && <p className="desk-muted">留空时由 WF4 自动生成分镜。</p>}
              {jsonIssue && <p id={group + '-json-issues'} className="topic-feedback topic-feedback--warning" role="alert">
                {jsonIssue}
              </p>}
              <textarea className="desk-json" spellCheck={false} id={group + '-json-editor'} value={values.remotion} disabled={busy}
                aria-invalid={Boolean(parsed.error)}
                aria-describedby={jsonIssue ? group + '-json-issues' : undefined}
                onChange={event => change('remotion', event.target.value)} />
            </>
          )}
          {tab === 'sources' && <SourceReference record={record} />}
        </EditorialPanels>
        {main && <RenderResults model={render} />}
      </div>

      <footer className="desk-footer">
        {notice && <p className={'topic-feedback' + (notice.error ? ' topic-feedback--warning' : '')}
          role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
        {finalizeReason && <small className="desk-muted" id={finalizeReasonId}>{finalizeReason}</small>}
        {main && renderReason && renderReason !== finalizeReason && <small className="desk-muted" id={renderReasonId}>{renderReason}</small>}
        <div className="desk-ai">
          <label htmlFor={group + '-revision'}>修改侧重点（可选）</label>
          <input id={group + '-revision'} value={revisionNote} disabled={busy}
            onChange={event => setRevisionNote(event.target.value)} placeholder="例如强化开头的数据对比" />
          <button type="button" className="button button--secondary" aria-busy={operation === 'rewrite'}
            disabled={busy || (!values.article.trim() && !values.script.trim())} onClick={() => void rewrite()}>
            <Sparkles size={15} aria-hidden />{operation === 'rewrite' ? 'AI 改稿中…' : 'AI 挑刺去味'}
          </button>
        </div>
        <div className="desk-actions">
          <label><input type="checkbox" checked={markLow} disabled={busy} onChange={event => setReviewTicket(event.target.checked ? fieldsKey : null)} />
            人工复核后将风险改为低风险
          </label>
          {dirty && <span className="wb-dirty" role="status">未保存</span>}
          <button type="button" className="button button--secondary" disabled={saveDisabled}
            onClick={() => void save(false)}>{operation === 'save' ? '正在保存…' : '保存草稿'}</button>
          <button type="button" className="button button--primary" disabled={saveDisabled || Boolean(finalizeReason)}
            aria-describedby={finalizeReason ? finalizeReasonId : undefined}
            onClick={() => void save(true)}>{operation === 'finalize' ? '正在定稿…' : '人工复核通过并定稿'}</button>
          {main && (
            <span title={renderReason ?? undefined} tabIndex={renderReason ? 0 : undefined}
              aria-describedby={renderReason ? (renderReason === finalizeReason ? finalizeReasonId : renderReasonId) : undefined}>
              <button type="button" className="button button--secondary" disabled={busy || Boolean(renderReason)}
                onClick={() => void renderVideo()}>{operation === 'render' ? '正在提交…' : render.submitLabel}</button>
            </span>
          )}
        </div>
      </footer>
    </>
  )
}

export function ProductionDesk({ id, api, writes, opener, onClose, onSaved }: {
  id: number
  api: ContentHubApi
  writes: RecordWrites
  opener: HTMLButtonElement
  onClose: () => void
  onSaved: (record: ProductionItem) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const [record, setRecord] = useState<ProductionItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const closeEditor = useRef(onClose)

  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    node?.querySelector('button')?.focus()
    return () => { node?.close(); opener.focus() }
  }, [opener])

  useEffect(() => {
    let active = true
    api.getProductionItem(id).then(
      item => { if (active) setRecord(item) },
      reason => { if (active) setError(message(reason)) },
    )
    return () => { active = false }
  }, [api, id, revision])

  return (
    <dialog ref={dialog} className="production-desk" aria-modal="true" aria-labelledby={heading}
      onCancel={event => { event.preventDefault(); closeEditor.current() }}>
      <div className="desk-shell">
        <header className="desk-header">
          <h2 id={heading}>内容精修工作台</h2>
          <button className="button button--quiet" type="button" aria-label="关闭工作台" onClick={() => closeEditor.current()}><X size={20} aria-hidden /></button>
        </header>
        {error ? <div className="desk-body">
          <p role="alert" className="topic-feedback topic-feedback--warning">工作台读取失败。{error}</p>
          <button className="button button--secondary" type="button" onClick={() => { setError(null); setRevision(value => value + 1) }}>重试读取</button>
        </div> : record ? <DeskEditor api={api} record={record} writes={writes} onSaved={onSaved} requestClose={onClose}
          registerClose={close => { closeEditor.current = close }} />
          : <p className="desk-body desk-loading" role="status"><LoaderCircle size={17} className="refresh-spinning" aria-hidden />正在读取完整记录…</p>}
      </div>
    </dialog>
  )
}
