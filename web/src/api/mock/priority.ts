// Mock-server copy of careline_shared.priority.priority_key (map spec section 6.4),
// so mock rows arrive ranked the way the real API ranks them. The dashboard itself
// never sorts: it shows rows in the order the API returns.
import type { PriorityRow, TriageGroup } from '../types'

const GROUP_ORDER: Record<TriageGroup, number> = {
  URGENT: 0,
  HUMAN_REVIEW: 1,
  UNREACHED: 2,
  NEEDS_HELP: 3,
  PENDING: 4,
  SAFE: 5,
}

const TIE_WINDOW_MIN = 30

type Unranked = Omit<PriorityRow, 'rank'>

export function priorityKey(row: Unranked): Array<number | string> {
  const minutes = row.minutes_to_battery_deadline
  // Unknown deadline sorts first: it is treated as soonest, matching R2.
  const bucket = minutes === null ? -1 : Math.floor(minutes / TIE_WINDOW_MIN)
  // Longer drive first; unknown drive time is treated as farthest.
  const drive = row.hospital_access?.drive_minutes ?? Number.POSITIVE_INFINITY
  return [
    GROUP_ORDER[row.triage_group],
    row.risk_tier,
    bucket,
    -drive,
    minutes ?? Number.NEGATIVE_INFINITY,
    row.resident_id,
  ]
}

function compareKeys(a: Array<number | string>, b: Array<number | string>): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue
    return a[i] < b[i] ? -1 : 1
  }
  return 0
}

export function rankRows(rows: Unranked[]): PriorityRow[] {
  return rows
    .map((row) => ({ row, key: priorityKey(row) }))
    .sort((x, y) => compareKeys(x.key, y.key))
    .map(({ row }, i) => ({ ...row, rank: i + 1 }))
}

/** True when two rows only differ by drive time in the sort (the tie-break the copilot explains). */
export function driveTieBreak(a: Unranked, b: Unranked): boolean {
  const ka = priorityKey(a)
  const kb = priorityKey(b)
  return ka[0] === kb[0] && ka[1] === kb[1] && ka[2] === kb[2] && ka[3] !== kb[3]
}
