import { TIME_ZONE } from '../config'
import type { OutageMeta } from '../api/types'

const hm = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: TIME_ZONE,
})

/** "18:42" in San Jose time. */
export function clock(t: string | number | Date): string {
  return hm.format(new Date(t))
}

/** "2h 41m", "41m", or "under 1m". Negative input reads as zero. */
export function span(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 1) return 'under 1m'
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r}m`
  return r === 0 ? `${h}h` : `${h}h ${r}m`
}

/** Demo-clock time for a wall-clock instant: the sim clock runs time_scale times faster from the outage start. */
export function simMs(outage: Pick<OutageMeta, 'started_at' | 'time_scale'>, wallMs: number): number {
  const start = Date.parse(outage.started_at)
  return start + (wallMs - start) * outage.time_scale
}
