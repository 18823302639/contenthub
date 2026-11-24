import { useCallback, useRef, useState } from 'react'
import { ApiHttpError, WebhookAuthError } from '../api'

type Flow = 'remotion' | 'legacy'
type Check = { sending: boolean; priorJobId?: string | null; jobId?: string }
type Checks = Partial<Record<string, Check>>
const storageKey = 'contenthub.render-submission-checks.v1'

function readChecks(): Checks {
  const restored: Checks = {}
  try {
    const data: unknown = JSON.parse(window.sessionStorage.getItem(storageKey) ?? '{}')
    if (!data || typeof data !== 'object') return restored
    for (const [key, value] of Object.entries(data)) {
      if (!/^(remotion|legacy):[1-9]\d*$/.test(key) || !value || typeof value !== 'object') continue
      const { priorJobId, jobId } = value as Partial<Check>
      if (priorJobId !== undefined && priorJobId !== null && typeof priorJobId !== 'string') continue
      restored[key] = { sending: false, priorJobId, jobId: typeof jobId === 'string' ? jobId : undefined }
    }
  } catch { /* Routing is still protected when browser storage is disabled. */ }
  return restored
}

export function isDefiniteRenderRejection(error: unknown): boolean {
  if (error instanceof WebhookAuthError) return true
  const http = error instanceof ApiHttpError ? error : error instanceof Error ? error.cause : null
  return http instanceof ApiHttpError && [400, 401, 403, 404, 405, 422].includes(http.status)
}

export function useRenderSubmissionChecks(persist: boolean) {
  const [checks, setChecks] = useState<Checks>(() => persist ? readChecks() : {})
  const current = useRef(checks)

  const write = useCallback((key: string, check?: Check) => {
    const next = { ...current.current }
    if (check) next[key] = check
    else delete next[key]
    current.current = next
    setChecks(next)
    if (persist) {
      try { window.sessionStorage.setItem(storageKey, JSON.stringify(next)) }
      catch { /* The in-memory check still applies. */ }
    }
  }, [persist])

  const get = useCallback((flow: Flow, id: number) => current.current[flow + ':' + id], [])

  const begin = useCallback((flow: Flow, id: number, priorJobId?: string | null) => {
    const key = flow + ':' + id
    if (current.current[key]) return null
    const sending = { sending: true, priorJobId }
    write(key, sending)
    return (uncertain: boolean) => {
      if (current.current[key] === sending) write(key, uncertain ? { ...sending, sending: false } : undefined)
    }
  }, [write])

  const observe = useCallback((id: number, jobId: string | null | undefined, terminal: boolean) => {
    const key = 'remotion:' + id
    const check = current.current[key]
    if (!check || check.sending || check.priorJobId === undefined || !jobId || jobId === check.priorJobId) return false
    if (!check.jobId) {
      if (terminal) return false
      write(key, { ...check, jobId })
    } else {
      if (check.jobId !== jobId) return false
      if (terminal) write(key)
    }
    return true
  }, [write])

  return { checks, get, begin, observe }
}

export type RenderSubmissionChecks = ReturnType<typeof useRenderSubmissionChecks>
