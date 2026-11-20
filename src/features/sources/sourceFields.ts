import type { NewRssSource } from '../../api'
import type { PoolType, RssSource } from '../../types/schema'

export const poolLabels: Record<PoolType, string> = { production: '生产池', radar: '雷达池' }

export function rssUrl(value: string): string | null {
  const input = value.trim()
  if (!/^https?:\/\/[^/]/i.test(input) || /[\s\\]/.test(input)) return null
  try {
    const parsed = new URL(input)
    return parsed.hostname && !parsed.username && !parsed.password ? parsed.href : null
  } catch {
    return null
  }
}

export function matchesSource(row: RssSource, input: NewRssSource) {
  return row.name === input.name && rssUrl(row.rss_url) === input.rss_url &&
    row.pool_type === input.pool_type && row.track_tag === input.track_tag
}
