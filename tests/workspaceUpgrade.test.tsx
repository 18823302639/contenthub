// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import type { ContentHubApi } from '../src/api'
import { ApiHttpError, createContentHubApi } from '../src/api'
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
  await waitFor(() => expect(window.localStorage.getItem('contenthub.lastWorkbenchId')).toBe('1'))
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
  expect(read).toHaveBeenCalledExactlyOnceWith(1, expect.any(AbortSignal))
  expect(screen.getByLabelText('成片预览').getAttribute('src')).toBe(video)
  const viewVideo = screen.getByRole('link', { name: '打开视频' })
  expect(viewVideo.getAttribute('href')).toBe(video)
  expect(viewVideo.hasAttribute('download')).toBe(false)
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

it('独立改稿台可从已确认的空稿直接重试并读取新初稿', async () => {
  const pending: ProductionItem = { ...row, workflow_status: '已确认-待核对', draft_md: '  ' }
  const rows = [pending]
  const api = fixture(rows)
  const trigger = vi.spyOn(api, 'triggerWebhook').mockImplementation(async () => {
    rows[0] = { ...pending, workflow_status: 'AI初稿完成', draft_md: '重新生成的正文' }
    return { accepted: true, status: 202 }
  })
  mount(api, '/workbench?id=1')
  expect((await editor()).value.trim()).toBe('')
  fireEvent.click(screen.getByRole('button', { name: '生成初稿' }))
  await screen.findByText('已重新触发初稿生成')
  expect((await editor()).value).toBe('重新生成的正文')
  expect(trigger).toHaveBeenCalledExactlyOnceWith('fetch-and-draft', { production_id: 1 })
})

it('改稿台重新生成已有正文时先确认，取消保留编辑', async () => {
  const api = fixture()
  const trigger = vi.spyOn(api, 'triggerWebhook').mockResolvedValue({ accepted: true, status: 202 })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  mount(api, '/workbench?id=1')
  const draft = await editor()
  fireEvent.change(draft, { target: { value: '尚未保存的人工内容' } })
  fireEvent.click(screen.getByRole('button', { name: '重新生成初稿' }))
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(trigger).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '重新生成初稿' }))
  await screen.findByText('已重新触发初稿生成')
  expect(trigger).toHaveBeenCalledExactlyOnceWith('fetch-and-draft', { production_id: 1 })
  expect((await editor()).value).toBe('尚未保存的人工内容')
})

it('服务端仍显示渲染中时，改稿台可刷新并在确认后重新提交', async () => {
  const api = fixture([{ ...row, render_status: 'rendering' }])
  const trigger = vi.spyOn(api, 'triggerRender').mockResolvedValue({ accepted: true, status: 202 })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  mount(api, '/workbench?id=1')
  await editor()
  const results = within(screen.getByRole('region', { name: '渲染状态与成片' }))
  fireEvent.click(results.getByRole('button', { name: '刷新渲染状态' }))
  expect(api.getProductionItem).toHaveBeenCalledTimes(2)
  const retry = screen.getByRole<HTMLButtonElement>('button', { name: '重试 Remotion 渲染' })
  expect(retry.disabled).toBe(false)
  fireEvent.click(retry)
  await act(async () => {})
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(trigger).not.toHaveBeenCalled()
  fireEvent.click(retry)
  await screen.findByText('Remotion 渲染请求已受理')
  expect(trigger).toHaveBeenCalledExactlyOnceWith(1)
})

it('重提渲染后旧的刷新请求不锁住新任务，也不展示旧成片', async () => {
  const pending = { ...row, render_status: 'rendering' }
  const api = fixture([pending])
  let resolveOldRead!: (record: ProductionItem) => void
  const oldRead = new Promise<ProductionItem>(resolve => { resolveOldRead = resolve })
  vi.mocked(api.getProductionItem).mockResolvedValueOnce(pending).mockReturnValueOnce(oldRead)
  vi.spyOn(api, 'triggerRender').mockResolvedValue({ accepted: true, status: 202 })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  mount(api, '/workbench?id=1')
  await editor()
  const results = within(screen.getByRole('region', { name: '渲染状态与成片' }))
  const refresh = results.getByRole<HTMLButtonElement>('button', { name: '刷新渲染状态' })
  fireEvent.click(refresh)
  expect(refresh.disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '重试 Remotion 渲染' }))
  await screen.findByText('Remotion 渲染请求已受理')
  expect(refresh.disabled).toBe(false)
  await act(async () => resolveOldRead({ ...pending, render_status: 'completed', video_url: '/old.mp4' }))
  expect(results.getByText('渲染状态 · 渲染中')).toBeTruthy()
  expect(results.queryByRole('link', { name: '下载视频' })).toBeNull()
})

