// W03: every resident in the outage, in the order the API returns (priority_key in
// code). The frontend never re-sorts. Clicking a row selects the resident.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { OutageMeta, PriorityRow } from '../api/types'
import { triageToken } from '../map/colors'
import { useSelection } from '../state/selection'
import { TriageChip } from '../ui/TriageChip'
import { RunwayCell, RunwayScale } from './Runway'
import './PriorityList.css'

const TIER_TEXT = { 1: 'Tier 1: ventilator or oxygen', 2: 'Tier 2: dialysis or refrigerated medicine', 3: 'Tier 3: mobility device' }

interface Props {
  rows: PriorityRow[]
  outage: OutageMeta | null
  simNow: number | null
  loading: boolean
}

export function PriorityList({ rows, outage, simNow, loading }: Props) {
  const { selectedId, select } = useSelection()
  const rowEls = useRef(new Map<string, HTMLTableRowElement>())
  const lastTops = useRef(new Map<string, number>())
  const seenUrgent = useRef<Set<string> | null>(null)
  const [flashing, setFlashing] = useState<Set<string>>(new Set())

  const order = rows.map((r) => r.resident_id).join(',')
  const urgent = rows.filter((r) => r.triage_group === 'URGENT').map((r) => r.resident_id).join(',')

  // Rows that change rank slide to their new place, so Jane sees the reorder happen.
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

  // A resident who just became urgent flashes once.
  useEffect(() => {
    if (!rows.length) return
    const now = new Set(urgent ? urgent.split(',') : [])
    const seen = seenUrgent.current
    seenUrgent.current = now
    if (!seen) return
    const fresh = [...now].filter((id) => !seen.has(id))
    if (!fresh.length) return
    setFlashing(new Set(fresh))
    const t = setTimeout(() => setFlashing(new Set()), 1800)
    return () => clearTimeout(t)
  }, [urgent, rows.length])

  useEffect(() => {
    if (selectedId) rowEls.current.get(selectedId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  return (
    <section className="panel plist" aria-labelledby="plist-title">
      <div className="panel-head">
        <h2 className="panel-title" id="plist-title">
          Priority list
        </h2>
        {outage && rows.length > 0 && (
          <p className="panel-meta">
            {rows.length} residents, highest priority first. The triage rules set this order, not the model.
          </p>
        )}
      </div>

      {!outage ? (
        <p className="empty">
          No active outage. Start one from the header and every registered resident in that zone appears here,
          highest priority first.
        </p>
      ) : loading ? (
        <p className="empty">Loading residents</p>
      ) : rows.length === 0 ? (
        <p className="empty">No registered residents in {outage.zone_name}.</p>
      ) : (
        <div className="plist-scroll">
          <table className="ptable">
            <thead>
              <tr>
                <th className="c-rank" scope="col">
                  <span className="sr-only">Rank</span>
                </th>
                <th className="c-res" scope="col">Resident</th>
                <th className="c-triage" scope="col">Triage</th>
                <th className="c-tier" scope="col">Tier</th>
                <th className="c-runway" scope="col">
                  Battery left
                  <RunwayScale />
                </th>
                <th className="c-calls" scope="col">Calls</th>
                <th className="c-drive" scope="col">Drive to hospital</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const selected = row.resident_id === selectedId
                const access = row.hospital_access
                return (
                  <tr
                    key={row.resident_id}
                    ref={(el) => {
                      if (el) rowEls.current.set(row.resident_id, el)
                      else rowEls.current.delete(row.resident_id)
                    }}
                    className={`prow prow--${triageToken(row.triage_group)}${selected ? ' is-selected' : ''}${flashing.has(row.resident_id) ? ' is-flash' : ''}`}
                    onClick={() => select(selected ? null : row.resident_id)}
                  >
                    <td className="c-rank num">{row.rank}</td>
                    <td className="c-res">
                      <span className="res-line">
                        <button
                          className="res-id num"
                          aria-pressed={selected}
                          onClick={(e) => {
                            e.stopPropagation()
                            select(selected ? null : row.resident_id)
                          }}
                        >
                          {row.resident_id}
                        </button>
                        <span className="res-name">{row.first_name}</span>
                      </span>
                      <span className="res-sub">
                        {row.device_type}
                        <span className="res-lang">{row.language.toUpperCase()}</span>
                        {row.simulated && (
                          <span className="tag" title="Answered by the call simulator, not a real phone">
                            sim
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="c-triage">
                      <TriageChip group={row.triage_group} rule={row.rule_id} />
                    </td>
                    <td className="c-tier">
                      <span className={`tier tier--${row.risk_tier} num`} title={TIER_TEXT[row.risk_tier]}>
                        {row.risk_tier}
                      </span>
                    </td>
                    <td className="c-runway">
                      <RunwayCell row={row} simNow={simNow} />
                    </td>
                    <td className="c-calls num">{row.attempts || '–'}</td>
                    <td className="c-drive">
                      {!access ? (
                        <span className="drive-none" title="Working out the nearest hospital">
                          –
                        </span>
                      ) : access.basis === 'live_traffic' && access.drive_minutes !== null ? (
                        <>
                          <span className="drive-main num">{access.drive_minutes} min</span>
                          <span className="drive-sub">live traffic</span>
                        </>
                      ) : (
                        <>
                          <span className="drive-main num">{access.distance_km.toFixed(1)} km</span>
                          <span className="drive-sub">straight-line</span>
                        </>
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
