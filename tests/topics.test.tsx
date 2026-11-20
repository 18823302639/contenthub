// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContentHubApp } from '../src/app/ContentHubApp'
import { createContentHubApi, WriteReadbackError } from '../src/api'
import type { ContentHubApi } from '../src/api'
import type { ProductionItem } from '../src/types/schema'

const retail = '【模拟】折扣加深后，客单价为何可能下降'
const appliance = '【模拟】挑烘干机时怎样比较待机功耗'

function openApp(api = createContentHubApi({}), path = '/') {
  window.history.replaceState(null, '', '#' + path)
  render(<HashRouter><ContentHubApp api={api} /></HashRouter>)
  return api
}

function card(title: string) {
  return screen.findByRole('article', { name: title })
}

function choose(label: string, value: string) {
  fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value } })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('选题看板', () => {
  it('默认进入选题看板并展示 Mock 卡片与安全原文外链', async () => {
    openApp()
    expect(screen.getByText('正在加载选题…')).toBeTruthy()
    const row = within(await card(retail))
    expect(window.location.hash).toBe('#/topics')
    expect(within(screen.getByRole('navigation', { name: '主导航' }))
      .getByRole('link', { name: '选题看板' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('Mock · 离线演示')).toBeTruthy()
    expect(row.getByText('5 / 5')).toBeTruthy()
    expect(row.getByText('中风险')).toBeTruthy()
    expect(row.getByText(/120 笔订单/)).toBeTruthy()
    expect(row.getByRole('link', { name: '原文' }).getAttribute('href'))
      .toBe('https://retail.example.invalid/studies/basket-baseline')
    expect(row.getByRole('link', { name: '原文' }).getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('组合筛选赛道、最低评分和状态，零结果时可以清除', async () => {
    openApp()
    await card(retail)
    choose('赛道', '汽车家电评测')
    choose('最低评分', '4')
    choose('流程状态', '待筛选')
    expect(screen.getAllByRole('article').map(row => row.querySelector('h2')?.textContent))
      .toEqual([appliance])
    choose('最低评分', '5')
    expect(screen.getByText('没有符合条件的选题')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(screen.getAllByRole('article')).toHaveLength(5)
  })

  it('先保存确认状态，再显示 Webhook 受理，最后读取初稿完成', async () => {
    const api = openApp()
    const update = vi.spyOn(api, 'updateProductionItem')
    const trigger = vi.spyOn(api, 'triggerWebhook')
    const row = within(await card(retail))
    fireEvent.click(row.getByRole('button', { name: '确认选题' }))
    expect(row.getByText('正在保存选题状态…')).toBeTruthy()
    expect(trigger).not.toHaveBeenCalled()
    await row.findByText('状态已保存，正在请求 Webhook…')
    expect(update).toHaveBeenCalledWith(1, { workflow_status: '已确认-待核对' })
    await row.findByText('Webhook 已受理，等待初稿回写。')
    expect(trigger).toHaveBeenCalledExactlyOnceWith('fetch-and-draft', { production_id: 1 })
    expect(row.getByText('已确认-待核对')).toBeTruthy()
    expect(row.queryByText('AI初稿完成')).toBeNull()
    await row.findByText('AI初稿完成', {}, { timeout: 4000 })
    expect(row.getByText('初稿已回写。')).toBeTruthy()
    expect(trigger).toHaveBeenCalledTimes(1)
  })

  it('筛选导致卡片离开时仍能看到 Webhook 异常，刷新不重发', async () => {
    const api = openApp()
    const trigger = vi.spyOn(api, 'triggerWebhook').mockRejectedValue(new Error('连接中断'))
    await card(retail)
    choose('流程状态', '待筛选')
    const row = within(await card(retail))
    fireEvent.click(row.getByRole('button', { name: '确认选题' }))
    await screen.findByText(/状态已保存，但 Webhook 受理未确认/)
    expect(screen.queryByRole('article', { name: retail })).toBeNull()
    expect((await api.getProductionItem(1)).workflow_status).toBe('已确认-待核对')
    fireEvent.click(screen.getByRole('button', { name: '刷新列表' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '刷新列表' }) as HTMLButtonElement).disabled).toBe(false))
    expect(trigger).toHaveBeenCalledTimes(1)
    choose('流程状态', '已确认-待核对')
    const confirmed = within(await card(retail))
    expect(confirmed.queryByRole('button', { name: '确认选题' })).toBeNull()
    expect(confirmed.getByText(/Webhook 受理未确认/)).toBeTruthy()
  })

  it('写入回读异常时显示核对指引，刷新确认状态后仍不提交 Webhook', async () => {
    const api = openApp()
    const actualUpdate = api.updateProductionItem
    vi.spyOn(api, 'updateProductionItem').mockImplementation(async (id, patch) => {
      await actualUpdate(id, patch)
      throw new WriteReadbackError('production_pool', id, new Error('回读中断'))
    })
    const trigger = vi.spyOn(api, 'triggerWebhook')
    const row = within(await card(retail))
    fireEvent.click(row.getByRole('button', { name: '确认选题' }))
    await row.findByText(/保存请求成功，但回读失败/)
    expect((row.getByRole('button', { name: '确认选题' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '刷新列表' }))
    await row.findByText('已确认-待核对')
    expect(trigger).not.toHaveBeenCalled()
  })

  it('保存回读异常后，较早的列表结果不能重新开放确认按钮', async () => {
    const api = openApp()
    const row = within(await card(retail))
    const staleRows = await api.listProductionItems()
    let releaseList!: (rows: ProductionItem[]) => void
    const staleList = new Promise<ProductionItem[]>(resolve => { releaseList = resolve })
    vi.spyOn(api, 'listProductionItems').mockReturnValueOnce(staleList)
    fireEvent.click(screen.getByRole('button', { name: '刷新列表' }))

    const actualUpdate = api.updateProductionItem
    vi.spyOn(api, 'updateProductionItem').mockImplementation(async (id, patch) => {
      await actualUpdate(id, patch)
      throw new WriteReadbackError('production_pool', id, new Error('回读中断'))
    })
    const trigger = vi.spyOn(api, 'triggerWebhook')
    fireEvent.click(row.getByRole('button', { name: '确认选题' }))
    await row.findByText(/保存请求成功，但回读失败/)
    await act(async () => releaseList(staleRows))
    expect((row.getByRole('button', { name: '确认选题' }) as HTMLButtonElement).disabled).toBe(true)
    expect(trigger).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '刷新列表' }))
    await row.findByText('已确认-待核对')
  })

  it('列表读到较新的放弃状态后，迟到的轮询不能显示旧初稿', async () => {
    const api = openApp()
    const row = within(await card(retail))
    const seed = await api.getProductionItem(1)
    vi.spyOn(api, 'triggerWebhook').mockResolvedValue({ accepted: true, status: 202 })
    let releasePoll!: (item: ProductionItem) => void
    const olderPoll = new Promise<ProductionItem>(resolve => { releasePoll = resolve })
    const read = vi.spyOn(api, 'getProductionItem').mockReturnValueOnce(olderPoll)
    fireEvent.click(row.getByRole('button', { name: '确认选题' }))
    await waitFor(() => expect(read).toHaveBeenCalledOnce(), { timeout: 2500 })
    await api.updateProductionItem(1, { workflow_status: '已放弃' })
    fireEvent.click(screen.getByRole('button', { name: '刷新列表' }))
    await row.findByText('已放弃')
    await act(async () => releasePoll({ ...seed, workflow_status: 'AI初稿完成' }))
    expect(row.getByText('已放弃')).toBeTruthy()
    expect(row.queryByText('AI初稿完成')).toBeNull()
  })

  it('并发确认让两条卡片离开筛选时，两个 Webhook 异常都保留', async () => {
    const api = openApp()
    vi.spyOn(api, 'triggerWebhook').mockRejectedValue(new Error('连接中断'))
    await card(retail)
    choose('流程状态', '待筛选')
    fireEvent.click(within(await card(retail)).getByRole('button', { name: '确认选题' }))
    fireEvent.click(within(await card(appliance)).getByRole('button', { name: '确认选题' }))
    await waitFor(() => expect(screen.getAllByText(/Webhook 受理未确认/)).toHaveLength(2))
    expect(screen.getByText(retail)).toBeTruthy()
    expect(screen.getByText(appliance)).toBeTruthy()
  })

  it('放弃更新卡片状态，改稿台链接仍携带选题 ID', async () => {
    openApp()
    const row = within(await card(appliance))
    fireEvent.click(row.getByRole('button', { name: '放弃' }))
    await row.findByText('已放弃')
    expect(row.queryByRole('button', { name: '确认选题' })).toBeNull()
    fireEvent.click(row.getByRole('link', { name: '进入改稿台' }))
    expect(window.location.hash).toBe('#/workbench/2')
    expect(screen.getByRole('heading', { name: '改稿台' })).toBeTruthy()
    expect(screen.getByText(/选题记录 #2/)).toBeTruthy()
  })

  it('首次读取失败给出错误和刷新入口，成功后显示数据', async () => {
    const api: ContentHubApi = createContentHubApi({})
    vi.spyOn(api, 'listProductionItems').mockRejectedValueOnce(new Error('读取测试错误'))
    openApp(api)
    await screen.findByText('读取测试错误')
    fireEvent.click(screen.getByRole('button', { name: '刷新列表' }))
    await card(retail)
    expect(screen.queryByText('读取测试错误')).toBeNull()
  })

  it('可从未知路由进入信源、运营和选题看板', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    openApp(createContentHubApi({}), '/not-found')
    expect(screen.getByRole('heading', { name: '页面不存在' })).toBeTruthy()
    const nav = within(screen.getByRole('navigation', { name: '主导航' }))
    fireEvent.click(nav.getByRole('link', { name: '信源管理' }))
    expect(screen.getByRole('heading', { name: '信源管理' })).toBeTruthy()
    expect(await screen.findByRole('table', { name: 'RSS 信源' })).toBeTruthy()
    fireEvent.click(nav.getByRole('link', { name: '运营数据' }))
    expect(await screen.findByRole('heading', { name: '运营数据' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: '阅读量趋势' })).toBeTruthy()
    fireEvent.click(nav.getByRole('link', { name: '选题看板' }))
    await card(retail)
  })
})
