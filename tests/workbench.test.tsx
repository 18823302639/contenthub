// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContentHubApp } from '../src/app/ContentHubApp'
import { createContentHubApi, WriteReadbackError } from '../src/api'

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

function mount(id: number | string, api = createContentHubApi({})) {
  window.history.replaceState(null, '', '#/workbench/' + id)
  render(<HashRouter><ContentHubApp api={api} /></HashRouter>)
  return api
}

function editor() {
  return screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Markdown 编辑器' })
}

function enterNote(value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: '修改意见' }), { target: { value } })
}

function press(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  else Reflect.deleteProperty(navigator, 'clipboard')
})

describe('改稿台', () => {
  it('AI 大纲 Tab 用 Markdown 渲染示例', async () => {
    mount(3)
    await editor()
    fireEvent.click(screen.getByRole('tab', { name: 'AI 大纲' }))
    const panel = within(screen.getByRole('tabpanel', { name: 'AI 大纲' }))
    expect(panel.getByRole('heading', { name: '留存率分析提纲' })).toBeTruthy()
    expect(panel.getByRole('list')).toBeTruthy()
  })

  it('没有大纲时显示空态，标杆开关回读后同步看板且保留未保存编辑', async () => {
    const api = mount(4)
    const write = vi.spyOn(api, 'updateProductionItem')
    const draft = await editor()
    fireEvent.click(screen.getByRole('tab', { name: 'AI 大纲' }))
    expect(screen.getByRole('tabpanel', { name: 'AI 大纲' }).textContent).toContain('暂无大纲')
    fireEvent.change(draft, { target: { value: '# 未保存编辑' } })
    const control = screen.getByRole('switch', { name: '标杆样本' })
    expect(control.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(control)
    expect(control.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(control)
    await screen.findByText('已标记为标杆样本。')
    expect(control.getAttribute('aria-checked')).toBe('true')
    expect((await editor()).value).toBe('# 未保存编辑')
    expect(write).toHaveBeenCalledExactlyOnceWith(4, { is_benchmark: true })
    fireEvent.click(screen.getByRole('link', { name: '返回选题看板' }))
    const card = await screen.findByRole('article', { name: '【模拟】用充电曲线估算服务区停留时间' })
    expect(within(card).getByText('标杆样本')).toBeTruthy()
  })

  it('标杆回读失败时保留旧开关状态，刷新后恢复操作', async () => {
    const api = mount(4)
    const actual = api.updateProductionItem
    const write = vi.spyOn(api, 'updateProductionItem').mockImplementationOnce(async (id, changes) => {
      await actual(id, changes)
      throw new WriteReadbackError('production_pool', id, new Error('模拟回读中断'))
    })
    await editor()
    const control = screen.getByRole('switch', { name: '标杆样本' })
    fireEvent.click(control)
    await screen.findByText(/写入已返回成功，但回读失败/)
    expect(control.getAttribute('aria-checked')).toBe('false')
    expect(control.getAttribute('aria-disabled')).toBe('true')
    press('刷新记录')
    await screen.findByText('已读取最新记录。')
    expect(control.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(control)
    await screen.findByText('已取消标杆样本。')
    expect(control.getAttribute('aria-checked')).toBe('false')
    expect(write).toHaveBeenNthCalledWith(2, 4, { is_benchmark: false })
  })

  it('未知流程状态仍可保存人工稿，暂不开放 AI 改稿与发布流转', async () => {
    const api = createContentHubApi({})
    const record = await api.getProductionItem(4)
    vi.spyOn(api, 'getProductionItem').mockResolvedValueOnce({ ...record, workflow_status: '另行复核' })
    mount(4, api)
    const draft = await editor()
    expect(screen.getByText('另行复核').classList.contains('pill--neutral')).toBe(true)
    enterNote('修改开头')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'AI 去味改稿' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '标记为已发布' }).disabled).toBe(true)
    fireEvent.change(draft, { target: { value: '# 人工补充' } })
    press('保存定稿')
    await screen.findByText('定稿已保存。')
  })


  it('加载原文与核查 Tab，空定稿使用初稿', async () => {
    mount(3)
    expect(screen.getByText('正在加载选题…')).toBeTruthy()
    expect((await editor()).value).toContain('先把两组观察窗口对齐')
    expect(screen.getByRole('link', { name: '打开原文' }).getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByRole('tabpanel', { name: '原文素材' }).textContent).toContain('模拟原文')
    fireEvent.keyDown(screen.getByRole('tab', { name: '原文素材' }), { key: 'ArrowRight' })
    const checks = within(screen.getByRole('tabpanel', { name: 'AI 事实核查清单' }))
    expect(checks.getByText('确认分母定义')).toBeTruthy()
    expect(checks.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('优先展示定稿、提供 GFM 预览并忽略 HTML 及不安全链接', async () => {
    mount(4)
    const draft = await editor()
    expect(draft.value).toContain('先核对起始荷电状态和温度')
    expect(draft.value).not.toContain('分段记录')
    fireEvent.change(draft, { target: { value: [
      '## 验收稿', '', '| 指标 | 数值 |', '| --- | --- |', '| 留存 | 20% |', '',
      '- [x] 已核对', '', '<div id="untrusted">原始 HTML</div>', '',
      '[危险链接](javascript:alert%281%29)', '', '![远程图片](https://sample.example.invalid/photo.png)',
    ].join('\n') } })
    fireEvent.click(screen.getByRole('tab', { name: '预览' }))
    const preview = within(screen.getByRole('tabpanel', { name: '预览' }))
    expect(preview.getByRole('heading', { name: '验收稿' })).toBeTruthy()
    expect(preview.getByRole('table')).toBeTruthy()
    expect((preview.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    expect(document.querySelector('#untrusted')).toBeNull()
    expect(preview.queryByRole('link', { name: '危险链接' })).toBeNull()
    expect(preview.queryByRole('img')).toBeNull()
  })

  it('可从工具栏定位到稿件并保持当前预览和未保存编辑', async () => {
    mount(3)
    const draft = await editor()
    const unsaved = '# 未保存的合成稿件'
    fireEvent.change(draft, { target: { value: unsaved } })
    fireEvent.click(screen.getByRole('tab', { name: '预览' }))
    fireEvent.click(screen.getByRole('button', { name: '跳到稿件' }))

    const panel = screen.getByRole('region', { name: '稿件' })
    expect(document.activeElement).toBe(panel)
    expect(within(panel).getByRole('tabpanel', { name: '预览' }).textContent).toContain('未保存的合成稿件')
    fireEvent.click(within(panel).getByRole('tab', { name: '编辑' }))
    expect((await editor()).value).toBe(unsaved)
  })

  it('复制当前全文、保存定稿，并仅登记发布状态和时间', async () => {
    const api = mount(3)
    const write = vi.spyOn(api, 'updateProductionItem')
    const copy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
    const markdown = '# 人工定稿\n\n可复制的完整内容'
    fireEvent.change(await editor(), { target: { value: markdown } })
    expect((screen.getByRole('button', { name: '标记为已发布' }) as HTMLButtonElement).disabled).toBe(true)
    press('复制全文')
    await screen.findByText('已复制全文。')
    expect(copy).toHaveBeenCalledWith(markdown)
    press('保存定稿')
    await screen.findByText('定稿已保存。')
    expect(write.mock.calls[0]).toEqual([3, { final_md: markdown }])
    press('标记为已发布')
    await screen.findByText('已记录发布状态和时间。')
    expect(write.mock.calls[1]).toEqual([3, { workflow_status: '已发布', published_at: expect.any(String) }])
    const row = await api.getProductionItem(3)
    expect(row.final_md).toBe(markdown)
    expect(Date.parse(row.published_at)).toBeGreaterThan(0)
  })

  it('先保存意见再触发改稿，回写保留编辑，允许对照后手动采用', async () => {
    const api = mount(3)
    const patch = vi.spyOn(api, 'updateProductionItem')
    const webhook = vi.spyOn(api, 'triggerWebhook')
    const draft = await editor()
    enterNote('补充对照组并减少套话')
    press('AI 去味改稿')
    expect(webhook).not.toHaveBeenCalled()
    await screen.findByText('修改意见已保存，正在请求 Webhook…')
    expect(patch).toHaveBeenCalledWith(3, { revision_note: '补充对照组并减少套话', workflow_status: '需AI润色' })
    await screen.findByText('Webhook 已受理，等待改稿回写。')
    expect(webhook).toHaveBeenCalledExactlyOnceWith('rewrite-draft', { production_id: 3, revision_note: '补充对照组并减少套话' })
    fireEvent.change(draft, { target: { value: '# 等待时补写的人工段落' } })
    await screen.findByText('改稿结果已回写，当前编辑已保留。', {}, { timeout: 4500 })
    expect((await editor()).value).toBe('# 等待时补写的人工段落')
    fireEvent.click(screen.getByRole('tab', { name: '回写稿' }))
    expect(screen.getByRole('tabpanel', { name: '回写稿' }).textContent).toContain('补充对照组并减少套话')
    press('用回写稿替换当前编辑')
    expect((await editor()).value).toContain('补充对照组并减少套话')
  })

  it('保存回读保留请求途中追加的文本', async () => {
    const api = mount(3)
    const draft = await editor()
    fireEvent.change(draft, { target: { value: '# 保存的版本' } })
    press('保存定稿')
    fireEvent.change(draft, { target: { value: '# 保存途中补充的版本' } })
    await screen.findByText('定稿已保存。')
    expect((await editor()).value).toBe('# 保存途中补充的版本')
    expect((await api.getProductionItem(3)).final_md).toBe('# 保存的版本')
    press('保存定稿')
    await waitFor(async () => expect((await api.getProductionItem(3)).final_md).toBe('# 保存途中补充的版本'))
  })

  it('Webhook 失败保留已写状态，刷新不重发', async () => {
    const api = mount(3)
    const trigger = vi.spyOn(api, 'triggerWebhook').mockRejectedValue(new Error('连接中断'))
    await editor()
    enterNote('缩短开头')
    press('AI 去味改稿')
    await screen.findByText(/修改意见已保存，但 Webhook 受理未确认/)
    expect((await api.getProductionItem(3)).workflow_status).toBe('需AI润色')
    press('刷新记录')
    await waitFor(() => expect((screen.getByRole('button', { name: '刷新记录' }) as HTMLButtonElement).disabled).toBe(false))
    expect(trigger).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'AI 去味改稿' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('保存回读失败不请求 Webhook，刷新时保留未保存编辑', async () => {
    const api = mount(3)
    const update = api.updateProductionItem
    vi.spyOn(api, 'updateProductionItem').mockImplementation(async (id, patch) => {
      await update(id, patch)
      throw new WriteReadbackError('production_pool', id, new Error('回读中断'))
    })
    const trigger = vi.spyOn(api, 'triggerWebhook')
    const draft = await editor()
    enterNote('减少套话')
    press('AI 去味改稿')
    fireEvent.change(draft, { target: { value: '本地补充' } })
    await screen.findByText(/写入已返回成功，但回读失败/)
    press('刷新记录')
    await waitFor(() => expect((screen.getByRole('button', { name: '刷新记录' }) as HTMLButtonElement).disabled).toBe(false))
    expect(trigger).not.toHaveBeenCalled()
    expect((await editor()).value).toBe('本地补充')
    expect(screen.getByText(/本次未发送 Webhook/)).toBeTruthy()
  })

  it('发布途中回到看板，放弃操作会等待同一条写入完成', async () => {
    const api = createContentHubApi({})
    window.history.replaceState(null, '', '#/topics')
    render(<HashRouter><ContentHubApp api={api} /></HashRouter>)
    const title = '【模拟】用充电曲线估算服务区停留时间'
    const card = within(await screen.findByRole('article', { name: title }))
    fireEvent.click(card.getByRole('link', { name: '进入改稿台' }))
    await editor()
    press('标记为已发布')
    fireEvent.click(screen.getByRole('link', { name: '返回选题看板' }))
    const refreshed = within(screen.getByRole('article', { name: title }))
    expect((refreshed.getByRole('button', { name: '放弃' }) as HTMLButtonElement).disabled).toBe(true)
    await refreshed.findByText('已发布')
    expect(refreshed.queryByRole('button', { name: '放弃' })).toBeNull()
    expect((await api.getProductionItem(4)).workflow_status).toBe('已发布')
  })

  it('已受理的任务离开改稿台仍能同步看板', async () => {
    const api = createContentHubApi({})
    const title = '【模拟】首购用户留存率容易被什么拉高'
    window.history.replaceState(null, '', '#/topics')
    render(<HashRouter><ContentHubApp api={api} /></HashRouter>)
    const card = within(await screen.findByRole('article', { name: title }))
    fireEvent.click(card.getByRole('link', { name: '进入改稿台' }))
    await editor()
    enterNote('补充分母')
    press('AI 去味改稿')
    await screen.findByText('Webhook 已受理，等待改稿回写。')
    fireEvent.click(screen.getByRole('link', { name: '返回选题看板' }))
    const refreshed = within(await screen.findByRole('article', { name: title }))
    await refreshed.findByText('待人工终审', {}, { timeout: 3500 })
  })

  it('直接进入待核对改稿台时会只读跟进初稿，无需手动刷新', async () => {
    const api = createContentHubApi({})
    await api.updateProductionItem(1, { workflow_status: '已确认-待核对' })
    await api.triggerWebhook('fetch-and-draft', { production_id: 1 })
    const trigger = vi.spyOn(api, 'triggerWebhook')
    mount(1, api)
    expect((await editor()).value).toBe('')
    await screen.findByText('初稿已回写。', {}, { timeout: 3500 })
    expect((await editor()).value).toContain('合成样本含 120 笔订单')
    expect(trigger).not.toHaveBeenCalled()
  })

  it('无稿时可开始编辑，无效 ID 不读取', async () => {
    const api = createContentHubApi({})
    const read = vi.spyOn(api, 'getProductionItem')
    mount('0', api)
    expect(screen.getByText('选题 ID 无效。')).toBeTruthy()
    expect(read).not.toHaveBeenCalled()
    cleanup()
    mount(1, api)
    expect((await editor()).value).toBe('')
    expect(screen.getByText('暂无原文素材。')).toBeTruthy()
    expect(screen.getByText('暂无稿件，可直接编辑。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '保存定稿' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('读取失败可刷新重试，剪贴板拒绝时显示实际反馈', async () => {
    const api = createContentHubApi({})
    vi.spyOn(api, 'getProductionItem').mockRejectedValueOnce(new Error('读取测试错误'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('权限拒绝')) } })
    mount(3, api)
    await screen.findByText('读取测试错误')
    press('刷新记录')
    await editor()
    press('复制全文')
    await screen.findByText('无法访问剪贴板，请在编辑区手动复制。')
    expect(screen.queryByText('已复制全文。')).toBeNull()
  })
})
