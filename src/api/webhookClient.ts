import { externalUrl } from '../utils/externalUrl'
import { readBaseUrl } from './config'
import type { ContentHubEnv } from './config'
import type { WebhookReceipt, WebhookRequest } from './contracts'
import { request } from './http'

function readSignedDownloadUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https?:\/\/[^/?#]/i.test(value) || /[\s\u0000-\u001f\u007f\\]/u.test(value)) {
    return null
  }
  // 只验证地址，保留签名链接原始字符串。
  return externalUrl(value) ? value : null
}

export function createWebhookClient(env: ContentHubEnv, fetcher: typeof fetch) {
  return async function triggerWebhook(...[action, payload]: WebhookRequest): Promise<WebhookReceipt> {
    const base = readBaseUrl(env.VITE_N8N_WEBHOOK_BASE_URL, 'VITE_N8N_WEBHOOK_BASE_URL')
    const response = await request(fetcher, 'n8n Webhook', `${base}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
