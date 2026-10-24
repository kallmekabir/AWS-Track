import { useCallback, useEffect, useRef, useState } from 'react'
import { callAgain, getQueue, startOutage, type Resident, type Status } from './api'
import './App.css'

const ZONE = 'A'
const POLL_MS = 3000

// Plain words on screen; color always comes with a word (CLAUDE.md, product rules).
const STATUS_LABEL: Record<Status, string> = {
  HELP_NOW: 'Help now',
  HELP_SOON: 'Help soon',
  PERSON_CHECK: 'A person must check',
  NEEDS_SUPPLIES: 'Needs supplies',
  OK_FOR_NOW: 'OK for now',
  CALLING: 'Calling now',
  NOT_CALLED: 'Not called yet',
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

function callProgress(r: Resident): string | null {
  if (r.status !== 'CALLING') return null
  return r.current_question > 0 ? `Question ${r.current_question} of 5` : 'Ringing…'
}

function reasonLine(r: Resident): string | null {
  const parts = [r.rule_id, r.reason].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

function App() {
  const [residents, setResidents] = useState<Resident[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const loading = useRef(false)

  const refresh = useCallback(async () => {
    if (loading.current) return // never stack polls on a slow connection
    loading.current = true
    try {
      setResidents(await getQueue(ZONE))
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      loading.current = false
    }
  }, [])

  useEffect(() => {
    // Polling the API is syncing with an external system; state is set after the fetch resolves.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  async function onStartOutage() {
    setStarting(true)
    setMessage(null)
    try {
      const result = await startOutage(ZONE)
      const n = result.calling.length
      const parts = [n ? `Calling ${n} ${n === 1 ? 'person' : 'people'} now.` : 'Nobody could be called.']
      if (result.waiting.length) parts.push(`${result.waiting.length} more waiting for a free line.`)
      if (result.errors.length) parts.push(`${result.errors.length} call(s) failed to start.`)
      setMessage(parts.join(' '))
      await refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  async function onCallAgain(r: Resident) {
    try {
      await callAgain(r.id)
      setMessage(`Calling ${r.name} again.`)
      await refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const count = (status: Status) => residents.filter((r) => r.status === status).length

  return (
    <main className="page">
      <header className="top">
        <div>
          <p className="eyebrow">County Public Health · Zone {ZONE}</p>
          <h1>CareCall</h1>
        </div>
        <button className="start" onClick={onStartOutage} disabled={starting}>
          {starting ? 'Starting…' : 'Start outage'}
        </button>
      </header>

      <p className="message" role="status" aria-live="polite">
        {message}
      </p>

      <section className="counts" aria-label="Summary">
        <span><strong>{count('CALLING')}</strong> calling now</span>
        <span className="counts-urgent"><strong>{count('HELP_NOW')}</strong> help now</span>
        <span><strong>{count('HELP_SOON')}</strong> help soon</span>
        <span><strong>{count('PERSON_CHECK')}</strong> to check</span>
        <span><strong>{count('NOT_CALLED')}</strong> not called yet</span>
      </section>

      {loadError && (
        <p className="load-error" role="alert">
          Can't reach the CareCall API: {loadError}
        </p>
      )}

      <ol className="list">
        {residents.map((r, i) => {
          const progress = callProgress(r)
          const reason = reasonLine(r)
          const isOpen = open.has(r.id)
          return (
            <li key={r.id} className={`row status-${r.status}`}>
              <span className="rank" aria-hidden="true">{i + 1}</span>
              <div className="who">
                <p className="name">{r.name}</p>
                <p className="device">
                  {r.device} · group {r.device_group}
                  {r.backups_on_file !== null &&
                    ` · ${r.backups_on_file} ${r.backups_on_file === 1 ? 'backup' : 'backups'} on file`}
                </p>
              </div>
              <div className="state">
                <span className={`pill pill-${r.status}`}>
                  {r.status === 'CALLING' && <span className="dot" aria-hidden="true" />}
                  {STATUS_LABEL[r.status]}
                </span>
                {progress && <p className="progress">{progress}</p>}
                {!progress && reason && <p className="reason">{reason}</p>}
                {r.runs_out_at && (
                  <p className="reason">Runs out at {timeFormat.format(new Date(r.runs_out_at))}</p>
                )}
                {r.last_error && <p className="reason error">Last error: {r.last_error}</p>}
              </div>
              <div className="actions">
                {r.transcript.length > 0 && (
                  <button className="ghost" onClick={() => toggle(r.id)} aria-expanded={isOpen}>
                    {isOpen ? 'Hide answers' : 'What they said'}
                  </button>
                )}
                {r.allow_call && r.status !== 'CALLING' && r.status !== 'NOT_CALLED' && (
                  <button className="ghost" onClick={() => onCallAgain(r)}>
                    Call again
                  </button>
                )}
              </div>
              {isOpen && (
                <dl className="answers">
                  {r.transcript.map((a) => (
                    <div key={a.q} className="answer">
                      <dt>{a.q}. {a.question}</dt>
                      <dd>“{a.answer}”</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          )
        })}
      </ol>
    </main>
  )
}

export default App
