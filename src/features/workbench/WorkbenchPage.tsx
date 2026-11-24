import { ArrowDown, ArrowLeft, ArrowUpRight, Bookmark, Clipboard, LoaderCircle, RefreshCw, Save, Sparkles } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { To } from 'react-router-dom'
import type { RecordWrites } from '../../app/useRecordWrites'
import type { ContentHubApi } from '../../api'
import { aiProcessingLabel } from '../../api/workflowPolling'
import { isWorkflowStatus, productionRiskLabel } from '../../types/schema'
import type { ProductionItem } from '../../types/schema'
import { externalUrl } from '../../utils/externalUrl'
import { MarkdownPreview } from './MarkdownPreview'
import { useUnsavedChanges } from '../../app/UnsavedChanges'
import { lastWorkbenchId, rememberWorkbench, WorkbenchQueue, workbenchQueue } from './WorkbenchQueue'
import { needsRemotion, editorialWarnings, renderDataIssue, renderRecordIsCurrent, reviewIssue } from '../productionDesk/editingRules'
import { parseRemotion, remotionText } from '../productionDesk/remotion'
import { RenderResults, useRenderResults } from '../productionDesk/RenderResults'
import { VideoControls } from './VideoControls'
import { useWorkbench } from './useWorkbench'
import type { WorkbenchSession } from './useWorkbench'
import './workbench.css'

interface WorkbenchProps {
  queue: { items: ProductionItem[] | null; loading: boolean; loadError: string | null; refresh: () => Promise<void> }
  api: ContentHubApi
  writes: RecordWrites
  sessions: Map<number, WorkbenchSession>
  onWrite: (record: ProductionItem) => void
  refreshBoard: () => void
}
type Tab<T extends string> = { value: T; label: string }

const sourceTabs = [
  { value: 'raw', label: '原文素材' },
  { value: 'checks', label: 'AI 事实核查清单' },
  { value: 'outline', label: 'AI 大纲' },
] as const
const editorTabs = [
  { value: 'editor', label: '编辑' },
  { value: 'preview', label: '预览' },
  { value: 'incoming', label: '回写稿' },
  { value: 'backup', label: '本地备份' },
] as const

const revisionTemplates = [
  { label: '去研报/AI味', note: '彻底去掉学术研报腔，删掉“数据口径”等生硬小标题和过渡句，改用口语化短句，每段不超过3行，增强阅读节奏感。' },
  { label: '公众号深度', note: '强化开头3句反常识冲击力，挑出最反差的数据做重点对比，后半段补充2个商业或社会心理归因，字数扩写到2000字左右，结尾克制不喊口号。' },
  { label: '头条号快节奏', note: '压缩到1200字以内，开头第一句直接抛结论或反常识数字，小标题改为带悬念的问句，多用口语连接词，结尾加一个引发评论区讨论的问题。' },
  { label: '逻辑拔高', note: '删掉车轱辘话和废话，保留全部核查数据与年份口径，将核心观点改为“反常识结论+数据支撑+现实推演”结构，提升信息密度。' },
] as const

function Tabs<T extends string>({ group, label, options, value, select }: {
  group: string
  label: string
  options: readonly Tab<T>[]
  value: T
  select: (value: T) => void
}) {
  return (
    <div className="wb-tabs" role="tablist" aria-label={label} onKeyDown={event => {
      const current = options.findIndex(tab => tab.value === value)
      let next: number
      switch (event.key) {
        case 'ArrowLeft': next = (current + options.length - 1) % options.length; break
        case 'ArrowRight': next = (current + 1) % options.length; break
        case 'Home': next = 0; break
        case 'End': next = options.length - 1; break
        default: return
      }
      event.preventDefault()
      select(options[next].value)
      event.currentTarget.querySelectorAll('button')[next]?.focus()
    }}>
      {options.map(tab => (
        <button
          key={tab.value}
          type="button"
          id={`${group}-${tab.value}`}
          role="tab"
          aria-selected={value === tab.value}
          aria-controls={`${group}-panel`}
          tabIndex={value === tab.value ? 0 : -1}
          onClick={() => select(tab.value)}
        >{tab.label}</button>
      ))}
    </div>
  )
}

