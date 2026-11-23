import { useCallback, useEffect, useRef, useState } from 'react'
import { WriteReadbackError } from '../../api'
import type { ContentHubApi } from '../../api'
import { pollWorkflow } from '../../api/workflowPolling'
import type { RecordWrites } from '../../app/useRecordWrites'
import { isWorkflowStatus } from '../../types/schema'
import type { ProductionItem } from '../../types/schema'

const confirmedStatus = '已确认-待核对'

const messages = {
  saving: '正在保存选题状态…',
  submitting: '状态已保存，正在请求 Webhook…',
  waiting: 'Webhook 已受理，等待初稿回写。',
  ready: '初稿已回写。',
  webhookUnverified: '状态已保存，但 Webhook 受理未确认。请核对执行记录，或刷新查看选题状态。',
  watchPaused: 'Webhook 已受理，暂未读到初稿。可刷新列表查看最新状态。',
  watchFailed: '读取初稿回写失败。可刷新列表查看最新状态。',
  watchChanged: '回读显示其他流程状态。请核对选题。',
  saveUnverified: '未能确认状态已保存。请刷新列表核对，本次未触发 Webhook。',
  readbackFailed: '保存请求成功，但回读失败。请刷新列表核对，本次未触发 Webhook。',
  checked: '已读取最新状态。',
  abandoning: '正在保存放弃状态…',
  abandoned: '已放弃该选题。',
  abandonUnverified: '未能确认放弃状态。请刷新列表核对。',
  stateChanged: '回读显示其他流程状态，请核对最新记录。本次未触发 Webhook。',
  wf2Starting: '正在提交初稿生成…',
  wf2Generating: '初稿生成中，通常需要 30–60 秒。',
  wf2Ready: '初稿已生成，可进入工作台审核',
  wf2Timeout: '等待初稿超过 3 分钟。可刷新列表核对最新状态。',
  wf2Failed: '未能确认初稿生成请求。',
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
    activity.kind === 'watchFailed' || activity.kind === 'watchChanged' ||
    activity.kind === 'saveUnverified' || activity.kind === 'readbackFailed' ||
    activity.kind === 'abandonUnverified' || activity.kind === 'stateChanged' ||
    activity.kind === 'wf2Failed' || activity.kind === 'wf2Timeout'
}

export function isMutationBlocked(activity?: TopicActivity) {
  return activity?.kind === 'saving' || activity?.kind === 'submitting' || activity?.kind === 'abandoning' ||
    activity?.kind === 'saveUnverified' || activity?.kind === 'readbackFailed' || activity?.kind === 'abandonUnverified' ||
    isGeneratingDraft(activity)
}

export function isGeneratingDraft(activity?: TopicActivity) {
  return activity?.kind === 'wf2Starting' || activity?.kind === 'wf2Generating'
}

export function canGenerateDraft(item: ProductionItem) {
  return isWorkflowStatus(item.workflow_status) &&
    !['生成中', '已发布', '已放弃'].includes(item.workflow_status)
}

export function hasDraft(item: ProductionItem) {
  return Boolean(item.draft_md?.trim() || item.final_md?.trim() || item.final_content?.trim() ||
    item.workflow_status === '待人工审核' || item.workflow_status === '已定稿')
}

function isWatching(activity?: TopicActivity) {
  return activity?.kind === 'waiting' || activity?.kind === 'webhookUnverified' || activity?.kind === 'watchPaused' ||
    activity?.kind === 'watchFailed' || activity?.kind === 'watchChanged'
}

export function canConfirm(item: ProductionItem, activity?: TopicActivity) {
  return item.workflow_status === '待筛选' && !isMutationBlocked(activity) && !isWatching(activity)
}

export function canAbandon(item: ProductionItem) {
  return isWorkflowStatus(item.workflow_status) && !['生成中', '已定稿', '已发布', '已放弃'].includes(item.workflow_status)
}

function draftOutput(item: ProductionItem) {
  return JSON.stringify([
    item.draft_md, item.video_script, item.remotion_data, item.fact_check_notes,
    item.compliance_report, item.ai_outline, item.suggested_titles,
  ])
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
    return activityFor(item, 'watchChanged', `当前记录为「${item.workflow_status}」。`)
  }
  if (activity.kind === 'saveUnverified' || activity.kind === 'readbackFailed' || activity.kind === 'abandonUnverified') {
    return activityFor(item, 'checked', `当前记录为「${item.workflow_status}」。`)
  }
  return activity
}

