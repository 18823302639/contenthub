import type { AccountMetric } from '../types/schema'

const dayMs = 86_400_000
const utcPlus8Ms = 8 * 3_600_000

export function calendarDay(timestamp: number) {
  return new Date(timestamp + utcPlus8Ms).toISOString().slice(0, 10)
}

export function isCalendarDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(value + 'T00:00:00Z')
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

export function shiftCalendarDay(day: string, difference: number) {
  return new Date(Date.parse(day + 'T00:00:00Z') + difference * dayMs).toISOString().slice(0, 10)
}

export function metricDay(value: string): string | null {
  const text = value.trim()
  if (isCalendarDay(text)) return text
  if (!isCalendarDay(text.slice(0, 10)) ||
    !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return null
  const timestamp = Date.parse(text.replace(' ', 'T'))
  return Number.isFinite(timestamp) ? calendarDay(timestamp) : null
}

export function calendarDayStart(day: string) {
  return day + 'T00:00:00+08:00'
}

export function dailyMetricKey(row: Pick<AccountMetric, 'production_id' | 'platform' | 'recorded_at'>) {
  if (row.production_id === null || !Number.isSafeInteger(row.production_id) || row.production_id <= 0) return null
  const day = metricDay(row.recorded_at)
  return day === null ? null : JSON.stringify([row.production_id, row.platform, day])
}
