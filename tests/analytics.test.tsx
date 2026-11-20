// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createContentHubApi, WriteReadbackError } from '../src/api'
import { ContentHubApp } from '../src/app/ContentHubApp'
import type { ContentHubApi } from '../src/api'
import { calendarDay } from '../src/utils/metricDays'

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true, value(this: HTMLDialogElement) { this.open = true },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true, value(this: HTMLDialogElement) { this.open = false },
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const [key, descriptor] of [['showModal', originalShowModal], ['close', originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key)
  }
})

function mount(api: ContentHubApi = createContentHubApi({})) {
  window.history.replaceState(null, '', '#/analytics')
  render(<HashRouter><ContentHubApp api={api} /></HashRouter>)
  return api
}

function press(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
}

function change(dialog: HTMLElement, name: string, value: string) {
  fireEvent.change(within(dialog).getByLabelText(name, { exact: true }), { target: { value } })
}

async function openEntry() {
  const opener = await screen.findByRole<HTMLButtonElement>('button', { name: '录入运营数据' })
  await waitFor(() => expect(opener.disabled).toBe(false))
  fireEvent.click(opener)
  return screen.findByRole('dialog', { name: '录入运营数据' })
}

function fill(dialog: HTMLElement, platform = '公众号') {
  change(dialog, '已发布内容', '5')
  change(dialog, '平台', platform)
  change(dialog, '日期（UTC+8）', calendarDay(Date.now()))
  change(dialog, '新增展现量', '100')
  change(dialog, '新增阅读量', '28')
  change(dialog, '平台 CTR（%）', '7')
  change(dialog, '平台完读率（%）', '40')
  change(dialog, '单日收益（元）', '12.5')
}

function save(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: '保存数据' }))
}