export function useTopicBoard(api: ContentHubApi, writes: RecordWrites) {
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
    const active = () => mounted.current && watchers.current.get(id) === token

    try {
      const finished = await pollWorkflow(api.mode, active, async () => {
        const ticket = ++sequence.current
        try {
          return { ticket, latest: await api.getProductionItem(id) }
        } catch (error) {
          return { ticket, error: message(error) }
        }
      }, ({ ticket, latest, error }) => {
        if ((observedAt.current.get(id) ?? 0) > ticket) return false
        if (!latest) {
          publish(item, 'watchFailed', { detail: error, ticket })
          return true
        }
        if (latest.workflow_status === confirmedStatus) return false

        const observed = { replaceItem: true, ticket }
        if (latest.workflow_status === 'AI初稿完成') publish(latest, 'ready', observed)
        else if (latest.workflow_status === '已放弃') publish(latest, 'abandoned', observed)
        else publish(latest, 'watchChanged', { ...observed, detail: `当前记录为「${latest.workflow_status}」。` })
        return true
      })
      if (!finished && active()) publish(item, 'watchPaused')
    } finally {
      if (active()) watchers.current.delete(id)
    }
  }

  async function confirm(item: ProductionItem) {
    if (busy.current.has(item.id) || !canConfirm(item, state.activities[item.id])) return
    const release = writes.acquire(item.id)
    if (!release) return
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
      release()
    }
  }

  async function generateDraft(item: ProductionItem) {
    if (busy.current.has(item.id) || !canGenerateDraft(item)) return
    const release = writes.acquire(item.id)
    if (!release) return
    busy.current.add(item.id)
    publish(item, 'wf2Starting')

    let generated = false
    const previousOutput = draftOutput(item)
    try {
      await api.triggerGenerateDraft(item.id)
      publish(item, 'wf2Generating')
      let seenGenerating = false
      generated = await pollWorkflow(api.mode, () => mounted.current, async () => {
        try {
          return await api.getProductionItem(item.id)
        } catch {
          return null
        }
      }, latest => {
        if (!latest) return false
        if (latest.workflow_status === '生成中') {
          seenGenerating = true
          publish(latest, 'wf2Generating', { replaceItem: true })
          return false
        }
        if (latest.workflow_status !== '待人工审核') return false
        // 重新生成时，旧的审核状态不足以确认新稿已写入。
        if (!seenGenerating && item.workflow_status === '待人工审核' && draftOutput(latest) === previousOutput) return false
        publish(latest, 'wf2Ready', { replaceItem: true })
        return true
      }, Date.now(), { interval: 5_000, duration: 180_000 })
      if (!generated) publish(item, 'wf2Timeout')
    } catch (error) {
      publish(item, 'wf2Failed', { detail: message(error) })
    } finally {
      busy.current.delete(item.id)
      release()
    }

    if (generated && mounted.current) void refresh()
  }

  async function abandon(item: ProductionItem) {
    if (busy.current.has(item.id) || isMutationBlocked(state.activities[item.id]) || !canAbandon(item)) return
    const release = writes.acquire(item.id)
    if (!release) return
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
      release()
    }
  }

  const refreshIfLoaded = useCallback(() => {
    if (mounted.current && loadedOnce.current) void refresh()
  }, [refresh])

  const observeWorkbenchWrite = useCallback((item: ProductionItem) => {
    observedAt.current.set(item.id, ++sequence.current)
    if (item.workflow_status !== confirmedStatus) watchers.current.delete(item.id)
    setState(current => {
      if (!current.items) return current
      return {
        ...current,
        items: current.items.map(row => row.id === item.id ? item : row),
        activities: { ...current.activities, [item.id]: observeActivity(item, current.activities[item.id]) },
      }
    })
  }, [])

  return {
    ...state, refresh, refreshIfLoaded, ensureLoaded, confirm, generateDraft, abandon,
    observeWorkbenchWrite, lockedIds: writes.lockedIds,
  }
}
