import { productionRiskLabel } from '../../types/schema'
import type { ProductionItem } from '../../types/schema'
import { parseRemotion, remotionText, sameRemotion } from './remotion'

const highRiskWords = ['财经', '金融', '投资', '财富', '证券', '宏观', '买入建议', '预测']

export function editorialWarnings(fields: { title: string; article: string; script: string }) {
  const entries = [['标题', fields.title], ['正文', fields.article], ['口播稿', fields.script]]
  return entries.flatMap(([label, value]) => {
    const hits = highRiskWords.filter(word => value.includes(word))
    return hits.length ? [label + ' · ' + hits.join('、')] : []
  })
}

export function reviewIssue(record: ProductionItem, warnings: string[], reviewed: boolean) {
  const highRisk = productionRiskLabel(record.compliance_risk) === '高风险'
  return (highRisk || warnings.length > 0) && !reviewed
    ? '请核对高危提示，并勾选「人工复核后将风险改为低风险」。' : null
}

export function needsRemotion(record: ProductionItem) {
  return record.track_tag !== 'sub_toutiao' && record.need_remotion !== false &&
    (record.track_tag === 'main_overseas' || record.need_remotion === true)
}

export function renderDataWarning(parsed: ReturnType<typeof parseRemotion>) {
  const { value } = parsed
  if (parsed.error || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return '建议将 Remotion 数据组织为包含 scenes 或 cards 的对象。'
  if (parsed.missingSources.length) return '请补齐一手数据来源 · ' + parsed.missingSources.join('、')
  if (parsed.missingYears.length) return '请补齐来源年份 · ' + parsed.missingYears.join('、')
  if (![value.scenes, value.cards].some(rows => Array.isArray(rows) && rows.length > 0)) {
    return '建议为 scenes 或 cards 标注一手数据来源和年份。'
  }
  return null
}

export function renderRecordIsCurrent(current: ProductionItem, latest: ProductionItem, parsed: ReturnType<typeof parseRemotion>) {
  const data = parseRemotion(remotionText(latest.remotion_data))
  const fields = ['zh_title', 'draft_md', 'final_md', 'final_content', 'video_script'] as const
  const active = ['queued', 'rendering', '排队中', '渲染中'].includes(latest.render_status?.trim().toLowerCase() ?? '')
  return latest.id === current.id && needsRemotion(latest) && !active &&
    productionRiskLabel(latest.compliance_risk) !== '高风险' && !data.error &&
    sameRemotion(data.value, parsed.value) && fields.every(field => latest[field] === current[field])
}
