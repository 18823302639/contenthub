import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContentHubApi } from '../src/api'

const env = {
  VITE_USE_MOCK: 'false',
  VITE_NOCODB_API_URL: '/backend/nocodb/',
  VITE_N8N_WEBHOOK_BASE_URL: '/backend/n8n/',
  VITE_NOCODB_RSS_SOURCES_TABLE_ID: 'mtestsource12345',
  VITE_NOCODB_PRODUCTION_POOL_TABLE_ID: 'mtestproduct1234',
  VITE_NOCODB_RADAR_POOL_TABLE_ID: 'mtestradar123456',
  VITE_NOCODB_ACCOUNT_METRICS_TABLE_ID: 'mtestmetrics1234',
  VITE_NOCODB_POST_METRICS_TABLE_ID: 'mtestpost123456',
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

  it('允许留空触发模拟润色，更新初稿字段并保留旧定稿', async () => {
    const { api, step } = setup()
    const [item] = await step(api.listProductionItems({ status: '待人工终审' }))
    const note = ''
    expect(item.final_md).toBeTruthy()
    await step(api.updateProductionItem(item.id, { revision_note: note, workflow_status: '需AI润色' }))
    await step(api.triggerWebhook('rewrite-draft', { production_id: item.id, revision_note: note }))
    await vi.advanceTimersByTimeAsync(1000)
    const updated = await step(api.getProductionItem(item.id))
    expect(updated.workflow_status).toBe('待人工终审')
    expect(updated.draft_md).toContain('AI 主编自动挑刺')
    expect(updated.draft_md).not.toBe(item.draft_md)
    expect(updated.final_md).toBe(item.final_md)
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
    expect(opportunities.every(row => (row.commercial_score ?? 0) >= 4 && (row.info_gap_score ?? 0) >= 4)).toBe(true)
  })
})

