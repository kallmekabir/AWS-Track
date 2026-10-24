// W08: the Bedrock zone brief and draft dispatch plan, Approve plan, and Ask CareLine.
// Text Bedrock wrote is set in the serif; IDs, ranks and drive times stay in the UI face.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import type { AskResponse, Brief, OutageMeta } from '../api/types'
import { clock } from '../lib/time'
import { TASK_LABEL } from '../lib/triage'
import { useSelection } from '../state/selection'
import './CopilotPanel.css'

type BriefState =
  | { status: 'idle' }
  | { status: 'loading'; startedAt: number }
  | { status: 'ready'; brief: Brief }
  | { status: 'error'; message: string }

interface Props {
  outage: OutageMeta | null
  /** Increments when Brief me is pressed in the zone strip. */
  briefRequest: number
  onApproved: () => void
}

export function CopilotPanel({ outage, briefRequest, onApproved }: Props) {
  const [state, setState] = useState<BriefState>({ status: 'idle' })
  const [approved, setApproved] = useState<{ briefId: string; count: number } | null>(null)
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)
  const outageId = outage?.outage_id

  // A different outage means a different brief.
  useEffect(() => {
    setState({ status: 'idle' })
    setApproved(null)
  }, [outageId])

  const runBrief = async () => {
    if (!outage) return
    setState({ status: 'loading', startedAt: Date.now() })
    setApproveError(null)
    try {
      const brief = await api.copilotBrief(outage.outage_id, outage.zone_id)
      setState({ status: 'ready', brief })
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof ApiError ? err.message : 'The brief did not finish. Try again in a moment.',
      })
    }
  }

  const handled = useRef(0)
  useEffect(() => {
    if (briefRequest > handled.current) {
      handled.current = briefRequest
      runBrief()
    }
  })

  const approve = async (brief: Brief) => {
    setApproving(true)
    setApproveError(null)
    try {
      const res = await api.copilotApprove(brief.outage_id, brief.brief_id)
      setApproved({ briefId: brief.brief_id, count: res.tasks.length })
      onApproved()
    } catch (err) {
      setApproveError(err instanceof ApiError ? err.message : 'The plan was not approved. Try again.')
    } finally {
      setApproving(false)
    }
  }

  return (
    <section id="copilot" className="panel copilot" aria-labelledby="copilot-title">
      <div className="panel-head">
        <h2 className="panel-title" id="copilot-title">
          Copilot brief
        </h2>
        <p className="panel-meta">
          Amazon Bedrock reads the live call data and drafts a plan. Nothing is created until you approve it.
        </p>
      </div>

      <div className="cp-body">
        {!outage ? (
          <p className="empty">Briefs are written for an active outage. Start one from the header.</p>
        ) : state.status === 'idle' ? (
          <div className="cp-start">
            <p className="cp-start-text">
              Get a situation brief for {outage.zone_name}: who to reach first and why, and a draft dispatch plan for your teams.
            </p>
            <button className="btn" onClick={runBrief}>
              Brief me on {outage.zone_id}
            </button>
          </div>
        ) : state.status === 'loading' ? (
          <Working startedAt={state.startedAt} />
        ) : state.status === 'error' ? (
          <div className="cp-start">
            <p className="error-text" role="alert">
              {state.message}
            </p>
            <button className="btn btn--quiet" onClick={runBrief}>
              Brief me again
            </button>
          </div>
        ) : (
          <BriefCard
            brief={state.brief}
            approved={approved?.briefId === state.brief.brief_id ? approved.count : null}
            approving={approving}
            approveError={approveError}
            onApprove={() => approve(state.brief)}
            onRefresh={runBrief}
          />
        )}

        {outage && <Ask outage={outage} />}
      </div>
    </section>
  )
}