it('改稿代理异常时保留未保存编辑，手动重试后只回填编辑器', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 502 }))
    .mockResolvedValueOnce(Response.json({ draft_md: '重试生成的正文' }))
  const api = createContentHubApi({ VITE_USE_MOCK: 'false' }, fetcher)
  vi.spyOn(api, 'listProductionItems').mockResolvedValue([row])
  vi.spyOn(api, 'getProductionItem').mockResolvedValue(row)
  const write = vi.spyOn(api, 'updateProductionItem')
  mount(api, '/workbench?id=1')
  const draft = await editor()
  fireEvent.change(draft, { target: { value: '未保存的人工编辑' } })
  const retry = screen.getByRole<HTMLButtonElement>('button', { name: 'AI 挑刺去味' })
  fireEvent.click(retry)
  await screen.findByText(/改稿结果未确认.*502.*执行记录/)
  expect(retry.disabled).toBe(false)
  expect(draft.value).toBe('未保存的人工编辑')
  expect(fetcher).toHaveBeenCalledTimes(1)

  fireEvent.click(retry)
  await screen.findByText('AI 改稿已写入草稿，请人工核对')
  expect(draft.value).toBe('重试生成的正文')
  expect(write).not.toHaveBeenCalled()
  expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method, JSON.parse(String(init?.body))])).toEqual(
    Array.from({ length: 2 }, () => ['/api/n8n/rewrite-draft', 'POST', {
      production_id: 1, revision_note: '', draft_md: '未保存的人工编辑', video_script: row.video_script,
    }]),
  )
})

it('已受理新渲染任务时，新的查询也会忽略回传的旧任务成片', async () => {
  const initial = { ...row, render_status: 'rendering', render_job_id: 'job-old' }
  const api = fixture([initial])
  const trigger = vi.spyOn(api, 'triggerRender').mockResolvedValue({ accepted: true, status: 202, jobId: 'job-new' })
  const read = vi.mocked(api.getProductionItem)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  mount(api, '/workbench?id=1')
  await editor()
  fireEvent.click(screen.getByRole('button', { name: '重试 Remotion 渲染' }))
  await screen.findByText('Remotion 渲染请求已受理')
  const results = within(screen.getByRole('region', { name: '渲染状态与成片' }))
  const refresh = results.getByRole('button', { name: '刷新渲染状态' })
  read.mockResolvedValueOnce({ ...initial, render_status: 'completed', video_url: '/old.mp4' })
  await act(async () => fireEvent.click(refresh))
  expect(results.getByText('渲染状态 · 渲染中')).toBeTruthy()
  expect(results.queryByRole('link', { name: '下载视频' })).toBeNull()

  const complete = { ...initial, render_job_id: 'job-new', render_status: 'completed', video_url: '/new.mp4' }
  read.mockResolvedValueOnce(complete)
  await act(async () => fireEvent.click(refresh))
  expect(results.getByRole('link', { name: '下载视频' }).getAttribute('href')).toBe('/new.mp4')
  read.mockResolvedValueOnce({ ...initial, render_status: 'completed', video_url: '/late.mp4' })
  await act(async () => fireEvent.click(refresh))
  expect(results.getByRole('link', { name: '下载视频' }).getAttribute('href')).toBe('/new.mp4')
  expect(trigger).toHaveBeenCalledExactlyOnceWith(1)
})

