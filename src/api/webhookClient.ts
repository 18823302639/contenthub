import { externalUrl } from '../utils/externalUrl'
import { readBaseUrl } from './config'
import type { ContentHubEnv } from './config'
import type { WebhookReceipt, WebhookRequest } from './contracts'
import { ApiHttpError, request } from './http'

export class RssSyncAuthError extends Error {
  constructor(status?: number) {
    const detail = status === undefined ? '未配置 VITE_WEBHOOK_SECRET。' : `HTTP ${status}。`
    super('采集鉴权失败，请检查 Webhook 密钥配置。' + detail)
    this.name = 'RssSyncAuthError'
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
  return async function triggerWebhook(...[action, payload]: WebhookRequest): Promise<WebhookReceipt> {
    const manualSync = action === 'rss-sync-now'
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (manualSync) {
      const secret = env.VITE_WEBHOOK_SECRET?.trim()
      if (!secret) throw new RssSyncAuthError()
      headers['X-Hub-Token'] = secret
    }
    const base = readBaseUrl(env.VITE_N8N_WEBHOOK_BASE_URL, 'VITE_N8N_WEBHOOK_BASE_URL')
    const response = await request(fetcher, 'n8n Webhook', `${base}/${action}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }).catch((error: unknown) => {
      if (manualSync && error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
        throw new RssSyncAuthError(error.status)
      }
      throw error
    })
    const receipt: WebhookReceipt = { accepted: true, status: response.status }
    // 所有 HTTP 2xx 均表示受理，只有视频任务读取回执正文。
    if (action === 'generate-video') {
      const body: { jobId?: unknown; downloadUrl?: unknown } | null = await response.json().catch(() => null)
      if (typeof body?.jobId === 'string' && body.jobId.trim()) receipt.jobId = body.jobId.trim()
      receipt.downloadUrl = readSignedDownloadUrl(body?.downloadUrl)
    }
    return receipt
  }
}
