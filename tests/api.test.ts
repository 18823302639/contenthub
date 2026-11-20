import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContentHubApi } from '../src/api'

const env = {
  VITE_USE_MOCK: 'false',
  VITE_NOCODB_API_URL: 'https://nocodb.example.invalid/api/v2/',
  VITE_NOCODB_TOKEN: 'test-only',
  VITE_N8N_WEBHOOK_BASE_URL: 'https://n8n.example.invalid/webhook/',
  VITE_NOCODB_RSS_SOURCES_TABLE_ID: 'mtestsource12345',
  VITE_NOCODB_PRODUCTION_POOL_TABLE_ID: 'mtestproduct1234',
  VITE_NOCODB_RADAR_POOL_TABLE_ID: 'mtestradar123456',
  VITE_NOCODB_ACCOUNT_METRICS_TABLE_ID: 'mtestmetrics1234',
  VITE_NOCODB_ID_FIELD: 'Id',
}

const source = {
  Id: 12,
  name: '模拟信源',
  rss_url: 'https://feed.example.invalid/rss',
  pool_type: 'production',
  track_tag: '商业数据',
  is_active: true,
  created_at: '2026-11-20T08:00:00Z',
} as const

const production = {
  Id: 7,
  source_name: '模拟信源',
  track_tag: '商业数据',
  raw_title: 'A sample test',
  zh_title: '【模拟】一组样本测试',
  url: 'https://news.example.invalid/test',
  key_data_points: '合成数据',
  suggested_titles: '["标题一","标题二","标题三"]',
  score: 4,
  compliance_risk: '中',
  workflow_status: '待筛选',
  raw_content: null,
  draft_md: null,
  published_at: null,
  created_at: '2026-11-20T08:00:00Z',
} as const

function page(list: unknown[], isLastPage = true) {
  return Response.json({ list, pageInfo: { isLastPage } })
}

const { Id: sourceId, created_at: sourceCreatedAt, ...sourceInput } = source

afterEach(() => vi.useRealTimers())

