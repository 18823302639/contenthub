// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createContentHubApi } from '../src/api'
import { ContentHubApp } from '../src/app/ContentHubApp'
import type { ProductionItem } from '../src/types/schema'

const main: ProductionItem = {
  id: 1, source_name: '样本表', raw_title: 'Original dataset', zh_title: '主赛道数据', track_tag: 'main_overseas',
  url: 'https://source.example.invalid/data', key_data_points: '100 条记录', suggested_titles: ['一个更好的标题'],
  score: 4, compliance_risk: '高风险', workflow_status: '待人工审核', ai_outline: '## 分析步骤',
  is_benchmark: false, created_at: '', published_at: '', raw_content: '原始明细', draft_md: '# 原稿',
  video_script: '这里是口播', remotion_data: { scenes: [{ source: '样本来源' }] },
  compliance_report: { status: 'fail', banned_word_hits: ['包赚'], prediction_phrase_hits: ['必涨'],
    missing_sources: [], suggestion: '删去结论并核对样本' },
}
const sub: ProductionItem = {
  ...main, id: 2, zh_title: '副赛道稿件', track_tag: 'sub_toutiao', compliance_risk: '低风险',
  workflow_status: '待筛选', draft_md: '', compliance_report: null, fact_check_notes: '等待核对',
}

const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false } })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const [key, desc] of [['showModal', showModal], ['close', close]] as const) {
    if (desc) Object.defineProperty(HTMLDialogElement.prototype, key, desc)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key)
  }
})

function mount(api = createContentHubApi({}), rows = [main, sub]) {
  vi.spyOn(api, 'listProductionItems').mockResolvedValue(rows)
  window.history.replaceState(null, '', '#/topics')
  render(<HashRouter><ContentHubApp api={api} /></HashRouter>)
  return api
}

function card(name: string) {
  return within(screen.getByRole('article', { name }))
}

function button(name: string) {
  return screen.getByRole<HTMLButtonElement>('button', { name })
}

it('赛道、工作流和风险可组合，保留采集按钮', async () => {
  mount()
  await screen.findByRole('article', { name: main.zh_title })
  expect(button('立即采集')).toBeTruthy()
  expect(card(main.zh_title).getByText('高风险').classList.contains('pill--red')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: /副赛道/ }))
  expect(screen.queryByRole('article', { name: main.zh_title })).toBeNull()
  expect(card(sub.zh_title).getByText('低风险').classList.contains('pill--green')).toBe(true)
  fireEvent.change(screen.getByRole('combobox', { name: '合规风险' }), { target: { value: '高风险' } })
  expect(screen.queryByRole('article', { name: sub.zh_title })).toBeNull()
})

it('WF2 按 5 秒读回，重新生成时不会把旧审核记录认作完成', async () => {
  const api = createContentHubApi({})
  const trigger = vi.spyOn(api, 'triggerGenerateDraft').mockResolvedValue({ accepted: true, status: 200 })
  const read = vi.spyOn(api, 'getProductionItem').mockResolvedValueOnce(main)
    .mockResolvedValueOnce({ ...main, workflow_status: '生成中' })
    .mockResolvedValue({ ...main, draft_md: '# 新稿' })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  vi.useFakeTimers()
  mount(api)
  await act(async () => {})
  await act(async () => fireEvent.click(card(main.zh_title).getByRole('button', { name: '重新生成' })))
  expect(trigger).not.toHaveBeenCalled()
  await act(async () => fireEvent.click(card(main.zh_title).getByRole('button', { name: '重新生成' })))
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(trigger).toHaveBeenCalledExactlyOnceWith(1)
  expect(card(main.zh_title).getByRole<HTMLButtonElement>('button', { name: '生成中…' }).disabled).toBe(true)
  await act(async () => vi.advanceTimersByTimeAsync(4_999))
  expect(read).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(1))
  expect(read).toHaveBeenCalledExactlyOnceWith(1)
  expect(screen.queryByText('初稿已生成，可进入工作台审核')).toBeNull()
  await act(async () => vi.advanceTimersByTimeAsync(10_000))
  expect(screen.getByText('初稿已生成，可进入工作台审核')).toBeTruthy()
  await act(async () => vi.advanceTimersByTimeAsync(180_000))
  expect(read).toHaveBeenCalledTimes(3)
})

