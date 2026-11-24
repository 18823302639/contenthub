export const poolTypes = ['production', 'radar'] as const
export type PoolType = (typeof poolTypes)[number]

export const wf2Tracks = ['main_overseas', 'sub_toutiao'] as const
export const productionTracks = ['商业数据', '汽车家电评测', ...wf2Tracks] as const

export const productionRiskLabels = ['低风险', '中风险', '高风险'] as const
export function productionRiskLabel(value: string) {
  return productionRiskLabels.find(label => label === value.trim() || label[0] === value.trim())
}

export const complianceRisks = ['低', '中', '高'] as const
export type ComplianceRisk = (typeof complianceRisks)[number]

export const workflowStatuses = [
  '待筛选',
  '生成中',
  '待人工审核',
  '已定稿',
  '已确认-待核对',
  'AI初稿完成',
  '初稿已生成',
  '精修中',
  '需AI润色',
  '待人工终审',
  '已发布',
  '已放弃',
] as const
export type WorkflowStatus = (typeof workflowStatuses)[number]

export function isWorkflowStatus(value: string): value is WorkflowStatus {
  return workflowStatuses.some(status => status === value)
}

export const demandTypes = ['避坑决策', '猎奇反常识', '效率提升', '情绪共鸣'] as const
export type DemandType = (typeof demandTypes)[number]

export const platforms = ['公众号', '头条', 'B站'] as const
export type Platform = (typeof platforms)[number]

export const rssSyncIntervals = [0, 1, 3, 6, 12, 24] as const
export type RssSyncInterval = (typeof rssSyncIntervals)[number]

export interface RssSyncSettings {
  id: number
  sync_interval_hours: RssSyncInterval | null
  last_synced_at: string | null
  last_sync_added_count?: number | null
}

export interface RssSource {
  id: number
  name: string
  rss_url: string
  pool_type: string
  track_tag: string
  is_active: boolean
  created_at: string
}

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject
export interface JsonObject { [key: string]: JsonValue }

export interface ComplianceReport {
  status: string
  banned_word_hits: string[]
  prediction_phrase_hits: string[]
  missing_sources: string[]
  suggestion: string
}

export interface ProductionItem {
  id: number
  source_name: string
  track_tag: string
  raw_title: string
  zh_title: string
  url: string
  key_data_points: string
  /** 使用可读取的备选标题，字段缺失时为空数组。 */
  suggested_titles: string[]
  /** 1–5 分，缺失或无效时为 null。 */
  score: number | null
  compliance_risk: string
  workflow_status: string
  ai_outline: string | null
  is_benchmark: boolean
  raw_content?: string
  fact_check?: string
  draft_md?: string
  final_md?: string
  final_content?: string
  video_script?: string
  remotion_data?: JsonObject | string | null
  compliance_report?: ComplianceReport | null
  fact_check_notes?: string
  revision_note?: string
  updated_at?: string
  need_remotion?: boolean | null
  render_status?: string
  video_url?: string
  cards_urls?: string[]
  render_error?: string
  /** 未发布时为空字符串。 */
  published_at: string
  created_at: string
}

export interface RadarItem {
  id: number
  source_name: string
  raw_title: string
  summary_zh: string
  url: string
  domain_tag: string
  demand_type: string
  commercial_score: number | null
  info_gap_score: number | null
  evergreen: boolean
  compliance_risk: string
}

export interface AccountMetric {
  id: number
  production_id: number | null
  title: string
  platform: string
  impressions: number | null
  views: number | null
  /** 百分数，25 表示 25%。 */
  ctr: number | null
  /** 百分数，60 表示 60%。 */
  completion_rate: number | null
  /** 单位为元。 */
  revenue: number | null
  recorded_at: string
}

/** post_metrics 的只读投影，目前读取与 account_metrics 同名的字段。 */
export type PostMetric = AccountMetric
