import { createContext, useCallback, useContext, useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom'

const registration = createContext<(id: string, dirty: boolean) => void>(() => {})

export const leaveEditorMessage = '尚有未保存的修改，确定离开当前稿件吗？'

export function useUnsavedChanges(dirty: boolean) {
  const register = useContext(registration)
  const id = useId()
  useEffect(() => {
    if (!dirty) return
    register(id, true)
    return () => register(id, false)
  }, [register, dirty, id])
}

function RouteGuard({ dirty }: { dirty: boolean }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && (
    currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search
  ))
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm(leaveEditorMessage)) blocker.proceed()
    else blocker.reset()
  }, [blocker])
  return null
}

export function UnsavedChanges({ children }: { children: ReactNode }) {
  const [editors, setEditors] = useState<string[]>([])
  const dataRouter = useContext(UNSAFE_DataRouterContext)
  const dirty = editors.length > 0
  const register = useCallback((id: string, dirty: boolean) => {
    setEditors(current => dirty ? [...current.filter(key => key !== id), id] : current.filter(key => key !== id))
  }, [])

  useEffect(() => {
    if (!dirty) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = true
    }
    function guardLink(event: MouseEvent) {
      if (dataRouter || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#/"]') : null
      if (link && link.hash !== window.location.hash && !window.confirm(leaveEditorMessage)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', guardLink, true)
    return () => {
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('click', guardLink, true)
    }
  }, [dirty, dataRouter])

  return <registration.Provider value={register}>
    {dataRouter && <RouteGuard dirty={dirty} />}
    {children}
  </registration.Provider>
}
