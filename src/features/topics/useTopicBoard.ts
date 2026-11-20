import { useCallback, useEffect, useRef, useState } from 'react'
import { WriteReadbackError } from '../../api'
import type { ContentHubApi } from '../../api'
import type { ProductionItem } from '../../types/schema'

const confirmedStatus = '已确认-待核对'

const messages = {
  saving: '正在保存选题状态…',
  submitting: '状态已保存，正在请求 Webhook…',
  waiting: 'Webhook 已受理，等待初稿回写。',
  ready: '初稿已回写。',
  webhookUnverified: '状态已保存，但 Webhook 受理未确认。请核对执行记录，或刷新查看选题状态。',
  watchPaused: 'Webhook 已受理，暂未读到初稿。可刷新列表查看最新状态。',
  saveUnverified: '未能确认状态已保存。请刷新列表核对，本次未触发 Webhook。',
  readbackFailed: '保存请求成功，但回读失败。请刷新列表核对，本次未触发 Webhook。',
  checked: '已读取最新状态。',
  abandoning: '正在保存放弃状态…',
  abandoned: '已放弃该选题。',
  abandonUnverified: '未能确认放弃状态。请刷新列表核对。',
  stateChanged: '回读显示其他流程状态，请核对最新记录。本次未触发 Webhook。',
} as const

type ActivityKind = keyof typeof messages

export interface TopicActivity {
  kind: ActivityKind
  title: string
  detail?: string
}

interface BoardState {
  items: ProductionItem[] | null
  loading: boolean
  loadError: string | null
  activities: Partial<Record<number, TopicActivity>>
  lastActivityId: number | null
}

export function describeActivity(activity: TopicActivity) {
  return messages[activity.kind]
}

export function isActivityError(activity: TopicActivity) {
  return activity.kind === 'webhookUnverified' || activity.kind === 'watchPaused' ||
    activity.kind === 'saveUnverified' || activity.kind === 'readbackFailed' ||
    activity.kind === 'abandonUnverified' || activity.kind === 'stateChanged'
}

export function isMutationBlocked(activity?: TopicActivity) {
  return activity?.kind === 'saving' || activity?.kind === 'submitting' || activity?.kind === 'abandoning' ||
    activity?.kind === 'saveUnverified' || activity?.kind === 'readbackFailed' || activity?.kind === 'abandonUnverified'
}

function isWatching(activity?: TopicActivity) {
  return activity?.kind === 'waiting' || activity?.kind === 'webhookUnverified' || activity?.kind === 'watchPaused'
}

export function canConfirm(item: ProductionItem, activity?: TopicActivity) {
  return item.workflow_status === '待筛选' && !isMutationBlocked(activity) && !isWatching(activity)
}

export function canAbandon(item: ProductionItem) {
  return item.workflow_status !== '已发布' && item.workflow_status !== '已放弃'
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败。'
}

function activityFor(item: ProductionItem, kind: ActivityKind, detail?: string): TopicActivity {
  return { kind, title: item.zh_title, detail }
}

function observeActivity(item: ProductionItem, activity?: TopicActivity): TopicActivity | undefined {
  if (!activity) return undefined
  if (isWatching(activity) && item.workflow_status === 'AI初稿完成') return activityFor(item, 'ready')
  if (isWatching(activity) && item.workflow_status === '已放弃') return activityFor(item, 'abandoned')
  if (activity.kind === 'waiting' && item.workflow_status !== confirmedStatus) {
    return activityFor(item, 'watchPaused', `当前记录为「${item.workflow_status}」。`)
  }
  if (activity.kind === 'saveUnverified' || activity.kind === 'readbackFailed' || activity.kind === 'abandonUnverified') {
    return activityFor(item, 'checked', `当前记录为「${item.workflow_status}」。`)
  }
  return activity
}

