// W07 (tasks): urgent alerts pinned on top, then welfare checks, then service tasks,
// each group in the API's priority order. Ack and Done are audited server-side.
import { useState } from 'react'
import { api } from '../api/client'
import type { OutageMeta, Task } from '../api/types'
import { clock, simMs } from '../lib/time'
import { TASK_LABEL } from '../lib/triage'
import { useSelection } from '../state/selection'
import { Glyph } from '../ui/Glyph'
import './TaskQueue.css'

interface Props {
  outage: OutageMeta | null
  tasks: Task[] | null
  onChanged: () => void
}

const GROUPS: Array<{ key: string; title: string; match: (t: Task) => boolean }> = [
  { key: 'alert', title: 'Urgent alerts', match: (t) => t.type === 'OPERATOR_ALERT' },
  { key: 'welfare', title: 'Welfare checks', match: (t) => t.type === 'WELFARE_CHECK' },
  { key: 'service', title: 'Service tasks', match: (t) => t.type !== 'OPERATOR_ALERT' && t.type !== 'WELFARE_CHECK' },
]

export function TaskQueue({ outage, tasks, onChanged }: Props) {
  const { select } = useSelection()
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const act = async (task: Task, action: 'ack' | 'done') => {
    setPending((s) => new Set(s).add(task.task_id))
    setError(null)
    try {
      await (action === 'ack' ? api.ackTask(task.task_id) : api.doneTask(task.task_id))
      onChanged()
    } catch {
      setError(`${TASK_LABEL[task.type]} for ${task.resident_id} was not updated. Try again.`)
    } finally {
      setPending((s) => {
        const next = new Set(s)
        next.delete(task.task_id)
        return next
      })
    }
  }

  const live = (tasks ?? []).filter((t) => t.status !== 'DONE')
  const done = (tasks ?? []).length - live.length

  return (
    <section className="panel tasks" aria-labelledby="tasks-title">
      <div className="panel-head">
        <h2 className="panel-title" id="tasks-title">
          Tasks
        </h2>
        {outage && tasks && (
          <p className="panel-meta">
            <span className="num">{live.length}</span> open{done > 0 && <>, <span className="num">{done}</span> done</>}
          </p>
        )}
      </div>

      {!outage ? (
        <p className="empty">Tasks appear here as the rules flag residents and as you approve plans.</p>
      ) : !tasks ? (
        <p className="empty">Loading tasks</p>
      ) : live.length === 0 ? (
        <p className="empty">No open tasks. Urgent alerts, welfare checks and service requests land here as calls finish.</p>
      ) : (
        <div className="tq">
          {error && (
            <p className="error-text tq-error" role="alert">
              {error}
            </p>
          )}
          {GROUPS.map((g) => {
            const items = live.filter(g.match)
            if (!items.length) return null
            return (
              <div key={g.key} className={`tq-group tq-group--${g.key}`}>
                <h3 className="tq-title">
                  {g.key === 'alert' && <Glyph group="URGENT" />}
                  {g.key === 'welfare' && <Glyph group="UNREACHED" />}
                  {g.title} <span className="tq-count num">{items.length}</span>
                </h3>
                <ul className="tq-list">
                  {items.map((t) => {
                    const busy = pending.has(t.task_id)
                    const fromPlan = t.created_by.startsWith('plan:')
                    return (
                      <li key={t.task_id} className={`task${t.status === 'ACK' ? ' is-ack' : ''}`}>
                        <div className="task-main">
                          <p className="task-line">
                            <span className="task-type">{TASK_LABEL[t.type]}</span>
                            <button className="link-id" onClick={() => select(t.resident_id, { reveal: true })}>
                              {t.resident_id}
                            </button>
                          </p>
                          <p className="task-meta">
                            {fromPlan
                              ? `Approved plan, Team ${t.details.team}, stop ${t.details.stop_no}`
                              : t.rule_id
                                ? `Rule ${t.rule_id}`
                                : 'Two calls unanswered'}
                            {t.details.hospital_name && t.details.drive_minutes !== undefined && (
                              <>
                                {', '}
                                <span className="num">{t.details.drive_minutes} min</span> to {t.details.hospital_name}
                              </>
                            )}
                            {outage && (
                              <>
                                {', '}
                                <span className="num">{clock(simMs(outage, Date.parse(t.created_at)))}</span>
                              </>
                            )}
                          </p>
                        </div>
                        <div className="task-actions">
                          {t.status === 'OPEN' ? (
                            <button className="btn btn--quiet btn--small" disabled={busy} onClick={() => act(t, 'ack')}>
                              Acknowledge
                            </button>
                          ) : (
                            <span className="task-ack">Acknowledged</span>
                          )}
                          <button className="btn btn--quiet btn--small" disabled={busy} onClick={() => act(t, 'done')}>
                            Done
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
