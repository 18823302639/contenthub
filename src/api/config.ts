import type { TableName } from './contracts'

export interface ContentHubEnv {
  readonly VITE_USE_MOCK?: string
  readonly VITE_NOCODB_API_URL?: string
  readonly VITE_N8N_WEBHOOK_BASE_URL?: string
  readonly VITE_WF2_GENERATE_WEBHOOK_URL?: string
  readonly VITE_WF3_RENDER_WEBHOOK_URL?: string
  readonly VITE_NOCODB_RSS_SOURCES_TABLE_ID?: string
  readonly VITE_NOCODB_RSS_SYNC_SETTINGS_TABLE_ID?: string
  readonly VITE_NOCODB_RSS_SYNC_SETTINGS_RECORD_ID?: string
  readonly VITE_NOCODB_PRODUCTION_POOL_TABLE_ID?: string
  readonly VITE_NOCODB_RADAR_POOL_TABLE_ID?: string
  readonly VITE_NOCODB_ACCOUNT_METRICS_TABLE_ID?: string
  readonly VITE_NOCODB_POST_METRICS_TABLE_ID?: string
  readonly VITE_NOCODB_ID_FIELD?: string
}

export const defaultNocodbBase = '/api/nocodb'
export const defaultN8nWebhookBase = '/api/n8n'
export const defaultWf2Url = defaultN8nWebhookBase + '/generate-draft'
export const defaultWf3Url = defaultN8nWebhookBase + '/render-video'
export const wf3NotConfigured = 'WF3 渲染服务尚未配置，请先完成 Day 3 广州渲染节点接入'

const tableKeys = {
  rss_sources: 'VITE_NOCODB_RSS_SOURCES_TABLE_ID',
  rss_sync_settings: 'VITE_NOCODB_RSS_SYNC_SETTINGS_TABLE_ID',
  production_pool: 'VITE_NOCODB_PRODUCTION_POOL_TABLE_ID',
  radar_pool: 'VITE_NOCODB_RADAR_POOL_TABLE_ID',
  account_metrics: 'VITE_NOCODB_ACCOUNT_METRICS_TABLE_ID',
  post_metrics: 'VITE_NOCODB_POST_METRICS_TABLE_ID',
} as const

export function readMode(env: ContentHubEnv): 'mock' | 'real' {
  const value = env.VITE_USE_MOCK?.trim()
  if (!value || value === 'true') return 'mock'
  if (value === 'false') return 'real'

  throw new Error('VITE_USE_MOCK 只能配置为 true 或 false。')
}

export function readTableId(env: ContentHubEnv, table: TableName): string {
  const key = tableKeys[table]
  const value = env[key]?.trim()
  if (!value || !/^m[A-Za-z0-9]+$/.test(value)) {
    throw new Error(`${key} 必须配置为 NocoDB 中显示的 Table ID（以 m 开头）。`)
  }
  return value
}

export function readRssSyncSettingsId(env: ContentHubEnv): number {
  const input = env.VITE_NOCODB_RSS_SYNC_SETTINGS_RECORD_ID?.trim() ?? ''
  const id = Number(input)
  if (!/^[1-9]\d*$/.test(input) || !Number.isSafeInteger(id)) {
    throw new Error('VITE_NOCODB_RSS_SYNC_SETTINGS_RECORD_ID 必须配置为采集配置记录的正整数主键。')
  }
  return id
}

export function readProxyPath(value: string, key: keyof ContentHubEnv): string {
  const path = value.trim().replace(/\/+$/, '')
  if (path.startsWith('/') && !path.startsWith('//') && !/[\s?#\\\u0000-\u001f\u007f]/u.test(path)) return path
  throw new Error(`${key} 必须配置为同源根路径（例如 /api/service）。`)
}
