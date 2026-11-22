import { dailyMetricKey } from '../utils/metricDays'
import type { ProductionItem } from '../types/schema'
import type { RecordStore, TableName, Tables, WebhookReceipt, WebhookRequest } from './contracts'
import { makeMockData } from './mockData'

const responseDelayMs = 180
const workflowDelayMs = 900

function delay() {
  return new Promise<void>(resolve => setTimeout(resolve, responseDelayMs))
}

export function createMockBackend() {
  const data = makeMockData(Date.now())
  const activeJobs = new Set<number>()
  let nextVideoJobId = 1

  function find<T extends TableName>(table: T, id: number): Tables[T] {
    const row = data[table].find(row => row.id === id)
    if (!row) throw new Error(`找不到模拟记录（${table}，ID ${id}）。`)
    return row
  }

  function updateProduction(item: ProductionItem, changes: Partial<ProductionItem>) {
    const index = data.production_pool.indexOf(item)
    data.production_pool[index] = { ...item, ...changes }
  }

  const store: RecordStore = {
    async list(table) {
      await delay()
      return structuredClone(data[table])
    },
    async get(table, id) {
      await delay()
      return structuredClone(find(table, id))
    },
    async create(table, fields) {
      const input = structuredClone(fields)
      await delay()
      const rows = data[table]
      const id = rows.reduce((last, row) => Math.max(last, row.id), 0) + 1
      const timestamps = table === 'rss_sources' ? { created_at: new Date().toISOString() } : {}
      const row = { ...input, id, ...timestamps } as Tables[typeof table]
      if ('recorded_at' in row) {
        const key = dailyMetricKey(row)
        if (key === null) throw new Error('无法确认运营数据的 UTC+8 日期。')
        if (data.account_metrics.some(record => dailyMetricKey(record) === key)) {
          throw new Error('同一内容在该平台当天已有记录。')
        }
      }
      rows.push(row)
      return structuredClone(row)
    },
    async update(table, id, changes) {
      const input = structuredClone(changes)
      await delay()
      const rows = data[table]
      const row = find(table, id)
      const updated = { ...row, ...input }
      rows[rows.indexOf(row)] = updated
      return structuredClone(updated)
    },
  }

  async function triggerWebhook(...request: WebhookRequest): Promise<WebhookReceipt> {
    const [action, payload] = structuredClone(request)
    await delay()

    const item = find('production_pool', payload.production_id)
    if (action === 'generate-video') {
      return {
        accepted: true,
        status: 202,
        jobId: `mock-video-${item.id}-${payload.format}-${nextVideoJobId++}`,
        downloadUrl: null,
      }
    }
    if (activeJobs.has(item.id)) throw new Error('这条选题已有模拟任务正在运行。')

    if (action === 'fetch-and-draft' && item.workflow_status !== '已确认-待核对') {
      throw new Error('请先确认选题，再触发模拟初稿。')
    }
    if (action === 'rewrite-draft' && (
      item.workflow_status !== '需AI润色' ||
      (item.revision_note ?? '') !== payload.revision_note ||
      !(item.final_md?.trim() || item.draft_md?.trim())
    )) {
      throw new Error('请先准备稿件并保存本次修改意见及「需AI润色」状态。')
    }

    activeJobs.add(item.id)
    setTimeout(() => {
      activeJobs.delete(item.id)
      // 并行人工修改会替换记录，迟到的模拟任务不覆盖新记录。
      if (!data.production_pool.includes(item)) return

      if (action === 'fetch-and-draft') {
        updateProduction(item, {
          raw_content: `【模拟原文】${item.raw_title}\n\n${item.key_data_points}`,
          fact_check: '【模拟核查】示例数据为合成数据。\n\n- [ ] 核对样本量与指标口径\n- [ ] 确认对照条件',
          draft_md: `# ${item.zh_title}\n\n${item.key_data_points}\n\n写作练习：补充口径定义与适用边界。`,
          workflow_status: 'AI初稿完成',
        })
      } else {
        const source = item.final_md?.trim() || item.draft_md?.trim()
        updateProduction(item, {
          draft_md: `${source}\n\n## 模拟润色记录\n\n- 修改意见：${payload.revision_note.trim() || 'AI 主编自动挑刺'}`,
          workflow_status: '待人工终审',
        })
      }
    }, workflowDelayMs)

    return { accepted: true, status: 202 }
  }

  return { store, triggerWebhook }
}
