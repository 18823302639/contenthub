import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import { createContentHubApi } from './api'
import { ContentHubApp } from './app/ContentHubApp'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('找不到 ContentHub 的挂载节点。')

const app = createRoot(root)

try {
  const api = createContentHubApi(__CONTENTHUB_ENV__)
  const router = createHashRouter([{ path: '*', element: <ContentHubApp api={api} /> }])
  app.render(<StrictMode><RouterProvider router={router} /></StrictMode>)
} catch (error) {
  app.render(
    <main className="startup-error" role="alert">
      <h1>ContentHub 配置错误</h1>
      <p>{error instanceof Error ? error.message : '配置读取失败。'}</p>
    </main>,
  )
}
