// W07 (call log): every call, newest first. It is a log only: rows never select a
// resident or draw a route (map spec section 8.3).
import { useEffect, useRef, useState } from 'react'
import type { CallRow, OutageMeta } from '../api/types'
import { clock, simMs } from '../lib/time'
import { KIND_LABEL, STATUS_LABEL } from '../lib/triage'
import { TriageChip } from '../ui/TriageChip'
import './CallFeed.css'

const SHOWN = 60

const keyOf = (c: CallRow) => `${c.call_id}|${c.status}|${c.triage ?? ''}`

export function CallFeed({ outage, calls }: { outage: OutageMeta | null; calls: CallRow[] | null }) {
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())

  // A call that is new, or whose status changed, highlights once.
  useEffect(() => {
    if (!calls) return
    const keys = new Set(calls.map(keyOf))
    const before = seen.current
    seen.current = keys
    if (!before) return
    const added = new Set(calls.filter((c) => !before.has(keyOf(c))).map((c) => c.call_id))
    if (!added.size) return
    setFresh(added)
    const t = setTimeout(() => setFresh(new Set()), 1500)
    return () => clearTimeout(t)
  }, [calls])

  return (
    <section className="panel feed" aria-labelledby="feed-title">
      <div className="panel-head">
        <h2 className="panel-title" id="feed-title">
          Call log
        </h2>
        <p className="panel-meta">Every call, newest first. Times are on the demo clock.</p>
      </div>
      {!outage ? (
        <p className="empty">Calls are logged here once an outage starts.</p>
      ) : !calls ? (
        <p className="empty">Loading calls</p>
      ) : calls.length === 0 ? (
        <p className="empty">The first calls go out a few seconds after the outage starts.</p>
      ) : (
        <div className="feed-scroll">
          <table className="ftable">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Resident</th>
                <th scope="col">Call</th>
                <th scope="col">Language</th>
                <th scope="col">Status</th>
                <th scope="col">Triage</th>
              </tr>
            </thead>
            <tbody>
              {calls.slice(0, SHOWN).map((c) => (
                <tr key={c.call_id} className={fresh.has(c.call_id) ? 'is-fresh' : undefined}>
                  <td className="num">{clock(simMs(outage, Date.parse(c.started_at)))}</td>
                  <td>
                    <span className="f-id num">{c.resident_id}</span>
                    {c.simulated && <span className="tag">sim</span>}
                  </td>
                  <td>
                    {KIND_LABEL[c.kind]} <span className="f-muted num">#{c.attempt}</span>
                  </td>
                  <td>{c.language.toUpperCase()}</td>
                  <td>
                    <span className={`f-status f-status--${c.status.toLowerCase()}`}>{STATUS_LABEL[c.status]}</span>
                  </td>
                  <td>{c.triage ? <TriageChip group={c.triage} rule={c.rule_id} /> : <span className="f-muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