it('旧站回执返回任务 ID 但未暴露对应列，仍可按状态找到成片', async () => {
  const api = fixture([{ ...row, render_status: '' }])
  vi.spyOn(api, 'triggerRender').mockResolvedValue({ accepted: true, status: 202, jobId: 'legacy-receipt' })
  mount(api, '/workbench?id=1')
  await editor()
  fireEvent.click(screen.getByRole('button', { name: '提交 Remotion 渲染' }))
  await screen.findByText('Remotion 渲染请求已受理')
  vi.mocked(api.getProductionItem).mockResolvedValueOnce({
    ...row, render_status: 'completed', video_url: '/legacy.mp4',
  })
  fireEvent.click(screen.getByRole('button', { name: '刷新渲染状态' }))
  expect((await screen.findByRole('link', { name: '下载视频' })).getAttribute('href')).toBe('/legacy.mp4')
})

it.each(['手动', '自动'])('读取渲染状态超时后恢复%s刷新，迟到结果不能取代新成片', async method => {
  vi.useFakeTimers()
  let finishStalledRead!: (response: Response) => void
  const stalledRead = new Promise<Response>(resolve => { finishStalledRead = resolve })
  const fetcher = vi.fn<typeof fetch>()
    .mockReturnValueOnce(stalledRead)
    .mockResolvedValueOnce(Response.json({ ...row, render_status: 'completed', video_url: '/current.mp4' }))
  const api = createContentHubApi({
    VITE_USE_MOCK: 'false', VITE_NOCODB_PRODUCTION_POOL_TABLE_ID: 'mtestrender',
  }, fetcher)
  const queued = { ...row, render_status: 'queued' }
  function Panel() { return <RenderResults model={useRenderResults(api, queued, true)} /> }
  render(<Panel />)
  const refresh = screen.getByRole<HTMLButtonElement>('button', { name: '刷新渲染状态' })

  fireEvent.click(refresh)
  expect(refresh.disabled).toBe(true)
  await act(async () => vi.advanceTimersByTimeAsync(7_999))
  expect(refresh.disabled).toBe(true)
  expect(screen.queryByRole('alert')).toBeNull()
  await act(async () => vi.advanceTimersByTimeAsync(1))
  expect(refresh.disabled).toBe(false)
  expect(screen.getByRole('alert').textContent).toContain('渲染状态读取超时')
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)

  if (method === '手动') await act(async () => fireEvent.click(refresh))
  else await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(screen.getByRole('link', { name: '下载视频' }).getAttribute('href')).toBe('/current.mp4')
  await act(async () => finishStalledRead(Response.json({ ...row, render_status: 'completed', video_url: '/outdated.mp4' })))
  expect(screen.getByRole('link', { name: '下载视频' }).getAttribute('href')).toBe('/current.mp4')
  expect(fetcher.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
    ['/api/nocodb/tables/mtestrender/records/1', 'GET'],
    ['/api/nocodb/tables/mtestrender/records/1', 'GET'],
  ])
})

it.each(['rendering', 'failed', 'completed'])('已确认成片后，同任务的 %s 快照缺少地址时保留当前成片', async renderStatus => {
  const completed = { ...row, render_job_id: 'job-current', render_status: 'completed', video_url: '/current.mp4' }
  const api = fixture([completed])
  mount(api, '/workbench?id=1')
  const download = await screen.findByRole('link', { name: '下载视频' })
  expect(download.getAttribute('href')).toBe('/current.mp4')
  vi.mocked(api.getProductionItem).mockResolvedValueOnce({ ...completed, render_status: renderStatus, video_url: '' })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '刷新渲染状态' })))
  expect(screen.getByText('渲染状态 · 已完成')).toBeTruthy()
  expect(screen.getByRole('link', { name: '下载视频' }).getAttribute('href')).toBe('/current.mp4')
})

it('同一任务先完成后补齐成片地址时，仍可通过刷新获取下载链接', async () => {
  const completed = { ...row, render_job_id: 'job-current', render_status: 'completed', video_url: '' }
  const api = fixture([completed])
  mount(api, '/workbench?id=1')
  await screen.findByText('渲染已完成，暂未提供可用的视频地址。')
  vi.mocked(api.getProductionItem).mockResolvedValueOnce({ ...completed, video_url: '/current.mp4' })
  fireEvent.click(screen.getByRole('button', { name: '刷新渲染状态' }))
  expect((await screen.findByRole('link', { name: '下载视频' })).getAttribute('href')).toBe('/current.mp4')
})

