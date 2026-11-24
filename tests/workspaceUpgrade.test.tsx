// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import type { ContentHubApi } from '../src/api'
import { createContentHubApi } from '../src/api'
import { ContentHubApp } from '../src/app/ContentHubApp'
import { RenderResults, useRenderResults } from '../src/features/productionDesk/RenderResults'
import type { ProductionItem } from '../src/types/schema'

const row: ProductionItem = {
  id: 1, source_name: '模拟信源', track_tag: 'main_overseas', raw_title: 'Original source',
  zh_title: '第一份稿件', url: 'https://source.example.invalid/data', key_data_points: '源数据',
  suggested_titles: [], score: 5, compliance_risk: '低风险', workflow_status: '待人工终审',
  ai_outline: null, is_benchmark: false, created_at: '2024-01-01', published_at: '',
  draft_md: '稿件正文', video_script: '稿件口播', remotion_data: { scenes: [{ source: '原始样本', source_year: 2024 }] },
}

function editor() {
  return screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Markdown 编辑器' })
}

function fixture(rows = [row]) {
  const api = createContentHubApi({})
  vi.spyOn(api, 'listProductionItems').mockResolvedValue(rows)
  vi.spyOn(api, 'getProductionItem').mockImplementation(async id => {
    const item = rows.find(entry => entry.id === id)
    if (!item) throw new Error('模拟记录不存在')
    return item
  })
  return api
}

