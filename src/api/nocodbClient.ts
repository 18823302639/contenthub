import { readBaseUrl, readTableId } from './config'
import type { ContentHubEnv } from './config'
import type { RecordStore, TableName, Tables } from './contracts'
import { request } from './http'
import { asObject, decodeRecord, readRecordId, requireRecordId } from './nocodbCodec'

const pageLimit = 100

export class WriteReadbackError extends Error {
  constructor(readonly table: TableName, readonly recordId: number | null, cause: unknown) {
    super('NocoDB 已返回写入成功，但无法确认记录的最新状态。请先查询记录，避免重复写入。', { cause })
    this.name = 'WriteReadbackError'
  }
}

export function createNocodbClient(env: ContentHubEnv, fetcher: typeof fetch): RecordStore {
  const idField = env.VITE_NOCODB_ID_FIELD?.trim() || 'id'

  function recordsUrl(table: TableName): string {
    const id = readTableId(env, table)
    const base = readBaseUrl(env.VITE_NOCODB_API_URL, 'VITE_NOCODB_API_URL')
    return `${base}/tables/${encodeURIComponent(id)}/records`
  }

  async function send(url: string, method: 'GET' | 'POST' | 'PATCH', fields?: object) {
    const token = env.VITE_NOCODB_TOKEN?.trim()
    if (!token || token === 'your_token_here') {
      throw new Error('请配置 VITE_NOCODB_TOKEN，或为受保护的同源代理配置公开标记。')
    }

    const headers = new Headers({ Accept: 'application/json', 'xc-token': token })
    if (fields) headers.set('Content-Type', 'application/json')

    return request(fetcher, 'NocoDB', url, {
      method,
      headers,
      body: fields ? JSON.stringify([fields]) : undefined,
    })
  }

  async function get<T extends TableName>(table: T, id: number): Promise<Tables[T]> {
    requireRecordId(id)
    const response = await send(`${recordsUrl(table)}/${id}`, 'GET')
    return decodeRecord(table, await response.json(), idField)
  }

  async function write<T extends TableName>(
    table: T,
    method: 'POST' | 'PATCH',
    fields: object,
    id: number | null,
  ): Promise<Tables[T]> {
    const response = await send(recordsUrl(table), method, fields)
    let recordId = id

    try {
      const receipt: unknown = await response.json()
      if (!Array.isArray(receipt) || receipt.length !== 1) {
        throw new Error('NocoDB 写入回执应包含一条记录的主键。')
      }
      const returnedId = readRecordId(asObject(receipt[0]), idField)
      if (id !== null && returnedId !== id) {
        throw new Error('NocoDB 写入回执的主键与请求不一致。')
      }

      recordId = returnedId
      const record = await get(table, returnedId)
      if (record.id !== returnedId) throw new Error('NocoDB 回读记录的主键与回执不一致。')
      return record
    } catch (cause) {
      throw new WriteReadbackError(table, recordId, cause)
    }
  }

  return {
    async list(table) {
      const url = recordsUrl(table)
      const rows: Tables[typeof table][] = []
      const seen = new Set<number>()
      let offset = 0

      while (true) {
        const query = new URLSearchParams({ offset: String(offset), limit: String(pageLimit), sort: idField })
        const response = await send(`${url}?${query}`, 'GET')
        const page = asObject(await response.json())
        const { isLastPage } = asObject(page.pageInfo)
        if (!Array.isArray(page.list) || typeof isLastPage !== 'boolean') {
          throw new Error('NocoDB 分页响应必须包含 list 和 pageInfo.isLastPage。')
        }

        for (const value of page.list) {
          const row = decodeRecord(table, value, idField)
          if (seen.has(row.id)) throw new Error('NocoDB 分页返回重复主键，请重新读取。')
          seen.add(row.id)
          rows.push(row)
        }
        if (isLastPage) return rows
        if (page.list.length === 0) throw new Error('NocoDB 分页未前进，请检查真实部署的响应。')
        offset += page.list.length
      }
    },
    get,
    create: (table, fields) => write(table, 'POST', fields, null),
    async update(table, id, changes) {
      requireRecordId(id)
      return write(table, 'PATCH', { ...changes, [idField]: id }, id)
    },
  }
}
