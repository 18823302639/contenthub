export const poolTypes = ['production', 'radar'] as const
export type PoolType = (typeof poolTypes)[number]

export const complianceRisks = ['低', '中', '高'] as const
export type ComplianceRisk = (typeof complianceRisks)[number]

export const workflowStatuses = [
  '待筛选',
  '已确认-待核对',
  'AI初稿完成',
  '需AI润色',
  '待人工终审',
  '已发布',
  '已放弃',
] as const
export type WorkflowStatus = (typeof workflowStatuses)[number]

export const demandTypes = ['避坑决策', '猎奇反常识', '效率提升', '情绪共鸣'] as const
export type DemandType = (typeof demandTypes)[number]

export const platforms = ['公众号', '头条', 'B站'] as const
export type Platform = (typeof platforms)[number]

export interface RssSource {
  id: number
  name: string
  rss_url: string
  pool_type: PoolType
  track_tag: string
  is_active: boolean
  created_at: string
}

export interface ProductionItem {
  id: number
  source_name: string
  track_tag: string
  raw_title: string
  zh_title: string
  url: string
  key_data_points: string
  /** 恰好三个备选标题。 */
  suggested_titles: string[]
  /** 1–5 分。 */
  score: number
  compliance_risk: ComplianceRisk
  workflow_status: WorkflowStatus
  raw_content?: string
  fact_check?: string
  draft_md?: string
  final_md?: string
  revision_note?: string
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
  demand_type: DemandType
  commercial_score: number
  info_gap_score: number
  evergreen: boolean
  compliance_risk: string
}

export interface AccountMetric {
  id: number
  production_id: number
  title: string
  platform: Platform
  impressions: number
  views: number
  /** 百分数，25 表示 25%。 */
  ctr: number
  /** 百分数，60 表示 60%。 */
  completion_rate: number
  /** 单位为元。 */
  revenue: number
  recorded_at: string
}
