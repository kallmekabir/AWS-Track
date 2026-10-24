// The ranked list: everyone in the zone in the order GET /queue returns. The ranking
// rules on the backend set that order; the dashboard never re-sorts. Clicking a row
// opens that person's details.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Resident } from '../api'
import { callProgress, canCallAgain, DEVICE_GROUP_TEXT, deviceLine, reasonLine } from '../lib/levels'
import { levelToken } from '../map/colors'
import { useSelection } from '../state/selection'
import { LevelChip } from '../ui/LevelChip'
import { RunwayCell, RunwayScale } from './Runway'
import './PriorityList.css'

interface Props {
  rows: Resident[]
  now: number
  loading: boolean
  onCallAgain: (r: Resident) => void
}

export function PriorityList({ rows, now, loading, onCallAgain }: Props) {
  const { selectedId, select } = useSelection()
  const rowEls = useRef(new Map<string, HTMLTableRowElement>())
  const lastTops = useRef(new Map<string, number>())
  const seenHelpNow = useRef<Set<string> | null>(null)
  const [flashing, setFlashing] = useState<Set<string>>(new Set())

  const order = rows.map((r) => r.id).join(',')
  const helpNow = rows.filter((r) => r.status === 'HELP_NOW').map((r) => r.id).join(',')

  // Rows that change place slide to their new spot, so Jane sees the reorder happen.
  useLayoutEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const tops = new Map<string, number>()
    rowEls.current.forEach((el, id) => {
      const top = el.offsetTop
      tops.set(id, top)
      const prev = lastTops.current.get(id)
      if (!reduce && prev !== undefined && prev !== top) {
        el.animate([{ transform: `translateY(${prev - top}px)` }, { transform: 'none' }], {
          duration: 450,
          easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
        })
      }
    })
    lastTops.current = tops
  }, [order])

  // Someone who just became "Help now" flashes once.
  useEffect(() => {
    if (!rows.length) return
    const current = new Set(helpNow ? helpNow.split(',') : [])
    const seen = seenHelpNow.current
    seenHelpNow.current = current
    if (!seen) return
    const fresh = [...current].filter((id) => !seen.has(id))
    if (!fresh.length) return
    setFlashing(new Set(fresh))
    const t = setTimeout(() => setFlashing(new Set()), 1800)
    return () => clearTimeout(t)
  }, [helpNow, rows.length])

  useEffect(() => {
    if (selectedId) rowEls.current.get(selectedId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  return (
    <section className="panel plist" aria-labelledby="plist-title">
      <div className="panel-head">
        <h2 className="panel-title" id="plist-title">
          Who to help first
        </h2>
        {rows.length > 0 && (
          <p className="panel-meta">
            {rows.length} people. The ranking rules set this order, not the AI.
          </p>
        )}
      </div>

      {loading ? (
        <p className="empty">Loading the list</p>
      ) : rows.length === 0 ? (
        <p className="empty">Nobody is registered in this zone yet.</p>
      ) : (
        <div className="plist-scroll">
          <table className="ptable">
            <thead>
              <tr>
                <th className="c-rank" scope="col">
                  <span className="sr-only">Place in line</span>
                </th>
                <th className="c-res" scope="col">Person</th>
                <th className="c-level" scope="col">Level and reason</th>
                <th className="c-runway" scope="col">
                  Backup left
                  <RunwayScale />
                </th>
                <th className="c-drive" scope="col">Supplier drive</th>
                <th className="c-act" scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const selected = r.id === selectedId
                const progress = callProgress(r)
                const reason = reasonLine(r)
                return (
                  <tr
                    key={r.id}
                    ref={(el) => {
                      if (el) rowEls.current.set(r.id, el)
                      else rowEls.current.delete(r.id)
                    }}
                    className={`prow prow--${levelToken(r.status)}${selected ? ' is-selected' : ''}${flashing.has(r.id) ? ' is-flash' : ''}`}
                    onClick={() => select(selected ? null : r.id)}
                  >
                    <td className="c-rank num">{i + 1}</td>
                    <td className="c-res">
                      <button
                        className="res-name"
                        aria-pressed={selected}
                        onClick={(e) => {
                          e.stopPropagation()
                          select(selected ? null : r.id)
                        }}
                      >
                        {r.name}
                      </button>
                      <span className="res-sub" title={DEVICE_GROUP_TEXT[r.device_group]}>
                        {deviceLine(r)}
                      </span>
                    </td>
                    <td className="c-level">
                      <LevelChip status={r.status} />
                      {progress ? (
                        <span className="lvl-line lvl-line--live">{progress}</span>
                      ) : (
                        reason && <span className="lvl-line">{reason}</span>
                      )}
                      {r.last_error && <span className="lvl-line lvl-line--error">Last error: {r.last_error}</span>}
                    </td>
                    <td className="c-runway">
                      <RunwayCell resident={r} now={now} />
                    </td>
                    <td className="c-drive">
                      {r.drive_minutes === null ? (
                        <span className="drive-sub">unknown</span>
                      ) : (
                        <span className="drive-main num">{Math.round(r.drive_minutes)} min</span>
                      )}
                    </td>
                    <td className="c-act">
                      {canCallAgain(r) && (
                        <button
                          className="btn btn--quiet"
                          onClick={(e) => {
                            e.stopPropagation()
                            onCallAgain(r)
                          }}
                        >
                          Call again
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
