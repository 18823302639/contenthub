import { describe, expect, it } from 'vitest'
import { createContentHubApi } from '../src/api'
import { buildReview } from '../src/features/analytics/review'
import type { AccountMetric } from '../src/types/schema'
import { calendarDay, metricDay } from '../src/utils/metricDays'

const now = Date.parse('2026-11-20T16:00:00Z')
const base: AccountMetric = {
  id: 1, production_id: 5, title: '示例', platform: '公众号', impressions: 100, views: 8,
  ctr: 10, completion_rate: 20, revenue: 2, recorded_at: '2026-11-20T16:00:00Z',
}
const row = (changes: Partial<AccountMetric>) => ({ ...base, ...changes })

describe('UTC+8 单日运营口径', () => {
  it('近 7 天含今天，正确处理 UTC+8 两端及未来日', () => {
    expect(calendarDay(now)).toBe('2026-11-21')
    expect(metricDay('2026-11-21 15:59:59+00:00')).toBe('2026-11-21')
    expect(metricDay('2026-11-21T00:00:00')).toBeNull()
    const review = buildReview([
      row({ id: 2, recorded_at: '2026-11-14T15:59:59Z', views: 400 }),
      row({ id: 3, recorded_at: '2026-11-14T16:00:00Z', views: 50 }),
      row({ id: 4, recorded_at: '2026-11-21T15:59:59Z', views: 30 }),
      row({ id: 5, recorded_at: '2026-11-21T16:00:00Z', views: 800 }),
    ], '公众号', 7, now)
    expect(review.points.map(point => point.day)).toEqual([
      '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21',
    ])
    expect(review.totals.views).toBe(80)
    expect(review.points[1]).toMatchObject({ views: null, ctr: null })
  })

  it('近 30 天包含第 30 个 UTC+8 日期，排除前一日', () => {
    const review = buildReview([
      row({ id: 2, recorded_at: '2026-10-22T15:59:59Z', views: 300 }),
      row({ id: 3, recorded_at: '2026-10-22T16:00:00Z', views: 12 }),
    ], '公众号', 30, now)
    expect(review.points).toHaveLength(30)
    expect(review.points[0].day).toBe('2026-10-23')
    expect(review.totals.views).toBe(12)
  })

  it('同平台按展现加权平台填报 CTR，无展现和无效 CTR 排除，合法的零保留', () => {
    const review = buildReview([
      base,
      row({ id: 2, production_id: 6, impressions: 1000, ctr: 4, views: 10 }),
      row({ id: 3, production_id: 7, impressions: 0, ctr: 90, views: 0 }),
      row({ id: 4, production_id: 8, impressions: 1000, ctr: 130, views: 0 }),
      row({ id: 5, platform: '头条', impressions: 9999, ctr: 99 }),
      row({ id: 6, recorded_at: '2026-11-19T16:00:00Z', views: 0, impressions: 0, ctr: 0, revenue: 0 }),
    ], '公众号', 7, now)
    expect(review.totals).toMatchObject({ views: 18, impressions: 2100 })
    expect(review.totals.ctr).toBeCloseTo(4.5454545)
    expect(review.points[5]).toMatchObject({ views: 0, impressions: 0, ctr: null, revenue: 0 })
    expect(review.points[4]).toMatchObject({ views: null, impressions: null, ctr: null, revenue: null })
  })

  it('完全相同的记录只计一次，不混算 100 和 150 两条冲突记录', () => {
    const identical = buildReview([base, row({ id: 2 })], '公众号', 7, now)
    expect(identical.totals.views).toBe(8)
    expect(identical.duplicateGroups).toBe(1)
    const conflicted = buildReview([row({ views: 100 }), row({ id: 2, views: 150 })], '公众号', 7, now)
    expect(conflicted.totals.views).toBeNull()
    expect(conflicted.conflictingGroups).toBe(1)
  })

  it('历史口径未知的记录不纳入，同日有未知冲突也隔离', () => {
    const history = row({ id: 2, recorded_at: '2026-11-19T16:00:00Z', views: 100 })
    const mixed = buildReview([base, history], '公众号', 7, now, item => item.id === 1)
    expect(mixed.totals.views).toBe(8)
    expect(mixed.unknownRows).toBe(1)
    const conflicted = buildReview([base, { ...history, recorded_at: base.recorded_at }], '公众号', 7, now, item => item.id === 1)
    expect(conflicted.totals.views).toBeNull()
    expect(conflicted.conflictingGroups).toBe(1)
  })

  it('整行指标都无效时不计为有可用数据的一天', () => {
    const review = buildReview([row({ views: -1, impressions: -1, ctr: 130, revenue: NaN })], '公众号', 7, now)
    expect(review.coveredDays).toBe(0)
    expect(review.invalidRows).toBe(1)
    expect(review.totals).toEqual({ views: null, impressions: null, ctr: null, revenue: null })
  })

  it('可识别明确附有时区的 ISO 分钟时间戳', () => {
    expect(metricDay('2026-11-20T16:00Z')).toBe('2026-11-21')
    expect(metricDay('2026-11-20T16:00')).toBeNull()
  })

  it('Mock 存储在并发提交时也拒绝同一内容、平台和 UTC+8 日期', async () => {
    const api = createContentHubApi({})
    const { id: _id, ...input } = row({ recorded_at: '2024-01-02T16:00:00Z' })
    const results = await Promise.allSettled([
      api.createAccountMetric(input),
      api.createAccountMetric({ ...input, recorded_at: '2024-01-03T01:00:00+08:00' }),
    ])
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect((await api.listAccountMetrics()).filter(item => metricDay(item.recorded_at) === '2024-01-03')).toHaveLength(1)
  })
})
