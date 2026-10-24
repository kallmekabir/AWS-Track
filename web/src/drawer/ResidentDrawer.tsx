// W06: opens with the selection. The redacted transcript beside Bedrock's extracted
// JSON (with the fields the deciding rule read highlighted), the battery runway,
// every attempt, the decision log, and an override that requires a reason.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api, ApiError } from '../api/client'
import type { Attempt, AuditEntry, CheckIn, OutageMeta, PriorityRow, ResidentTimeline, Triage } from '../api/types'
import { usePoll } from '../api/usePoll'
import { triageToken } from '../map/colors'
import { clock, simMs, span } from '../lib/time'
import {
  fieldsForRule,
  GROUP_LABEL,
  KIND_LABEL,
  LANGUAGE_LABEL,
  RULE_TEXT,
  STATUS_LABEL,
  TASK_LABEL,
  TRIAGE_OPTIONS,
} from '../lib/triage'
import { minutesLeft } from '../lib/runway'
import { TriageChip } from '../ui/TriageChip'
import './ResidentDrawer.css'

interface Props {
  outage: OutageMeta
  row: PriorityRow
  simNow: number | null
  onClose: () => void
  onChanged: () => void
}

const SCALE_MIN = 360

export function ResidentDrawer({ outage, row, simNow, onClose, onChanged }: Props) {
  const rid = row.resident_id
  const ref = useRef<HTMLElement>(null)
  const timeline = usePoll((signal) => api.getTimeline(rid, outage.outage_id, { signal }), `timeline:${rid}`)
  const audit = usePoll((signal) => api.getAudit(outage.outage_id, { signal }), `audit:${outage.outage_id}`)
  const [picked, setPicked] = useState<number | null>(null)

  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])

  const attempts = timeline.data?.attempts ?? []
  const shown = attempts.find((a) => a.attempt === picked) ?? latestWithWords(attempts)
  const decided = [...attempts].reverse().find((a) => a.triage !== null) ?? null
  const entries = (audit.data?.items ?? []).filter((e) => e.resident_id === rid)
  const sim = (wallIso: string) => clock(simMs(outage, Date.parse(wallIso)))
  const resident = timeline.data?.resident

  const refresh = () => {
    timeline.refresh()
    audit.refresh()
    onChanged()
  }

  return (
    <aside className="drawer" ref={ref} tabIndex={-1} aria-labelledby="drawer-title">
      <header className={`dr-head dr-head--${triageToken(row.triage_group)}`}>
        <span className="dr-rank num" aria-label={`Rank ${row.rank}`}>
          {row.rank}
        </span>
        <div className="dr-who">
          <h2 id="drawer-title" className="dr-title">
            <span className="num">{rid}</span>
            <span className="dr-name">
              {resident ? `${resident.first_name} ${resident.last_name}` : row.first_name}
            </span>
          </h2>
          <p className="dr-sub">
            Tier {row.risk_tier}, {row.device_type.toLowerCase()}, {LANGUAGE_LABEL[row.language]}.{' '}
            {row.simulated ? 'Answered by the call simulator.' : 'Real phone, consenting teammate.'}
          </p>
        </div>
        <button className="dr-close" onClick={onClose} aria-label="Close resident details">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="dr-body">
        <section className="dr-decision">
          <TriageChip group={row.triage_group} rule={row.rule_id} />
          <p className="dr-rule">
            {row.rule_id
              ? (RULE_TEXT[row.rule_id] ?? row.rule_id)
              : row.triage_group === 'UNREACHED'
                ? 'No answer after two calls. A welfare check task is open.'
                : `${GROUP_LABEL[row.triage_group]}. The rules decide once the resident answers.`}
          </p>
        </section>

        <RunwaySection row={row} simNow={simNow} timeline={timeline.data} />

        <section className="dr-section">
          <h3 className="dr-h">Calls</h3>
          {attempts.length === 0 ? (
            <p className="dr-muted">Not called yet. Residents are called in order of medical risk.</p>
          ) : (
            <ol className="dr-attempts">
              {attempts.map((a) => (
                <li key={a.call_id}>
                  <button
                    className="dr-attempt"
                    aria-pressed={a.call_id === shown?.call_id}
                    onClick={() => setPicked(a.attempt)}
                  >
                    <span className="dr-attempt-no num">Call {a.attempt}</span>
                    <span className="dr-attempt-what">
                      {KIND_LABEL[a.kind]} at <span className="num">{sim(a.started_at)}</span>, {STATUS_LABEL[a.status].toLowerCase()}
                    </span>
                    {a.triage && <TriageChip group={a.triage} rule={a.rule_id} />}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        {shown && <Conversation attempt={shown} language={row.language} />}

        <section className="dr-section">
          <h3 className="dr-h">Decision log</h3>
          {entries.length === 0 ? (
            <p className="dr-muted">No decisions yet.</p>
          ) : (
            <ol className="dr-log">
              {entries.map((e) => (
                <li key={e.audit_sk} className={e.action === 'OVERRIDE' ? 'is-override' : undefined}>
                  <span className="dr-log-time num">{sim(e.audit_sk.split('#')[0])}</span>
                  <span className="dr-log-what">{describe(e)}</span>
                  {e.inputs_hash && <span className="dr-log-hash">inputs {e.inputs_hash.slice(0, 18)}</span>}
                </li>
              ))}
            </ol>
          )}
        </section>

        <Override attempt={decided} onDone={refresh} />
      </div>
    </aside>
  )
}

/** The latest call with words to show; otherwise the latest call. */
function latestWithWords(attempts: Attempt[]): Attempt | undefined {
  return [...attempts].reverse().find((a) => a.transcript_redacted.length > 0) ?? attempts.at(-1)
}

function describe(e: AuditEntry): ReactNode {
  const after = (e.after ?? {}) as Record<string, string | number | null>
  const before = (e.before ?? {}) as Record<string, string | null>
  const label = (t: unknown) => (typeof t === 'string' && t in GROUP_LABEL ? GROUP_LABEL[t as Triage] : String(t))
  switch (e.action) {
    case 'CALL_PLACED':
      return `Call ${after.attempt ?? ''} placed${after.kind ? `, ${KIND_LABEL[after.kind as keyof typeof KIND_LABEL].toLowerCase()}` : ''}`
    case 'TRIAGE_DECIDED':
      return (
        <>
          Rules set <strong>{label(after.triage)}</strong> with {e.rule_id}
        </>
      )
    case 'TASK_CREATED':
      return `Task created: ${TASK_LABEL[after.type as keyof typeof TASK_LABEL] ?? after.type}`
    case 'TASK_ACK':
      return `${e.actor} acknowledged a task`
    case 'TASK_DONE':
      return `${e.actor} marked a task done`
    case 'OVERRIDE':
      return (
        <>
          <strong>{e.actor}</strong> overrode {label(before.triage)} to <strong>{label(after.triage)}</strong>
          {e.reason && <span className="dr-log-reason">“{e.reason}”</span>}
        </>
      )
    default:
      return e.action.toLowerCase().replace(/_/g, ' ')
  }
}

function RunwaySection({ row, simNow, timeline }: { row: PriorityRow; simNow: number | null; timeline: ResidentTimeline | undefined }) {
  const left = minutesLeft(row, simNow)
  const next = timeline?.next_check_at_sim ?? null
  const toNext = next && simNow !== null ? (Date.parse(next) - simNow) / 60000 : null

  if (left === null) {
    return (
      <section className="dr-section dr-runway">
        <h3 className="dr-h">Battery runway</h3>
        <p className="dr-muted">
          No battery deadline.
          {next && toNext !== null && toNext > 0 && (
            <>
              {' '}
              Next call at <span className="num">{clock(next)}</span>, in {span(toNext)}.
            </>
          )}
        </p>
      </section>
    )
  }

  const pct = (m: number) => `${(Math.min(Math.max(m, 0), SCALE_MIN) / SCALE_MIN) * 100}%`
  return (
    <section className="dr-section dr-runway">
      <h3 className="dr-h">Battery runway</h3>
      <p className="dr-runway-head">
        <span className="dr-big num">{left > 0 ? span(left) : 'Ran out'}</span>
        <span>
          {left > 0 ? 'of battery left, runs out at ' : 'at '}
          <span className="num">{clock(row.battery_deadline_sim!)}</span> on the demo clock
        </span>
      </p>
      <div className="dr-track" aria-hidden="true">
        <span className="dr-bar" style={{ width: pct(left) }} />
        <span className="dr-r2" style={{ left: pct(240) }} />
        {toNext !== null && toNext > 0 && toNext < left && <span className="dr-next" style={{ left: pct(toNext) }} />}
      </div>
      <div className="dr-track-labels" aria-hidden="true">
        <span>Now</span>
        <span style={{ left: pct(240) }}>4h, rule R2</span>
        <span>6h</span>
      </div>
      <p className="dr-muted">
        {toNext !== null && toNext > 0 ? (
          <>
            Next call at <span className="num">{clock(next!)}</span>, in {span(toNext)}: halfway through the runway, so
            CareLine checks in before the battery runs out.
          </>
        ) : row.triage_group === 'URGENT' ? (
          'No recheck booked: urgent residents go to a person.'
        ) : (
          'No recheck booked yet.'
        )}
      </p>
    </section>
  )
}

const REDACTION_SPLIT = /(\[[A-Z_]+\])/
const REDACTION_TOKEN = /^\[[A-Z_]+\]$/

function Conversation({ attempt, language }: { attempt: Attempt; language: string }) {
  const live = attempt.status === 'ANSWERED' && attempt.triage === null
  const hits = new Set(fieldsForRule(attempt.rule_id, attempt.extracted))
  return (
    <section className="dr-section">
      <div className="dr-convo">
        <div>
          <h3 className="dr-h">
            What the resident said <span className="tag">redacted</span>
          </h3>
          {attempt.transcript_redacted.length === 0 ? (
            <p className="dr-muted">
              {attempt.status === 'RINGING' ? 'Ringing.' : 'No answer. Nothing was recorded.'}
            </p>
          ) : (
            <ol className="dr-turns">
              {attempt.transcript_redacted.map((t, i) => (
                <li key={i} className={`dr-turn dr-turn--${t.speaker}${i === 0 ? ' dr-turn--intro' : ''}`}>
                  <span className="dr-speaker">{t.speaker === 'careline' ? 'CareLine' : 'Resident'}</span>
                  <span className="dr-words" lang={language}>
                    {t.text.split(REDACTION_SPLIT).map((part, j) =>
                      REDACTION_TOKEN.test(part) ? (
                        <span key={j} className="dr-redacted">
                          {part.slice(1, -1).toLowerCase()}
                        </span>
                      ) : (
                        part
                      ),
                    )}
                  </span>
                </li>
              ))}
              {live && <li className="dr-muted">Call in progress</li>}
            </ol>
          )}
        </div>
        <div>
          <h3 className="dr-h">What Bedrock extracted</h3>
          {attempt.extracted ? (
            <>
              <JsonView value={attempt.extracted} hits={hits} />
              <p className="dr-muted dr-json-note">
                {hits.size > 0
                  ? `Rule ${attempt.rule_id} read the highlighted fields. Bedrock extracts; the rules decide.`
                  : 'Bedrock extracts; the rules decide.'}
              </p>
            </>
          ) : (
            <p className="dr-muted">{live ? 'Waiting for the call to finish.' : 'Nothing to extract.'}</p>
          )}
        </div>
      </div>
    </section>
  )
}

function JsonView({ value, hits }: { value: CheckIn; hits: Set<keyof CheckIn> }) {
  const keys = Object.keys(value) as Array<keyof CheckIn>
  return (
    <pre className="dr-json" aria-label="Extracted JSON">
      {'{\n'}
      {keys.map((k, i) => (
        <span key={k} className={hits.has(k) ? 'is-hit' : undefined}>
          {'  '}
          <span className="j-key">"{k}"</span>: <span className="j-val">{JSON.stringify(value[k]).replace(/","/g, '", "')}</span>
          {i < keys.length - 1 ? ',' : ''}
          {'\n'}
        </span>
      ))}
      {'}'}
    </pre>
  )
}

function Override({ attempt, onDone }: { attempt: Attempt | null; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<Triage | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Triage | null>(null)

  if (!attempt) {
    return (
      <section className="dr-section">
        <h3 className="dr-h">Override</h3>
        <p className="dr-muted">Nothing to override yet: this resident has no triage.</p>
      </section>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!choice || !reason.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.overrideCall(attempt.call_id, choice, reason.trim())
      setSaved(choice)
      setOpen(false)
      setReason('')
      setChoice(null)
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The override was not saved. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dr-section dr-override">
      <h3 className="dr-h">Override</h3>
      {saved && !open && (
        <p className="dr-saved" role="status">
          Triage overridden to {GROUP_LABEL[saved]}. The reason is in the decision log.
        </p>
      )}
      {!open ? (
        <button className="btn btn--quiet" onClick={() => setOpen(true)}>
          Override triage
        </button>
      ) : (
        <form onSubmit={submit}>
          <fieldset className="dr-choices">
            <legend className="dr-muted">New triage for call {attempt.attempt}</legend>
            {TRIAGE_OPTIONS.map((t) => (
              <label key={t} className={`dr-choice${t === attempt.triage ? ' is-current' : ''}`}>
                <input
                  type="radio"
                  name="triage"
                  value={t}
                  disabled={t === attempt.triage}
                  checked={choice === t}
                  onChange={() => setChoice(t)}
                />
                {GROUP_LABEL[t]}
                {t === attempt.triage && <span className="dr-muted"> (current)</span>}
              </label>
            ))}
          </fieldset>
          <label className="dr-reason-label" htmlFor="override-reason">
            Reason, required
          </label>
          <textarea
            id="override-reason"
            className="dr-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="For example: daughter confirmed by phone that the backup battery was replaced"
          />
          <p className="dr-muted">Saved to the audit log with your operator ID and the before and after triage. Tasks stay as they are.</p>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="dr-actions">
            <button className="btn" type="submit" disabled={busy || !choice || !reason.trim()}>
              {busy ? 'Overriding' : 'Override triage'}
            </button>
            <button className="btn btn--quiet" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