function Sources({ record }: { record: ProductionItem }) {
  const [tab, setTab] = useState<(typeof sourceTabs)[number]['value']>('raw')
  const group = useId()
  const url = externalUrl(record.url)
  const markdown = tab === 'outline' ? record.ai_outline : record.fact_check

  return (
    <section className="wb-panel" aria-labelledby={`${group}-title`}>
      <div className="wb-panel-title">
        <h2 id={`${group}-title`}>参考素材</h2>
        {url && (
          <a className="topic-origin" href={url} target="_blank" rel="noopener noreferrer">
            打开原文<ArrowUpRight size={14} aria-hidden />
          </a>
        )}
      </div>
      <Tabs group={group} label="参考素材" options={sourceTabs} value={tab} select={setTab} />
      <div className="wb-source-body" role="tabpanel" id={`${group}-panel`} aria-labelledby={`${group}-${tab}`} tabIndex={0}>
        {tab === 'raw' ? (
          record.raw_content?.trim()
            ? <p className="wb-original">{record.raw_content}</p>
            : <p className="wb-muted">暂无原文素材。</p>
        ) : (
          markdown?.trim()
            ? <MarkdownPreview text={markdown} />
            : <p className="wb-muted">{tab === 'outline' ? '暂无大纲' : '暂无 AI 事实核查清单。'}</p>
        )}
      </div>
    </section>
  )
}

