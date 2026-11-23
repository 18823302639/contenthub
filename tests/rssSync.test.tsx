// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { createContentHubApi } from '../src/api'
import type { RssSyncSettings, WebhookReceipt } from '../src/api'
import type { RssSource } from '../src/types/schema'
import { ContentHubApp } from '../src/app/ContentHubApp'

const initial: RssSyncSettings = { id: 1, interval_hours: 6, last_synced_at: '2026-11-22T09:20:00Z' }

function setup(path = '/topics') {
  const api = Object.assign(createContentHubApi({}), {
    getRssSyncSettings: vi.fn<() => Promise<RssSyncSettings>>().mockResolvedValue(initial),
    setRssSyncInterval: vi.fn<(value: number) => Promise<RssSyncSettings>>(),
  })
  window.history.replaceState(null, '', '#' + path)
  render(<HashRouter><ContentHubApp api={api} /></HashRouter>)
  return api
}

function frequency() {
  return screen.getByRole<HTMLSelectElement>('combobox', { name: '自动采集频率' })
}

async function loadSettings() {
  await waitFor(() => expect(frequency().disabled).toBe(false))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('两个页面读取同一频率，暂停直接保存，并以本地时间格式显示上次采集', async () => {
  const api = setup()
  await loadSettings()
  const field = frequency()
  expect(field.value).toBe('6')
  expect(Array.from(field.options).map(option => option.value)).toEqual(['0', '1', '3', '6', '12', '24'])
  const time = screen.getByText(new Date(initial.last_synced_at!).toLocaleString('zh-CN', {
    dateStyle: 'medium', timeStyle: 'short',
  }))
  expect(time.getAttribute('datetime')).toBe(initial.last_synced_at)

  let finish!: (settings: RssSyncSettings) => void
  const saved = new Promise<RssSyncSettings>(resolve => { finish = resolve })
  api.setRssSyncInterval.mockReturnValueOnce(saved)
  fireEvent.change(field, { target: { value: '0' } })
  expect(frequency().disabled).toBe(true)
  expect(api.setRssSyncInterval).toHaveBeenCalledExactlyOnceWith(0)
  api.getRssSyncSettings.mockResolvedValue({ ...initial, interval_hours: 0 })
  await act(async () => finish({ ...initial, interval_hours: 0 }))
  expect(screen.getByText('采集频率已更新')).toBeTruthy()
  expect(frequency().value).toBe('0')

  fireEvent.click(screen.getByRole('link', { name: '信源管理' }))
  await loadSettings()
  expect(frequency().value).toBe('0')
})

it('提交手动采集时防止连点，受理后刷新当前页面并保留筛选', async () => {
  const api = setup('/sources?pool=radar')
  let finish!: (value: WebhookReceipt) => void
  const trigger = vi.spyOn(api, 'triggerWebhook').mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const list = vi.spyOn(api, 'listRssSources')
  await screen.findByText('模拟·消费者问答库')
  fireEvent.click(screen.getByRole('button', { name: '立即采集' }))
  const working = screen.getByRole<HTMLButtonElement>('button', { name: '采集中...' })
  expect(working.disabled).toBe(true)
  fireEvent.click(working)
  expect(trigger).toHaveBeenCalledExactlyOnceWith('rss-sync-now', {})

  await act(async () => finish({ accepted: true, status: 202 }))
  expect(screen.getByText('已触发采集，请稍后刷新查看新选题')).toBeTruthy()
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('button', { name: '雷达池' }).getAttribute('aria-pressed')).toBe('true')
})

it('信源正在写入时先等待，完成后执行采集受理要求的列表刷新', async () => {
  const api = setup('/sources')
  const list = vi.spyOn(api, 'listRssSources')
  const source = (await api.listRssSources())[0]
  list.mockClear()
  let finishWrite!: (row: RssSource) => void
  vi.spyOn(api, 'setRssSourceActive').mockReturnValueOnce(new Promise(resolve => { finishWrite = resolve }))
  vi.spyOn(api, 'triggerWebhook').mockResolvedValueOnce({ accepted: true, status: 202 })

  fireEvent.click(await screen.findByRole('switch', { name: '启用 模拟·零售数据观察' }))
  await screen.findByText('正在保存状态…')
  fireEvent.click(screen.getByRole('button', { name: '立即采集' }))
  await screen.findByText('已触发采集，请稍后刷新查看新选题')
  expect(list).not.toHaveBeenCalled()
  await act(async () => finishWrite({ ...source, is_active: false }))
  await waitFor(() => expect(list).toHaveBeenCalledOnce())
})

it('保存频率和触发失败有明确提示，并保留原频率', async () => {
  const api = setup()
  api.setRssSyncInterval.mockRejectedValueOnce(new Error('没有写入权限'))
  const trigger = vi.spyOn(api, 'triggerWebhook').mockRejectedValueOnce(new Error('网络异常'))
  await loadSettings()
  fireEvent.change(frequency(), { target: { value: '12' } })
  await screen.findByText(/采集频率保存结果未确认/)
  expect(frequency().value).toBe('6')
  fireEvent.click(screen.getByRole('button', { name: '立即采集' }))
  await screen.findByText(/采集触发结果未确认/)
  expect(trigger).toHaveBeenCalledOnce()
  expect(screen.queryByText('已触发采集，请稍后刷新查看新选题')).toBeNull()
})