describe('NocoDB v2 与真实模式', () => {
  it('保留选题的未知枚举和赛道，容忍文本空值与数字字符串', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const value = {
        ...production, Id: '7', score: '4', compliance_risk: '待核风险',
        workflow_status: '自动初审', track_tag: '新赛道', key_data_points: null,
        fact_check: ['错误类型'], final_md: null, created_at: null,
      }
      const api = createContentHubApi(env, vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(value)))
      const row = await api.getProductionItem(7)
      expect(row).toMatchObject({
        id: 7, score: 4, compliance_risk: '待核风险', workflow_status: '自动初审',
        track_tag: '新赛道', key_data_points: '', created_at: '', published_at: '',
      })
      expect(row).toMatchObject({ fact_check: '', final_md: '' })
      for (const field of ['compliance_risk', 'workflow_status', 'track_tag', 'fact_check']) {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(field))
      }
    } finally { warn.mockRestore() }
  })

  it.each([
    [['一', '二'], ['一', '二']],
    ['["一","二"]', ['一', '二']],
    ['普通标题', ['普通标题']],
    ['"JSON 单条标题"', ['JSON 单条标题']],
    ['[坏掉的 JSON', []],
    [[null, '可用标题', 42], ['可用标题']],
    [null, []],
  ])('兼容标题字段 %j', async (value, titles) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const api = createContentHubApi(env, vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
        ...production, score: '超出范围', suggested_titles: value,
      })))
      await expect(api.getProductionItem(7)).resolves.toMatchObject({ suggested_titles: titles, score: null })
    } finally { warn.mockRestore() }
  })

  it('隔离损坏记录并以原始页长计算下一页，结构错误和无主键单条仍失败', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const fetcher = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(page([null, { name: '没有主键' }, { ...source, pool_type: '另一个池', is_active: '0' }], false))
        .mockResolvedValueOnce(page([{ Id: '13', name: '后续记录', is_active: 1 }]))
        .mockResolvedValueOnce(Response.json({ list: {}, pageInfo: { isLastPage: true } }))
        .mockResolvedValueOnce(Response.json({ ...production, Id: null }))
      const api = createContentHubApi(env, fetcher)
      await expect(api.listRssSources()).resolves.toMatchObject([
        { id: 12, is_active: false, pool_type: '另一个池' },
        { id: 13, is_active: true, rss_url: '', created_at: '' },
      ])
      expect(new URL(String(fetcher.mock.calls[1][0]), 'https://contenthub.example.invalid').searchParams.get('offset')).toBe('3')
      expect(warn.mock.calls.filter(([message]) => String(message).includes('已跳过'))).toHaveLength(2)
      await expect(api.listRssSources()).rejects.toThrow('分页')
      await expect(api.getProductionItem(7)).rejects.toThrow('主键')
    } finally { warn.mockRestore() }
  })

  it('雷达分数和布尔值可以转换，有缺失分数的记录不进入阈值结果', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const api = createContentHubApi(env, vi.fn<typeof fetch>().mockResolvedValueOnce(page([
        { Id: 1, demand_type: '新需求', commercial_score: '4', info_gap_score: '4.5', evergreen: 'TRUE' },
        { Id: 2, commercial_score: null, info_gap_score: '5', evergreen: 0 },
      ])))
      await expect(api.listRadarItems({ minCommercialScore: 4, minInfoGapScore: 4 })).resolves.toMatchObject([
        { id: 1, demand_type: '新需求', commercial_score: 4, info_gap_score: 4.5, evergreen: true },
      ])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('demand_type'))
    } finally { warn.mockRestore() }
  })

  it('两种运营表采用相同的容错投影，保留实际零并用 null 表示无效数字', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const value = {
        Id: '4', production_id: '7', platform: '新平台', impressions: '0', views: '4',
        ctr: '无', completion_rate: null, revenue: '12.5', recorded_at: null,
      }
      const fetcher = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(page([value]))
        .mockResolvedValueOnce(page([{ ...value, production_id: '无效' }]))
      const api = createContentHubApi(env, fetcher)
      const expected = { id: 4, platform: '新平台', title: '', impressions: 0, views: 4,
        ctr: null, completion_rate: null, revenue: 12.5, recorded_at: '' }
      await expect(api.listAccountMetrics()).resolves.toMatchObject([{ ...expected, production_id: 7 }])
      await expect(api.listPostMetrics()).resolves.toMatchObject([{ ...expected, production_id: null }])
      expect(new URL(String(fetcher.mock.calls[1][0]), 'https://contenthub.example.invalid').pathname).toBe('/backend/nocodb/tables/mtestpost123456/records')
    } finally { warn.mockRestore() }
  })

  it('旧配置缺省使用 Mock，只有明确 false 切到真实模式，拼错会报错', () => {
    expect(createContentHubApi({}).mode).toBe('mock')
    expect(createContentHubApi(env).mode).toBe('real')
    expect(() => createContentHubApi({ VITE_USE_MOCK: 'flase' })).toThrow('VITE_USE_MOCK')
  })

  it('缺少真实 Table ID 或误填 SQL 表名时在发请求前报配置错误', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const api = createContentHubApi({ ...env, VITE_NOCODB_RSS_SOURCES_TABLE_ID: '' }, fetcher)
    await expect(api.listRssSources()).rejects.toThrow('VITE_NOCODB_RSS_SOURCES_TABLE_ID')
    const badId = createContentHubApi({ ...env, VITE_NOCODB_RSS_SOURCES_TABLE_ID: 'rss_sources' }, fetcher)
    await expect(badId.listRssSources()).rejects.toThrow('VITE_NOCODB_RSS_SOURCES_TABLE_ID')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('NocoDB 默认走同源代理，读取和更新都不携带 API 令牌', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(production))
      .mockResolvedValueOnce(Response.json([{ Id: 7 }]))
      .mockResolvedValueOnce(Response.json({ ...production, is_benchmark: true }))
    const api = createContentHubApi({ ...env, VITE_NOCODB_API_URL: undefined }, fetcher)
    await expect(api.getProductionItem(7)).resolves.toMatchObject({ id: 7 })
    await expect(api.updateProductionItem(7, { is_benchmark: true })).resolves.toMatchObject({ is_benchmark: true })
    const path = '/api/nocodb/tables/mtestproduct1234/records'
    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [path + '/7', 'GET'], [path, 'PATCH'], [path + '/7', 'GET'],
    ])
    for (const [, init] of fetcher.mock.calls) {
      const headers = new Headers(init?.headers)
      expect(headers.has('xc-token')).toBe(false)
      expect(headers.has('Authorization')).toBe(false)
      expect(headers.get('Accept')).toBe('application/json')
    }
  })

  it.each([401, 403])('NocoDB 代理返回 %i 时保留状态码和鉴权提示', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status }))
    await expect(createContentHubApi(env, fetcher).listRssSources()).rejects.toMatchObject({
      status, message: expect.stringContaining('请检查服务器 NocoDB 代理鉴权配置'),
    })
  })

  it('拒绝跨源代理路径，并在发请求前报告配置错误', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const invalid = createContentHubApi({
      ...env,
      VITE_NOCODB_API_URL: 'https://external-api.example.invalid/api/v2',
      VITE_N8N_WEBHOOK_BASE_URL: '//external-api.example.invalid/webhook',
      VITE_WF2_GENERATE_WEBHOOK_URL: 'https://external-api.example.invalid/generate',
      VITE_WF3_RENDER_WEBHOOK_URL: '//external-api.example.invalid/render',
    }, fetcher)
    await expect(invalid.listRssSources()).rejects.toThrow('VITE_NOCODB_API_URL')
    await expect(invalid.triggerWebhook('rss-sync-now', {})).rejects.toThrow('VITE_N8N_WEBHOOK_BASE_URL')
    await expect(invalid.triggerGenerateDraft(7)).rejects.toThrow('VITE_WF2_GENERATE_WEBHOOK_URL')
    await expect(invalid.triggerRender(7)).rejects.toThrow('VITE_WF3_RENDER_WEBHOOK_URL')
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
    expect(new URL(String(firstUrl), 'https://contenthub.example.invalid').pathname).toBe('/backend/nocodb/tables/mtestsource12345/records')
    expect(new URL(String(firstUrl), 'https://contenthub.example.invalid').searchParams.get('offset')).toBe('0')
    expect(new URL(String(firstUrl), 'https://contenthub.example.invalid').searchParams.get('limit')).toBe('100')
    expect(new URL(String(firstUrl), 'https://contenthub.example.invalid').searchParams.get('sort')).toBe('Id')
    expect(new Headers(firstOptions?.headers).get('xc-token')).toBeNull()
    expect(new URL(String(calls[1][0]), 'https://contenthub.example.invalid').searchParams.get('offset')).toBe('1')
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
    expect(row).toMatchObject({ raw_content: '', draft_md: '' })
    expect(row).not.toHaveProperty('Id')
    expect(fetcher.mock.calls[0][0]).toBe('/backend/nocodb/tables/mtestproduct1234/records/7')
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
    expect(patchUrl).toBe('/backend/nocodb/tables/mtestsource12345/records')
    expect(patch).toMatchObject({ method: 'PATCH', body: JSON.stringify([{ is_active: false, Id: 12 }]) })
    expect(getUrl).toBe(patchUrl + '/12')
    expect(postUrl).toBe(patchUrl)
    expect(post).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(post?.body))).toEqual([sourceInput])
    expect(new Headers(post?.headers).get('content-type')).toBe('application/json')
    expect(createdUrl).toBe(patchUrl + '/13')
  })

  it.each([[true, true], [false, false], [1, true], [0, false], ['1', true], ['0', false], [null, false]])(
    '标杆样本字段 %j 兼容 NocoDB 的返回值',
    async (stored, normalized) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
        ...production, ai_outline: '# 提纲', is_benchmark: stored,
      }))
      await expect(createContentHubApi(env, fetcher).getProductionItem(7)).resolves.toMatchObject({
        ai_outline: '# 提纲', is_benchmark: normalized,
      })
    },
  )

  it('标杆样本单独写入布尔字段，并用真实回读更新状态', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([{ Id: '7' }]))
      .mockResolvedValueOnce(Response.json({ ...production, ai_outline: null, is_benchmark: '1' }))
    await expect(createContentHubApi(env, fetcher).updateProductionItem(7, { is_benchmark: true }))
      .resolves.toMatchObject({ ai_outline: null, is_benchmark: true })
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'PATCH', body: JSON.stringify([{ is_benchmark: true, Id: 7 }]),
    })
  })

  it.each([undefined, '不可读'])('取消标杆时，回读没有可识别的值 %j 则不能确认成功', async (value) => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([{ Id: 7 }]))
      .mockResolvedValueOnce(Response.json({ ...production, is_benchmark: value }))
    await expect(createContentHubApi(env, fetcher).updateProductionItem(7, { is_benchmark: false }))
      .rejects.toMatchObject({ name: 'WriteReadbackError', recordId: 7 })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('源表停用回读缺字段也不能冒充成功，显式 null 则表示未勾选', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([{ Id: 12 }]))
      .mockResolvedValueOnce(Response.json({ ...source, is_active: undefined }))
      .mockResolvedValueOnce(Response.json([{ Id: 12 }]))
      .mockResolvedValueOnce(Response.json({ ...source, is_active: null }))
    const api = createContentHubApi(env, fetcher)
    await expect(api.setRssSourceActive(12, false)).rejects.toMatchObject({ name: 'WriteReadbackError', recordId: 12 })
    await expect(api.setRssSourceActive(12, false)).resolves.toMatchObject({ is_active: false })
  })

  it('单条读取的有效主键与请求不同时仍视为结构错误', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ ...production, Id: '8' }))
    await expect(createContentHubApi(env, fetcher).getProductionItem(7)).rejects.toThrow('主键与请求不一致')
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

