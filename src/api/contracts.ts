import type { AccountMetric, JsonValue, Platform, PoolType, PostMetric, ProductionItem, RadarItem, RssSource, RssSyncInterval, RssSyncSettings, WorkflowStatus } from '../types/schema'

export interface ProductionFilters {
  trackTag?: string
  minScore?: number
  status?: string
  risk?: string
}

export interface RadarFilters {
  minCommercialScore?: number
  minInfoGapScore?: number
}

export type NewRssSource = Omit<RssSource, 'id' | 'created_at' | 'pool_type'> & { pool_type: PoolType }
export type NewAccountMetric = {
  [Field in Exclude<keyof AccountMetric, 'id'>]: Field extends 'platform' ? Platform : NonNullable<AccountMetric[Field]>
}
export type ProductionUpdate = Partial<Pick<ProductionItem,
  'zh_title' | 'raw_content' | 'fact_check' | 'draft_md' | 'final_md' | 'final_content' | 'video_script' |
  'revision_note' | 'published_at' | 'is_benchmark' | 'compliance_risk'
> & { workflow_status: WorkflowStatus; remotion_data: JsonValue }>

export type VideoFormat = '16x9' | '9x16'
export type VideoVoice =
  | 'zh-CN-YunxiNeural'
  | 'zh-CN-YunjianNeural'
  | 'zh-CN-XiaoxiaoNeural'
  | 'zh-CN-XiaoyiNeural'

export interface WebhookPayloads {
  'fetch-and-draft': { production_id: number }
  'rewrite-draft': { production_id: number; revision_note: string; draft_md?: string; video_script?: string }
  'generate-video': { production_id: number; format: VideoFormat; voice: VideoVoice }
  'rss-sync-now': Record<string, never>
}

export type WebhookAction = keyof WebhookPayloads
export type WebhookRequest = {
  [Action in WebhookAction]: [action: Action, payload: WebhookPayloads[Action]]
}[WebhookAction]

export interface WebhookReceipt {
  accepted: true
  status: number
  jobId?: string
  downloadUrl?: string | null
  draft_md?: string
  video_script?: string
}

export interface ContentHubApi {
  readonly mode: 'mock' | 'real'
  listProductionItems(filters?: ProductionFilters, onTotalRows?: (total: number) => void): Promise<ProductionItem[]>
  getProductionItem(id: number, signal?: AbortSignal): Promise<ProductionItem>
  deleteProductionItem(id: number): Promise<void>
  updateProductionItem(id: number, changes: ProductionUpdate): Promise<ProductionItem>
  listRssSources(poolType?: PoolType): Promise<RssSource[]>
  getRssSyncSettings(): Promise<RssSyncSettings>
  setRssSyncInterval(hours: RssSyncInterval): Promise<RssSyncSettings>
  createRssSource(source: NewRssSource): Promise<RssSource>
  setRssSourceActive(id: number, active: boolean): Promise<RssSource>
  listRadarItems(filters?: RadarFilters): Promise<RadarItem[]>
  /** since 为含该时间点的下界。 */
  listAccountMetrics(since?: string): Promise<AccountMetric[]>
  listPostMetrics(): Promise<PostMetric[]>
  createAccountMetric(metric: NewAccountMetric): Promise<AccountMetric>
  triggerWebhook(...request: WebhookRequest): Promise<WebhookReceipt>
  triggerGenerateDraft(recordId: number): Promise<WebhookReceipt>
  triggerRender(recordId: number): Promise<WebhookReceipt>
}

export interface Tables {
  rss_sources: RssSource
  rss_sync_settings: RssSyncSettings
  production_pool: ProductionItem
  radar_pool: RadarItem
  account_metrics: AccountMetric
  post_metrics: PostMetric
}

type NewRecords = { rss_sources: NewRssSource; account_metrics: NewAccountMetric }

export type TableName = keyof Tables

export interface RecordStore {
  list<T extends TableName>(table: T, onTotalRows?: (total: number) => void): Promise<Tables[T][]>
  get<T extends TableName>(table: T, id: number, signal?: AbortSignal): Promise<Tables[T]>
  remove(table: 'production_pool', id: number): Promise<void>
  create<T extends keyof NewRecords>(table: T, fields: NewRecords[T]): Promise<Tables[T]>
  update<T extends TableName>(table: T, id: number, changes: Partial<Omit<Tables[T], 'id'>>): Promise<Tables[T]>
}