describe('Mock API', () => {
  function setup() {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-20T12:00:00Z'))
    const fetcher = vi.fn<typeof fetch>()
    const api = createContentHubApi({}, fetcher)
    async function step<T>(promise: Promise<T>) {
      const result = expect(promise).resolves.toBeDefined()
      await vi.advanceTimersByTimeAsync(250)
      await result
      return promise
    }

    return { api, fetcher, step }
  }

  it('默认离线，读取有可观察的延迟，实例状态相互隔离', async () => {
    const { api, fetcher, step } = setup()
    const complete = vi.fn()
    const pending = api.listProductionItems({ trackTag: '商业数据', minScore: 4 })
    void pending.then(complete)
    await vi.advanceTimersByTimeAsync(0)
    expect(complete).not.toHaveBeenCalled()
    const rows = await step(pending)
    expect(api.mode).toBe('mock')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row).toMatchObject({ track_tag: '商业数据', suggested_titles: expect.any(Array) })
      expect(row.score).toBeGreaterThanOrEqual(4)
      expect(row.zh_title).toContain('模拟')
    }
    rows[0].suggested_titles[0] = '篡改缓存'
    await expect(step(api.getProductionItem(rows[0].id))).resolves.toMatchObject({
      suggested_titles: expect.not.arrayContaining(['篡改缓存']),
    })
    const independent = createContentHubApi({ VITE_USE_MOCK: 'true' }, fetcher)
    await step(api.updateProductionItem(rows[0].id, { workflow_status: '已放弃' }))
    expect((await step(independent.getProductionItem(rows[0].id))).workflow_status)
      .toBe(rows[0].workflow_status)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('确认选题、受理、生成初稿、润色、保存及发布均反映在后续读取', async () => {
    const { api, step } = setup()
    const [item] = await step(api.listProductionItems({ status: '待筛选' }))
    const id = item.id
    await step(api.updateProductionItem(id, { workflow_status: '已确认-待核对' }))
    const receipt = await step(api.triggerWebhook('fetch-and-draft', { production_id: id }))
    expect(receipt).toEqual({ accepted: true, status: 202 })
    expect((await step(api.getProductionItem(id))).workflow_status).toBe('已确认-待核对')
    await vi.advanceTimersByTimeAsync(1000)
    const draft = await step(api.getProductionItem(id))
    expect(draft).toMatchObject({
      workflow_status: 'AI初稿完成',
      raw_content: expect.stringContaining('模拟'),
      fact_check: expect.stringContaining('模拟'),
      draft_md: expect.stringContaining('模拟'),
    })
    const note = '补充对照组说明'
    await step(api.updateProductionItem(id, { revision_note: note, workflow_status: '需AI润色' }))
    await step(api.triggerWebhook('rewrite-draft', { production_id: id, revision_note: note }))
    await vi.advanceTimersByTimeAsync(1000)
    const rewritten = await step(api.getProductionItem(id))
    expect(rewritten.workflow_status).toBe('待人工终审')
    expect(rewritten.draft_md).toContain(note)
    expect(rewritten.revision_note).toBe(note)

    await step(api.updateProductionItem(id, { final_md: '# 人工定稿' }))
    const published = await step(api.updateProductionItem(id, {
      workflow_status: '已发布',
      published_at: '2026-11-20T12:00:04Z',
    }))
    expect(published).toMatchObject({ final_md: '# 人工定稿', workflow_status: '已发布' })
    expect(await step(api.getProductionItem(id))).toEqual(published)
  })

  it('拒绝重复任务，放弃选题后迟到的初稿不会覆盖状态', async () => {
    const { api, step } = setup()
    const [item] = await step(api.listProductionItems({ status: '待筛选' }))
    await step(api.updateProductionItem(item.id, { workflow_status: '已确认-待核对' }))
    await step(api.triggerWebhook('fetch-and-draft', { production_id: item.id }))
    const rejected = expect(api.triggerWebhook('fetch-and-draft', { production_id: item.id }))
      .rejects.toThrow('已有模拟任务')
    await vi.advanceTimersByTimeAsync(250)
    await rejected
    await step(api.updateProductionItem(item.id, { workflow_status: '已放弃' }))
    await vi.advanceTimersByTimeAsync(1000)
    const row = await step(api.getProductionItem(item.id))
    expect(row.workflow_status).toBe('已放弃')
    expect(row.draft_md).toBeUndefined()
  })

  it('润色已有定稿的选题时，工作台优先读取的字段会显示新版', async () => {
    const { api, step } = setup()
    const [item] = await step(api.listProductionItems({ status: '待人工终审' }))
    const note = '强调可比较的测量条件'
    expect(item.final_md).toBeTruthy()
    await step(api.updateProductionItem(item.id, { revision_note: note, workflow_status: '需AI润色' }))
    await step(api.triggerWebhook('rewrite-draft', { production_id: item.id, revision_note: note }))
    await vi.advanceTimersByTimeAsync(1000)
    const updated = await step(api.getProductionItem(item.id))
    expect(updated.workflow_status).toBe('待人工终审')
    expect(updated.final_md || updated.draft_md).toContain(note)
    expect(updated.draft_md).toBe(item.draft_md)
  })

  it('与 JSON PATCH 一致，省略 undefined 字段并允许显式清空字符串', async () => {
    const { api, step } = setup()
    const [item] = await step(api.listProductionItems({ status: '待人工终审' }))
    expect(item.final_md).toBeTruthy()
    await step(api.updateProductionItem(item.id, { final_md: undefined, revision_note: '复核数据' }))
    expect((await step(api.getProductionItem(item.id))).final_md).toBe(item.final_md)
    expect((await step(api.updateProductionItem(item.id, { final_md: '' }))).final_md).toBe('')
  })

  it('保存信源和运营数据，雷达机会同时应用两个评分下限', async () => {
    const { api, step } = setup()
    const created = await step(api.createRssSource(sourceInput))
    expect(created.created_at).toMatch(/^2026-11-20T/)
    await step(api.setRssSourceActive(created.id, false))
    expect(await step(api.listRssSources('production')))
      .toContainEqual({ ...created, is_active: false })
    expect(await step(api.listRssSources('radar'))).not.toContainEqual(created)

    const [item] = await step(api.listProductionItems({ status: '已发布' }))
    const metric = await step(api.createAccountMetric({
      production_id: item.id,
      title: item.zh_title,
      platform: '公众号',
      impressions: 200,
      views: 50,
      ctr: 25,
      completion_rate: 60,
      revenue: 3.24,
      recorded_at: '2026-11-20T08:00:00Z',
    }))
    expect(await step(api.listAccountMetrics('2026-11-20T08:00:00Z'))).toContainEqual(metric)
    expect(await step(api.listAccountMetrics('2026-11-21T00:00:00Z'))).toEqual([])
    const opportunities = await step(api.listRadarItems({ minCommercialScore: 4, minInfoGapScore: 4 }))
    expect(opportunities.length).toBeGreaterThan(0)
    expect(opportunities.length).toBeLessThan((await step(api.listRadarItems())).length)
    expect(opportunities.every(row => row.commercial_score >= 4 && row.info_gap_score >= 4)).toBe(true)
  })
})

