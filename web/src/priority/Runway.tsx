// Battery runway: hours left on one shared 0-6 h scale, so the list reads as a picture
// of who runs out first. The 4 h tick is rule R3's line ("under 4 hours left").
import type { Resident } from '../api'
import { callProgress } from '../lib/levels'
import { minutesLeft } from '../lib/runway'
import { clock, span } from '../lib/time'

const SCALE_MIN = 360
const TICKS = [120, 240]

/** What to say when there is no runs-out time to draw. */
function noDeadlineText(r: Resident): string {
  const progress = callProgress(r)
  if (progress) return progress === 'Ringing' ? 'Ringing' : 'On the call'
  if (r.status === 'NOT_CALLED') return r.missed_calls ? 'Calling again soon' : 'Not called yet'
  if (r.rule_id === 'NA') return 'No answer (2 tries)'
  return 'Hours unknown'
}

export function RunwayCell({ resident, now }: { resident: Resident; now: number }) {
  const left = minutesLeft(resident, now)
  if (left === null) {
    return <span className="rw-none">{noDeadlineText(resident)}</span>
  }
  const at = clock(resident.runs_out_at!)
  if (left <= 0) {
    return (
      <span className="rw-out">
        Ran out at <span className="num">{at}</span>
      </span>
    )
  }
  const pct = Math.min(1, left / SCALE_MIN) * 100
  return (
    <span className="rw">
      <span className="rw-track" aria-hidden="true">
        {/* Ticks sit under the bar and poke out above and below it. */}
        {TICKS.map((t) => (
          <span key={t} className={`rw-tick${t === 240 ? ' rw-tick--r3' : ''}`} style={{ left: `${(t / SCALE_MIN) * 100}%` }} />
        ))}
        <span className="rw-bar" style={{ width: `${pct}%` }} />
        {left > SCALE_MIN && <span className="rw-over">+</span>}
      </span>
      <span className="rw-text">
        <span className={`num${left < 120 ? ' rw-low' : ''}`}>{span(left)} left</span>
        <span className="rw-at num">Runs out {at}</span>
      </span>
    </span>
  )
}

export function RunwayScale() {
  return (
    <span className="rw-scale" aria-hidden="true">
      {[0, 120, 240, 360].map((t) => (
        <span key={t} className={`rw-scale-mark${t === 240 ? ' rw-scale-mark--r3' : ''}`} style={{ left: `${(t / SCALE_MIN) * 100}%` }}>
          {t === 0 ? '0' : `${t / 60} h`}
        </span>
      ))}
    </span>
  )
}
