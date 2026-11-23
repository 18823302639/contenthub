import { AlertTriangle, ShieldCheck } from 'lucide-react'
import type { ProductionItem } from '../../types/schema'
import { MarkdownPreview } from '../workbench/MarkdownPreview'

const passedStatuses = new Set(['pass', 'passed', 'ok', 'success', '通过', '合规通过', '合规初检通过'])

export function ComplianceBanner({ record }: { record: ProductionItem }) {
  const report = record.compliance_report
  const issues = report ? [
    { label: '红线词', items: report.banned_word_hits },
    { label: '预测词', items: report.prediction_phrase_hits },
    { label: '缺少信源', items: report.missing_sources },
  ] : []
  const red = Boolean(report && (report.banned_word_hits.length || report.prediction_phrase_hits.length))
  const missing = Boolean(report?.missing_sources.length)
  const passed = Boolean(report && !red && !missing && passedStatuses.has(report.status.trim().toLowerCase()))
  const tone = red ? 'danger' : passed ? 'success' : 'warning'
  const title = red ? '合规初检命中红线或预测词' : missing ? '合规初检发现信源缺失'
    : passed ? '合规初检通过' : report ? '合规初检待核对' : '事实核查备注'

  return (
    <div className={'desk-compliance desk-compliance--' + tone} role={passed ? 'status' : 'alert'}>
      <strong>{passed ? <ShieldCheck size={18} aria-hidden /> : <AlertTriangle size={18} aria-hidden />}{title}</strong>
      {issues.map(({ label, items }) => items.length > 0 && (
        <div key={label}><b>{label}</b>
          <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>
      ))}
      {report?.suggestion && <p>修改建议：{report.suggestion}</p>}
      {!report && (record.fact_check_notes?.trim()
        ? <MarkdownPreview text={record.fact_check_notes} />
        : <p>暂无合规报告或事实核查备注。</p>)}
    </div>
  )
}