function Working({ startedAt }: { startedAt: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const s = Math.floor((Date.now() - startedAt) / 1000)
  return (
    <div className="cp-working" role="status" aria-live="polite">
      <span className="cp-working-bar" aria-hidden="true" />
      <p>
        Bedrock is reading live call data for this zone. Briefs take 10 to 20 seconds.{' '}
        <span className="num cp-muted">{s}s</span>
      </p>
    </div>
  )
}

function ResidentLinks({ ids }: { ids: string[] }) {
  const { select } = useSelection()
  return (
    <>
      {ids.map((id) => (
        <button key={id} className="link-id" onClick={() => select(id, { reveal: true })}>
          {id}
        </button>
      ))}
    </>
  )
}

interface BriefCardProps {
  brief: Brief
  approved: number | null
  approving: boolean
  approveError: string | null
  onApprove: () => void
  onRefresh: () => void
}

function BriefCard({ brief, approved, approving, approveError, onApprove, onRefresh }: BriefCardProps) {
  const stops = brief.dispatch_plan.teams.reduce((n, t) => n + t.stops.length, 0)
  return (
    <article className="brief">
      <div className="brief-main">
        <p className="brief-provenance">
          <span className="tag">Written by Bedrock</span>
          <span>
            at <span className="num">{clock(brief.generated_at)}</span> real time from {brief.tool_calls} read-only lookups.
            Order comes from the priority rules.
          </span>
        </p>

        <h3 className="brief-headline prose">{brief.headline}</h3>

        {brief.reordered && (
          <p className="brief-note">
            Bedrock listed these out of order, so CareLine put them back in priority-list order.
          </p>
        )}

        <ol className="brief-priorities">
          {brief.priorities.map((p) => (
            <li key={p.rank} className="bp">
              <span className="bp-rank num" title="Rank in the priority list">
                {p.rank}
              </span>
              <div className="bp-body">
                <p className="bp-ids">
                  <ResidentLinks ids={p.resident_ids} />
                  {p.nearest_hospital && (
                    <span className="bp-hosp">
                      {p.drive_minutes !== undefined && <span className="num">{p.drive_minutes} min</span>} to {p.nearest_hospital.name}
                    </span>
                  )}
                </p>
                <p className="bp-reason prose">{p.reason}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="brief-side">
        {stops > 0 && (
          <div className="brief-plan">
            <h4 className="brief-sub">Draft dispatch plan</h4>
            <div className="plan-teams">
              {brief.dispatch_plan.teams.map((team) => (
                <div key={team.team} className="plan-team">
                  <p className="plan-team-name">Team {team.team}</p>
                  <ol className="plan-stops">
                    {team.stops.map((stop, i) => (
                      <li key={`${stop.resident_id}-${i}`}>
                        <span className="plan-stop-no num">{i + 1}</span>
                        <ResidentLinks ids={[stop.resident_id]} />
                        <span className="plan-stop-type">{TASK_LABEL[stop.task_type]}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="brief-actions">
          {approved !== null ? (
            <p className="brief-approved" role="status">
              Plan approved. {approved} {approved === 1 ? 'task was' : 'tasks were'} added to the queue, logged with you as the approver.
            </p>
          ) : (
            <>
              <button className="btn" onClick={onApprove} disabled={approving || stops === 0}>
                {approving ? 'Approving plan' : `Approve plan, ${stops} ${stops === 1 ? 'task' : 'tasks'}`}
              </button>
              <button className="btn btn--quiet" onClick={onRefresh} disabled={approving}>
                Brief me again
              </button>
            </>
          )}
          {approveError && (
            <p className="error-text" role="alert">
              {approveError}
            </p>
          )}
        </div>

        {brief.open_questions.length > 0 && (
          <div className="brief-questions">
            <h4 className="brief-sub">Open questions</h4>
            <ul>
              {brief.open_questions.map((q) => (
                <li key={q} className="prose">
                  {q}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="brief-model">Model: {brief.model_id}</p>
      </div>
    </article>
  )
}

function Ask({ outage }: { outage: OutageMeta }) {
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ q: string; a: AskResponse } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const q = question.trim()
    if (!q) return
    setBusy(true)
    setError(null)
    try {
      setResult({ q, a: await api.copilotAsk(outage.outage_id, q) })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No answer came back. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ask">
      <form className="ask-form" onSubmit={submit}>
        <label className="ask-label" htmlFor="ask-input">
          Ask CareLine
        </label>
        <div className="ask-row">
          <input
            id="ask-input"
            className="ask-input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={`Who on oxygen haven't we reached in ${outage.zone_id}?`}
            autoComplete="off"
          />
          <button className="btn" type="submit" disabled={busy || !question.trim()}>
            {busy ? 'Asking' : 'Ask'}
          </button>
        </div>
      </form>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="ask-answer" aria-live="polite">
          <p className="ask-q">{result.q}</p>
          <p className="prose ask-a">{result.a.answer}</p>
          {result.a.cited_resident_ids.length > 0 && (
            <p className="ask-cites">
              <span className="cp-muted">From the records of</span> <ResidentLinks ids={result.a.cited_resident_ids} />
            </p>
          )}
        </div>
      )}
    </div>
  )
}