describe('NocoDB v2 与真实模式', () => {
  it('旧配置缺省使用 Mock，只有明确 false 切到真实模式，拼错会报错', () => {
    expect(createContentHubApi({}).mode).toBe('mock')
    expect(createContentHubApi(env).mode).toBe('real')
    expect(() => createContentHubApi({ VITE_USE_MOCK: 'flase' })).toThrow('VITE_USE_MOCK')
  })

  it('缺少真实 Table ID 或凭证、误填 SQL 表名时在发请求前报配置错误', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const api = createContentHubApi({ ...env, VITE_NOCODB_RSS_SOURCES_TABLE_ID: '' }, fetcher)
    await expect(api.listRssSources()).rejects.toThrow('VITE_NOCODB_RSS_SOURCES_TABLE_ID')
    const badId = createContentHubApi({ ...env, VITE_NOCODB_RSS_SOURCES_TABLE_ID: 'rss_sources' }, fetcher)
    await expect(badId.listRssSources()).rejects.toThrow('VITE_NOCODB_RSS_SOURCES_TABLE_ID')
    const noToken = createContentHubApi({ ...env, VITE_NOCODB_TOKEN: 'your_token_here' }, fetcher)
    await expect(noToken.listRssSources()).rejects.toThrow('VITE_NOCODB_TOKEN')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('按 table ID 和主键排序分页，偏移量依据服务实际返回行数', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(page([source], false))
      .mockResolvedValueOnce(page([{ ...source, Id: 13, pool_type: 'radar' }]))
    const api = createContentHubApi(env, fetcher)
    expect(await api.listRssSources('production')).toEqual([{ ...sourceInput, id: sourceId, created_at: sourceCreatedAt }])
    const calls = fetcher.mock.calls
    const [firstUrl, firstOptions] = calls[0]
    expect(new URL(String(firstUrl)).pathname).toBe('/api/v2/tables/mtestsource12345/records')
    expect(new URL(String(firstUrl)).searchParams.get('offset')).toBe('0')
    expect(new URL(String(firstUrl)).searchParams.get('limit')).toBe('100')
    expect(new URL(String(firstUrl)).searchParams.get('sort')).toBe('Id')
    expect(new Headers(firstOptions?.headers).get('xc-token')).toBe('test-only')
    expect(new URL(String(calls[1][0])).searchParams.get('offset')).toBe('1')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('遇到无进展分页或远端拒绝时明确报错，不回退 Mock', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(page([], false))
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
      .mockResolvedValueOnce(page([source], false))
      .mockResolvedValueOnce(page([source]))
    const api = createContentHubApi(env, fetcher)
    await expect(api.listRssSources()).rejects.toThrow('分页')
    await expect(api.listRssSources()).rejects.toMatchObject({ status: 403 })
    await expect(api.listRssSources()).rejects.toThrow('重复')
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('读取单条记录并规范化主键、JSON 标题、可空字段以及未发布日期', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(production))
    const api = createContentHubApi(env, fetcher)
    const row = await api.getProductionItem(7)
    expect(row).toMatchObject({ id: 7, suggested_titles: ['标题一', '标题二', '标题三'], published_at: '' })
    expect(row).not.toHaveProperty('raw_content')
    expect(row).not.toHaveProperty('draft_md')
    expect(row).not.toHaveProperty('Id')
    expect(fetcher.mock.calls[0][0]).toBe('https://nocodb.example.invalid/api/v2/tables/mtestproduct1234/records/7')
  })

  it('PATCH 和 POST 使用原始字段数组，请求成功后按主键回读', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([{ Id: 12 }]))
      .mockResolvedValueOnce(Response.json({ ...source, is_active: false }))
      .mockResolvedValueOnce(Response.json([{ Id: 13 }], { status: 201 }))
      .mockResolvedValueOnce(Response.json({ ...source, Id: 13 }))
    const api = createContentHubApi(env, fetcher)
    expect(await api.setRssSourceActive(12, false)).toMatchObject({ id: 12, is_active: false })
    expect(await api.createRssSource(sourceInput)).toMatchObject({ id: 13, created_at: sourceCreatedAt })
    const [[patchUrl, patch], [getUrl], [postUrl, post], [createdUrl]] = fetcher.mock.calls
    expect(patchUrl).toBe('https://nocodb.example.invalid/api/v2/tables/mtestsource12345/records')
    expect(patch).toMatchObject({ method: 'PATCH', body: JSON.stringify([{ is_active: false, Id: 12 }]) })
    expect(getUrl).toBe(patchUrl + '/12')
    expect(postUrl).toBe(patchUrl)
    expect(post).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(post?.body))).toEqual([sourceInput])
    expect(new Headers(post?.headers).get('content-type')).toBe('application/json')
    expect(createdUrl).toBe(patchUrl + '/13')
  })

  it('区分已写入但回读失败，且不自动重复写入', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([{ Id: 12 }]))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
    await expect(createContentHubApi(env, fetcher).setRssSourceActive(12, false))
      .rejects.toMatchObject({ name: 'WriteReadbackError', recordId: 12 })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

