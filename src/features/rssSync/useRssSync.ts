import { useCallback, useEffect, useRef, useState } from 'react'
import { RssSyncAuthError } from '../../api'
import type { ContentHubApi, RssSyncInterval, RssSyncSettings } from '../../api'

type Notice = { text: string; error?: boolean }

function detail(error: unknown) {
  return error instanceof Error ? ' ' + error.message : ''
}

export function useRssSync(api: ContentHubApi, page: '/topics' | '/sources' | null) {
  const [settings, setSettings] = useState<RssSyncSettings | null>(null)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [pendingInterval, setPendingInterval] = useState<RssSyncInterval | null>(null)
  const [frequencyNotice, setFrequencyNotice] = useState<Notice | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncNotice, setSyncNotice] = useState<Notice | null>(null)
  const [acceptedCount, setAcceptedCount] = useState(0)
  const readVersion = useRef(0)
  const saving = useRef(false)
  const submitting = useRef(false)

  const refreshSettings = useCallback(async () => {
    if (saving.current) return
    const version = ++readVersion.current
    setReading(true)
    setReadError(null)
    try {
      const current = await api.getRssSyncSettings()
      if (version === readVersion.current) setSettings(current)
    } catch (error) {
      if (version === readVersion.current) setReadError('采集配置读取失败。' + detail(error))
    } finally {
      if (version === readVersion.current) setReading(false)
    }
  }, [api])

  useEffect(() => {
    if (page) void refreshSettings()
    return () => { readVersion.current++ }
  }, [page, refreshSettings])

  async function changeInterval(hours: RssSyncInterval) {
    if (!settings || saving.current || hours === settings.sync_interval_hours) return
    saving.current = true
    readVersion.current++
    setReading(false)
    setPendingInterval(hours)
    setFrequencyNotice(null)
    try {
      const saved = await api.setRssSyncInterval(hours)
      setSettings(saved)
      setReadError(null)
      setFrequencyNotice(saved.sync_interval_hours === hours ? { text: '采集频率已更新' }
        : { text: '采集频率保存结果未确认，回读值与所选值不一致。请刷新核对。', error: true })
    } catch (error) {
      setFrequencyNotice({ text: '采集频率保存结果未确认，请刷新核对。' + detail(error), error: true })
    } finally {
      saving.current = false
      setPendingInterval(null)
    }
  }

  async function syncNow() {
    if (submitting.current) return
    submitting.current = true
    setSyncing(true)
    setSyncNotice(null)
    try {
      await api.triggerWebhook('rss-sync-now', {})
      setSyncNotice({ text: '已触发采集，请稍后刷新查看新选题' })
      setAcceptedCount(count => count + 1)
      void refreshSettings()
    } catch (error) {
      const text = error instanceof RssSyncAuthError ? error.message
        : '采集触发结果未确认，请先核对执行记录。' + detail(error)
      setSyncNotice({ text, error: true })
    } finally {
      submitting.current = false
      setSyncing(false)
    }
  }

  return { settings, reading, readError, pendingInterval, frequencyNotice, syncing, syncNotice,
    acceptedCount, changeInterval, refreshSettings, syncNow }
}
