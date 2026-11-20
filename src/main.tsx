import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createContentHubApi } from './api'
import './styles.css'

function readStartupMessage() {
  try {
    const api = createContentHubApi(import.meta.env)
    return api.mode === 'mock' ? 'Mock · 离线演示' : '真实模式 · 等待发起请求'
  } catch (error) {
    return error instanceof Error ? error.message : '配置读取失败。'
  }
}

const startupMessage = readStartupMessage()
const root = document.getElementById('root')
if (!root) throw new Error('找不到 ContentHub 的挂载节点。')

createRoot(root).render(
  <StrictMode>
    <main className="mx-auto max-w-3xl px-6 pt-20 sm:px-8">
      <section aria-labelledby="app-title" className="rounded-xl border border-slate-200 bg-white p-7">
        <h1 id="app-title" className="text-xl font-semibold tracking-tight text-slate-950">ContentHub</h1>
        <p className="mt-1.5 text-sm text-slate-600">自媒体选题与内容生产</p>
        <p role="status" className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600">{startupMessage}</p>
      </section>
    </main>
  </StrictMode>,
)