it('工作台读取详情，校验 JSON 和来源，再把草稿写入两个定稿字段', async () => {
  const api = mount()
  const read = vi.spyOn(api, 'getProductionItem').mockResolvedValue(main)
  const write = vi.spyOn(api, 'updateProductionItem').mockImplementation(async (_id, patch) => ({ ...main, ...patch }))
  await screen.findByRole('article', { name: main.zh_title })
  fireEvent.click(card(main.zh_title).getByRole('button', { name: '打开工作台' }))
  const modal = within(await screen.findByRole('dialog', { name: '内容精修工作台' }))
  await modal.findByText('包赚')
  expect(read).toHaveBeenCalledExactlyOnceWith(1)
  expect(modal.getByText('必涨')).toBeTruthy()
  fireEvent.click(modal.getByRole('button', { name: '一个更好的标题' }))
  expect(modal.getByRole<HTMLInputElement>('textbox', { name: '中文标题' }).value).toBe('一个更好的标题')
  fireEvent.change(modal.getByRole('textbox', { name: '图文正文' }), { target: { value: '# 已核查的正文' } })
  fireEvent.click(modal.getByRole('tab', { name: 'Remotion 渲染数据' }))
  const json = modal.getByRole('textbox', { name: 'Remotion JSON' })
  fireEvent.change(json, { target: { value: '{' } })
  expect(modal.getByText(/JSON 语法错误/)).toBeTruthy()
  expect(modal.getByRole<HTMLButtonElement>('button', { name: '保存草稿' }).disabled).toBe(true)
  fireEvent.change(json, { target: { value: '{"cards":[{}]}' } })
  expect(modal.getByText(/cards\[0\]\.source/)).toBeTruthy()
  expect(modal.getByRole<HTMLButtonElement>('button', { name: '提交 Remotion 渲染' }).disabled).toBe(true)
  fireEvent.change(json, { target: { value: '{"scenes":[{"source":"样本来源"}]}' } })
  fireEvent.click(modal.getByRole('checkbox', { name: '人工复核后将风险改为低风险' }))
  fireEvent.click(modal.getByRole('button', { name: '人工复核通过并定稿' }))
  await modal.findByText('已保存并定稿')
  expect(write).toHaveBeenCalledExactlyOnceWith(1, {
    zh_title: '一个更好的标题', draft_md: '# 已核查的正文',
    video_script: '这里是口播', remotion_data: { scenes: [{ source: '样本来源' }] },
    final_md: '# 已核查的正文', final_content: '# 已核查的正文', workflow_status: '已定稿', compliance_risk: '低风险',
  })
})

it('WF2 无回写时最多等 180 秒，停止继续读单条', async () => {
  const api = createContentHubApi({})
  vi.spyOn(api, 'triggerGenerateDraft').mockResolvedValue({ accepted: true, status: 200 })
  const get = vi.spyOn(api, 'getProductionItem').mockResolvedValue({ ...sub, workflow_status: '生成中' })
  vi.useFakeTimers()
  mount(api)
  await act(async () => {})
  fireEvent.click(card(sub.zh_title).getByRole('button', { name: '生成初稿' }))
  await act(async () => vi.advanceTimersByTimeAsync(179_999))
  expect(get).toHaveBeenCalledTimes(35)
  expect(screen.queryByText(/等待初稿超过/)).toBeNull()
  await act(async () => vi.advanceTimersByTimeAsync(1))
  expect(screen.getByText(/等待初稿超过 3 分钟/)).toBeTruthy()
  await act(async () => vi.advanceTimersByTimeAsync(30_000))
  expect(get).toHaveBeenCalledTimes(35)
})

it('只有主赛道显示 WF3，未配置且满足数据要求时给出明确提示', async () => {
  const api = mount()
  vi.spyOn(api, 'getProductionItem').mockImplementation(async id => id === 1 ? { ...main, compliance_risk: '低风险' } : sub)
  const trigger = vi.spyOn(api, 'triggerRender')
  await screen.findByRole('article', { name: main.zh_title })
  fireEvent.click(card(main.zh_title).getByRole('button', { name: '打开工作台' }))
  let modal = within(await screen.findByRole('dialog'))
  const renderButton = await modal.findByRole<HTMLButtonElement>('button', { name: '提交 Remotion 渲染' })
  expect(renderButton.disabled).toBe(false)
  fireEvent.click(renderButton)
  await modal.findByText('WF3 渲染服务尚未配置，请先完成 Day 3 广州渲染节点接入')
  expect(trigger).not.toHaveBeenCalled()
  fireEvent.click(modal.getByRole('button', { name: '关闭工作台' }))

  fireEvent.click(card(sub.zh_title).getByRole('button', { name: '打开工作台' }))
  modal = within(await screen.findByRole('dialog'))
  await modal.findByText('等待核对')
  expect(modal.getByRole<HTMLButtonElement>('tab', { name: '视频口播稿' }).disabled).toBe(true)
  expect(modal.queryByRole('button', { name: '提交 Remotion 渲染' })).toBeNull()
})

