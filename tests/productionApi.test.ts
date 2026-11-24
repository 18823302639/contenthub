import { describe, expect, it, vi } from 'vitest'
import { createContentHubApi } from '../src/api'

const env = {
  VITE_USE_MOCK: 'false',
  VITE_NOCODB_API_URL: '/nocodb',
  VITE_NOCODB_PRODUCTION_POOL_TABLE_ID: 'mtestproduction',
}

describe('WF2 和 WF3', () => {
  it('WF1、WF2、WF3 默认使用同源代理，也支持单独配置且不发送密钥', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 200 }))
    const defaults = createContentHubApi(env, fetcher)
    await defaults.triggerWebhook('rss-sync-now', {})
    await defaults.triggerGenerateDraft(9)
    await defaults.triggerRender(9)
    const configured = createContentHubApi({
      ...env, VITE_N8N_WEBHOOK_BASE_URL: '/internal/n8n/', VITE_WF2_GENERATE_WEBHOOK_URL: '/internal/generate',
      VITE_WF3_RENDER_WEBHOOK_URL: '/internal/render',
    }, fetcher)
    await configured.triggerWebhook('rss-sync-now', {})
    await configured.triggerGenerateDraft(9)
    await configured.triggerRender(9)
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/n8n/rss-sync-now', '/api/n8n/generate-draft', '/api/n8n/render-video',
      '/internal/n8n/rss-sync-now', '/internal/generate', '/internal/render',
    ])
    for (const [url, init] of fetcher.mock.calls) {
      const body = String(url).endsWith('/rss-sync-now') ? '{}' : '{"record_id":9}'
      expect(init).toMatchObject({ method: 'POST', body, redirect: 'error' })
      expect(new Headers(init?.headers).has('X-Hub-Token')).toBe(false)
      expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
    }
  })

  it('代理拒绝时保留鉴权失败提示，缺失默认 WF3 路由时提示尚未接入', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    const api = createContentHubApi(env, fetcher)
    await expect(api.triggerGenerateDraft(9)).rejects.toThrow(/初稿生成鉴权失败.*403/)
    await expect(api.triggerRender(9)).rejects.toThrow(/渲染提交鉴权失败.*401/)
    await expect(api.triggerRender(9)).rejects.toThrow('WF3 渲染服务尚未配置，请先完成 Day 3 广州渲染节点接入')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('解码完整字段，并向 NocoDB 以 JSON 对象更新渲染数据', async () => {
    const data = { scenes: [{ source: '原始样本' }], cards: [] }
    const report = { status: 'pass', banned_word_hits: [], prediction_phrase_hits: [], missing_sources: [], suggestion: '' }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        id: 9, track_tag: 'main_overseas', workflow_status: '待人工审核', compliance_risk: '低风险',
        remotion_data: JSON.stringify(data), compliance_report: JSON.stringify(report),
        fact_check_notes: '校验完成', video_script: '口播正文', final_content: '定稿全文',
      }))
      .mockResolvedValueOnce(Response.json([{ id: 9 }]))
      .mockResolvedValueOnce(Response.json({ id: 9, remotion_data: data }))
    const api = createContentHubApi(env, fetcher)
    await expect(api.getProductionItem(9)).resolves.toMatchObject({
      track_tag: 'main_overseas', workflow_status: '待人工审核', compliance_risk: '低风险',
      compliance_report: report, remotion_data: data, fact_check_notes: '校验完成', video_script: '口播正文', final_content: '定稿全文',
    })
    await api.updateProductionItem(9, { remotion_data: data })
    expect(fetcher.mock.calls[1][1]?.body).toBe(JSON.stringify([{ remotion_data: data, id: 9 }]))
  })
})

describe('Remotion 兼容性', () => {
  it('区别空、语法错误、缺来源和可提交的对象', async () => {
    const { parseRemotion } = await import('../src/features/productionDesk/remotion')
    expect(parseRemotion('')).toMatchObject({ value: null, error: null, missingSources: [] })
    expect(parseRemotion('{"scenes":')).toMatchObject({ value: null, error: expect.any(String) })
    expect(parseRemotion('false')).toMatchObject({ value: false, error: null })
    expect(parseRemotion('[]')).toMatchObject({ value: [], error: null })
    expect(parseRemotion('{"scenes":[{"source":" "}],"cards":[null,{"source":"原始数据"}]}'))
      .toMatchObject({ error: null, missingSources: ['scenes[0].source', 'cards[0].source'] })
    expect(parseRemotion('{"scenes":[{"source":"原始数据"}],"cards":[]}'))
      .toMatchObject({ error: null, missingSources: [] })
  })
})

it('挑刺回执返回本轮编辑稿，发送当前图文、口播与指令', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    draft_md: '# 已优化图文', video_script: '优化口播',
  }))
  const api = createContentHubApi({ VITE_USE_MOCK: 'false' }, fetcher)
  const payload = { production_id: 9, revision_note: '精简摘要', draft_md: '# 编辑中的稿', video_script: '编辑中的口播' }
  await expect(api.triggerWebhook('rewrite-draft', payload)).resolves.toMatchObject({
    draft_md: '# 已优化图文', video_script: '优化口播',
  })
  const [url, init] = fetcher.mock.calls[0]
  expect(url).toBe('/api/n8n/rewrite-draft')
  expect(JSON.parse(String(init?.body))).toEqual(payload)
  expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
})

it('NocoDB 优先报告跨页全库总数并解码 WF4 字段，不改同源读取方式', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({
      list: [{ id: 1, need_remotion: 'false', render_status: 'completed',
        video_url: 'https://mock.example.invalid/v.mp4', cards_urls: '["/files/card.png"]',
        updated_at: '2024-07-01T03:00:00Z' }],
      pageInfo: { isLastPage: false, totalRows: '42' },
    })).mockResolvedValueOnce(Response.json({
      list: [{ id: 2, need_remotion: 'true', render_status: 'failed', render_error: '模拟失败' }],
      pageInfo: { isLastPage: true },
    }))

  const api = createContentHubApi({ VITE_USE_MOCK: 'false', VITE_NOCODB_PRODUCTION_POOL_TABLE_ID: 'mtest' }, fetcher)
  const total = vi.fn()
  const items = await api.listProductionItems(undefined, total)
  expect(total).toHaveBeenCalledExactlyOnceWith(42)
  expect(items[0]).toMatchObject({ need_remotion: false, render_status: 'completed', cards_urls: ['/files/card.png'] })
  expect(items[1]).toMatchObject({ need_remotion: true, render_error: '模拟失败' })
  expect(fetcher.mock.calls[1][0]).toBe('/api/nocodb/tables/mtest/records?offset=1&limit=100&sort=id')
})
