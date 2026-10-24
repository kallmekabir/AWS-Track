// Grid from map spec section 8.1: header and zone strip, priority list beside the map
// (the drawer opens over the map's right edge), copilot beside the task queue, then the
// call log beside fairness and privacy.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { usePoll } from '../api/usePoll'
import { config } from '../config'
import { useSimNow } from '../lib/useNow'
import { useSelection } from '../state/selection'
import { Header } from '../header/Header'
import { PriorityList } from '../priority/PriorityList'
import { MapPanel } from '../map/MapPanel'
import { ResidentDrawer } from '../drawer/ResidentDrawer'
import { CopilotPanel } from '../copilot/CopilotPanel'
import { TaskQueue } from '../tasks/TaskQueue'
import { CallFeed } from '../feed/CallFeed'
import { FairnessPanel } from '../fairness/FairnessPanel'
import './Dashboard.css'

export function Dashboard() {
  const { selectedId, select } = useSelection()
  const [mapUnavailable, setMapUnavailable] = useState(!config.locationApiKey)
  const [briefRequest, setBriefRequest] = useState(0)
  const headerRef = useRef<HTMLDivElement>(null)

  const active = usePoll((signal) => api.getActiveOutage({ signal }), 'active')
  const outage = active.data?.outage ?? null
  const id = outage?.outage_id
  const summary = usePoll(id ? (signal) => api.getSummary(id, { signal }) : null, `summary:${id}`)
  const priority = usePoll(id ? (signal) => api.getPriority(id, { signal }) : null, `priority:${id}`)
  const calls = usePoll(id ? (signal) => api.getCalls(id, { signal }) : null, `calls:${id}`)
  const tasks = usePoll(id ? (signal) => api.getTasks(id, { signal }) : null, `tasks:${id}`)

  const simNow = useSimNow(summary.data?.sim_now, summary.lastUpdated, outage?.time_scale ?? 1, outage?.status === 'ACTIVE')
  const rows = priority.data?.rows ?? []
  const selectedRow = rows.find((r) => r.resident_id === selectedId) ?? null

  // Keep the work area exactly one screen tall under the sticky header.
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Ending or replacing the outage clears the selection; Esc closes the drawer.
  const prevId = useRef(id)
  useEffect(() => {
    if (prevId.current !== undefined && prevId.current !== id) select(null)
    prevId.current = id
  }, [id, select])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input, textarea, select')) select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [select])

  const { refresh: refreshPriority } = priority
  const { refresh: refreshSummary } = summary
  const { refresh: refreshTasks } = tasks
  const { refresh: refreshCalls } = calls
  const refreshAfterWrite = useCallback(() => {
    refreshPriority()
    refreshSummary()
    refreshTasks()
    refreshCalls()
  }, [refreshPriority, refreshSummary, refreshTasks, refreshCalls])

  const requestBrief = useCallback(() => {
    setBriefRequest((n) => n + 1)
    document.getElementById('copilot')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  return (
    <div className="dash">
      <div className="dash-header" ref={headerRef}>
        <Header
          outage={outage}
          summary={summary.data ?? null}
          simNow={simNow}
          loading={active.data === undefined && !active.error}
          apiError={active.error ?? null}
          mapUnavailable={mapUnavailable}
          onOutageChanged={active.refresh}
          onBrief={requestBrief}
        />
      </div>

      <main>
        <section
          id="work"
          className={`work${mapUnavailable ? ' work--no-map' : ''}${selectedRow ? ' work--drawer' : ''}`}
          aria-label="Priority list and map"
        >
          <PriorityList rows={rows} outage={outage} simNow={simNow} loading={!!id && !priority.data} />
          {!mapUnavailable && (
            <MapPanel
              outageId={id ?? null}
              rows={rows}
              drawerOpen={!!selectedRow}
              onUnavailable={() => setMapUnavailable(true)}
            />
          )}
          {outage && selectedRow && (
            <ResidentDrawer
              key={selectedRow.resident_id}
              outage={outage}
              row={selectedRow}
              simNow={simNow}
              onClose={() => select(null)}
              onChanged={refreshAfterWrite}
            />
          )}
        </section>

        <div className="dash-lower">
          <CopilotPanel outage={outage} briefRequest={briefRequest} onApproved={tasks.refresh} />
          <TaskQueue outage={outage} tasks={tasks.data?.items ?? null} onChanged={tasks.refresh} />
        </div>

        <div className="dash-lower dash-lower--log">
          <CallFeed outage={outage} calls={calls.data?.items ?? null} />
          <FairnessPanel outage={outage} calls={calls.data?.items ?? null} />
        </div>
      </main>
    </div>
  )
}
