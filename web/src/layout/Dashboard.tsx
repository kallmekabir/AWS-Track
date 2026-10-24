// The one screen (CLAUDE.md section 3): the ranked list beside the map, and the
// selected person's details over the map's right edge. One GET /queue poll every
// 3 seconds feeds all of it, so the list, the pins and the details never disagree.
import { useCallback, useEffect, useRef, useState } from 'react'
import { callAgain, getHospitals, getQueue, type Resident } from '../api'
import { config, ZONE } from '../config'
import { useNow } from '../lib/useNow'
import { usePoll } from '../lib/usePoll'
import { useSelection } from '../state/selection'
import { Header } from '../header/Header'
import { PriorityList } from '../priority/PriorityList'
import { MapPanel } from '../map/MapPanel'
import { ResidentDrawer } from '../drawer/ResidentDrawer'
import './Dashboard.css'

export function Dashboard() {
  const { selectedId, select } = useSelection()
  const [mapUnavailable, setMapUnavailable] = useState(!config.locationApiKey)
  const [message, setMessage] = useState<string | null>(null)
  // The list slides out of the map's way while someone is selected. Hovering its strip
  // brings it back for that selection only, so a new pick slides it away again.
  const [peekFor, setPeekFor] = useState<string | null>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const now = useNow(1000)

  const queue = usePoll(() => getQueue(ZONE), `queue:${ZONE}`)
  const hospitals = usePoll(() => getHospitals(), 'hospitals', 60_000)
  const rows = queue.data ?? []
  const selectedIndex = rows.findIndex((r) => r.id === selectedId)
  const selected = selectedIndex >= 0 ? rows[selectedIndex] : null
  const { refresh } = queue
  const peeking = !!selected && peekFor === selected.id
  const peek = (open: boolean) => setPeekFor(open && selected ? selected.id : null)

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

  // Esc closes the details.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input, textarea, select')) select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [select])

  const onCallAgain = useCallback(
    async (r: Resident) => {
      try {
        await callAgain(r.id)
        setMessage(`Calling ${r.name} again.`)
        refresh()
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e))
      }
    },
    [refresh],
  )

  return (
    <div className="dash">
      <div className="dash-header" ref={headerRef}>
        <Header
          rows={rows}
          loadError={queue.error ?? null}
          mapUnavailable={mapUnavailable}
          message={message}
          onMessage={setMessage}
          onStarted={refresh}
        />
      </div>

      <main
        id="work"
        className={`work${mapUnavailable ? ' work--no-map' : ''}${selected ? ' work--drawer' : ''}`}
        aria-label="Ranked list and map"
      >
        <div
          className={`list-dock${peeking ? ' is-peeking' : ''}`}
          onMouseEnter={() => peek(true)}
          onMouseLeave={() => peek(false)}
          onFocus={() => peek(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) peek(false)
          }}
        >
          <PriorityList rows={rows} now={now} loading={queue.data === undefined && !queue.error} onCallAgain={onCallAgain} />
          <button type="button" className="list-handle" aria-label="Show the ranked list"
            aria-expanded={peeking} onClick={() => peek(!peeking)}>
            <span aria-hidden="true">›</span>
            <span className="list-handle-text">Who to help first</span>
          </button>
        </div>
        {!mapUnavailable && (
          <MapPanel rows={rows} hospitals={hospitals.data ?? []} hospitalError={!!hospitals.error}
            drawerOpen={!!selected} onUnavailable={() => setMapUnavailable(true)} />
        )}
        {selected && (
          <ResidentDrawer
            key={selected.id}
            resident={selected}
            hospitals={hospitals.data ?? []}
            place={selectedIndex + 1}
            now={now}
            onClose={() => select(null)}
            onCallAgain={onCallAgain}
          />
        )}
      </main>
    </div>
  )
}
