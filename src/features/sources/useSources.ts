import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiHttpError, WriteReadbackError } from '../../api'
import type { ContentHubApi, NewRssSource } from '../../api'
import type { RssSource } from '../../types/schema'
import { matchesSource } from './sourceFields'

type RowFeedback = { kind: 'saving' | 'unverified' | 'different'; message: string }

interface PendingCreation {
  input: NewRssSource
  previousIds: ReadonlySet<number>
  receiptId: number | null
  acknowledged: boolean
}

const rejectedStatuses = new Set([400, 401, 403, 404, 405, 413, 415, 422])

function creationKey(input: NewRssSource) {
  return input.pool_type + '\n' + input.rss_url
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败。'
}

export function useSources(api: ContentHubApi) {
  const [rows, setRows] = useState<RssSource[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [rowFeedback, setRowFeedback] = useState<Partial<Record<number, RowFeedback>>>({})
  const [savingCreate, setSavingCreate] = useState(false)
  const [checkingCreate, setCheckingCreate] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingInput, setPendingInput] = useState<NewRssSource | null>(null)

  const loadedOnce = useRef(false)
  const reading = useRef(false)
  const creating = useRef(false)
  const checking = useRef(false)
  const toggling = useRef(new Set<number>())
  const unverifiedRows = useRef(new Set<number>())
  const pending = useRef<PendingCreation | null>(null)
  const deferred = useRef(new Map<string, PendingCreation>())
  const readVersion = useRef(0)

  useEffect(() => () => {
    readVersion.current++
    reading.current = false
    loadedOnce.current = false
  }, [])

  const refresh = useCallback(async () => {
    if (reading.current || creating.current || toggling.current.size > 0) return null
    const ticket = ++readVersion.current
    reading.current = true
    setLoading(true)
    setLoadError(null)
    try {
      const result = await api.listRssSources()
      if (ticket !== readVersion.current) return null
      setRows(result)
      unverifiedRows.current.clear()
      setRowFeedback({})
      return { rows: result }
    } catch (error) {
      if (ticket !== readVersion.current) return null
      const message = errorMessage(error)
      setLoadError(message)
      return { error: message }
    } finally {
      if (ticket === readVersion.current) {
        reading.current = false
        setLoading(false)
      }
    }
  }, [api])

  const ensureLoaded = useCallback(() => {
    if (loadedOnce.current) return
    loadedOnce.current = true
    void refresh()
  }, [refresh])

  async function toggle(row: RssSource) {
    if (reading.current || toggling.current.has(row.id) || unverifiedRows.current.has(row.id)) return

    const next = !row.is_active
    toggling.current.add(row.id)
    setNotice(null)
    setRowFeedback(current => ({ ...current, [row.id]: { kind: 'saving', message: '正在保存状态…' } }))

    try {
      const saved = await api.setRssSourceActive(row.id, next)
      if (saved.id !== row.id) throw new Error('回读结果的信源 ID 不一致。')
      setRows(current => current?.map(item => item.id === row.id ? saved : item) ?? null)

      if (saved.is_active === next) {
        setRowFeedback(current => ({ ...current, [row.id]: undefined }))
        setNotice(`「${row.name}」已${next ? '启用' : '停用'}。`)
      } else {
        setRowFeedback(current => ({ ...current, [row.id]: {
          kind: 'different', message: '回读的启停状态与请求不一致。',
        } }))
      }
    } catch (error) {
      unverifiedRows.current.add(row.id)
      setRowFeedback(current => ({ ...current, [row.id]: {
        kind: 'unverified', message: '启停结果未确认。请刷新信源核对。' + errorMessage(error),
      } }))
    } finally {
      toggling.current.delete(row.id)
    }
  }

  function markPending(attempt: PendingCreation | null, message: string | null) {
    pending.current = attempt
    setPendingInput(attempt?.input ?? null)
    setCreateError(message)
  }

  async function create(input: NewRssSource) {
    if (!rows || reading.current || creating.current || checking.current || pending.current) return null
    const unresolved = deferred.current.get(creationKey(input))
    if (unresolved) {
      markPending(unresolved, '同一分组下这个 RSS 链接的上次新增尚待核对。')
      return null
    }

    const previousIds = new Set(rows.map(row => row.id))
    creating.current = true
    setSavingCreate(true)
    setCreateError(null)
    setNotice(null)
    try {
      const saved = await api.createRssSource(input)
      if (previousIds.has(saved.id) || !matchesSource(saved, input)) {
        markPending({ input, previousIds, receiptId: saved.id, acknowledged: true },
          '回读信息与本次提交不一致，需核对新增结果。')
        return null
      }

      setRows(current => [...(current ?? []), saved])
      setNotice(saved.is_active === input.is_active ? '信源已新增。' : '信源已新增，启用状态以实际回读为准。')
      return saved
    } catch (error) {
      if (error instanceof ApiHttpError && rejectedStatuses.has(error.status)) {
        setCreateError('保存信源失败。' + errorMessage(error))
        return null
      }
      const failure = error instanceof WriteReadbackError ? error : null
      const prefix = failure ? '写入已返回成功，但需核对新增结果。' : '保存结果未确认，需核对新增结果。'
      markPending({ input, previousIds, receiptId: failure?.recordId ?? null, acknowledged: Boolean(failure) },
        prefix + (failure ? '' : errorMessage(error)))
      return null
    } finally {
      creating.current = false
      setSavingCreate(false)
    }
  }

  async function verifyCreation() {
    const attempt = pending.current
    if (!attempt || checking.current || reading.current || creating.current || toggling.current.size > 0) return null

    checking.current = true
    setCheckingCreate(true)
    setCreateError(null)
    try {
      const result = await refresh()
      if (!result?.rows) {
        setCreateError('无法核对列表。' + (result?.error ?? '请稍后再试。'))
        return null
      }

      const candidates = result.rows.filter(row => !attempt.previousIds.has(row.id))
      const matches = attempt.receiptId === null
        ? candidates.filter(row => matchesSource(row, attempt.input))
        : candidates.filter(row => row.id === attempt.receiptId)
      if (matches.length === 1) {
        const [record] = matches
        deferred.current.delete(creationKey(attempt.input))
        markPending(null, null)
        const same = matchesSource(record, attempt.input) && record.is_active === attempt.input.is_active
        setNotice(same ? '已从列表核对到新增信源。' : '已找到写入回执对应的信源，请核对列表中的实际信息。')
        return record
      }
      if (matches.length > 1) {
        setCreateError('查到多条匹配记录，请先核对对应信源。')
      } else if (attempt.acknowledged) {
        setCreateError('本次读取未找到匹配的新增记录。写入曾返回成功，请稍后核对列表。')
      } else {
        setCreateError('本次读取未找到匹配的新增记录。原请求仍可能完成，请稍后核对列表。')
      }
      return null
    } finally {
      checking.current = false
      setCheckingCreate(false)
    }
  }

  function deferCreation() {
    const attempt = pending.current
    if (!attempt || checking.current) return
    deferred.current.set(creationKey(attempt.input), attempt)
    markPending(null, null)
  }

  return {
    rows, loading, loadError, notice, rowFeedback, pendingInput, createError, savingCreate, checkingCreate,
    writing: savingCreate || Object.values(rowFeedback).some(item => item?.kind === 'saving'),
    ensureLoaded, refresh, toggle, create, verifyCreation, deferCreation,
    clearCreateError() { if (!pending.current) setCreateError(null) },
  }
}
