import { Copy, LoaderCircle, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { wf3NotConfigured } from '../../api'
import type { ContentHubApi, ProductionUpdate } from '../../api'
import type { RecordWrites } from '../../app/useRecordWrites'
import { productionRiskLabel } from '../../types/schema'
import type { ProductionItem } from '../../types/schema'
import { externalUrl } from '../../utils/externalUrl'
import { MarkdownPreview, renderMarkdownHtml } from '../workbench/MarkdownPreview'
import { ComplianceBanner } from './ComplianceBanner'
import { parseRemotion, remotionText, sameRemotion } from './remotion'
import './productionDesk.css'

const tabs = [
  { id: 'article', label: '图文正文', video: false },
  { id: 'script', label: '视频口播稿', video: true },
  { id: 'remotion', label: 'Remotion 渲染数据', video: true },
  { id: 'sources', label: '原始信源与大纲', video: false },
] as const
type TabId = (typeof tabs)[number]['id']
type Operation = 'save' | 'finalize' | 'render'
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
      return !parsed.error && sameRemotion(parsed.value, patch.remotion_data)
    }
    return (record[key] ?? '') === patch[key]
  })
}

function SourceReference({ record }: { record: ProductionItem }) {
  const url = externalUrl(record.url)
  return (
    <div className="desk-reference">
      <div><h3>原文标题</h3><p>{record.raw_title || '暂无原文标题。'}</p>
        {url && <a className="topic-origin" href={url} target="_blank" rel="noopener noreferrer">打开原文</a>}
      </div>
      <div><h3>核心数据点</h3><p>{record.key_data_points || '暂无核心数据点。'}</p></div>
      <div><h3>AI 大纲</h3>{record.ai_outline?.trim() ? <MarkdownPreview text={record.ai_outline} /> : <p>暂无大纲。</p>}</div>
      <div><h3>原始素材</h3><p>{record.raw_content || '暂无原始素材。'}</p></div>
    </div>
  )
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
  const [tab, selectTab] = useState<TabId>('article')
  const [markLow, setMarkLow] = useState(false)
  const [operation, setOperation] = useState<Operation | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const main = record.track_tag === 'main_overseas'
  const enabledTabs = tabs.filter(option => !option.video || main)
  const parsed = parseRemotion(values.remotion)
  const sourceIssues = parsed.missingSources.join('、')
  const locked = writes.lockedIds.has(record.id)
  const busy = operation !== null || locked || record.workflow_status === '生成中'
  const original = fields(record)
  const dirty = markLow || Object.keys(values).some(key => values[key as keyof typeof values] !== original[key as keyof typeof values])
  const savedRender = parseRemotion(original.remotion)
  const renderReason = parsed.error || (!parsed.value ? '请先填写 Remotion JSON。' : null) ||
    (sourceIssues ? '请补齐渲染来源：' + sourceIssues : null) ||
    (productionRiskLabel(record.compliance_risk) === '高风险' ? '高风险稿件需先人工复核并降低风险等级。' : null) ||
    (api.wf3Configured && !sameRemotion(savedRender.value, parsed.value) ? '请先保存当前渲染数据。' : null)
  const saveDisabled = busy || (main && Boolean(parsed.error))
  const canFinalize = Boolean(values.title.trim() && values.article.trim())
  const seconds = Math.ceil(length(values.script) * 60 / 260)
  const activeTab = enabledTabs.some(option => option.id === tab) ? tab : 'article'
  const jsonIssueVisible = activeTab === 'remotion' && Boolean(parsed.error || sourceIssues)
  const renderReasonId = group + (jsonIssueVisible ? '-json-issues' : '-render-reason')

  useEffect(() => {
    registerClose(() => {
      if (operation === 'save' || operation === 'finalize') return
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
    if (saveDisabled || (finalize && !canFinalize)) return
    const release = writes.acquire(record.id)
    if (!release) return
    const patch: ProductionUpdate = { zh_title: values.title.trim(), draft_md: values.article }
    if (main) Object.assign(patch, { video_script: values.script, remotion_data: parsed.value })
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
      if (finalize) setMarkLow(false)
      setNotice({ text: finalize ? '已保存并定稿' : '草稿已保存' })
    } catch (error) {
      setNotice({ text: '保存结果未确认。' + message(error), error: true })
    } finally {
      setOperation(null)
      release()
    }
  }

  async function renderVideo() {
    if (!main || renderReason || busy) return
    if (!api.wf3Configured) {
      setNotice({ text: wf3NotConfigured })
      return
    }
    const release = writes.acquire(record.id)
    if (!release) return
    setNotice(null)
    setOperation('render')
    try {
      const latest = await api.getProductionItem(record.id)
      const latestRemotion = parseRemotion(remotionText(latest.remotion_data))
      if (latest.track_tag !== 'main_overseas' || productionRiskLabel(latest.compliance_risk) === '高风险' ||
          latestRemotion.error || latestRemotion.missingSources.length || !sameRemotion(latestRemotion.value, parsed.value)) {
        setRecord(latest)
        setNotice({ text: '记录已更新或不满足渲染条件。请核对风险等级和已保存的渲染数据。', error: true })
        return
      }
      await api.triggerRender(record.id)
      setNotice({ text: 'Remotion 渲染请求已受理' })
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

        <div className="desk-tabs" role="tablist" aria-label="精修内容" onKeyDown={event => {
          const index = enabledTabs.findIndex(option => option.id === activeTab)
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          if (!step && event.key !== 'Home' && event.key !== 'End') return
          event.preventDefault()
          const next = step ? (index + step + enabledTabs.length) % enabledTabs.length : event.key === 'Home' ? 0 : enabledTabs.length - 1
          selectTab(enabledTabs[next].id)
          event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')[next]?.focus()
        }}>
          {tabs.map(option => (
            <button id={group + '-' + option.id} key={option.id} type="button" role="tab"
              disabled={option.video && !main} title={option.video && !main ? '副赛道无需视频' : undefined}
              className={main && option.id === 'script' ? 'desk-tab-featured' : undefined}
              aria-selected={option.id === activeTab} aria-controls={group + '-panel'}
              tabIndex={option.id === activeTab ? 0 : -1} onClick={() => selectTab(option.id)}>{option.label}</button>
          ))}
        </div>
        {!main && <p className="desk-muted">{record.track_tag === 'sub_toutiao' ? '副赛道无需视频' : '当前赛道无需视频'}</p>}
        <div className="desk-panel" role="tabpanel" id={group + '-panel'} aria-labelledby={group + '-' + activeTab}>
          {activeTab === 'article' && (
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
          {activeTab === 'script' && (
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
          {activeTab === 'remotion' && (
            <>
              <div className="desk-editor-toolbar">
                <label htmlFor={group + '-json-editor'}>Remotion JSON</label>
                <button className="button button--secondary" type="button" disabled={busy || !parsed.value}
                  onClick={() => change('remotion', JSON.stringify(parsed.value, null, 2))}>格式化 JSON</button>
              </div>
              {(parsed.error || sourceIssues) && <p id={group + '-json-issues'} className="topic-feedback topic-feedback--warning" role="alert">
                {parsed.error || '缺少非空来源：' + sourceIssues}
              </p>}
              <textarea className="desk-json" spellCheck={false} id={group + '-json-editor'} value={values.remotion} disabled={busy}
                aria-invalid={Boolean(parsed.error || sourceIssues)}
                aria-describedby={parsed.error || sourceIssues ? group + '-json-issues' : undefined}
                onChange={event => change('remotion', event.target.value)} />
            </>
          )}
          {activeTab === 'sources' && <SourceReference record={record} />}
        </div>
      </div>

      <footer className="desk-footer">
        {notice && <p className={'topic-feedback' + (notice.error ? ' topic-feedback--warning' : '')}
          role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
        {main && renderReason && !jsonIssueVisible && <small className="desk-muted" id={renderReasonId}>{renderReason}</small>}
        <div className="desk-actions">
          <label><input type="checkbox" checked={markLow} disabled={busy} onChange={event => setMarkLow(event.target.checked)} />
            人工复核后将风险改为低风险
          </label>
          <button type="button" className="button button--secondary" disabled={saveDisabled}
            onClick={() => void save(false)}>{operation === 'save' ? '正在保存…' : '保存草稿'}</button>
          <button type="button" className="button button--primary" disabled={saveDisabled || !canFinalize}
            title={!canFinalize ? '定稿需要中文标题和图文正文' : undefined}
            onClick={() => void save(true)}>{operation === 'finalize' ? '正在定稿…' : '人工复核通过并定稿'}</button>
          {main && (
            <span title={renderReason ?? undefined} tabIndex={renderReason ? 0 : undefined}
              aria-describedby={renderReason ? renderReasonId : undefined}>
              <button type="button" className="button button--secondary" disabled={busy || Boolean(renderReason)}
                onClick={() => void renderVideo()}>{operation === 'render' ? '正在提交…' : '提交 Remotion 渲染'}</button>
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