function mount(api: ContentHubApi, path: string) {
  const router = createMemoryRouter([{ path: '*', element: <ContentHubApp api={api} /> }], { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  window.localStorage.clear()
})

it('改稿队列按更新时间排序，URL 参数优先于本地记录并排除待筛选、放弃', async () => {
  window.localStorage.setItem('contenthub.lastWorkbenchId', '2')
  const api = fixture([
    row,
    { ...row, id: 2, zh_title: '更新的稿件', workflow_status: '精修中', updated_at: '2025-02-01' },
    { ...row, id: 3, zh_title: '不在队列', workflow_status: '已放弃', updated_at: '2026-01-01' },
    { ...row, id: 4, zh_title: '也不在队列', workflow_status: '待筛选', updated_at: '2026-01-01' },
  ])
  mount(api, '/workbench?id=1')
  await editor()
  expect(screen.getByText(/选题记录 #1/)).toBeTruthy()
  const queue = within(screen.getByRole('complementary', { name: '待改稿列表' }))
  expect(queue.getAllByRole('link').map(link => link.querySelector('strong')?.textContent))
    .toEqual(['更新的稿件', '第一份稿件'])
  expect(window.localStorage.getItem('contenthub.lastWorkbenchId')).toBe('1')
})

it('无有效 URL 时优先选上次稿件，切换和浏览器返回时会保护未保存编辑', async () => {
  window.localStorage.setItem('contenthub.lastWorkbenchId', '1')
  const api = fixture([row, { ...row, id: 2, zh_title: '更新的稿件', updated_at: '2025-02-01' }])
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const router = mount(api, '/workbench')
  const input = await editor()
  expect(screen.getByText(/选题记录 #1/)).toBeTruthy()
  fireEvent.change(input, { target: { value: '未保存正文' } })
  expect(screen.getByText('未保存')).toBeTruthy()
  const link = screen.getByRole('link', { name: /更新的稿件/ })
  fireEvent.click(link)
  expect(confirm).toHaveBeenCalledOnce()
  expect(input.value).toBe('未保存正文')
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false)
  confirm.mockReturnValueOnce(true)
  fireEvent.click(link)
  expect(await screen.findByText(/选题记录 #2/)).toBeTruthy()
  fireEvent.change(await editor(), { target: { value: '第二条也未保存' } })
  await act(async () => router.navigate(-1))
  expect(confirm).toHaveBeenCalledTimes(3)
  expect(screen.getByText(/选题记录 #2/)).toBeTruthy()
})

it('选题页搜索、页码跳转、每页条数和筛选重置保持一致，全库总数独立', async () => {
  const rows = Array.from({ length: 27 }, (_, index) => ({
    ...row, id: index + 1, zh_title: index === 24 ? '唯一关键词' : '样本 ' + (index + 1),
    workflow_status: '待筛选',
  }))
  const api = fixture(rows)
  vi.mocked(api.listProductionItems).mockImplementation(async (_filters, total) => { total?.(42); return rows })
  mount(api, '/topics')
  expect(await screen.findByText('当前总选题数：42 条')).toBeTruthy()
  expect(screen.getAllByRole('article')).toHaveLength(12)
  const pages = within(screen.getByRole('navigation', { name: '选题分页' }))
  fireEvent.click(pages.getByRole('button', { name: '下一页' }))
  expect(pages.getByText('共 27 条，第 2 / 3 页')).toBeTruthy()
  fireEvent.change(pages.getByRole('spinbutton', { name: '页码' }), { target: { value: '3' } })
  fireEvent.click(pages.getByRole('button', { name: '跳转' }))
  expect(screen.getAllByRole('article')).toHaveLength(3)
  fireEvent.change(pages.getByRole('combobox', { name: '每页条数' }), { target: { value: '20' } })
  expect(pages.getByText('共 27 条，第 1 / 2 页')).toBeTruthy()
  fireEvent.click(pages.getByRole('button', { name: '下一页' }))
  fireEvent.change(screen.getByRole('searchbox', { name: '标题/关键词' }), { target: { value: '唯一关键词' } })
  fireEvent.click(screen.getByRole('button', { name: '搜索' }))
  expect(pages.getByText('共 1 条，第 1 / 1 页')).toBeTruthy()
  expect(screen.getByRole('article', { name: '唯一关键词' })).toBeTruthy()
})

it('采集后先比较全库数量，出现新批次时优先用数据库本次新增数', async () => {
  const api = fixture()
  let total = 20
  let synced = false
  vi.mocked(api.listProductionItems).mockImplementation(async (_filters, reportTotal) => { reportTotal?.(total); return [row] })
  vi.spyOn(api, 'getRssSyncSettings').mockImplementation(async () => ({
    id: 1, sync_interval_hours: 6, last_sync_added_count: synced ? 8 : 99,
    last_synced_at: synced ? '2025-01-02T00:00:00Z' : '2025-01-01T00:00:00Z',
  }))
  vi.spyOn(api, 'triggerWebhook').mockImplementation(async () => { total = 22; return { accepted: true, status: 202 } })
  mount(api, '/topics')
  await screen.findByText('当前总选题数：20 条')
  fireEvent.click(screen.getByRole('button', { name: '立即采集' }))
  expect(await screen.findByText('刷新完成：本次新增 2 条，当前共 22 条')).toBeTruthy()
  synced = true
  fireEvent.click(screen.getByRole('button', { name: '刷新列表' }))
  expect(await screen.findByText('刷新完成：本次新增 8 条，当前共 22 条')).toBeTruthy()
})

it('改稿台发送临时稿件，回填后只在人工保存时写入草稿', async () => {
  const api = fixture()
  const hook = vi.spyOn(api, 'triggerWebhook').mockResolvedValue({
    accepted: true, status: 200, draft_md: 'AI 优化正文', video_script: 'AI 优化口播',
  })
  const write = vi.spyOn(api, 'updateProductionItem').mockImplementation(async (_id, patch) => ({ ...row, ...patch }))
  mount(api, '/workbench?id=1')
  fireEvent.change(await editor(), { target: { value: '用户正在编辑的正文' } })
  fireEvent.change(screen.getByRole('textbox', { name: '修改侧重点（可选）' }), { target: { value: '保留数据口径' } })
  fireEvent.click(screen.getByRole('button', { name: 'AI 挑刺去味' }))
  await screen.findByText('AI 改稿已写入草稿，请人工核对')
  expect(hook).toHaveBeenCalledExactlyOnceWith('rewrite-draft', {
    production_id: 1, revision_note: '保留数据口径', draft_md: '用户正在编辑的正文', video_script: '稿件口播',
  })
  expect((await editor()).value).toBe('AI 优化正文')
  expect(write).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
  await screen.findByText('草稿已保存。')
  expect(write).toHaveBeenCalledExactlyOnceWith(1, {
    draft_md: 'AI 优化正文', video_script: 'AI 优化口播', remotion_data: row.remotion_data,
  })
  expect(screen.queryByText('未保存')).toBeNull()
})

it('初始渲染中每十秒读记录，完成后呈现视频和静态图并停止轮询', async () => {
  vi.useFakeTimers()
  const api = fixture()
  const video = 'https://media.example.invalid/video.mp4?sig=fake%2b'
  const card = '/mock/chart.png'
  const read = vi.mocked(api.getProductionItem).mockResolvedValue({
    ...row, render_status: 'completed', video_url: video, cards_urls: [card, 'javascript:alert(1)'],
  })
  const queued = { ...row, render_status: 'queued' }
  function Panel() { return <RenderResults model={useRenderResults(api, queued, true)} /> }
  render(<Panel />)
  expect(screen.getByText('渲染状态 · 渲染中')).toBeTruthy()
  await act(async () => vi.advanceTimersByTimeAsync(9999))
  expect(read).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(1))
  expect(read).toHaveBeenCalledExactlyOnceWith(1)
  expect(screen.getByLabelText('成片预览').getAttribute('src')).toBe(video)
  expect(screen.getByRole('link', { name: '下载视频' }).getAttribute('href')).toBe(video)
  expect(screen.getByRole('img', { name: '静态数据图 1' }).getAttribute('src')).toBe(card)
  expect(screen.getAllByRole('img')).toHaveLength(1)
  await act(async () => vi.advanceTimersByTimeAsync(60_000))
  expect(read).toHaveBeenCalledTimes(1)
})

it('长改稿队列内可按标题搜索，过滤不会改变当前稿件', async () => {
  const rows = [row, ...Array.from({ length: 9 }, (_, index) => ({
    ...row, id: index + 2, zh_title: '稿件编号 ' + (index + 2),
  }))]
  mount(fixture(rows), '/workbench?id=1')
  await editor()
  const queue = within(screen.getByRole('complementary', { name: '待改稿列表' }))
  fireEvent.change(queue.getByRole('searchbox', { name: '搜索待改稿件' }), { target: { value: '编号 8' } })
  expect(queue.getAllByRole('link')).toHaveLength(1)
  expect(queue.getByRole('link', { name: /稿件编号 8/ })).toBeTruthy()
  expect(screen.getByText(/选题记录 #1/)).toBeTruthy()
})

it('高危词与 JSON 语法错误阻止定稿，来源年份缺失只提示', async () => {
  const warned = { ...row, zh_title: '投资预测', remotion_data: { scenes: [{ source: '样本' }] } }
  mount(fixture([warned]), '/workbench?id=1')
  await editor()
  const finalize = screen.getByRole<HTMLButtonElement>('button', { name: '人工复核通过并定稿' })
  expect(finalize.disabled).toBe(true)
  expect(screen.getByText(/标题 · 投资、预测/)).toBeTruthy()
  const acknowledgement = screen.getByRole<HTMLInputElement>('checkbox', { name: '人工复核后将风险改为低风险' })
  fireEvent.click(acknowledgement)
  expect(finalize.disabled).toBe(false)
  fireEvent.click(screen.getByRole('tab', { name: 'Remotion 渲染数据' }))
  expect(screen.getByText(/请补齐来源年份/)).toBeTruthy()
  const json = screen.getByRole('textbox', { name: 'Remotion JSON' })
  fireEvent.change(json, { target: { value: '{"scenes":[' } })
  expect(screen.getAllByText(/JSON 语法错误/).length).toBeGreaterThan(0)
  expect(finalize.disabled).toBe(true)
  fireEvent.change(json, { target: { value: '{"scenes":[{"source":"原始样本","source_year":2024}]}' } })
  expect(acknowledgement.checked).toBe(false)
  fireEvent.click(acknowledgement)
  expect(finalize.disabled).toBe(false)
  fireEvent.click(screen.getByRole('tab', { name: '图文正文' }))
  fireEvent.change(await editor(), { target: { value: '追加证券内容' } })
  expect(acknowledgement.checked).toBe(false)
  expect(finalize.disabled).toBe(true)
})

it('need_remotion=false 即使是主赛道也隐藏渲染操作和结果', async () => {
  mount(fixture([{ ...row, need_remotion: false }]), '/workbench?id=1')
  await editor()
  expect(screen.queryByRole('button', { name: '提交 Remotion 渲染' })).toBeNull()
  expect(screen.queryByRole('region', { name: '渲染状态与成片' })).toBeNull()
})

it('独立改稿台可以切换四个面板，业务禁渲染时仍能修改并保存口播', async () => {
  const item = { ...row, track_tag: 'sub_toutiao', need_remotion: false, fact_check_notes: '查证原始样本' }
  const api = fixture([item])
  const write = vi.spyOn(api, 'updateProductionItem').mockImplementation(async (_id, patch) => ({ ...item, ...patch }))
  mount(api, '/workbench?id=1')
  await editor()
  const tabs = within(screen.getByRole('tablist', { name: '精修内容' }))
  fireEvent.click(tabs.getByRole('tab', { name: '视频口播稿' }))
  fireEvent.change(screen.getByRole('textbox', { name: '口播脚本' }), { target: { value: '改稿台里的口播' } })
  expect(screen.getByText('未保存')).toBeTruthy()
  fireEvent.click(tabs.getByRole('tab', { name: 'Remotion 渲染数据' }))
  expect(screen.getByRole('textbox', { name: 'Remotion JSON' })).toBeTruthy()
  fireEvent.click(tabs.getByRole('tab', { name: '原始信源与大纲' }))
  const reference = within(screen.getByRole('tabpanel', { name: '原始信源与大纲' }))
  expect(reference.getByText('查证原始样本')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '提交 Remotion 渲染' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
  await screen.findByText('草稿已保存。')
  expect(write).toHaveBeenCalledExactlyOnceWith(1, { draft_md: item.draft_md, video_script: '改稿台里的口播' })
})

it('精修 Tab 有独立面板且空白 Remotion 不禁用原有定稿和渲染操作', async () => {
  const item = { ...row, remotion_data: null }
  const api = fixture([item])
  const trigger = vi.spyOn(api, 'triggerRender').mockResolvedValue({ accepted: true, status: 202 })
  mount(api, '/workbench?id=1')
  await editor()
  const tabs = within(screen.getByRole('tablist', { name: '精修内容' }))
  const buttons = tabs.getAllByRole('tab')
  expect(new Set(buttons.map(button => button.getAttribute('aria-controls'))).size).toBe(4)
  for (const button of buttons) {
    fireEvent.click(button)
    expect(button.getAttribute('aria-selected')).toBe('true')
    expect(document.getElementById(button.getAttribute('aria-controls')!)?.hidden).toBe(false)
    for (const inactive of buttons.filter(tab => tab !== button)) {
      expect(inactive.getAttribute('aria-selected')).toBe('false')
      expect(document.getElementById(inactive.getAttribute('aria-controls')!)?.hidden).toBe(true)
    }
  }
  const finalize = screen.getByRole<HTMLButtonElement>('button', { name: '人工复核通过并定稿' })
  expect(finalize.disabled).toBe(false)
  expect(screen.queryByRole('button', { name: '保存定稿' })).toBeNull()
  const render = screen.getByRole<HTMLButtonElement>('button', { name: '提交 Remotion 渲染' })
  expect(render.disabled).toBe(false)
  fireEvent.click(render)
  await screen.findByText('Remotion 渲染请求已受理')
  expect(trigger).toHaveBeenCalledExactlyOnceWith(1)
})
