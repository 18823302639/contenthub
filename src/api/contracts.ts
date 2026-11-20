import type { AccountMetric, PoolType, ProductionItem, RadarItem, RssSource, WorkflowStatus } from '../types/schema'

export interface ProductionFilters {
  trackTag?: string
  minScore?: number
  status?: WorkflowStatus
}

export interface RadarFilters {
  minCommercialScore?: number
  minInfoGapScore?: number
}

export type NewRssSource = Omit<RssSource, 'id' | 'created_at'>
export type NewAccountMetric = Omit<AccountMetric, 'id'>
export type ProductionUpdate = Partial<Pick<ProductionItem,
  'workflow_status' | 'raw_content' | 'fact_check' | 'draft_md' | 'final_md' | 'revision_note' | 'published_at'
>>

export interface WebhookPayloads {
  'fetch-and-draft': { production_id: number }
  'rewrite-draft': { production_id: number; revision_note: string }
}

export type WebhookAction = keyof WebhookPayloads
export type WebhookRequest = {
  [Action in WebhookAction]: [action: Action, payload: WebhookPayloads[Action]]
}[WebhookAction]

export interface WebhookReceipt {
  accepted: true
  status: number
}

export interface ContentHubApi {
  readonly mode: 'mock' | 'real'
  listProductionItems(filters?: ProductionFilters): Promise<ProductionItem[]>
  getProductionItem(id: number): Promise<ProductionItem>
  updateProductionItem(id: number, changes: ProductionUpdate): Promise<ProductionItem>
  listRssSources(poolType?: PoolType): Promise<RssSource[]>
  createRssSource(source: NewRssSource): Promise<RssSource>
  setRssSourceActive(id: number, active: boolean): Promise<RssSource>
  listRadarItems(filters?: RadarFilters): Promise<RadarItem[]>
  /** since 为含该时间点的下界。 */
  listAccountMetrics(since?: string): Promise<AccountMetric[]>
  createAccountMetric(metric: NewAccountMetric): Promise<AccountMetric>
  triggerWebhook(...request: WebhookRequest): Promise<WebhookReceipt>
}

export interface Tables {
  rss_sources: RssSource
  production_pool: ProductionItem
  radar_pool: RadarItem
  account_metrics: AccountMetric
}

export type TableName = keyof Tables

export interface RecordStore {
  list<T extends TableName>(table: T): Promise<Tables[T][]>
  get<T extends TableName>(table: T, id: number): Promise<Tables[T]>
  create<T extends 'rss_sources' | 'account_metrics'>(table: T, fields: Omit<Tables[T], 'id' | 'created_at'>): Promise<Tables[T]>
  update<T extends TableName>(table: T, id: number, changes: Partial<Omit<Tables[T], 'id'>>): Promise<Tables[T]>
}
