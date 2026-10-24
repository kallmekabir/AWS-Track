// One person's details (CLAUDE.md section 3): their level and the rule behind it,
// how long their backup lasts, what they said on the call, and Call again. It reads
// the same /queue poll as the list, so it updates while a call is going.
import { useEffect, useRef } from 'react'
import type { Hospital, Resident } from '../api'
import { levelToken } from '../map/colors'
import { callProgress, canCallAgain, DEVICE_GROUP_TEXT, deviceLine, NEED_TEXT, RULE_TEXT, yesNoText } from '../lib/levels'
import { minutesLeft } from '../lib/runway'
import { clock, span } from '../lib/time'
import { LevelChip } from '../ui/LevelChip'
import './ResidentDrawer.css'

interface Props {
  resident: Resident
  hospitals: Hospital[]
  place: number
  now: number
  onClose: () => void
  onCallAgain: (r: Resident) => void
}

const SCALE_MIN = 360

export function ResidentDrawer({ resident: r, hospitals, place, now, onClose, onCallAgain }: Props) {
  const ref = useRef<HTMLElement>(null)
  const progress = callProgress(r)

  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])

  return (
    <aside className="drawer" ref={ref} tabIndex={-1} aria-labelledby="drawer-title">
      <header className={`dr-head dr-head--${levelToken(r.status)}`}>
        <span className="dr-rank num" aria-label={`Place ${place} in line`}>
          {place}
        </span>
        <div className="dr-who">
          <h2 id="drawer-title" className="dr-title">
            {r.name}
          </h2>
          <p className="dr-sub" title={DEVICE_GROUP_TEXT[r.device_group]}>
            {deviceLine(r)}
          </p>
          <p className="dr-sub">
            {r.address}, <span className="num">{r.phone}</span>
          </p>
        </div>
        <button className="dr-close" onClick={onClose} aria-label="Close details">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="dr-body">
        <section className="dr-decision">
          <LevelChip status={r.status} rule={r.rule_id} />
          <p className="dr-rule">{progress ?? r.reason ?? 'Waiting for a call.'}</p>
          {r.rule_id && RULE_TEXT[r.rule_id] && (
            <p className="dr-muted">
              Rule {r.rule_id}: {RULE_TEXT[r.rule_id]}.
            </p>
          )}
        </section>

        <Backup resident={r} hospitals={hospitals} now={now} />

        <section className="dr-section">
          <h3 className="dr-h">What they said</h3>
          {r.transcript.length === 0 ? (
            <p className="dr-muted">{progress ? `${progress}. Answers appear here as they come in.` : 'No answers yet.'}</p>
          ) : (
            <ol className="dr-answers">
              {r.transcript.map((a) => (
                <li key={a.q} className="dr-answer">
                  <span className="dr-q">
                    <span className="num">{a.q}.</span> {a.question}
                  </span>
                  <span className="dr-a">“{a.answer}”</span>
                </li>
              ))}
              {progress && r.current_question > r.transcript.length && (
                <li className="dr-muted">Question {r.current_question} of 5 is being asked now.</li>
              )}
            </ol>
          )}
        </section>

        <section className="dr-section">
          <h3 className="dr-h">Bedrock's facts</h3>
          <BedrockFacts resident={r} />
        </section>

        <section className="dr-section">
          <h3 className="dr-h">Calls</h3>
          <dl className="dr-facts">
            <div>
              <dt>Last call started</dt>
              <dd className="num">{r.call_started_at ? clock(r.call_started_at) : 'Not called yet'}</dd>
            </div>
            <div>
              <dt>Missed calls</dt>
              <dd className="num">{r.missed_calls}</dd>
            </div>
          </dl>
          {r.last_error && <p className="dr-error">Last error: {r.last_error}</p>}
          {canCallAgain(r) && (
            <button className="btn btn--quiet dr-call" onClick={() => onCallAgain(r)}>
              Call again
            </button>
          )}
        </section>
      </div>
    </aside>
  )
}

