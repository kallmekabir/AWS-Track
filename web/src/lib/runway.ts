import type { PriorityRow } from '../api/types'

/** Battery minutes left on the demo clock, ticking locally between polls. */
export function minutesLeft(row: PriorityRow, simNow: number | null): number | null {
  if (row.battery_deadline_sim === null) return null
  if (simNow === null) return row.minutes_to_battery_deadline
  return (Date.parse(row.battery_deadline_sim) - simNow) / 60000
}
