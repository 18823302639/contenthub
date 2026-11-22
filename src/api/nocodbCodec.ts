import { complianceRisks, demandTypes, platforms, poolTypes, productionTracks, workflowStatuses } from '../types/schema'
import type { AccountMetric, ProductionItem } from '../types/schema'
import { isCalendarDay } from '../utils/metricDays'
import type { TableName, Tables } from './contracts'

type Row = Record<string, unknown>
type Decoders = { [Table in TableName]: (row: Row, id: number) => Tables[Table] }

export class NocodbStructureError extends Error {}

export function asObject(value: unknown): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new NocodbStructureError('NocoDB 响应格式错误，应为 JSON 对象。')
  }
  return value as Row
}

function warnField(field: string, handling: string) {
  console.warn('NocoDB 字段 ' + field + ' 的值未识别，' + handling + '。')
}

function positiveId(value: unknown): number | null {
  const id = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null
}

export function requireRecordId(id: number): void {
  if (typeof id !== 'number' || positiveId(id) === null) throw new Error('记录 ID 必须为正的安全整数。')
}

export function readRecordId(row: Row, idField: string): number {
  const id = positiveId(row[idField])
  if (id === null) throw new NocodbStructureError('NocoDB 记录缺少有效主键 ' + idField + '。')
  return id
}

function readNullableText(row: Row, field: string): string | null {
  const value = row[field]
  if (typeof value === 'string') return value
  if (value != null) warnField(field, '按缺失处理')
  return null
}

function readText(row: Row, field: string): string {
  return readNullableText(row, field) ?? ''
}

function readDate(row: Row, field: string): string {
  const value = readText(row, field).trim()
  if (!value) return ''
  if (isCalendarDay(value.slice(0, 10)) && Number.isFinite(Date.parse(value.replace(' ', 'T')))) return value
  warnField(field, '使用空日期')
  return ''
}

function readNumber(row: Row, field: string, min = -Infinity, max = Infinity): number | null {
  const value = row[field]
  const number = typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
    ? Number(value)
    : value
  if (typeof number === 'number' && Number.isFinite(number) && number >= min && number <= max) return number
  if (value != null && value !== '') warnField(field, '按缺失处理')
  return null
}

export function parseCheckbox(value: unknown): boolean | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value
  if (normalized === true || normalized === 1 || normalized === '1' || normalized === 'true') return true
  if (normalized === false || normalized === 0 || normalized === '0' || normalized === 'false' ||
      normalized === null) return false
  return null
}

function readCheckbox(row: Row, field: string): boolean {
  const value = row[field]
  const checkbox = parseCheckbox(value)
  if (checkbox === null && value != null && value !== '') warnField(field, '使用 false')
  return checkbox ?? false
}

function readChoice(row: Row, field: string, choices: readonly string[]): string {
  const value = readText(row, field)
  const normalized = value.trim()
  if (!normalized) return ''
  if (choices.includes(normalized)) return normalized
  warnField(field, '保留原文本')
  return value
}

function readTitles(value: unknown): string[] {
  let titles = value
  if (typeof titles === 'string') {
    const input = titles.trim()
    if (!input || input === 'null') return []
    if (!['[', '{', '"'].includes(input[0])) return [input]
    try {
      titles = JSON.parse(input)
    } catch {
      warnField('suggested_titles', '使用空数组')
      return []
    }
  }

  if (typeof titles === 'string') return titles.trim() ? [titles.trim()] : []
  if (Array.isArray(titles)) {
    const usable = titles.filter((title): title is string => typeof title === 'string' && title.trim() !== '')
    if (usable.length !== titles.length) warnField('suggested_titles', '忽略不可用项')
    return usable
  }
  if (titles != null) warnField('suggested_titles', '使用空数组')
  return []
}

function readMetrics(row: Row, id: number): AccountMetric {
  const productionId = positiveId(row.production_id)
  if (productionId === null && row.production_id != null && row.production_id !== '') {
    warnField('production_id', '按缺失处理')
  }
  return {
    id,
    production_id: productionId,
    title: readText(row, 'title'),
    platform: readChoice(row, 'platform', platforms),
    impressions: readNumber(row, 'impressions'),
    views: readNumber(row, 'views'),
    ctr: readNumber(row, 'ctr'),
    completion_rate: readNumber(row, 'completion_rate'),
    revenue: readNumber(row, 'revenue'),
    recorded_at: readDate(row, 'recorded_at'),
  }
}

const optionalProductionFields = ['raw_content', 'fact_check', 'draft_md', 'final_md', 'revision_note'] as const

const decode: Decoders = {
  rss_sources: (row, id) => ({
    id,
    name: readText(row, 'name'),
    rss_url: readText(row, 'rss_url'),
    pool_type: readChoice(row, 'pool_type', poolTypes),
    track_tag: readText(row, 'track_tag'),
    is_active: readCheckbox(row, 'is_active'),
    created_at: readDate(row, 'created_at'),
  }),

  production_pool: (row, id) => {
    const item: ProductionItem = {
      id,
      source_name: readText(row, 'source_name'),
      track_tag: readChoice(row, 'track_tag', productionTracks),
      raw_title: readText(row, 'raw_title'),
      zh_title: readText(row, 'zh_title'),
      url: readText(row, 'url'),
      key_data_points: readText(row, 'key_data_points'),
      suggested_titles: readTitles(row.suggested_titles),
      score: readNumber(row, 'score', 1, 5),
      compliance_risk: readChoice(row, 'compliance_risk', complianceRisks),
      workflow_status: readChoice(row, 'workflow_status', workflowStatuses),
      ai_outline: readNullableText(row, 'ai_outline'),
      is_benchmark: readCheckbox(row, 'is_benchmark'),
      published_at: readDate(row, 'published_at'),
      created_at: readDate(row, 'created_at'),
    }

    for (const field of optionalProductionFields) item[field] = readText(row, field)
    return item
  },

  radar_pool: (row, id) => ({
    id,
    source_name: readText(row, 'source_name'),
    raw_title: readText(row, 'raw_title'),
    summary_zh: readText(row, 'summary_zh'),
    url: readText(row, 'url'),
    domain_tag: readText(row, 'domain_tag'),
    demand_type: readChoice(row, 'demand_type', demandTypes),
    commercial_score: readNumber(row, 'commercial_score'),
    info_gap_score: readNumber(row, 'info_gap_score'),
    evergreen: readCheckbox(row, 'evergreen'),
    compliance_risk: readChoice(row, 'compliance_risk', complianceRisks),
  }),

  account_metrics: readMetrics,
  post_metrics: readMetrics,
}

export function decodeRecord<T extends TableName>(table: T, value: unknown, idField: string): Tables[T] {
  const row = asObject(value)
  return decode[table](row, readRecordId(row, idField))
}