describe('RSS 采集配置', () => {
  const settingsEnv = {
    ...env,
    VITE_NOCODB_RSS_SYNC_SETTINGS_TABLE_ID: 'mtestsync1',
    VITE_NOCODB_RSS_SYNC_SETTINGS_RECORD_ID: '7',
  }
  const configUrl = '/backend/nocodb/tables/mtestsync1/records'

  it('读取同一配置行，直接保存频率并回读，手动采集走 n8n', async () => {
    const previous = { Id: 7, sync_interval_hours: '6', last_synced_at: '2026-11-22T09:20:00Z' }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(previous))
      .mockResolvedValueOnce(Response.json([{ Id: 7 }]))
      .mockResolvedValueOnce(Response.json({ ...previous, sync_interval_hours: 0 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
    const api = createContentHubApi(settingsEnv, fetcher)
    await expect(api.getRssSyncSettings()).resolves.toEqual({ id: 7, sync_interval_hours: 6, last_synced_at: previous.last_synced_at })
    await expect(api.setRssSyncInterval(0)).resolves.toEqual({ id: 7, sync_interval_hours: 0, last_synced_at: previous.last_synced_at })
    await expect(api.triggerWebhook('rss-sync-now', {})).resolves.toEqual({ accepted: true, status: 202 })

    expect(fetcher.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
      [configUrl + '/7', 'GET'], [configUrl, 'PATCH'], [configUrl + '/7', 'GET'],
      ['/backend/n8n/rss-sync-now', 'POST'],
    ])
    const patch = fetcher.mock.calls[1][1]
    expect(JSON.parse(String(patch?.body))).toEqual([{ Id: 7, sync_interval_hours: 0 }])
    expect(new Headers(patch?.headers).get('xc-token')).toBeNull()
    expect(new Headers(patch?.headers).get('X-Hub-Token')).toBeNull()
    const webhook = fetcher.mock.calls[3][1]
    expect(JSON.parse(String(webhook?.body))).toEqual({})
    expect(new Headers(webhook?.headers).get('xc-token')).toBeNull()
    expect(new Headers(webhook?.headers).get('X-Hub-Token')).toBeNull()
    expect(webhook?.redirect).toBe('error')
  })

  it('配置记录 ID 缺失时不发写入，未知频率和无日期保留为空值', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ Id: 7, sync_interval_hours: 8, last_synced_at: null }))
    await expect(createContentHubApi({ ...settingsEnv, VITE_NOCODB_RSS_SYNC_SETTINGS_RECORD_ID: '' }, fetcher)
      .setRssSyncInterval(24)).rejects.toThrow('VITE_NOCODB_RSS_SYNC_SETTINGS_RECORD_ID')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(createContentHubApi(settingsEnv, fetcher).getRssSyncSettings())
      .resolves.toEqual({ id: 7, sync_interval_hours: null, last_synced_at: null })
  })

  it('离线 Mock 保存频率，手动采集完成后回写时间', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-22T08:00:00Z'))
    const fetcher = vi.fn<typeof fetch>()
    const api = createContentHubApi({}, fetcher)
    const change = api.setRssSyncInterval(3)
    await vi.advanceTimersByTimeAsync(180)
    await expect(change).resolves.toMatchObject({ sync_interval_hours: 3, last_synced_at: null })
    const collect = api.triggerWebhook('rss-sync-now', {})
    await vi.advanceTimersByTimeAsync(180)
    await expect(collect).resolves.toMatchObject({ accepted: true, status: 202 })
    await vi.advanceTimersByTimeAsync(900)
    const read = api.getRssSyncSettings()
    await vi.advanceTimersByTimeAsync(180)
    await expect(read).resolves.toMatchObject({ sync_interval_hours: 3, last_synced_at: '2026-11-22T08:00:01.260Z' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('n8n Webhook', () => {
  it('接受 n8n 默认 JSON、非 JSON 响应与空的 2xx 回执', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ message: 'Workflow was started' }))
      .mockResolvedValueOnce(new Response('accepted', { status: 299 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const api = createContentHubApi(env, fetcher)
    for (const status of [200, 299, 204]) {
      await expect(api.triggerWebhook('fetch-and-draft', { production_id: 7 }))
        .resolves.toEqual({ accepted: true, status })
    }
  })

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
      expect(url).toBe('/backend/n8n/' + action)
      expect(options).toMatchObject({ method: 'POST', body: JSON.stringify(payload) })
      expect(new Headers(options?.headers).get('content-type')).toBe('application/json')
      expect(new Headers(options?.headers).get('xc-token')).toBeNull()
      expect(new Headers(options?.headers).get('X-Hub-Token')).toBeNull()
    }
  })

  const videoPayload = { production_id: 7, format: '16x9', voice: 'zh-CN-YunxiNeural' } as const

  it('视频回执保留合法 HTTPS 下载地址原文', async () => {
    const downloadUrl = 'https://Render.Example.invalid:443/file/7?sig=fake%2b%2F&part=1&part=2&ttl=86400'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ jobId: 'job-1', downloadUrl }))
    await expect(createContentHubApi(env, fetcher).triggerWebhook('generate-video', videoPayload))
      .resolves.toEqual({ accepted: true, status: 200, jobId: 'job-1', downloadUrl })
  })

  it.each([
    ['缺失地址', undefined],
    ['非文本地址', 123],
    ['畸形地址', 'https://[invalid'],
    ['缺少主机名', 'https:///file.mp4'],
    ['相对地址', '//render.example.invalid/file.mp4'],
    ['HTTP 地址', 'http://render.example.invalid/file.mp4?sig=fake'],
    ['嵌入了账号凭据的地址', 'https://viewer:fake@render.example.invalid/file.mp4?sig=fake'],
    ['JavaScript 地址', 'javascript:alert(1)'],
    ['带空白字符的地址', 'https://render.example.invalid/file.mp4?sig=bad\tvalue'],
  ])('视频回执中的%s不影响有效任务 ID', async (_label, downloadUrl) => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ jobId: 'job-1', downloadUrl }, { status: 202 }))
    await expect(createContentHubApi(env, fetcher).triggerWebhook('generate-video', videoPayload))
      .resolves.toEqual({ accepted: true, status: 202, jobId: 'job-1', downloadUrl: null })
  })

  it('Webhook HTTP 失败向调用方传播，非法覆盖地址显式失败', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 500 }))
    const api = createContentHubApi(env, fetcher)
    await expect(api.triggerWebhook('fetch-and-draft', { production_id: 7 })).rejects.toMatchObject({ status: 500 })
    const invalidBase = createContentHubApi({ VITE_USE_MOCK: 'false', VITE_N8N_WEBHOOK_BASE_URL: '//invalid.example' }, fetcher)
    await expect(invalidBase.triggerWebhook('fetch-and-draft', { production_id: 7 }))
      .rejects.toThrow('VITE_N8N_WEBHOOK_BASE_URL')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
