// Zone, the time now, the counts, and the one Start outage button. The header turns
// ink once calls have started: the room is in incident mode.
import { useState } from 'react'
import { startOutage, type Resident, type Status } from '../api'
import { config, ZONE } from '../config'
import { clock } from '../lib/time'
import { useNow } from '../lib/useNow'
import { Glyph } from '../ui/Glyph'
import './Header.css'

interface Props {
  rows: Resident[]
  loadError: Error | null
  mapUnavailable: boolean
  message: string | null
  onMessage: (message: string | null) => void
  onStarted: () => void
}

export function Header({ rows, loadError, mapUnavailable, message, onMessage, onStarted }: Props) {
  const now = useNow(1000)
  const [starting, setStarting] = useState(false)
  const active = rows.some((r) => r.status !== 'NOT_CALLED' || r.missed_calls > 0)
  const count = (status: Status) => rows.filter((r) => r.status === status).length
  const [time, meridiem] = clock(now).split(' ')

  async function onStartOutage() {
    setStarting(true)
    onMessage(null)
    try {
      const result = await startOutage(ZONE)
      const n = result.calling.length
      const parts = [n ? `Calling ${n} ${n === 1 ? 'person' : 'people'} now.` : 'Nobody could be called.']
      if (result.waiting.length) parts.push(`${result.waiting.length} more waiting for a free line.`)
      if (result.errors.length) parts.push(`${result.errors.length} call(s) failed to start.`)
      onMessage(parts.join(' '))
      onStarted()
    } catch (e) {
      onMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  return (
    <header className={`hdr${active ? ' hdr--active' : ''}`}>
      <div className="brand">
        <span className="brand-name">CareCall</span>
        <span className="brand-org">County Public Health</span>
      </div>

      <div className="hdr-outage">
        <h1 className="hdr-outage-name">{active ? `Outage in Zone ${ZONE}` : `Zone ${ZONE}`}</h1>
        <p className="hdr-outage-meta" role="status" aria-live="polite">
          {loadError
            ? `Can't reach the CareCall API: ${loadError.message}`
            : (message ?? (active ? 'Calling 4 people at a time, highest risk first.' : 'Start outage calls everyone in the zone, 4 at a time.'))}
        </p>
      </div>

      <div className="hdr-clock">
        <span className="hdr-clock-label">Now</span>
        <span className="hdr-clock-time num">{time}</span>
        <span className="hdr-clock-meridiem">{meridiem}</span>
      </div>

      <dl className="hdr-counts">
        <div>
          <dt>Calling now</dt>
          <dd className="num">{count('CALLING')}</dd>
        </div>
        <div>
          <dt>
            <Glyph status="HELP_NOW" /> Help now
          </dt>
          <dd className="num">{count('HELP_NOW')}</dd>
        </div>
        <div>
          <dt>
            <Glyph status="HELP_SOON" /> Help soon
          </dt>
          <dd className="num">{count('HELP_SOON')}</dd>
        </div>
        <div>
          <dt>
            <Glyph status="PERSON_CHECK" /> To check
          </dt>
          <dd className="num">{count('PERSON_CHECK')}</dd>
        </div>
        <div>
          <dt>Not called yet</dt>
          <dd className="num">{count('NOT_CALLED')}</dd>
        </div>
      </dl>

      <div className="hdr-flags">
        {config.useMocks && <span className="hdr-flag">Mock data</span>}
        {mapUnavailable && <span className="hdr-flag hdr-flag--warn">Map unavailable</span>}
        <button className={`btn btn--start${active ? ' btn--light' : ''}`} onClick={onStartOutage} disabled={starting}>
          {starting ? 'Starting…' : 'Start outage'}
        </button>
      </div>
    </header>
  )
}
