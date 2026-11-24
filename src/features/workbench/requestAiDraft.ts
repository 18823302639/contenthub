import type { ContentHubApi } from '../../api'

export async function requestAiDraft(
  api: ContentHubApi, id: number, article: string, script: string, note: string,
) {
  const receipt = await api.triggerWebhook('rewrite-draft', {
    production_id: id, draft_md: article, video_script: script, revision_note: note.trim(),
  })
  if (!receipt.draft_md && !receipt.video_script) {
    throw new Error('Webhook 已受理，但回执未包含可用的稿件。请核对 WF3 返回内容。')
  }
  return { article: receipt.draft_md, script: receipt.video_script }
}
