import { useCallback, useRef, useState } from 'react'

export interface RecordWrites {
  lockedIds: ReadonlySet<number>
  acquire: (id: number) => (() => void) | null
}

export function useRecordWrites(): RecordWrites {
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

  return { lockedIds, acquire }
}
