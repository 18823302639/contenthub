import { ChevronDown, Download, LoaderCircle, Video } from 'lucide-react'
import { useId, useState } from 'react'
import type { ContentHubApi, VideoFormat } from '../../api'

type Submission =
  | { phase: 'pending' }
  | { phase: 'accepted'; jobId: string }
  | { phase: 'error'; message: string }

export function VideoControls({ api, productionId }: { api: ContentHubApi; productionId: number }) {
  const formatId = useId()
  const [format, setFormat] = useState<VideoFormat>('16x9')
  const [submission, setSubmission] = useState<Submission | null>(null)
  const pending = submission?.phase === 'pending'
  const jobId = submission?.phase === 'accepted' ? submission.jobId : null
  const download = jobId ? api.getVideoDownloadUrl(jobId) : null

  async function generate() {
    if (pending) return
    setSubmission({ phase: 'pending' })
    try {
      const receipt = await api.triggerWebhook('generate-video', { production_id: productionId, format })
      if (receipt.jobId) setSubmission({ phase: 'accepted', jobId: receipt.jobId })
      else setSubmission({ phase: 'error', message: 'Webhook 已受理，但未返回有效任务 ID。请先核对 n8n 执行记录。' })
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : ''
      setSubmission({ phase: 'error', message: `视频任务提交未确认。${detail} 请先核对 n8n 执行记录。` })
    }
  }

  return (
    <div className="wb-video-controls">
      <div className="wb-video-actions">
        <label className="wb-video-label" htmlFor={formatId}>视频画幅</label>
        <div className="filter-control">
          <select id={formatId} value={format} disabled={pending}
            onChange={event => setFormat(event.target.value === '9x16' ? '9x16' : '16x9')}>
            <option value="16x9">16x9（横屏 B站 / YouTube）</option>
            <option value="9x16">9x16（竖屏 抖音 / 视频号）</option>
          </select>
          <ChevronDown size={14} aria-hidden />
        </div>
        <button type="button" className="button button--secondary" disabled={pending} aria-busy={pending}
          onClick={() => void generate()}>
          {pending ? <LoaderCircle size={15} className="refresh-spinning" aria-hidden /> : <Video size={15} aria-hidden />}
          {pending ? '正在拆解分镜并推送渲染...' : '生成视频'}
        </button>
      </div>
      {submission?.phase === 'error' && (
        <p className="topic-feedback topic-feedback--warning wb-video-notice" role="alert">{submission.message}</p>
      )}
      {jobId && (
        <div className="topic-feedback wb-video-notice">
          <div role="status">
            {api.mode === 'mock' ? <span>已生成模拟渲染任务。</span> : <span>渲染任务已提交至渲染机，约需 40-60 秒完成</span>}
            {' · 任务 ID '}<code>{jobId}</code>
          </div>
          {download && (
            <a className="button button--secondary" href={download} target="_blank" rel="noopener noreferrer">
              <Download size={15} aria-hidden />下载成品 MP4
            </a>
          )}
        </div>
      )}
    </div>
  )
}