it('旧站未暴露任务 ID 时，代理 504 后旧终态不会解除只读核对', async () => {
  const initial = { ...row, render_status: 'failed' }
  const api = fixture([initial])
  const trigger = vi.spyOn(api, 'triggerRender').mockRejectedValueOnce(new ApiHttpError('n8n Webhook', 504))
  mount(api, '/workbench?id=1')
  await editor()
  fireEvent.click(screen.getByRole('button', { name: '重试 Remotion 渲染' }))
  const results = within(screen.getByRole('region', { name: '渲染状态与成片' }))
  await results.findByText('渲染状态 · 提交结果未知')
  const refresh = results.getByRole('button', { name: '刷新渲染状态' })
  vi.mocked(api.getProductionItem).mockResolvedValueOnce({ ...initial, render_status: 'completed', video_url: '/old.mp4' })
  await act(async () => fireEvent.click(refresh))
  expect(results.queryByRole('link', { name: '下载视频' })).toBeNull()
  const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Remotion 渲染待核对' })
  expect(submit.disabled).toBe(true)
  fireEvent.click(submit)
  expect(trigger).toHaveBeenCalledTimes(1)
})

it('渲染 POST 明确被拒绝时，保留下一次人工提交入口', async () => {
  const api = fixture([row])
  const trigger = vi.spyOn(api, 'triggerRender')
    .mockRejectedValueOnce(new ApiHttpError('n8n Webhook', 403))
    .mockResolvedValueOnce({ accepted: true, status: 202 })
  mount(api, '/workbench?id=1')
  await editor()
  const submit = screen.getByRole<HTMLButtonElement>('button', { name: '提交 Remotion 渲染' })
  fireEvent.click(submit)
  await screen.findByText(/HTTP 403/)
  expect(submit.disabled).toBe(false)
  fireEvent.click(submit)
  await screen.findByText('Remotion 渲染请求已受理')
  expect(trigger).toHaveBeenCalledTimes(2)
})

it.each([
  ['数据库显式期限', '/file.mp4?synthetic=attachment%2Bvalue', '2026-06-03T12:26:00Z'],
  ['SigV4 请求期限', '/file.mp4?X-Amz-Date=20260603T122500Z&X-Amz-Expires=60&X-Amz-Signature=synthetic', undefined],
  ['两种期限较早者', '/file.mp4?X-Amz-Date=20260603T122500Z&X-Amz-Expires=60&X-Amz-Signature=synthetic', '2026-06-03T12:28:00Z'],
])('独立下载使用%s并在过期后保留播放入口', async (_kind, path, expiry) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-03T12:25:59Z'))
  const attachment = 'https://media.example.invalid' + path
  const playback = 'https://media.example.invalid/preview.mp4?fixture=playback%2Bvalue'
  const record = {
    ...row, render_status: 'completed', video_url: playback, video_download_url: attachment,
    video_download_expires_at: expiry,
  }
  const api = fixture([record])
  function Panel() { return <RenderResults model={useRenderResults(api, record, true)} /> }
  render(<Panel />)

  const save = screen.getByRole('link', { name: '下载视频' })
  expect(save.getAttribute('href')).toBe(attachment)
  expect(save.hasAttribute('download')).toBe(false)
  expect(screen.getByLabelText('成片预览').getAttribute('src')).toBe(playback)
  expect(screen.getByRole('link', { name: '打开视频' }).getAttribute('href')).toBe(playback)
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(screen.queryByRole('link', { name: '下载视频' })).toBeNull()
  expect(screen.getByText(/下载链接已过期/)).toBeTruthy()
  expect(screen.getByRole('link', { name: '打开视频' }).getAttribute('href')).toBe(playback)
  expect(api.getProductionItem).not.toHaveBeenCalled()
})

it.each(['javascript:alert(1)', 'https://example.invalid/play.mp4'])('独立下载地址无效或与播放相同时保留播放链接', videoDownload => {
  const record = { ...row, render_status: 'completed', video_url: 'https://example.invalid/play.mp4', video_download_url: videoDownload }
  const api = fixture([record])
  function Panel() { return <RenderResults model={useRenderResults(api, record, true)} /> }
  render(<Panel />)
  expect(screen.queryByRole('link', { name: '下载视频' })).toBeNull()
  expect(screen.getByRole('link', { name: '打开视频' }).getAttribute('href')).toBe(record.video_url)
})

