import { defaultN8nWebhookBase, defaultWf2Url, defaultWf3Url, readProxyPath, wf3NotConfigured } from './config'
import type { ContentHubEnv } from './config'
import type { WebhookReceipt, WebhookRequest } from './contracts'
import { ApiHttpError, isAuthFailure, request } from './http'

export class WebhookAuthError extends Error {
  constructor(action: string, status: number) {
    super(`${action}鉴权失败，请检查服务器 Webhook 代理鉴权配置。HTTP ${status}。`)
    this.name = 'WebhookAuthError'
  }
}

function readSignedDownloadUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https:\/\/[^/?#]/i.test(value) || /[\s\u0000-\u001f\u007f\\]/u.test(value)) {
    return null
  }
  try {
    const url = new URL(value)
    // 只验证地址，保留签名链接原始字符串。
    return url.username || url.password ? null : value
  } catch {
    return null
  }
}

export function createWebhookClient(env: ContentHubEnv, fetcher: typeof fetch) {
  async function post(url: string, payload: object, actionLabel?: string) {
    try {
      return await request(fetcher, 'n8n Webhook', url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      if (actionLabel && isAuthFailure(error)) {
        throw new WebhookAuthError(actionLabel, error.status)
      }
      throw error
    }
  }

  return {
    async triggerWebhook(...[action, payload]: WebhookRequest): Promise<WebhookReceipt> {
      const base = readProxyPath(env.VITE_N8N_WEBHOOK_BASE_URL?.trim() || defaultN8nWebhookBase, 'VITE_N8N_WEBHOOK_BASE_URL')
      const response = await post(`${base}/${action}`, payload, action === 'rss-sync-now' ? '采集' : action === 'rewrite-draft' ? 'AI 改稿' : undefined)
      const receipt: WebhookReceipt = { accepted: true, status: response.status }
      if (action === 'generate-video') {
        const body: { jobId?: unknown; downloadUrl?: unknown } | null = await response.json().catch(() => null)
        if (typeof body?.jobId === 'string' && body.jobId.trim()) receipt.jobId = body.jobId.trim()
        receipt.downloadUrl = readSignedDownloadUrl(body?.downloadUrl)
      }
      if (action === 'rewrite-draft') {
        const json: unknown = await response.json().catch(() => null)
        const body = Array.isArray(json) ? json[0] : json
        if (body && typeof body === 'object') {
          const { draft_md, video_script } = body as Record<string, unknown>
          if (typeof draft_md === 'string' && draft_md.trim()) receipt.draft_md = draft_md
          if (typeof video_script === 'string' && video_script.trim()) receipt.video_script = video_script
        }
      }
      return receipt
    },

    async triggerGenerateDraft(recordId: number): Promise<WebhookReceipt> {
      const url = readProxyPath(env.VITE_WF2_GENERATE_WEBHOOK_URL?.trim() || defaultWf2Url, 'VITE_WF2_GENERATE_WEBHOOK_URL')
      const response = await post(url, { record_id: recordId }, '初稿生成')
      return { accepted: true, status: response.status }
    },

    async triggerRender(recordId: number): Promise<WebhookReceipt> {
      const url = readProxyPath(env.VITE_WF3_RENDER_WEBHOOK_URL?.trim() || defaultWf3Url, 'VITE_WF3_RENDER_WEBHOOK_URL')
      try {
        const response = await post(url, { record_id: recordId }, '渲染提交')
        return { accepted: true, status: response.status }
      } catch (error) {
        if (url === defaultWf3Url && error instanceof ApiHttpError && error.status === 404) {
          throw new Error(wf3NotConfigured, { cause: error })
        }
        throw error
      }
    },
  }
}
