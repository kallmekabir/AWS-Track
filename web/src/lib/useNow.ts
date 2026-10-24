import { useEffect, useState } from 'react'

/** Wall-clock milliseconds, refreshed every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/**
 * The demo clock, ticking locally between polls. It is anchored to the server's
 * `sim_now` so client clock skew is not multiplied by the time scale.
 */
export function useSimNow(simNowIso: string | undefined, receivedAt: number | undefined, timeScale: number, running: boolean): number | null {
  const now = useNow(1000)
  if (!simNowIso || receivedAt === undefined) return null
  const base = Date.parse(simNowIso)
  return running ? base + (now - receivedAt) * timeScale : base
}
