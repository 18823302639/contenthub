import { complianceRisks, demandTypes, platforms, poolTypes, workflowStatuses } from '../types/schema'
import type { ProductionItem } from '../types/schema'
import type { TableName, Tables } from './contracts'

type Row = Record<string, unknown>
type Decoders = { [Table in TableName]: (row: Row, id: number) => Tables[Table] }

export function asObject(value: unknown): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('NocoDB 响应格式错误，应为 JSON 对象。')
  }
  return value as Row
}

function badField(field: string): never {
  throw new Error(`NocoDB 字段 ${field} 的值不符合 ContentHub 数据契约。`)
}

export function requireRecordId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('记录 ID 必须为正的安全整数。')
}

export function readRecordId(row: Row, idField: string): number {
  const id = row[idField]
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return badField(idField)
  return id
}

function readText(row: Row, field: string): string {
  const value = row[field]
  return typeof value === 'string' ? value : badField(field)
}

function readNumber(row: Row, field: string): number {
  const value = row[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : badField(field)
}

function readCheckbox(row: Row, field: string): boolean {
  const value = row[field]
  if (value === null) return false
  return typeof value === 'boolean' ? value : badField(field)
}

function readChoice<T extends string>(row: Row, field: string, choices: readonly T[]): T {
  const option = choices.find(choice => choice === row[field])
  return option ?? badField(field)
}

function readTitles(value: unknown): string[] {
  let titles: unknown = value
  if (typeof titles === 'string') {
    try {
      titles = JSON.parse(titles)
    } catch {
      return badField('suggested_titles')
    }
  }

  if (!Array.isArray(titles) || titles.length !== 3 || !titles.every(title => typeof title === 'string')) {
    return badField('suggested_titles')
  }
  return titles
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
    created_at: readText(row, 'created_at'),
  }),

  production_pool: (row, id) => {
    const score = readNumber(row, 'score')
    if (score < 1 || score > 5) return badField('score')

    const item: ProductionItem = {
      id,
      source_name: readText(row, 'source_name'),
      track_tag: readText(row, 'track_tag'),
      raw_title: readText(row, 'raw_title'),
      zh_title: readText(row, 'zh_title'),
      url: readText(row, 'url'),
      key_data_points: readText(row, 'key_data_points'),
      suggested_titles: readTitles(row.suggested_titles),
      score,
      compliance_risk: readChoice(row, 'compliance_risk', complianceRisks),
      workflow_status: readChoice(row, 'workflow_status', workflowStatuses),
      published_at: row.published_at === null ? '' : readText(row, 'published_at'),
      created_at: readText(row, 'created_at'),
    }

    for (const field of optionalProductionFields) {
      if (row[field] != null) item[field] = readText(row, field)
    }
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
    compliance_risk: readText(row, 'compliance_risk'),
  }),

  account_metrics: (row, id) => ({
    id,
    production_id: readRecordId(row, 'production_id'),
    title: readText(row, 'title'),
    platform: readChoice(row, 'platform', platforms),
    impressions: readNumber(row, 'impressions'),
    views: readNumber(row, 'views'),
    ctr: readNumber(row, 'ctr'),
    completion_rate: readNumber(row, 'completion_rate'),
    revenue: readNumber(row, 'revenue'),
    recorded_at: readText(row, 'recorded_at'),
  }),
}

export function decodeRecord<T extends TableName>(table: T, value: unknown, idField: string): Tables[T] {
  const row = asObject(value)
  return decode[table](row, readRecordId(row, idField))
}
