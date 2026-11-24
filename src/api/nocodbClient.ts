import { defaultNocodbBase, readProxyPath, readTableId } from './config'
import type { ContentHubEnv } from './config'
import type { RecordStore, TableName, Tables } from './contracts'
import { ApiHttpError, isAuthFailure, request } from './http'
import { asObject, decodeRecord, NocodbStructureError, parseCheckbox, readRecordId, requireRecordId } from './nocodbCodec'

const pageLimit = 100

export class WriteReadbackError extends Error {
  constructor(readonly table: TableName, readonly recordId: number | null, cause: unknown) {
    const hint = isAuthFailure(cause) ? ' ' + cause.message : ''
    super('NocoDB 已返回写入成功，但无法确认记录的最新状态。请先查询记录，避免重复写入。' + hint, { cause })
    this.name = 'WriteReadbackError'
  }
}

export function createNocodbClient(env: ContentHubEnv, fetcher: typeof fetch): RecordStore {
  const idField = env.VITE_NOCODB_ID_FIELD?.trim() || 'id'

  function recordsUrl(table: TableName): string {
    const id = readTableId(env, table)
    const base = readProxyPath(env.VITE_NOCODB_API_URL?.trim() || defaultNocodbBase, 'VITE_NOCODB_API_URL')
    return `${base}/tables/${encodeURIComponent(id)}/records`
  }

  async function send(url: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', fields?: object, signal?: AbortSignal) {
    const headers = new Headers({ Accept: 'application/json' })
    if (fields) headers.set('Content-Type', 'application/json')

    try {
      return await request(fetcher, 'NocoDB', url, {
        method,
        headers,
        body: fields ? JSON.stringify([fields]) : undefined,
        ...(signal ? { signal } : {}),
      })
    } catch (error) {
      if (isAuthFailure(error)) {
        throw new ApiHttpError(error.service, error.status, '请检查服务器 NocoDB 代理鉴权配置。')
      }
      throw error
    }
  }

  async function get<T extends TableName>(
    table: T,
    id: number,
    signal?: AbortSignal,
    verifyCheckbox?: 'is_benchmark' | 'is_active',
  ): Promise<Tables[T]> {
    requireRecordId(id)
    const response = await send(`${recordsUrl(table)}/${id}`, 'GET', undefined, signal)
    const value = asObject(await response.json())
    if (verifyCheckbox && parseCheckbox(value[verifyCheckbox]) === null) {
      throw new Error('NocoDB 回读缺少可识别的 ' + verifyCheckbox + ' 值。')
    }
    const record = decodeRecord(table, value, idField)
    if (record.id !== id) throw new NocodbStructureError('NocoDB 单条记录的主键与请求不一致。')
    return record
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
      const checkbox = table === 'production_pool' ? 'is_benchmark' : table === 'rss_sources' ? 'is_active' : undefined
      return await get(table, returnedId, undefined, checkbox && Object.hasOwn(fields, checkbox) ? checkbox : undefined)
    } catch (cause) {
      throw new WriteReadbackError(table, recordId, cause)
    }
  }

  return {
    async list(table, onTotalRows) {
      const url = recordsUrl(table)
      const rows: Tables[typeof table][] = []
      const seen = new Set<number>()
      let offset = 0
      let totalRows: number | undefined

      while (true) {
        const query = new URLSearchParams({ offset: String(offset), limit: String(pageLimit), sort: idField })
        const response = await send(`${url}?${query}`, 'GET')
        const page = asObject(await response.json())
        const { isLastPage, totalRows: reported } = asObject(page.pageInfo)
        const count = typeof reported === 'string' && /^\d+$/.test(reported) ? Number(reported) : reported
        if (totalRows === undefined && typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
          totalRows = count
        }
        if (!Array.isArray(page.list) || typeof isLastPage !== 'boolean') {
          throw new Error('NocoDB 分页响应必须包含 list 和 pageInfo.isLastPage。')
        }

        for (const [index, value] of page.list.entries()) {
          let row: Tables[typeof table]
          try {
            row = decodeRecord(table, value, idField)
          } catch (error) {
            if (!(error instanceof NocodbStructureError)) throw error
            console.warn('NocoDB ' + table + ' 第 ' + (offset + index + 1) + ' 条记录格式错误或无有效主键，已跳过。')
            continue
          }
          if (seen.has(row.id)) throw new Error('NocoDB 分页返回重复主键，请重新读取。')
          seen.add(row.id)
          rows.push(row)
        }
        if (isLastPage) {
          onTotalRows?.(totalRows ?? offset + page.list.length)
          return rows
        }
        if (page.list.length === 0) throw new Error('NocoDB 分页未前进，请检查真实部署的响应。')
        offset += page.list.length
      }
    },
    get,
    async remove(table, id) {
      const response = await send(recordsUrl(table), 'DELETE', { [idField]: id })
      if (response.status === 204) return
      try {
        const receipt: unknown = await response.json()
        if (Array.isArray(receipt) && receipt.length === 1 &&
            readRecordId(asObject(receipt[0]), idField) === id) return
      } catch {
        // 响应可能来自代理或缺少有效记录 ID，交给列表核对。
      }
      throw new Error('NocoDB 删除回执未能确认，请刷新列表核对记录。')
    },
    create: (table, fields) => write(table, 'POST', fields, null),
    async update(table, id, changes) {
      requireRecordId(id)
      return write(table, 'PATCH', { ...changes, [idField]: id }, id)
    },
  }
}
