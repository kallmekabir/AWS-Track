import { TIME_ZONE } from '../config'

const hm = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: TIME_ZONE,
})

/** "6:15 PM" in San Jose time. */
export function clock(t: string | number | Date): string {
  return hm.format(new Date(t))
}

/** "2 h 41 min", "41 min", or "under 1 min". Negative input reads as zero. */
export function span(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 1) return 'under 1 min'
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r} min`
  return r === 0 ? `${h} h` : `${h} h ${r} min`
}