describe('n8n Webhook', () => {
  it('对两个动作各 POST JSON 到所配置路径，只返回受理回执', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('queued', { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const api = createContentHubApi(env, fetcher)
    const draft = { production_id: 7 }
    const rewrite = { production_id: 7, revision_note: '复核样本量' }
    expect(await api.triggerWebhook('fetch-and-draft', draft)).toEqual({ accepted: true, status: 202 })
    expect(await api.triggerWebhook('rewrite-draft', rewrite)).toEqual({ accepted: true, status: 204 })
    for (const [index, action, payload] of [[0, 'fetch-and-draft', draft], [1, 'rewrite-draft', rewrite]] as const) {
      const [url, options] = fetcher.mock.calls[index]
      expect(url).toBe('https://n8n.example.invalid/webhook/' + action)
      expect(options).toMatchObject({ method: 'POST', body: JSON.stringify(payload) })
      expect(new Headers(options?.headers).get('content-type')).toBe('application/json')
      expect(new Headers(options?.headers).get('xc-token')).toBeNull()
    }
  })

  it('Webhook HTTP 失败向调用方传播，缺配置显式失败', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 500 }))
    const api = createContentHubApi(env, fetcher)
    await expect(api.triggerWebhook('fetch-and-draft', { production_id: 7 })).rejects.toMatchObject({ status: 500 })
    const missingBase = createContentHubApi({ VITE_USE_MOCK: 'false' }, fetcher)
    await expect(missingBase.triggerWebhook('fetch-and-draft', { production_id: 7 }))
      .rejects.toThrow('VITE_N8N_WEBHOOK_BASE_URL')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
