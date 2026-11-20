import type { ContentHubEnv } from './config'
import { readMode } from './config'
import type { ContentHubApi, WebhookRequest } from './contracts'
import { createMockBackend } from './mockApi'
import { createNocodbClient } from './nocodbClient'
import { requireRecordId } from './nocodbCodec'
import { createWebhookClient } from './webhookClient'

export type { ContentHubEnv } from './config'
export type {
  ContentHubApi, NewAccountMetric, NewRssSource, ProductionFilters, ProductionUpdate,
  RadarFilters, WebhookAction, WebhookPayloads, WebhookReceipt,
} from './contracts'
export { ApiHttpError } from './http'
export { WriteReadbackError } from './nocodbClient'

function dateTime(value: string): number {
  return Date.parse(value.replace(' ', 'T'))
}

export function createContentHubApi(env: ContentHubEnv, fetcher: typeof fetch = globalThis.fetch): ContentHubApi {
  const mode = readMode(env)
  const { store, triggerWebhook } = mode === 'mock'
    ? createMockBackend()
    : { store: createNocodbClient(env, fetcher), triggerWebhook: createWebhookClient(env, fetcher) }

  return {
    mode,
    async listProductionItems({ trackTag, minScore, status } = {}) {
      const rows = await store.list('production_pool')
      return rows.filter(row => (
        (trackTag === undefined || row.track_tag === trackTag) &&
        (minScore === undefined || row.score >= minScore) &&
        (status === undefined || row.workflow_status === status)
      ))
    },
    getProductionItem: id => store.get('production_pool', id),
    updateProductionItem(id, changes) {
      const patch = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined))
      return store.update('production_pool', id, patch)
    },
    async listRssSources(poolType) {
      const rows = await store.list('rss_sources')
      return poolType === undefined ? rows : rows.filter(row => row.pool_type === poolType)
    },
    createRssSource: source => store.create('rss_sources', source),
    setRssSourceActive: (id, active) => store.update('rss_sources', id, { is_active: active }),
    async listRadarItems({ minCommercialScore, minInfoGapScore } = {}) {
      const rows = await store.list('radar_pool')
      return rows.filter(row => (
        (minCommercialScore === undefined || row.commercial_score >= minCommercialScore) &&
        (minInfoGapScore === undefined || row.info_gap_score >= minInfoGapScore)
      ))
    },
    async listAccountMetrics(since) {
      if (since === undefined) return store.list('account_metrics')
      const start = dateTime(since)
      if (!Number.isFinite(start)) throw new Error('运营数据的起始日期无效。')
      const rows = await store.list('account_metrics')
      return rows.filter(row => dateTime(row.recorded_at) >= start)
    },
    createAccountMetric: metric => store.create('account_metrics', metric),
    async triggerWebhook(...request: WebhookRequest) {
      const [action, payload] = request
      requireRecordId(payload.production_id)
      if (action === 'rewrite-draft' && !payload.revision_note.trim()) {
        throw new Error('提交润色时请填写修改意见。')
      }
      return triggerWebhook(...request)
    },
  }
}