it('配置 WF3 时重新核对持久化内容，阻止高风险回写和未保存数据', async () => {
  const ready = { ...main, compliance_risk: '中风险' }
  const api = mount(createContentHubApi({ VITE_WF3_RENDER_WEBHOOK_URL: '/render' }), [ready, sub])
  const read = vi.spyOn(api, 'getProductionItem').mockResolvedValue(ready)
  const trigger = vi.spyOn(api, 'triggerRender').mockResolvedValue({ accepted: true, status: 202 })
  await screen.findByRole('article', { name: ready.zh_title })
  fireEvent.click(card(ready.zh_title).getByRole('button', { name: '打开工作台' }))
  const modal = within(await screen.findByRole('dialog'))
  const renderButton = await modal.findByRole<HTMLButtonElement>('button', { name: '提交 Remotion 渲染' })
  fireEvent.click(modal.getByRole('tab', { name: 'Remotion 渲染数据' }))
  const editor = modal.getByRole('textbox', { name: 'Remotion JSON' })
  fireEvent.change(editor, { target: { value: '{"scenes":[{"source":"另一份样稿"}]}' } })
  expect(renderButton.disabled).toBe(true)
  fireEvent.change(editor, { target: { value: '{"scenes":[{"source":"样本来源"}]}' } })
  fireEvent.click(renderButton)
  await modal.findByText('Remotion 渲染请求已受理')
  expect(read).toHaveBeenCalledTimes(2)
  expect(trigger).toHaveBeenCalledExactlyOnceWith(1)
  read.mockResolvedValueOnce(main)
  fireEvent.click(modal.getByRole('button', { name: '提交 Remotion 渲染' }))
  await modal.findByText(/不满足渲染条件/)
  expect(trigger).toHaveBeenCalledTimes(1)
})

it('复制当前标题、Markdown、纯文本和口播稿，并可对照原始资料', async () => {
  const api = mount()
  vi.spyOn(api, 'getProductionItem').mockResolvedValue(main)
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const copy = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
  try {
    await screen.findByRole('article', { name: main.zh_title })
    fireEvent.click(card(main.zh_title).getByRole('button', { name: '打开工作台' }))
    const modal = within(await screen.findByRole('dialog'))
    fireEvent.click(await modal.findByRole('button', { name: '一键复制标题' }))
    expect(copy).toHaveBeenLastCalledWith('主赛道数据')
    const article = '# 样本报告\n\n**重要信息**\n\n|甲|乙|\n|-|-|\n|1|2|'
    fireEvent.change(modal.getByRole('textbox', { name: '图文正文' }), { target: { value: article } })
    fireEvent.click(modal.getByRole('button', { name: '一键复制 Markdown' }))
    expect(copy).toHaveBeenLastCalledWith(article)
    fireEvent.click(modal.getByRole('button', { name: '复制纯文本' }))
    await modal.findByText('已复制纯文本')
    expect(copy).toHaveBeenLastCalledWith(expect.stringContaining('甲\t乙'))
    expect(copy.mock.lastCall?.[0]).not.toMatch(/# 样本报告|\*\*重要信息\*\*/)
    fireEvent.click(modal.getByRole('tab', { name: '视频口播稿' }))
    fireEvent.click(modal.getByRole('button', { name: '一键复制脚本' }))
    expect(copy).toHaveBeenLastCalledWith('这里是口播')
    fireEvent.click(modal.getByRole('tab', { name: '原始信源与大纲' }))
    expect(modal.getByText('原始明细')).toBeTruthy()
    const source = modal.getByRole('link', { name: '打开原文' })
    expect(source.getAttribute('href')).toBe(main.url)
    expect(source.getAttribute('target')).toBe('_blank')
  } finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original)
    else Reflect.deleteProperty(navigator, 'clipboard')
  }
})
