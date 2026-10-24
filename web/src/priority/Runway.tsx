// Battery runway: hours of battery left on one shared 0-6 h scale, so the list reads as
// a picture of who runs out first. The 4 h tick is rule R2's threshold; 2 h is where
// the runway planner books transport or charging straight away.
import type { PriorityRow } from '../api/types'
import { minutesLeft } from '../lib/runway'
import { clock, span } from '../lib/time'

const SCALE_MIN = 360
const TICKS = [120, 240]

/** What to say when there is no battery deadline to draw. */
function noDeadlineText(row: PriorityRow): string {
  if (row.triage_group === 'UNREACHED') return 'No answer twice'
  if (row.triage_group === 'PENDING') {
    if (row.last_call_status === 'RINGING') return 'Calling now'
    if (row.last_call_status === 'ANSWERED') return 'On the call'
    if (row.last_call_status === 'NO_ANSWER') return 'No answer, retry booked'
    return 'Not called yet'
  }
  if (row.rule_id === 'R0') return 'Transferred to a responder'
  if (row.rule_id === 'R1') return 'Device off'
  if (row.rule_id === 'R2') return 'Battery unknown'
  return 'Not on battery'
}

export function RunwayCell({ row, simNow }: { row: PriorityRow; simNow: number | null }) {
  const left = minutesLeft(row, simNow)
  if (left === null) {
    return <span className="rw-none">{noDeadlineText(row)}</span>
  }
  const deadline = clock(row.battery_deadline_sim!)
  if (left <= 0) {
    return (
      <span className="rw-out">
        Ran out at <span className="num">{deadline}</span>
      </span>
    )
  }
  const pct = Math.min(1, left / SCALE_MIN) * 100
  return (
    <span className="rw">
      <span className="rw-track" aria-hidden="true">
        {/* Ticks sit under the bar and poke out above and below it. */}
        {TICKS.map((t) => (
          <span key={t} className={`rw-tick${t === 240 ? ' rw-tick--r2' : ''}`} style={{ left: `${(t / SCALE_MIN) * 100}%` }} />
        ))}
        <span className="rw-bar" style={{ width: `${pct}%` }} />
        {left > SCALE_MIN && <span className="rw-over">+</span>}
      </span>
      <span className="rw-text">
        <span className={`num${left < 120 ? ' rw-low' : ''}`}>{span(left)} left</span>
        <span className="rw-at num">{deadline}</span>
      </span>
    </span>
  )
}

export function RunwayScale() {
  return (
    <span className="rw-scale" aria-hidden="true">
      {[0, 120, 240, 360].map((t) => (
        <span key={t} className={`rw-scale-mark${t === 240 ? ' rw-scale-mark--r2' : ''}`} style={{ left: `${(t / SCALE_MIN) * 100}%` }}>
          {t === 0 ? '0' : `${t / 60}h`}
        </span>
      ))}
    </span>
  )
}
