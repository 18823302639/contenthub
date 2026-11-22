import { readBaseUrl } from './config'
import type { ContentHubEnv } from './config'
import type { WebhookReceipt, WebhookRequest } from './contracts'
import { request } from './http'

export function createWebhookClient(env: ContentHubEnv, fetcher: typeof fetch) {
  return async function triggerWebhook(...[action, payload]: WebhookRequest): Promise<WebhookReceipt> {
    const base = readBaseUrl(env.VITE_N8N_WEBHOOK_BASE_URL, 'VITE_N8N_WEBHOOK_BASE_URL')
    const response = await request(fetcher, 'n8n Webhook', `${base}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    // request 已校验 HTTP 2xx。n8n 可以返回任意响应体，也可以没有响应体。
    return { accepted: true, status: response.status }
  }
}