function Backup({ resident: r, hospitals, now }: { resident: Resident; hospitals: Hospital[]; now: number }) {
  const left = minutesLeft(r, now)
  const pct = (m: number) => `${(Math.min(Math.max(m, 0), SCALE_MIN) / SCALE_MIN) * 100}%`
  return (
    <section className="dr-section">
      <h3 className="dr-h">Backup left</h3>
      {left === null ? (
        <p className="dr-muted">{r.hours_left === null ? 'Hours left unknown until they answer.' : `${r.hours_left} h left.`}</p>
      ) : (
        <>
          <p className="dr-runway-head">
            <span className="dr-big num">{left > 0 ? span(left) : 'Ran out'}</span>
            <span>
              {left > 0 ? 'left. Runs out at ' : 'at '}
              <span className="num">{clock(r.runs_out_at!)}</span>
            </span>
          </p>
          <div className="dr-track" aria-hidden="true">
            <span className="dr-bar" style={{ width: pct(left) }} />
            <span className="dr-r3" style={{ left: pct(240) }} />
          </div>
          <div className="dr-track-labels" aria-hidden="true">
            <span>Now</span>
            <span style={{ left: pct(240) }}>4 h, rule R3</span>
            <span>6 h</span>
          </div>
        </>
      )}
      <dl className="dr-facts">
        <div>
          <dt>Hours they said</dt>
          <dd className="num">{r.hours_left === null ? 'unknown' : `${r.hours_left} h`}</dd>
        </div>
        <div>
          <dt>Drive from nearest hospital</dt>
          <dd className="num">{r.drive_minutes === null ? 'unknown' : `${Math.round(r.drive_minutes)} min`}</dd>
        </div>
        {r.nearest_hospital_id && (
          <div>
            <dt>Hospital</dt>
            <dd>{hospitals.find((h) => h.id === r.nearest_hospital_id)?.name ?? r.nearest_hospital_id}</dd>
          </div>
        )}
        {r.location_updated_at && (
          <div><dt>Drive calculated</dt><dd>{clock(r.location_updated_at)}</dd></div>
        )}
      </dl>
    </section>
  )
}


// Bedrock's facts: plain-word rows, how the model did, and the rule that ranked it.
// Shows nothing (not an error) when facts is missing: not called yet, or a missed call.
function BedrockFacts({ resident: r }: { resident: Resident }) {
  const f = r.facts
  if (!f) {
    return <p className="dr-muted">No facts yet. Bedrock reads the answers when a call is ranked.</p>
  }
  const needs = f.needs.filter((n) => n !== 'none')
  const spareMin = r.time_to_spare == null ? null : Math.round(r.time_to_spare * 60)
  return (
    <>
      <dl className="dr-facts">
        <div>
          <dt>Safe</dt>
          <dd>{yesNoText(f.safe)}</dd>
        </div>
        <div>
          <dt>Device working</dt>
          <dd>{yesNoText(f.device_working)}</dd>
        </div>
        <div>
          <dt>Backups left</dt>
          <dd className="num">{f.backup_left === null ? 'not sure' : f.backup_left}</dd>
        </div>
        <div>
          <dt>Hours left</dt>
          <dd className="num">{f.hours_left === null ? 'not sure' : `${f.hours_left} h`}</dd>
        </div>
        <div>
          <dt>Needs</dt>
          <dd>{needs.length ? needs.map((n) => NEED_TEXT[n] ?? n).join(', ') : 'nothing'}</dd>
        </div>
        <div>
          <dt>Emergency</dt>
          <dd>{f.emergency ? 'yes' : 'no'}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd className="num">{Math.round(f.confidence * 100)}%</dd>
        </div>
      </dl>

      {r.ai && !r.ai.ok ? (
        <div className="dr-error">
          <p>Bedrock could not read this call. A person must check.</p>
          {r.ai.problems.length > 0 && (
            <ul className="dr-problems">
              {r.ai.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        r.ai && (
          <p className="dr-muted">
            Read by <span className="num">{r.ai.model_id}</span> in <span className="num">{r.ai.latency_ms}</span> ms.
          </p>
        )
      )}

      {r.rule_id && (
        <p className="dr-ranked">
          Ranked by rule <span className="num">{r.rule_id}</span> · {r.reason}
        </p>
      )}
      {spareMin !== null && (
        <p className="dr-muted">
          <span className="num">{spareMin}</span> min to spare.
        </p>
      )}
    </>
  )
}
