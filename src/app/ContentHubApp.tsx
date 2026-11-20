import { ArrowLeft, ChartNoAxesCombined, ChevronRight, Layers3, LayoutGrid, Rss, SquarePen } from 'lucide-react'
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import type { ContentHubApi } from '../api'
import { SourcesPage } from '../features/sources/SourcesPage'
import { useSources } from '../features/sources/useSources'
import { TopicsPage } from '../features/topics/TopicsPage'
import { useRecordWrites } from './useRecordWrites'
import { WorkbenchPage } from '../features/workbench/WorkbenchPage'
import { useTopicBoard } from '../features/topics/useTopicBoard'

const links = [
  { to: '/topics', label: '选题看板', icon: LayoutGrid },
  { to: '/workbench', label: '改稿台', icon: SquarePen },
  { to: '/sources', label: '信源管理', icon: Rss },
  { to: '/analytics', label: '运营数据', icon: ChartNoAxesCombined },
]

function Placeholder({ title, text, phase }: { title: string; text: string; phase?: number }) {
  return (
    <section className="placeholder" aria-labelledby="placeholder-title">
      <h1 id="placeholder-title">{title}</h1>
      {phase && <p className="placeholder-phase">阶段 {phase} 开放</p>}
      <p>{text}</p>
      <Link className="button button--secondary" to="/topics"><ArrowLeft size={15} aria-hidden />返回选题看板</Link>
    </section>
  )
}

export function ContentHubApp({ api }: { api: ContentHubApi }) {
  const writes = useRecordWrites()
  const board = useTopicBoard(api, writes)
  const sources = useSources(api)
  const { pathname } = useLocation()
  const active = links.find(link => pathname === link.to || pathname.startsWith(link.to + '/'))
  const mode = api.mode === 'mock' ? 'Mock · 离线演示' : '真实数据模式'

  return (
    <div className="workspace">
      <a className="skip-link" href="#content-start" onClick={event => {
        event.preventDefault()
        document.getElementById('content-start')?.focus()
      }}>跳到主内容</a>
      <aside className="workspace-sidebar">
        <Link className="workspace-brand" to="/topics" aria-label="ContentHub">
          <span className="brand-mark"><Layers3 size={18} strokeWidth={2.15} aria-hidden /></span>
          <span className="brand-label">
            <strong>ContentHub</strong>
            <span>内容工作区</span>
          </span>
        </Link>
        <nav className="workspace-nav" aria-label="主导航">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} title={label} className={({ isActive }) => isActive ? 'nav-link nav-link--active' : 'nav-link'}>
              <Icon size={17} strokeWidth={1.9} aria-hidden /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="workspace-mode" title={mode}>
          <span className={api.mode === 'mock' ? 'mode-dot' : 'mode-dot mode-dot--real'} aria-hidden />
          <span>{mode}</span>
        </div>
      </aside>

      <div className="workspace-body">
        <header className="workspace-bar">
          <span>工作区</span>
          <ChevronRight size={14} aria-hidden />
          <strong>{active?.label ?? (pathname === '/' ? '选题看板' : '页面不存在')}</strong>
        </header>
        <main className="workspace-content" id="content-start" tabIndex={-1}>
          <Routes>
            <Route index element={<Navigate to="/topics" replace />} />
            <Route path="/topics" element={<TopicsPage board={board} />} />
            <Route path="/workbench" element={<Placeholder title="改稿台" text="从选题看板选择一条选题进入改稿台。" />} />
            <Route path="/workbench/:id" element={<WorkbenchPage api={api} writes={writes} onWrite={board.observeWorkbenchWrite} refreshBoard={board.refreshIfLoaded} />} />
            <Route path="/sources" element={<SourcesPage model={sources} />} />
            <Route path="/analytics" element={<Placeholder title="运营数据" text="在这里查看账号指标和雷达机会。" phase={5} />} />
            <Route path="*" element={<Placeholder title="页面不存在" text="请通过左侧导航打开工作区页面。" />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