describe('运营数据复盘', () => {
  it('默认按公众号看近 7 天，可切至 30 天或其他平台，雷达严格取双阈值', async () => {
    const network = vi.fn<typeof fetch>()
    const api = createContentHubApi({}, network)
    const radar = vi.spyOn(api, 'listRadarItems')
    mount(api)
    await screen.findByRole('heading', { name: '阅读量趋势' })
    expect(screen.getByRole('button', { name: '公众号' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '近 7 天' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('heading', { name: 'CTR 趋势' })).toBeTruthy()
    fireEvent.click(screen.getByText('查看逐日数据'))
    const daily = screen.getByRole('table', { name: '逐日运营数据' })
    expect(within(daily).getAllByRole('row')).toHaveLength(8)
    press('近 30 天')
    expect(within(daily).getAllByRole('row')).toHaveLength(31)
    press('B站')
    expect(screen.getByRole('button', { name: 'B站' }).getAttribute('aria-pressed')).toBe('true')
    expect(await screen.findByText(/低频家电租买成本/)).toBeTruthy()
    expect(screen.getByText(/按周复盘的台账/)).toBeTruthy()
    expect(screen.queryByText(/三件套/)).toBeNull()
    expect(screen.queryByText(/比价耗时/)).toBeNull()
    expect(radar).toHaveBeenCalledWith({ minCommercialScore: 4, minInfoGapScore: 4 })
    expect(network).not.toHaveBeenCalled()
  })

  it('按填报 CTR 录入，单次提交保存后有反馈，同平台同日再次提交受阻', async () => {
    const api = mount()
    const post = vi.spyOn(api, 'createAccountMetric')
    let dialog = await openEntry()
    expect(within(dialog).getByText(/仅填写这一天的新增数据/)).toBeTruthy()
    save(dialog)
    expect(within(dialog).getByText('请选择已发布内容。')).toBeTruthy()
    expect(post).not.toHaveBeenCalled()
    fill(dialog)
    save(dialog)
    fireEvent.submit(dialog.querySelector('form')!)
    await screen.findByText('运营数据已保存。')
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][0]).toMatchObject({ production_id: 5, platform: '公众号', impressions: 100, views: 28, ctr: 7 })
    fireEvent.click(screen.getByText('查看逐日数据'))
    const dayRow = screen.getByRole('row', { name: new RegExp(calendarDay(Date.now())) })
    expect(within(dayRow).getByText('7%')).toBeTruthy()
    dialog = await openEntry()
    fill(dialog)
    save(dialog)
    await within(dialog).findByText(/同一内容在该平台当天已有记录/)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('隔离真实模式的来源不明历史记录，不用零填补', async () => {
    const api: ContentHubApi = { ...createContentHubApi({}), mode: 'real' }
    mount(api)
    await screen.findByText(/历史记录口径未核对/)
    expect(screen.getByLabelText('周期新增阅读量').textContent).toContain('—')
    fireEvent.click(screen.getByText('查看逐日数据'))
    const trends = screen.getByRole('table', { name: '逐日运营数据' })
    expect(within(trends).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('真实模式仅显示当前会话回读确认的手动单日记录', async () => {
    const backend = createContentHubApi({})
    mount({ ...backend, mode: 'real' })
    await screen.findByText(/历史记录口径未核对/)
    const dialog = await openEntry()
    fill(dialog)
    save(dialog)
    await screen.findByText('运营数据已保存。')
    expect(screen.getByLabelText('周期新增阅读量').querySelector('strong')?.textContent).toBe('28')
    press('刷新数据')
    const refresh = screen.getByRole<HTMLButtonElement>('button', { name: '刷新数据' })
    await waitFor(() => expect(refresh.disabled).toBe(false))
    expect(screen.getByLabelText('周期新增阅读量').querySelector('strong')?.textContent).toBe('28')
    expect(screen.getByLabelText('周期加权 CTR').querySelector('strong')?.textContent).toBe('7%')
    expect(screen.getByText(/历史记录口径未核对/)).toBeTruthy()
  })

  it('新增回读失败保留核对反馈，同一申请不会自动重发', async () => {
    const api = mount()
    const create = api.createAccountMetric
    const post = vi.spyOn(api, 'createAccountMetric').mockImplementationOnce(async input => {
      const saved = await create(input)
      throw new WriteReadbackError('account_metrics', saved.id, new Error('回读中断'))
    })
    const dialog = await openEntry()
    fill(dialog)
    save(dialog)
    await screen.findByText(/保存结果待核对/)
    expect(screen.queryByText('运营数据已保存。')).toBeNull()
    const verifying = screen.getByRole('dialog', { name: '录入运营数据' })
    fireEvent.submit(verifying.querySelector('form')!)
    expect(post).toHaveBeenCalledTimes(1)
    fireEvent.click(within(verifying).getByRole('button', { name: '核对记录' }))
    await screen.findByText(/已核对到该单日记录/)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it.each(['数据不一致', '回执 ID 不一致', '没有回执 ID'])('核对时发现同日但%s，不确认保存', async kind => {
    const api = mount()
    const create = api.createAccountMetric
    const post = vi.spyOn(api, 'createAccountMetric').mockImplementationOnce(async input => {
      const saved = await create(kind === '数据不一致' ? { ...input, views: 77 } : input)
      const id = kind === '回执 ID 不一致' ? saved.id + 1 : kind === '没有回执 ID' ? null : saved.id
      throw new WriteReadbackError('account_metrics', id, new Error('回读中断'))
    })
    const dialog = await openEntry()
    fill(dialog)
    save(dialog)
    await screen.findByText(/保存结果待核对/)
    const verifying = screen.getByRole('dialog', { name: '录入运营数据' })
    fireEvent.click(within(verifying).getByRole('button', { name: '核对记录' }))
    await within(verifying).findByText(/同日记录无法与本次提交确认/)
    expect(screen.queryByText(/已核对到该单日记录/)).toBeNull()
    fireEvent.submit(verifying.querySelector('form')!)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('单独处理雷达读取错误，复盘指标仍可查看', async () => {
    const api = createContentHubApi({})
    const radar = vi.spyOn(api, 'listRadarItems').mockRejectedValueOnce(new Error('雷达读取测试失败'))
    mount(api)
    await screen.findByText('雷达读取测试失败')
    expect(await screen.findByRole('heading', { name: '阅读量趋势' })).toBeTruthy()
    press('刷新数据')
    await screen.findByText(/低频家电租买成本/)
    expect(radar).toHaveBeenCalledTimes(2)
  })
})
