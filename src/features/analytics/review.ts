import type { AccountMetric, Platform } from '../../types/schema'
import { calendarDay, dailyMetricKey, metricDay, shiftCalendarDay } from '../../utils/metricDays'

export type ReviewPeriod = 7 | 30

interface Values {
  views: number | null
  impressions: number | null
  ctr: number | null
  revenue: number | null
}

export interface DailyPoint extends Values {
  day: string
}

interface Accumulator {
  views: number | null
  impressions: number | null
  revenue: number | null
  ctrSum: number
  ctrWeight: number
}

function accumulator(): Accumulator {
  return { views: null, impressions: null, revenue: null, ctrSum: 0, ctrWeight: 0 }
}

export function isCount(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0
}

export function isPercentage(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100
}

export function equalDailyValues(left: AccountMetric, right: Omit<AccountMetric, 'id'>) {
  const key = dailyMetricKey(left)
  return key !== null && key === dailyMetricKey(right) && left.views === right.views &&
    left.impressions === right.impressions && left.ctr === right.ctr &&
    left.completion_rate === right.completion_rate && left.revenue === right.revenue
}

function add(bucket: Accumulator, row: AccountMetric) {
  if (isCount(row.views)) bucket.views = (bucket.views ?? 0) + row.views
  if (isCount(row.impressions)) {
    bucket.impressions = (bucket.impressions ?? 0) + row.impressions
    if (row.impressions > 0 && isPercentage(row.ctr)) {
      bucket.ctrWeight += row.impressions
      bucket.ctrSum += row.ctr * row.impressions
    }
  }
  if (row.revenue !== null && Number.isFinite(row.revenue)) bucket.revenue = (bucket.revenue ?? 0) + row.revenue
}

function values(bucket: Accumulator): Values {
  return {
    views: bucket.views, impressions: bucket.impressions, revenue: bucket.revenue,
    ctr: bucket.ctrWeight > 0 ? bucket.ctrSum / bucket.ctrWeight : null,
  }
}

export function reviewDates(period: ReviewPeriod, now: number) {
  const today = calendarDay(now)
  return Array.from({ length: period }, (_, index) => shiftCalendarDay(today, index + 1 - period))
}

export function buildReview(
  rows: readonly AccountMetric[],
  platform: Platform,
  period: ReviewPeriod,
  now: number,
  isDaily: (row: AccountMetric) => boolean = () => true,
) {
  const dates = reviewDates(period, now)
  const buckets = new Map(dates.map(date => [date, accumulator()]))
  const total = accumulator()
  const grouped = new Map<string, AccountMetric[]>()
  let unknownRows = 0
  let invalidDates = 0
  let invalidRows = 0
  let duplicateGroups = 0
  let conflictingGroups = 0

  for (const row of rows) {
    if (row.platform !== platform) continue
    const day = metricDay(row.recorded_at)
    if (day === null) {
      invalidDates++
      continue
    }
    if (!buckets.has(day)) continue
    const key = dailyMetricKey(row)
    if (key === null) {
      invalidRows++
      continue
    }
    const group = grouped.get(key)
    if (group) group.push(row)
    else grouped.set(key, [row])
  }

  for (const group of grouped.values()) {
    const eligible = group.filter(isDaily)
    unknownRows += group.length - eligible.length
    if (eligible.length === 0) continue
    const row = eligible[0]
    if (group.length > eligible.length || eligible.slice(1).some(other => !equalDailyValues(row, other))) {
      conflictingGroups++
      continue
    }
    if (eligible.length > 1) duplicateGroups++
    const day = metricDay(row.recorded_at)!
    if (!isCount(row.views) || !isCount(row.impressions) || !isPercentage(row.ctr) || !Number.isFinite(row.revenue)) {
      invalidRows++
    }
    add(buckets.get(day)!, row)
    add(total, row)
  }

  const points = dates.map(day => ({ day, ...values(buckets.get(day)!) }))
  const coveredDays = points.filter(point =>
    point.views !== null || point.impressions !== null || point.ctr !== null || point.revenue !== null,
  ).length

  return {
    points,
    totals: values(total),
    coveredDays,
    unknownRows, invalidDates, invalidRows, duplicateGroups, conflictingGroups,
  }
}
