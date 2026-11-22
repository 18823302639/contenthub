import type { ContentHubApi } from './contracts'

export const aiProcessingLabel = 'AI 处理中，约需 40–60 秒…'

export async function pollWorkflow<T>(
  mode: ContentHubApi['mode'],
  active: () => boolean,
  read: () => Promise<T>,
  observe: (value: T) => boolean,
  started = Date.now(),
): Promise<boolean> {
  const interval = mode === 'mock' ? 420 : 4_000
  const duration = mode === 'mock' ? 4_200 : 90_000
  const deadline = started + duration
  const now = Date.now()
  if (now >= deadline || !active()) return false
  const firstRead = started + (Math.floor((now - started) / interval) + 1) * interval
  const timedOut = Symbol()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof timedOut>(resolve => {
    timer = setTimeout(() => resolve(timedOut), deadline - now)
  })

  try {
    for (let next = firstRead; active(); next = Math.max(next + interval, Date.now())) {
      const wait = Math.min(next, deadline) - Date.now()
      if (wait > 0) await new Promise<void>(resolve => setTimeout(resolve, wait))
      if (!active() || Date.now() >= deadline) return false

      const result = await Promise.race([read().then(value => ({ value })), timeout])
      if (result === timedOut || !active() || Date.now() >= deadline) return false
      if (observe(result.value)) return true
    }
    return false
  } finally {
    clearTimeout(timer)
  }
}
