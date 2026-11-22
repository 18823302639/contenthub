import type { TableName } from './contracts'

export interface ContentHubEnv {
  readonly VITE_USE_MOCK?: string
  readonly VITE_NOCODB_API_URL?: string
  readonly VITE_NOCODB_TOKEN?: string
  readonly VITE_N8N_WEBHOOK_BASE_URL?: string
  readonly VITE_REMOTION_BASE_URL?: string
  readonly VITE_REMOTION_TOKEN?: string
  readonly VITE_NOCODB_RSS_SOURCES_TABLE_ID?: string
  readonly VITE_NOCODB_PRODUCTION_POOL_TABLE_ID?: string
  readonly VITE_NOCODB_RADAR_POOL_TABLE_ID?: string
  readonly VITE_NOCODB_ACCOUNT_METRICS_TABLE_ID?: string
  readonly VITE_NOCODB_POST_METRICS_TABLE_ID?: string
  readonly VITE_NOCODB_ID_FIELD?: string
}

const tableKeys = {
  rss_sources: 'VITE_NOCODB_RSS_SOURCES_TABLE_ID',
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

export function readBaseUrl(value: string | undefined, key: keyof ContentHubEnv): string {
  const base = value?.trim().replace(/\/+$/, '')
  if (base && !/[?#\\]/.test(base)) {
    if (base.startsWith('/') && !base.startsWith('//')) return base
    if (/^https?:\/\//i.test(base)) {
      try {
        const parsed = new URL(base)
        if (!parsed.username && !parsed.password) return base
      } catch {
        // 使用同一条配置错误提示。
      }
    }
  }
  throw new Error(`${key} 必须配置为 HTTP(S) 基础地址或同源根路径。`)
}

export function buildVideoDownloadUrl(env: ContentHubEnv, jobId: string): string | null {
  const address = env.VITE_REMOTION_BASE_URL?.trim()
  const token = env.VITE_REMOTION_TOKEN?.trim()
  if (!address || !token || /[\t\r\n]/.test(address)) return null

  try {
    const base = readBaseUrl(address, 'VITE_REMOTION_BASE_URL')
    return `${base}/download/${encodeURIComponent(jobId)}.mp4?token=${encodeURIComponent(token)}`
  } catch {
    return null
  }
}
