import { useCallback, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { ApiHttpError, WriteReadbackError } from '../../api'
import type { ContentHubApi, NewAccountMetric } from '../../api'
import type { AccountMetric, ProductionItem, RadarItem } from '../../types/schema'
import { dailyMetricKey, metricDay } from '../../utils/metricDays'
import { equalDailyValues } from './review'

interface Resource<T> {
  rows: T[] | null
  error: string | null
}

interface PendingMetric {
  key: string
  input: NewAccountMetric
  priorIds: ReadonlySet<number>
  receiptId: number | null
}

function message(error: unknown) {
  return error instanceof Error ? error.message : '请求失败。'
}

async function readResource<T>(load: () => Promise<T[]>, set: Dispatch<SetStateAction<Resource<T>>>) {
  try {
    set({ rows: await load(), error: null })
  } catch (error) {
    set(current => ({ ...current, error: message(error) }))
  }
}

export function useAnalytics(api: ContentHubApi) {
  const [metrics, setMetrics] = useState<Resource<AccountMetric>>({ rows: null, error: null })
  const [radar, setRadar] = useState<Resource<RadarItem>>({ rows: null, error: null })
  const [articles, setArticles] = useState<Resource<ProductionItem>>({ rows: null, error: null })
  const [loading, setLoading] = useState(true)
  const [operation, setOperation] = useState<'saving' | 'checking' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [entryError, setEntryError] = useState<string | null>(null)
  const [pendingInput, setPendingInput] = useState<NewAccountMetric | null>(null)
  const reading = useRef(false)
  const writing = useRef(false)
  const pending = useRef(new Map<string, PendingMetric>())
  const checking = useRef<PendingMetric | null>(null)
  const verified = useRef(new Map<number, NewAccountMetric>())

  const refresh = useCallback(async () => {
    if (reading.current || writing.current) return
    reading.current = true
    setLoading(true)
    try {
      await Promise.all([
        readResource(() => api.listAccountMetrics(), setMetrics),
        readResource(() => api.listRadarItems({ minCommercialScore: 4, minInfoGapScore: 4 }), setRadar),
        readResource(() => api.listProductionItems({ status: '已发布' }), setArticles),
      ])
    } finally {
      reading.current = false
      setLoading(false)
    }
  }, [api])

  function isDaily(row: AccountMetric) {
    if (api.mode === 'mock') return true
    const submitted = verified.current.get(row.id)
    return Boolean(submitted && equalDailyValues(row, submitted))
  }

  function openCheck(attempt: PendingMetric, text: string) {
    pending.current.set(attempt.key, attempt)
    checking.current = attempt
    setPendingInput(attempt.input)
    setEntryError(text)
  }

  function resetEntry() {
    checking.current = null
    setPendingInput(null)
    setEntryError(null)
  }

  async function save(input: NewAccountMetric) {
    if (reading.current || writing.current) return null
    const key = dailyMetricKey(input)
    if (!key) {
      setEntryError('无法确认录入记录的 UTC+8 日期。')
      return null
    }
    const unresolved = pending.current.get(key)
    if (unresolved) {
      openCheck(unresolved, '这条单日记录的上次保存结果待核对。')
      return null
    }

    writing.current = true
    setOperation('saving')
    setEntryError(null)
    setNotice(null)
    try {
      let current: AccountMetric[]
      try {
        current = await api.listAccountMetrics()
        setMetrics({ rows: current, error: null })
      } catch (error) {
        setEntryError('无法读取列表核对重复记录。' + message(error))
        return null
      }

      if (current.some(row => dailyMetricKey(row) === key)) {
        setEntryError('同一内容在该平台当天已有记录。')
        return null
      }
      if (current.some(row => row.production_id === input.production_id && row.platform === input.platform && !metricDay(row.recorded_at))) {
        setEntryError('该内容与平台有无法辨认日期的旧记录，请先核对日期再录入。')
        return null
      }
      const priorIds = new Set(current.map(row => row.id))

      try {
        const saved = await api.createAccountMetric(input)
        if (!Number.isSafeInteger(saved.id) || saved.id <= 0 || priorIds.has(saved.id) || !equalDailyValues(saved, input)) {
          openCheck({ key, input, priorIds, receiptId: saved.id }, '回读内容与本次提交不一致，保存结果待核对。')
          return null
        }

        verified.current.set(saved.id, input)
        setMetrics({ rows: [...current, saved], error: null })
        setNotice('运营数据已保存。')
        return saved
      } catch (error) {
        if (error instanceof ApiHttpError && (error.status === 400 || error.status === 422)) {
          setEntryError('服务拒绝了本次录入。' + message(error))
        } else {
          openCheck({ key, input, priorIds, receiptId: error instanceof WriteReadbackError ? error.recordId : null },
            '保存结果待核对。请先读取列表。' + (error instanceof WriteReadbackError ? '' : message(error)))
        }
        return null
      }
    } finally {
      writing.current = false
      setOperation(null)
    }
  }

  async function verify() {
    const attempt = checking.current
    if (!attempt || writing.current || reading.current) return null
    writing.current = true
    setOperation('checking')
    setEntryError(null)
    try {
      const current = await api.listAccountMetrics()
      const matches = current.filter(row => dailyMetricKey(row) === attempt.key)
      const fromReceipt = matches.find(row => row.id === attempt.receiptId && Number.isSafeInteger(row.id) &&
        row.id > 0 && !attempt.priorIds.has(row.id) && equalDailyValues(row, attempt.input))
      if (fromReceipt) verified.current.set(fromReceipt.id, attempt.input)
      setMetrics({ rows: current, error: null })

      if (fromReceipt) {
        pending.current.delete(attempt.key)
        resetEntry()
        setNotice(matches.length > 1
          ? '已核对到该单日记录，存在多条同日记录，请查看数据核对提示。'
          : '已核对到该单日记录。')
        return fromReceipt
      }

      setEntryError(matches.length > 0
        ? '同日记录无法与本次提交确认。请核对回执 ID 与实际指标。'
        : '本次读取未找到该单日记录。原请求仍可能完成，可稍后再次核对。')
      return null
    } catch (error) {
      setEntryError('核对记录失败。' + message(error))
      return null
    } finally {
      writing.current = false
      setOperation(null)
    }
  }

  return {
    metrics, radar, articles, isDaily, loading, operation, notice, entryError, pendingInput,
    refresh, save, verify, resetEntry,
  }
}
