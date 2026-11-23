import { externalUrl } from '../utils/externalUrl'
import { defaultWf2Url, readBaseUrl, wf3NotConfigured } from './config'
import type { ContentHubEnv } from './config'
import type { WebhookReceipt, WebhookRequest } from './contracts'
import { ApiHttpError, request } from './http'

export class WebhookAuthError extends Error {
  constructor(action: string, status?: number) {
    const detail = status === undefined ? '未配置 VITE_WEBHOOK_SECRET。' : `HTTP ${status}。`
    super(action + '鉴权失败，请检查 Webhook 密钥配置。' + detail)
    this.name = 'WebhookAuthError'
  }
}

function readSignedDownloadUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https?:\/\/[^/?#]/i.test(value) || /[\s\u0000-\u001f\u007f\\]/u.test(value)) {
    return null
  }
  // 只验证地址，保留签名链接原始字符串。
  return externalUrl(value) ? value : null
}

export function createWebhookClient(env: ContentHubEnv, fetcher: typeof fetch) {
  async function post(url: string, payload: object, protectedAction?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (protectedAction) {
      const secret = env.VITE_WEBHOOK_SECRET?.trim()
      if (!secret) throw new WebhookAuthError(protectedAction)
      headers['X-Hub-Token'] = secret
    }
    try {
      return await request(fetcher, 'n8n Webhook', url, { method: 'POST', headers, body: JSON.stringify(payload) })
    } catch (error) {
      if (protectedAction && error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
        throw new WebhookAuthError(protectedAction, error.status)
      }
      throw error
    }
  }

  return {
    async triggerWebhook(...[action, payload]: WebhookRequest): Promise<WebhookReceipt> {
      const base = readBaseUrl(env.VITE_N8N_WEBHOOK_BASE_URL, 'VITE_N8N_WEBHOOK_BASE_URL')
      const response = await post(`${base}/${action}`, payload, action === 'rss-sync-now' ? '采集' : undefined)
      const receipt: WebhookReceipt = { accepted: true, status: response.status }
      if (action === 'generate-video') {
        const body: { jobId?: unknown; downloadUrl?: unknown } | null = await response.json().catch(() => null)
        if (typeof body?.jobId === 'string' && body.jobId.trim()) receipt.jobId = body.jobId.trim()
        receipt.downloadUrl = readSignedDownloadUrl(body?.downloadUrl)
      }
      return receipt
    },

    async triggerGenerateDraft(recordId: number): Promise<WebhookReceipt> {
      const url = readBaseUrl(env.VITE_WF2_GENERATE_WEBHOOK_URL?.trim() || defaultWf2Url, 'VITE_WF2_GENERATE_WEBHOOK_URL')
      const response = await post(url, { record_id: recordId }, '初稿生成')
      return { accepted: true, status: response.status }
    },

    async triggerRender(recordId: number): Promise<WebhookReceipt> {
      const configured = env.VITE_WF3_RENDER_WEBHOOK_URL?.trim()
      if (!configured) throw new Error(wf3NotConfigured)
      const url = readBaseUrl(configured, 'VITE_WF3_RENDER_WEBHOOK_URL')
      const response = await post(url, { record_id: recordId }, '渲染提交')
      return { accepted: true, status: response.status }
    },
  }
}