function EditorPanel({ workbench, panel }: { workbench: ReturnType<typeof useWorkbench>; panel: RefObject<HTMLElement> }) {
  const [selected, select] = useState<(typeof editorTabs)[number]['value']>('editor')
  const group = useId()
  const { doc, dirty, edit, adoptIncoming, restoreBackup } = workbench
  if (!doc) return null
  const options = editorTabs.filter(option => (
    (option.value !== 'incoming' || doc.incoming !== null) && (option.value !== 'backup' || doc.backups.length > 0)
  ))
  const tab = options.some(option => option.value === selected) ? selected : 'editor'

  return (
    <section className="wb-panel wb-draft" ref={panel} tabIndex={-1} aria-labelledby={`${group}-title`}>
      <div className="wb-panel-title">
        <h2 id={`${group}-title`}>稿件</h2>
        <span className={dirty ? 'wb-dirty' : 'wb-muted'}>
          {dirty ? '有未保存编辑' : doc.preferredDraft !== null ? 'AI 回写初稿' : doc.record.final_md?.trim() ? '定稿' : '初稿'}
        </span>
      </div>
      <Tabs group={group} label="稿件视图" options={options} value={tab} select={select} />
      <div className="wb-editor-body" role="tabpanel" id={`${group}-panel`} aria-labelledby={`${group}-${tab}`} tabIndex={tab === 'editor' ? -1 : 0}>
        {tab === 'editor' && (
          <>
            {!doc.markdown && <p className="wb-muted wb-empty-document">暂无稿件，可直接编辑。</p>}
            <textarea className="wb-editor" aria-label="Markdown 编辑器" spellCheck={false}
              value={doc.markdown} onChange={event => edit(event.target.value)} />
          </>
        )}
        {tab === 'preview' && (
          doc.markdown.trim() ? <MarkdownPreview text={doc.markdown} /> : <p className="wb-muted">暂无可预览的稿件。</p>
        )}
        {tab === 'incoming' && (
          <>
            <div className="wb-incoming">
              <p>当前编辑仍保留。采用回写稿会替换编辑区。</p>
              <button className="button button--secondary" onClick={() => { adoptIncoming(); select('editor') }}>
                用回写稿替换当前编辑
              </button>
            </div>
            {doc.incoming?.trim() ? <MarkdownPreview text={doc.incoming} /> : <p className="wb-muted">回写稿为空。</p>}
          </>
        )}
        {tab === 'backup' && doc.backups.map((backup, index) => (
          <div className="wb-backup" key={backup}>
            <button type="button" className="button button--secondary" onClick={() => { restoreBackup(index); select('editor') }}>
              恢复这份备份
            </button>
            {backup.trim() ? <MarkdownPreview text={backup} /> : <p className="wb-muted">这份备份为空稿。</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

function Workbench({ api, id, writes, sessions, onWrite, refreshBoard, topicsPath }: WorkbenchProps & { id: number; topicsPath: To }) {
  const workbench = useWorkbench(api, id, writes, onWrite, refreshBoard, sessions)
  const { doc, operation, notice, copyNotice, watching } = workbench
  const record = doc?.record
  const [reviewTicket, setReviewTicket] = useState<string | null>(null)
  const [polishNote, setPolishNote] = useState('')
  const [reviewedFields, setReviewedFields] = useState<string | null>(null)
  const [renderingRequest, setRenderingRequest] = useState(false)
  const [renderNotice, setRenderNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const video = Boolean(record && needsRemotion(record))
  const render = useRenderResults(api, record, video)
  const parsed = parseRemotion(video ? workbench.remotion : '')
  const warnings = editorialWarnings({ title: record?.zh_title ?? '', article: doc?.markdown ?? '', script: workbench.script })
  const reviewKey = JSON.stringify([record?.zh_title, doc?.markdown, workbench.script, workbench.remotion])
  const markLow = reviewTicket === reviewKey
  const reviewReason = record ? reviewIssue(record, warnings, markLow || reviewedFields === reviewKey) : null
  const dataReason = video ? renderDataIssue(parsed) : null
  const finalizeReason = reviewReason || dataReason || (!record?.zh_title.trim() ? '请先补齐中文标题。' : null)
  const renderReason = reviewReason || dataReason ||
    (productionRiskLabel(record?.compliance_risk ?? '') === '高风险' ? '请先用人工复核操作保存低风险等级。' : null) ||
    (workbench.dirty ? '请先保存草稿和渲染数据。' : null) ||
    (render.phase === 'rendering' ? '已在渲染，请等待本次结果。' : null)
  useUnsavedChanges(workbench.dirty || markLow)
  useEffect(() => { if (record) rememberWorkbench(record.id) }, [record])
  const noteId = useId()
  const jsonId = noteId + '-remotion'
  const finalizeReasonId = noteId + '-finalize-reason'
  const renderReasonId = noteId + '-render-reason'
  const draftPanel = useRef<HTMLElement>(null)
  const sendingRewrite = operation === 'rewriting'
  const rewritingLabel = watching ? aiProcessingLabel : sendingRewrite ? '正在提交改稿…' : 'AI 去味改稿'

  async function submitRender() {
    if (!record || !video || renderReason || renderingRequest || operation !== null) return
    const release = writes.acquire(id)
    if (!release) return
    setRenderingRequest(true)
    setRenderNotice(null)
    try {
      const latest = await api.getProductionItem(id)
      if (!renderRecordIsCurrent(record, latest, parsed)) {
        throw new Error('记录已变更或不满足渲染条件，请刷新记录核对。')
      }
      await api.triggerRender(id)
      render.accepted(latest)
      setRenderNotice({ text: 'Remotion 渲染请求已受理' })
    } catch (error) {
      setRenderNotice({ text: error instanceof Error ? error.message : '渲染请求未确认。', error: true })
    } finally {
      setRenderingRequest(false)
      release()
    }
  }

  return (
    <section className="wb-workspace-editor" aria-labelledby="workbench-heading">
      <header className="page-header wb-page-header">
        <div>
          <h1 id="workbench-heading">改稿台</h1>
          <p>选题记录 #{id}{record ? ` · ${record.zh_title}` : ''}</p>
        </div>
        <div className="wb-header-actions">
          <Link className="button button--quiet" to={topicsPath}><ArrowLeft size={15} aria-hidden />返回选题看板</Link>
          <button className="button button--secondary" disabled={operation !== null} onClick={() => void workbench.refresh()}>
            <RefreshCw size={15} aria-hidden />刷新记录
          </button>
        </div>
      </header>

      {!record && operation === 'reading' && <p className="read-error wb-loading" role="status">正在加载选题…</p>}
      {notice && (
        <div className={notice.error ? 'topic-feedback topic-feedback--warning wb-notice' : 'topic-feedback wb-notice'} role={notice.error ? 'alert' : 'status'}>
          {notice.rewriteComplete && doc?.incoming != null ? '改稿结果已回写，当前编辑已保留。' : notice.text}
          {notice.rewriteComplete && Boolean(doc?.backups.length) && ' 未保存的人工内容可在「本地备份」恢复。'}
        </div>
      )}
      {copyNotice && (
        <div className={copyNotice.error ? 'topic-feedback topic-feedback--warning wb-notice' : 'topic-feedback wb-notice'} role={copyNotice.error ? 'alert' : 'status'}>
          {copyNotice.text}
        </div>
      )}
      {record && doc && (
        <>
          <div className="wb-toolbar">
            <div className="wb-note">
              <label htmlFor={noteId}>修改意见</label>
              <div className="wb-note-templates" role="group" aria-label="改稿快捷模板">
                {revisionTemplates.map(template => (
                  <button type="button" className="button button--secondary" key={template.label}
                    onClick={() => workbench.setNote(template.note)}>{template.label}</button>
                ))}
              </div>
              <textarea rows={2} id={noteId} placeholder="留空则由 AI 主编自动挑刺并去味重写；或点击上方快捷模板 / 输入具体意见"
                value={workbench.note} onChange={event => workbench.setNote(event.target.value)} />
            </div>
            <div className="wb-toolbar-buttons">
              <button className="button button--primary" disabled={!workbench.canRewrite} aria-busy={watching || sendingRewrite}
                onClick={() => void workbench.rewrite()}>
                {watching || sendingRewrite ? <LoaderCircle size={15} className="refresh-spinning" aria-hidden />
                  : <Sparkles size={15} aria-hidden />}{rewritingLabel}
              </button>
              <button className="button button--secondary" disabled={!doc.markdown.trim()} onClick={() => void workbench.copy('rich')}>
                <Clipboard size={15} aria-hidden />复制全文
              </button>
              <button type="button" className="button button--quiet" disabled={!doc.markdown.trim()} onClick={() => void workbench.copy('markdown')}>
                复制 Markdown
              </button>
              <button className="button button--secondary" disabled={!workbench.canPublish} onClick={() => void workbench.publish()}>
                标记为已发布
              </button>
              <button type="button" className="button button--secondary wb-benchmark" role="switch" aria-label="标杆样本"
                aria-checked={record.is_benchmark} aria-disabled={!workbench.canToggleBenchmark}
                onClick={() => void workbench.toggleBenchmark()}>
                <Bookmark size={15} aria-hidden />标杆样本<span>{record.is_benchmark ? '已标记' : '未标记'}</span>
              </button>
            </div>
            <div className="wb-record-status">
              <span className="pill pill--neutral">{record.workflow_status || '未标注状态'}</span>
              {!isWorkflowStatus(record.workflow_status) && <span>流程状态未识别，暂不能提交 AI 改稿或登记发布。</span>}
              {record.workflow_status === '已发布' && record.published_at &&
                <time dateTime={record.published_at}>{record.published_at}</time>}
              {workbench.pending && !notice && <span>等待回写，可刷新记录查询进度。</span>}
              {!workbench.pending && workbench.dirty && <span>稿件尚有未保存的编辑。</span>}
              <button type="button" className="button button--quiet wb-jump-to-draft" onClick={() => draftPanel.current?.focus()}>
                <ArrowDown size={15} aria-hidden />跳到稿件
              </button>
            </div>
            {record.need_remotion !== false && record.track_tag !== 'sub_toutiao' && <VideoControls api={api} productionId={id} />}
          </div>
          <div className="wb-grid">
            <Sources record={record} />
            <EditorPanel workbench={workbench} panel={draftPanel} />
          </div>
          {warnings.length > 0 && <p className="topic-feedback topic-feedback--warning" role="status">
            高危词待核对 · {warnings.join('；')}
          </p>}
          {video && <div className="wb-remotion">
            <details>
              <summary>视频口播与 Remotion 渲染数据</summary>
              <label htmlFor={jsonId + '-script'}>视频口播稿</label>
              <textarea id={jsonId + '-script'} value={workbench.script} disabled={operation === 'polishing'}
                onChange={event => workbench.editScript(event.target.value)} />
              <label htmlFor={jsonId}>Remotion JSON</label>
              <button type="button" className="button button--secondary" disabled={!parsed.value}
                onClick={() => workbench.editRemotion(JSON.stringify(parsed.value, null, 2))}>格式化 JSON</button>
              <textarea className="desk-json" spellCheck={false} id={jsonId} value={workbench.remotion}
                aria-invalid={Boolean(dataReason)} aria-describedby={dataReason ? jsonId + '-error' : undefined}
                onChange={event => workbench.editRemotion(event.target.value)} />
              {dataReason && <p id={jsonId + '-error'} className="topic-feedback topic-feedback--warning">{dataReason}</p>}
            </details>
            <RenderResults model={render} />
          </div>}
          <footer className="wb-action-footer">
            {renderNotice && <p role={renderNotice.error ? 'alert' : 'status'}>{renderNotice.text}</p>}
            {finalizeReason && <small id={finalizeReasonId}>{finalizeReason}</small>}
            {video && renderReason && renderReason !== finalizeReason && <small id={renderReasonId}>{renderReason}</small>}
            <div className="wb-footer-ai">
              <label htmlFor={noteId + '-polish'}>修改侧重点（可选）</label>
              <input id={noteId + '-polish'} value={polishNote} disabled={operation === 'polishing'}
                onChange={event => setPolishNote(event.target.value)} placeholder="例如强化开头的数据对比" />
              <button type="button" className="button button--secondary" disabled={!workbench.canPolish}
                aria-busy={operation === 'polishing'} onClick={() => void workbench.polish(polishNote)}>
                <Sparkles size={15} aria-hidden />{operation === 'polishing' ? 'AI 改稿中…' : 'AI 挑刺去味'}
              </button>
            </div>
            <div className="wb-footer-actions">
              <label><input type="checkbox" checked={markLow} onChange={event => setReviewTicket(event.target.checked ? reviewKey : null)} /> 人工复核后将风险改为低风险</label>
              {(workbench.dirty || markLow) && <span className="wb-dirty">未保存</span>}
              <button type="button" className="button button--secondary" disabled={!workbench.canSaveDraft || (video && Boolean(parsed.error))}
                onClick={() => void workbench.saveDraft()}><Save size={15} aria-hidden />保存草稿</button>
              <button type="button" className="button button--primary" disabled={!workbench.canSaveDraft || Boolean(finalizeReason)}
                aria-describedby={finalizeReason ? finalizeReasonId : undefined}
                onClick={() => void workbench.saveDraft(true, markLow, saved => {
                  if (markLow) setReviewedFields(JSON.stringify([saved.zh_title, saved.draft_md, saved.video_script ?? '', remotionText(saved.remotion_data)]))
                  setReviewTicket(null)
                })}>人工复核通过并定稿</button>
              {video && <button type="button" className="button button--secondary" disabled={Boolean(renderReason) || renderingRequest || operation !== null || writes.lockedIds.has(id)}
                aria-describedby={renderReason ? (renderReason === finalizeReason ? finalizeReasonId : renderReasonId) : undefined}
                onClick={() => void submitRender()}>{renderingRequest ? '正在提交…' : '提交 Remotion 渲染'}</button>}
              <button type="button" className="button button--quiet" disabled={!workbench.canSave || Boolean(finalizeReason) || markLow}
                onClick={() => void workbench.save()}>保存定稿</button>
            </div>
          </footer>
        </>
      )}
    </section>
  )
}

export function WorkbenchPage(props: WorkbenchProps) {
  const { id } = useParams()
  const { state, search } = useLocation()
  const navigate = useNavigate()
  const { queue } = props
  const { refresh } = queue
  const [defaultId, setDefaultId] = useState(lastWorkbenchId)
  const topicsPath = { pathname: '/topics', search: typeof state?.topicsSearch === 'string' ? state.topicsSearch : '' }
  const rows = workbenchQueue(queue.items ?? [])
  const requested = new URLSearchParams(search).get('id')
  const routeId = id ? Number(id) : undefined
  const queryId = requested && /^[1-9]\d*$/.test(requested) ? Number(requested) : undefined
  const selected = queryId !== undefined && rows.some(item => item.id === queryId) ? queryId :
    routeId ?? (rows.some(item => item.id === defaultId) ? defaultId : rows[0]?.id)
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { if (selected !== undefined) setDefaultId(selected) }, [selected])

  if (id && (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(routeId))) {
    return (
      <section className="placeholder" aria-labelledby="invalid-workbench-heading">
        <h1 id="invalid-workbench-heading">改稿台</h1>
        <p role="alert">选题 ID 无效。</p>
        <Link className="button button--secondary" to={topicsPath}>返回选题看板</Link>
      </section>
    )
  }

  return <div className="wb-workspace">
    <WorkbenchQueue items={rows} id={selected} loading={queue.loading} error={queue.loadError}
      refresh={() => void refresh()} navigate={target => void navigate(target, { state })} state={state} />
    {selected !== undefined
      ? <Workbench key={selected} {...props} id={selected} topicsPath={topicsPath} />
      : <section className="placeholder" aria-labelledby="empty-workbench-heading">
        <h1 id="empty-workbench-heading">改稿台</h1>
        {queue.items === null && queue.loading ? <p role="status">正在查找待改稿件…</p>
          : queue.items === null && queue.loadError ? <>
            <p role="alert">无法读取改稿队列。</p>
            <button type="button" className="button button--secondary" onClick={() => void refresh()}>重新读取</button>
          </> : <>
            <p>暂无待改稿件。你可以从选题看板生成初稿。</p>
            <Link className="button button--secondary" to={topicsPath}>返回选题看板</Link>
          </>}
      </section>}
  </div>
}
