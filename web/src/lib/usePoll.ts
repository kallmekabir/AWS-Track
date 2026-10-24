import { useCallback, useEffect, useRef, useState } from 'react'
import { config } from '../config'

export interface PollState<T> {
  data: T | undefined
  error: Error | undefined
  lastUpdated: number | undefined
  /** Fetch now, outside the interval (after a write, for example). */
  refresh: () => void
}

/**
 * Polls `fetcher` every 3 s while `enabled`, pausing while the tab is hidden.
 * Keeps the last good data on error so panels never flash empty between polls.
 */
export function usePoll<T>(
  fetcher: ((signal: AbortSignal) => Promise<T>) | null,
  key: string,
  intervalMs = config.pollMs,
): PollState<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<Error>()
  const [lastUpdated, setLastUpdated] = useState<number>()
  const [tick, setTick] = useState(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const enabled = fetcher !== null

  // A new key means a different resource: drop what we had.
  useEffect(() => {
    setData(undefined)
    setError(undefined)
    setLastUpdated(undefined)
  }, [key])

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    let stopped = false

    const run = async () => {
      const fn = fetcherRef.current
      if (stopped || !fn) return
      if (document.hidden) {
        timer = setTimeout(run, intervalMs)
        return
      }
      controller = new AbortController()
      try {
        const next = await fn(controller.signal)
        if (stopped) return
        setData(next)
        setError(undefined)
        setLastUpdated(Date.now())
      } catch (err) {
        if (stopped || (err as Error).name === 'AbortError') return
        setError(err as Error)
      }
      if (!stopped) timer = setTimeout(run, intervalMs)
    }

    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer)
        run()
      }
    }

    run()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [key, intervalMs, tick, enabled])

  const refresh = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, lastUpdated, refresh }
}
