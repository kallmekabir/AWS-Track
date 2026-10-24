import type { Resident } from '../api'

/** Minutes until the person's backup runs out, ticking locally between polls. */
export function minutesLeft(r: Resident, now: number): number | null {
  if (!r.runs_out_at) return null
  return (Date.parse(r.runs_out_at) - now) / 60000
}
