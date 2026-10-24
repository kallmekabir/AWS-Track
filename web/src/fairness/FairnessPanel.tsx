// W09 (Should): contact rate and time to first contact by language, the eval's
// missed-urgent rate, and a fixed card on what CareLine stores and never stores.
import { api } from '../api/client'
import type { CallRow, Language, OutageMeta } from '../api/types'
import { usePoll } from '../api/usePoll'
import { clock } from '../lib/time'
import { LANGUAGE_LABEL } from '../lib/triage'
import './FairnessPanel.css'

const LANGS: Language[] = ['en', 'es', 'hi']

export function FairnessPanel({ outage, calls }: { outage: OutageMeta | null; calls: CallRow[] | null }) {
  const id = outage?.outage_id
  const metrics = usePoll(id ? (signal) => api.getFairness(id, { signal }) : null, `fairness:${id}`, 10000)
  const firstEnded = (calls ?? [])
    .map((c) => c.ended_at)
    .filter((t): t is string => !!t)
    .sort()[0]

  return (
    <section className="panel fair" aria-labelledby="fair-title">
      <div className="panel-head">
        <h2 className="panel-title" id="fair-title">
          Fairness and privacy
        </h2>
      </div>

      <div className="fair-body">
        <h3 className="fair-h">Reach by language</h3>
        {!outage ? (
          <p className="fair-muted">Compared once an outage starts.</p>
        ) : !metrics.data ? (
          <p className="fair-muted">Loading</p>
        ) : (
          <table className="fair-table">
            <thead>
              <tr>
                <th scope="col">Language</th>
                <th scope="col">Reached</th>
                <th scope="col" className="r">
                  Median wait
                </th>
                <th scope="col" className="r">
                  Missed urgent
                </th>
              </tr>
            </thead>
            <tbody>
              {LANGS.map((lang) => {
                const m = metrics.data!.by_language[lang]
                if (!m) return null
                const pct = Math.round(m.contact_rate * 100)
                return (
                  <tr key={lang}>
                    <th scope="row">{LANGUAGE_LABEL[lang]}</th>
                    <td>
                      <span className="fair-rate">
                        <span className="fair-bar" aria-hidden="true">
                          <span style={{ width: `${pct}%` }} />
                        </span>
                        <span className="num">{pct}%</span>
                      </span>
                    </td>
                    <td className="r num">{m.median_minutes_to_contact === null ? '–' : `${m.median_minutes_to_contact} min`}</td>
                    <td className="r num">{m.missed_urgent_rate === null ? '–' : `${Math.round(m.missed_urgent_rate * 100)}%`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {outage && (
          <p className="fair-muted fair-foot">
            Median wait is demo-clock minutes from the outage start to the first answered call. Missed urgent comes from
            the evaluation: 30 scenarios in each language.
          </p>
        )}

        <div className="privacy">
          <div>
            <h3 className="fair-h">What CareLine stores</h3>
            <ul>
              <li>Answers as fields: safe, device power, battery hours, needs</li>
              <li>Redacted transcripts, deleted 24 hours after each call</li>
              <li>Each decision's rule ID and a hash of its inputs</li>
              <li>Every override: who, when, why, before and after</li>
            </ul>
          </div>
          <div>
            <h3 className="fair-h">What it never stores</h3>
            <ul>
              <li>Diagnoses or medication names</li>
              <li>Unredacted transcripts or call recordings</li>
              <li>Anything for residents who have not opted in</li>
            </ul>
            <p className="fair-muted">Bedrock never receives home locations or phone numbers.</p>
          </div>
        </div>
        {firstEnded && (
          <p className="fair-muted fair-expiry">
            The first transcript from this outage is deleted at <span className="num">{clock(Date.parse(firstEnded) + 24 * 3600 * 1000)}</span>{' '}
            real time tomorrow.
          </p>
        )}
      </div>
    </section>
  )
}