const signedFixture =
  'https://fixture.00000000000000000000000000000000.r2.cloudflarestorage.com/fixture.mp4' +
  '?response-content-disposition=attachment%3B%20filename%3Dfixture.mp4' +
  '&X-Amz-Algorithm=AWS4-HMAC-SHA256' +
  '&X-Amz-Credential=FIXTURE%2F20260603%2Fauto%2Fs3%2Faws4_request' +
  '&X-Amz-Date=20260603T122500Z&X-Amz-Expires=60' +
  '&X-Amz-Signature=' + 'a'.repeat(64) +
  '&X-Amz-SignedHeaders=host&x-id=GetObject'

function showCompletedVideo(video_url: string, video_download_url?: string, video_download_expires_at?: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-03T12:25:15Z'))
  const record = { ...row, render_status: 'completed', video_url, video_download_url, video_download_expires_at }
  const api = fixture([record])
  function Panel() { return <RenderResults model={useRenderResults(api, record, true)} /> }
  render(<Panel />)
  return api
}

it('在有效期内原样下载 R2 旧字段的附件，保留当前页与过期后的播放入口', async () => {
  const api = showCompletedVideo(signedFixture)
  const save = screen.getByRole('link', { name: '下载视频' })
  expect(save.getAttribute('href')).toBe(signedFixture)
  const target = save.getAttribute('target')
  expect(target).toBeTruthy()
  expect(target).not.toBe('_blank')
  const frame = Array.from(document.querySelectorAll('iframe')).find(item => item.name === target)
  expect(frame?.getAttribute('sandbox')).toBe('allow-downloads')
  expect(save.getAttribute('referrerpolicy')).toBe('no-referrer')
  expect(save.hasAttribute('download')).toBe(false)

  await act(async () => vi.advanceTimersByTimeAsync(45_000))
  expect(screen.queryByRole('link', { name: '下载视频' })).toBeNull()
  expect(screen.getByText(/下载链接已过期/)).toBeTruthy()
  expect(screen.getByRole('link', { name: '打开视频' }).getAttribute('href')).toBe(signedFixture)
  expect(api.getProductionItem).not.toHaveBeenCalled()
})

it('优先独立附件，独立链接过期后仍可下载有效的 R2 旧字段', async () => {
  const explicit = 'https://cdn.example.invalid/attachment.mp4?fixture=keep%2Bexact'
  showCompletedVideo(signedFixture, explicit, '2026-06-03T12:25:16Z')
  expect(screen.getByRole('link', { name: '下载视频' }).getAttribute('href')).toBe(explicit)
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(screen.getByRole('link', { name: '下载视频' }).getAttribute('href')).toBe(signedFixture)
})

it.each([
  ['其他域', signedFixture.replace('r2.cloudflarestorage.com', 'example.invalid')],
  ['仿冒域', signedFixture.replace('r2.cloudflarestorage.com', 'r2.cloudflarestorage.com.example.invalid')],
  ['非标准端口', signedFixture.replace('cloudflarestorage.com/', 'cloudflarestorage.com:8443/')],
  ['明文协议', signedFixture.replace('https:', 'http:')],
  ['普通播放', signedFixture.replace('disposition=attachment', 'disposition=inline')],
  ['没有签名', signedFixture.replace(/&X-Amz-Signature=[a-f]+/, '')],
  ['重复签名', signedFixture + '&X-Amz-Signature=' + 'b'.repeat(64)],
  ['重复附件请求', signedFixture + '&response-content-disposition=inline'],
  ['已过期', signedFixture.replace('X-Amz-Expires=60', 'X-Amz-Expires=10')],
  ['未生效', signedFixture.replace('20260603T122500Z', '20260603T122530Z')],
  ['无效签发日', signedFixture.replace('20260603T122500Z', '20260631T122500Z')],
  ['非读取请求', signedFixture.replace('GetObject', 'PutObject')],
])('旧字段的%s地址不提供下载入口', (_name, url) => {
  showCompletedVideo(url)
  expect(screen.queryByRole('link', { name: '下载视频' })).toBeNull()
  if (url.startsWith('https:')) {
    expect(screen.getByRole('link', { name: '打开视频' }).getAttribute('href')).toBe(url)
  }
})