export function useTopicBoard(api: ContentHubApi) {
  const [state, setState] = useState<BoardState>({
    items: null, loading: true, loadError: null, activities: {}, lastActivityId: null,
  })
  const loadedOnce = useRef(false)
  const mounted = useRef(true)
  const sequence = useRef(0)
  const latestList = useRef(0)
  const observedAt = useRef(new Map<number, number>())
  const busy = useRef(new Set<number>())
  const watchers = useRef(new Map<number, symbol>())

  useEffect(() => {
    mounted.current = true
    const active = watchers.current
    return () => {
      mounted.current = false
      active.clear()
    }
  }, [])

  const refresh = useCallback(async () => {
    const ticket = ++sequence.current
    latestList.current = ticket
    setState(current => ({ ...current, loading: true, loadError: null }))
    try {
      const incoming = await api.listProductionItems()
      if (!mounted.current || latestList.current !== ticket) return

      const protectedIds = new Set(busy.current)
      for (const [id, version] of observedAt.current) {
        if (version > ticket) protectedIds.add(id)
      }
      const incomingIds = new Set(incoming.map(item => item.id))
      for (const item of incoming) {
        if (protectedIds.has(item.id)) continue
        observedAt.current.set(item.id, ticket)
        if (item.workflow_status !== confirmedStatus) watchers.current.delete(item.id)
      }
      for (const id of watchers.current.keys()) {
        if (!incomingIds.has(id) && !protectedIds.has(id)) watchers.current.delete(id)
      }

      setState(current => {
        const prior = current.items ?? []
        const priorById = new Map(prior.map(item => [item.id, item]))
        const activities = { ...current.activities }
        const items = incoming.map(item => {
          if (protectedIds.has(item.id)) return priorById.get(item.id) ?? item
          activities[item.id] = observeActivity(item, activities[item.id])
          return item
        })
        items.push(...prior.filter(item => protectedIds.has(item.id) && !incomingIds.has(item.id)))
        return { ...current, items, activities, loading: false }
      })
    } catch (error) {
      if (mounted.current && latestList.current === ticket) {
        setState(current => ({ ...current, loading: false, loadError: message(error) }))
      }
    }
  }, [api])

  const ensureLoaded = useCallback(() => {
    if (loadedOnce.current) return
    loadedOnce.current = true
    void refresh()
  }, [refresh])

  function publish(item: ProductionItem, kind: ActivityKind, {
    detail, replaceItem = false, ticket = ++sequence.current,
  }: { detail?: string; replaceItem?: boolean; ticket?: number } = {}) {
    if (!mounted.current || (observedAt.current.get(item.id) ?? 0) > ticket) return
    observedAt.current.set(item.id, ticket)
    setState(current => ({
      ...current,
      items: replaceItem ? current.items?.map(row => row.id === item.id ? item : row) ?? [item] : current.items,
      activities: { ...current.activities, [item.id]: activityFor(item, kind, detail) },
      lastActivityId: item.id,
    }))
  }

  async function watchDraft(item: ProductionItem) {
    const id = item.id
    const token = Symbol()
    watchers.current.set(id, token)
    const interval = api.mode === 'mock' ? 420 : 3_000
    const maxReads = api.mode === 'mock' ? 10 : 20
    const active = () => mounted.current && watchers.current.get(id) === token

    try {
      for (let attempt = 0; attempt < maxReads; attempt++) {
        await new Promise<void>(resolve => setTimeout(resolve, interval))
        if (!active()) return

        const ticket = ++sequence.current
        let latest: ProductionItem
        try {
          latest = await api.getProductionItem(id)
        } catch (error) {
          if (!active()) return
          if ((observedAt.current.get(id) ?? 0) > ticket) continue
          publish(item, 'watchPaused', { detail: message(error), ticket })
          return
        }
        if (!active()) return
        if ((observedAt.current.get(id) ?? 0) > ticket || latest.workflow_status === confirmedStatus) continue

        const observed = { replaceItem: true, ticket }
        if (latest.workflow_status === 'AI初稿完成') publish(latest, 'ready', observed)
        else if (latest.workflow_status === '已放弃') publish(latest, 'abandoned', observed)
        else publish(latest, 'watchPaused', { ...observed, detail: `当前记录为「${latest.workflow_status}」。` })
        return
      }
      if (active()) publish(item, 'watchPaused')
    } finally {
      if (active()) watchers.current.delete(id)
    }
  }

  async function confirm(item: ProductionItem) {
    if (busy.current.has(item.id) || !canConfirm(item, state.activities[item.id])) return
    busy.current.add(item.id)
    publish(item, 'saving')

    try {
      const saved = await api.updateProductionItem(item.id, { workflow_status: confirmedStatus })
      if (saved.workflow_status !== confirmedStatus) {
        publish(saved, 'stateChanged', { replaceItem: true })
        return
      }
      publish(saved, 'submitting', { replaceItem: true })

      try {
        await api.triggerWebhook('fetch-and-draft', { production_id: item.id })
      } catch (error) {
        publish(saved, 'webhookUnverified', { detail: message(error) })
        return
      }
      if (mounted.current) {
        publish(saved, 'waiting')
        void watchDraft(saved)
      }
    } catch (error) {
      publish(item, error instanceof WriteReadbackError ? 'readbackFailed' : 'saveUnverified', { detail: message(error) })
    } finally {
      busy.current.delete(item.id)
    }
  }

  async function abandon(item: ProductionItem) {
    if (busy.current.has(item.id) || isMutationBlocked(state.activities[item.id]) || !canAbandon(item)) return
    busy.current.add(item.id)
    watchers.current.delete(item.id)
    publish(item, 'abandoning')
    try {
      const saved = await api.updateProductionItem(item.id, { workflow_status: '已放弃' })
      publish(saved, saved.workflow_status === '已放弃' ? 'abandoned' : 'abandonUnverified', { replaceItem: true })
    } catch (error) {
      publish(item, 'abandonUnverified', { detail: message(error) })
    } finally {
      busy.current.delete(item.id)
    }
  }

  return { ...state, refresh, ensureLoaded, confirm, abandon }
}
