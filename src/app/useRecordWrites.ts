import { useCallback, useRef, useState } from 'react'
import { useRenderSubmissionChecks } from './renderSubmissionChecks'
import type { RenderSubmissionChecks } from './renderSubmissionChecks'

export interface RecordWrites {
  lockedIds: ReadonlySet<number>
  renderChecks: RenderSubmissionChecks
  acquire: (id: number) => (() => void) | null
}

export function useRecordWrites(persistRenderChecks: boolean): RecordWrites {
  const renderChecks = useRenderSubmissionChecks(persistRenderChecks)
  const locked = useRef(new Set<number>())
  const [lockedIds, setLockedIds] = useState<ReadonlySet<number>>(new Set())

  const acquire = useCallback((id: number) => {
    if (locked.current.has(id)) return null
    locked.current.add(id)
    setLockedIds(new Set(locked.current))

    return () => {
      locked.current.delete(id)
      setLockedIds(new Set(locked.current))
    }
  }, [])

  return { lockedIds, acquire, renderChecks }
}
