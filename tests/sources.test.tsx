// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HashRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentHubApp } from '../src/app/ContentHubApp'
import { ApiHttpError, createContentHubApi, WriteReadbackError } from '../src/api'
import type { RssSource } from '../src/types/schema'

const retail = '模拟·零售数据观察'
const radar = '模拟·消费者问答库'
const newName = '模拟·新增信源'
const newUrl = 'https://new-feed.example.invalid/feed.xml'
const freshInput = {
  name: newName,
  rss_url: newUrl,
  pool_type: 'radar',
  track_tag: '测试赛道',
  is_active: true,
} as const

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')

beforeEach(() => {
  // jsdom 只模拟 dialog 开关；真实浏览器负责 modal 惯用的焦点约束与 Esc。
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.open = true },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) { this.open = false },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  for (const [key, descriptor] of [['showModal', originalShowModal], ['close', originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key)
  }
})

function mount(api = createContentHubApi({}), hash = '#/sources') {
  window.history.replaceState(null, '', hash)
  render(<HashRouter><ContentHubApp api={api} /></HashRouter>)
  return api
}

function source(name: string) {
  return screen.findByRole('row', { name: new RegExp(name) })
}

function press(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

function fill(dialog: HTMLElement, name = newName, rssUrl = newUrl) {
  const fields = within(dialog)
  fireEvent.change(fields.getByRole('textbox', { name: '信源名称' }), { target: { value: name } })
  fireEvent.change(fields.getByRole('textbox', { name: 'RSS 链接' }), { target: { value: rssUrl } })
  fireEvent.change(fields.getByRole('textbox', { name: '赛道' }), { target: { value: '测试赛道' } })
}

async function open() {
  await source(retail)
  press('新增信源')
  return screen.findByRole('dialog', { name: '新增 RSS 信源' })
}

describe('RSS 信源管理', () => {
  it('在加载后显示真实 Mock 行，可切换全部、生产池和雷达池', async () => {
    const transport = vi.fn<typeof fetch>()
    const api = mount(createContentHubApi({}, transport))
    expect(screen.getByText('正在加载信源…')).toBeTruthy()
    const row = within(await source(retail))
    expect(row.getByText('商业数据')).toBeTruthy()
    expect(row.getByRole('link').getAttribute('href')).toBe('https://retail.example.invalid/feed.xml')
    expect(row.getByRole('link').getAttribute('rel')).toBe('noopener noreferrer')
    expect(row.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    const list = vi.spyOn(api, 'listRssSources')
    press('生产池')
    expect(screen.queryByRole('row', { name: new RegExp(radar) })).toBeNull()
    press('雷达池')
    expect(screen.queryByRole('row', { name: new RegExp(retail) })).toBeNull()
    expect(within(await source(radar)).getByRole('switch').getAttribute('aria-checked')).toBe('false')
    press('全部')
    expect(screen.getAllByRole('row')).toHaveLength(4)
    expect(list).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it('Switch 支持空格启停，提交期间保持回读旧状态并拦截重复操作', async () => {
    const api = mount()
    const update = vi.spyOn(api, 'setRssSourceActive')
    const control = within(await source(retail)).getByRole('switch', { name: '启用 ' + retail })
    const user = userEvent.setup()
    control.focus()
    await user.keyboard(' ')
    expect(update).toHaveBeenCalledExactlyOnceWith(1, false)
    expect(control.getAttribute('aria-disabled')).toBe('true')
    expect(control.getAttribute('aria-checked')).toBe('true')
    await user.keyboard('{Enter}')
    expect(update).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(control.getAttribute('aria-checked')).toBe('false'))
    expect((await api.listRssSources()).find(row => row.id === 1)?.is_active).toBe(false)
    expect(control.getAttribute('aria-label')).toBe('启用 ' + retail)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(control.getAttribute('aria-checked')).toBe('true'))
  })

  it('拦截空项和非 HTTP(S) URL，并可关闭弹窗后恢复新增按钮焦点', async () => {
    const api = mount()
    const create = vi.spyOn(api, 'createRssSource')
    const dialog = await open()
    const fields = within(dialog)
    expect(document.activeElement).toBe(fields.getByRole('textbox', { name: '信源名称' }))
    fireEvent.click(fields.getByRole('button', { name: '保存信源' }))
    expect(fields.getByText('请输入信源名称。')).toBeTruthy()
    expect(fields.getByText('请输入赛道。')).toBeTruthy()
    fill(dialog, '有效名称', 'javascript:alert(1)')
    fireEvent.click(fields.getByRole('button', { name: '保存信源' }))
    expect(fields.getByText('请输入有效的 HTTP(S) RSS 链接。')).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '新增信源' }))
  })

  it('新增默认沿用当前分组，只提交一次并显示后端回读的新行', async () => {
    const api = mount()
    const create = vi.spyOn(api, 'createRssSource')
    await source(retail)
    press('雷达池')
    press('新增信源')
    const dialog = await screen.findByRole('dialog', { name: '新增 RSS 信源' })
    const fields = within(dialog)
    expect((fields.getByRole('combobox', { name: '分组' }) as HTMLSelectElement).value).toBe('radar')
    fill(dialog, '  ' + newName + '  ', ' ' + newUrl + ' ')
    const save = fields.getByRole('button', { name: '保存信源' })
    fireEvent.click(save)
    fireEvent.submit(save.closest('form')!)
    expect(create).toHaveBeenCalledExactlyOnceWith(freshInput)
    expect(fields.getByText('正在保存信源…')).toBeTruthy()
    const row = within(await source(newName))
    expect(row.getByText('雷达池')).toBeTruthy()
    expect(row.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('信源已新增。')).toBeTruthy()
    expect((await api.listRssSources('radar')).filter(row => row.name === newName)).toHaveLength(1)
  })

  it('读取失败可重试，空分组可返回全部', async () => {
    const api = createContentHubApi({})
    const read = api.listRssSources
    vi.spyOn(api, 'listRssSources').mockRejectedValueOnce(new Error('读取测试失败')).mockImplementation(async () =>
      (await read()).filter(row => row.pool_type === 'production'))
    mount(api)
    await screen.findByText('读取测试失败')
    press('刷新信源')
    await source(retail)
    press('雷达池')
    expect(screen.getByText('当前分组暂无信源。')).toBeTruthy()
    press('查看全部信源')
    expect(await source(retail)).toBeTruthy()
  })

  it('启停回读异常保留旧值，刷新核对后才恢复开关', async () => {
    const api = mount()
    const update = api.setRssSourceActive
    const call = vi.spyOn(api, 'setRssSourceActive').mockImplementationOnce(async (id, enabled) => {
      await update(id, enabled)
      throw new WriteReadbackError('rss_sources', id, new Error('回读中断'))
    })
    const control = within(await source(retail)).getByRole('switch')
    fireEvent.click(control)
    await screen.findByText(/启停结果未确认/)
    expect(control.getAttribute('aria-checked')).toBe('true')
    expect(control.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(control)
    expect(call).toHaveBeenCalledTimes(1)
    press('刷新信源')
    await waitFor(() => expect(control.getAttribute('aria-checked')).toBe('false'))
    expect(control.getAttribute('aria-disabled')).toBe('false')
  })

  it('新增写入已提交但回读失败时，核对既有记录而不重复 POST', async () => {
    const api = mount()
    const original = api.createRssSource
    const create = vi.spyOn(api, 'createRssSource').mockImplementationOnce(async input => {
      const row = await original(input)
      throw new WriteReadbackError('rss_sources', row.id, new Error('回读中断'))
    })
    const dialog = await open()
    fireEvent.change(within(dialog).getByRole('combobox', { name: '分组' }), { target: { value: 'radar' } })
    fill(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: '保存信源' }))
    await within(dialog).findByText(/需核对新增结果/)
    expect(screen.queryByText('信源已新增。')).toBeNull()
    fireEvent.submit(dialog.querySelector('form')!)
    expect(create).toHaveBeenCalledTimes(1)
    fireEvent.click(within(dialog).getByRole('button', { name: '核对列表' }))
    await source(newName)
    expect(screen.getByText('已从列表核对到新增信源。')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((await api.listRssSources()).filter(row => row.name === newName)).toHaveLength(1)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('一次查询未找到记录时不会解锁仍可能迟到的 POST', async () => {
    const api = mount()
    const original = api.createRssSource
    const create = vi.spyOn(api, 'createRssSource').mockRejectedValueOnce(new Error('连接中断'))
    const dialog = await open()
    fill(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: '保存信源' }))
    await within(dialog).findByText(/需核对新增结果/)
    fireEvent.click(within(dialog).getByRole('button', { name: '核对列表' }))
    await within(dialog).findByText(/本次读取未找到匹配的新增记录/)
    expect((within(dialog).getByRole('textbox', { name: '信源名称' }) as HTMLInputElement).value).toBe(newName)
    expect(within(dialog).queryByRole('button', { name: '保存信源' })).toBeNull()
    fireEvent.submit(dialog.querySelector('form')!)
    expect(create).toHaveBeenCalledTimes(1)
    await original({ ...freshInput, pool_type: 'production' })
    fireEvent.click(within(dialog).getByRole('button', { name: '核对列表' }))
    await source(newName)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('明确的输入拒绝可以修正后主动重试，表单保留输入', async () => {
    const api = mount()
    const create = vi.spyOn(api, 'createRssSource').mockRejectedValueOnce(new ApiHttpError('NocoDB', 422))
    const dialog = await open()
    fill(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: '保存信源' }))
    await within(dialog).findByText(/保存信源失败/)
    expect((within(dialog).getByRole('textbox', { name: '信源名称' }) as HTMLInputElement).value).toBe(newName)
    fireEvent.click(within(dialog).getByRole('button', { name: '保存信源' }))
    await source(newName)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('回执 ID 可定位字段被后端调整的新增行', async () => {
    const api = mount()
    const original = api.createRssSource
    const create = vi.spyOn(api, 'createRssSource').mockImplementationOnce(async input => {
      const saved = await original({ ...input, name: input.name + '（实际记录）' })
      throw new WriteReadbackError('rss_sources', saved.id, new Error('回读中断'))
    })
    const dialog = await open()
    fill(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: '保存信源' }))
    await within(dialog).findByText(/需核对新增结果/)
    fireEvent.click(within(dialog).getByRole('button', { name: '核对列表' }))
    await source(newName + '（实际记录）')
    expect(screen.getByText(/找到写入回执对应的信源/)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('暂存无法核对的新增，可录入别的信源，但拦截同一分组与链接的重复提交', async () => {
    const api = mount()
    const create = vi.spyOn(api, 'createRssSource')
      .mockRejectedValueOnce(new WriteReadbackError('rss_sources', 999, new Error('回读中断')))
    let dialog = await open()
    fill(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: '保存信源' }))
    await within(dialog).findByText(/需核对新增结果/)
    fireEvent.click(within(dialog).getByRole('button', { name: '核对列表' }))
    await within(dialog).findByText(/写入曾返回成功/)
    fireEvent.click(within(dialog).getByRole('button', { name: '新增其他信源' }))

    dialog = await screen.findByRole('dialog', { name: '新增 RSS 信源' })
    expect((within(dialog).getByRole('textbox', { name: 'RSS 链接' }) as HTMLInputElement).value).toBe('')
    fill(dialog, '模拟·备用信源', 'https://alternate.example.invalid/rss')
    fireEvent.click(within(dialog).getByRole('button', { name: '保存信源' }))
    await source('模拟·备用信源')
    expect(create).toHaveBeenCalledTimes(2)

    dialog = await open()
    fill(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: '保存信源' }))
    await within(dialog).findByText(/上次新增尚待核对/)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('核对过程中离开再返回，旧申请完成前不会打开新的新增表单', async () => {
    const api = mount()
    const original = api.createRssSource
    vi.spyOn(api, 'createRssSource').mockImplementationOnce(async input => {
      const saved = await original(input)
      throw new WriteReadbackError('rss_sources', saved.id, new Error('回读中断'))
    })
    const dialog = await open()
    fill(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: '保存信源' }))
    await within(dialog).findByText(/需核对新增结果/)
    const verifiedRows = await api.listRssSources()
    let finish!: (rows: RssSource[]) => void
    const response = new Promise<RssSource[]>(resolve => { finish = resolve })
    vi.spyOn(api, 'listRssSources').mockReturnValueOnce(response)
    fireEvent.click(within(dialog).getByRole('button', { name: '核对列表' }))

    function navigate(hash: string) {
      act(() => {
        window.history.replaceState(null, '', hash)
        window.dispatchEvent(new PopStateEvent('popstate'))
      })
    }
    navigate('#/analytics')
    expect(screen.queryByRole('dialog')).toBeNull()
    navigate('#/sources')
    const opener = screen.getByRole<HTMLButtonElement>('button', { name: '新增信源' })
    expect(opener.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(opener)
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => finish(verifiedRows))
    await source(newName)
    expect(opener.getAttribute('aria-disabled')).toBe('false')
  })

  it('保存期间允许关闭弹窗，后台写入失败仍在页面反馈', async () => {
    const api = mount()
    let reject!: (error: Error) => void
    const response = new Promise<RssSource>((_, fail) => { reject = fail })
    const create = vi.spyOn(api, 'createRssSource').mockReturnValue(response)
    const dialog = await open()
    fill(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: '保存信源' }))
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).toBeNull()
    const opener = screen.getByRole('button', { name: '新增信源' })
    expect(document.activeElement).toBe(opener)
    fireEvent.click(opener)
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => reject(new ApiHttpError('NocoDB', 422)))
    expect(screen.getByText(/保存信源失败/)).toBeTruthy()
    expect(create).toHaveBeenCalledTimes(1)
    expect(opener.getAttribute('aria-disabled')).toBe('false')
  })

  it('回读状态不一致时以实际状态为准，避免成功误报', async () => {
    const api = createContentHubApi({})
    const original = (await api.listRssSources())[0]
    let finish!: (source: RssSource) => void
    const response = new Promise<RssSource>(resolve => { finish = resolve })
    vi.spyOn(api, 'setRssSourceActive').mockReturnValue(response)
    mount(api)
    const control = within(await source(retail)).getByRole('switch')
    fireEvent.click(control)
    expect((screen.getByRole('button', { name: '刷新信源' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => finish(original))
    await screen.findByText('回读的启停状态与请求不一致。')
    expect(control.getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByText(/已停用。/)).toBeNull()
  })
})
