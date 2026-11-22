import { Download, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ContentHubApi } from '../../api'

const probeIntervalMs = 6_000
const renderTimeoutMs = 180_000
type RenderPhase = 'rendering' | 'ready' | 'timeout'

const messages: Record<RenderPhase, string> = {
  rendering: '正在配音并渲染视频',
  ready: '视频已生成，可立即下载',
  timeout: '渲染耗时较长，请稍后手动尝试下载',
}

export function VideoRenderNotice({ api, jobId, downloadUrl }: {
  api: ContentHubApi
  jobId: string
  downloadUrl: string
}) {
  const [phase, setPhase] = useState<RenderPhase>('rendering')
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const started = Date.now()
    const deadline = started + renderTimeoutMs
    let activeProbe: AbortController | undefined

    const clockTimer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1_000)), 1_000)
    const probeTimer = setInterval(async () => {
      if (Date.now() >= deadline) return
      // 每次仅保留一个探测请求，卡住的请求由下一次接管。
      activeProbe?.abort()
      const probe = new AbortController()
      activeProbe = probe
      const ready = await api.probeVideoDownload(downloadUrl, probe.signal)
      if (probe.signal.aborted || Date.now() >= deadline) return
      activeProbe = undefined
      if (ready) finish('ready')
    }, probeIntervalMs)
    const deadlineTimer = setTimeout(() => finish('timeout'), renderTimeoutMs)

    function stop() {
      clearInterval(clockTimer)
      clearInterval(probeTimer)
      clearTimeout(deadlineTimer)
      activeProbe?.abort()
    }

    function finish(result: 'ready' | 'timeout') {
      stop()
      setPhase(result)
    }

    return stop
  }, [api, downloadUrl])

  const rendering = phase === 'rendering'
  const noticeStyle = phase === 'ready' ? ' wb-video-notice--ready' : phase === 'timeout' ? ' topic-feedback--warning' : ''

  return (
    <div className={'topic-feedback wb-video-notice' + noticeStyle}>
      <div className="wb-video-progress">
        {rendering && <LoaderCircle size={15} className="refresh-spinning" aria-hidden />}
        <div>
          <span role="status">{messages[phase]}</span>
          {rendering && <span role="timer" aria-live="off">（已用时 {seconds} 秒）</span>}
          {' · 任务 ID '}<code>{jobId}</code>
        </div>
      </div>
      {rendering ? (
        <button className="button button--secondary" type="button" disabled>等待生成...</button>
      ) : (
        <a className={'button ' + (phase === 'ready' ? 'button--primary' : 'button--secondary')}
          href={downloadUrl} target="_blank" rel="noopener noreferrer">
          <Download size={15} aria-hidden />下载成品 MP4
        </a>
      )}
    </div>
  )
}
