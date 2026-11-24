import type { ContentHubApi, WebhookReceipt } from '../../api'
import { ApiHttpError } from '../../api/http'

export async function requestAiDraft(
  api: ContentHubApi, id: number, article: string, script: string, note: string,
) {
  let receipt: WebhookReceipt
  try {
    receipt = await api.triggerWebhook('rewrite-draft', {
      production_id: id, draft_md: article, video_script: script, revision_note: note.trim(),
    })
  } catch (error) {
    if (error instanceof ApiHttpError && error.status >= 500) {
      throw new Error('AI 改稿结果未确认（HTTP ' + error.status + '）。请核对 n8n 执行记录后再重试。', { cause: error })
    }
    throw error
  }
  if (!receipt.draft_md && !receipt.video_script) {
    throw new Error('Webhook 已受理，但回执未包含可用的稿件。请核对 WF3 返回内容。')
  }
  return { article: receipt.draft_md, script: receipt.video_script }
}
