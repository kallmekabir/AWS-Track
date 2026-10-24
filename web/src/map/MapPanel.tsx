// W04, W05, W10: Amazon Location map (Monochrome, Light) with resident pins from the
// priority poll, every hospital, and the route to the selected resident's nearest
// hospital. Polls never move the camera; it moves once per outage and once per selection.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre 6 loads its worker from a file next to its own module; Vite's dep
// pre-bundling moves that module, so point it at the worker explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { api } from '../api/client'
import type { HospitalCollection, HospitalRoute, PriorityRow } from '../api/types'
import { config } from '../config'
import { GROUP_LABEL, GROUP_ORDER } from '../lib/triage'
import { clock } from '../lib/time'
import { useSelection } from '../state/selection'
import { Glyph, HospitalGlyph } from '../ui/Glyph'
import { addLayers, EMPTY, residentFeatures, source } from './layers'
import { drawImage } from './pins'
import './MapPanel.css'

maplibregl.setWorkerUrl(workerUrl)

const SAN_JOSE: [number, number] = [-121.8863, 37.3382]

type RouteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; route: HospitalRoute }
  | { status: 'error' }

interface Props {
  outageId: string | null
  rows: PriorityRow[]
  drawerOpen: boolean
  onUnavailable: () => void
}

function styleUrl() {
  const { awsRegion, mapStyle, locationApiKey } = config
  return `https://maps.geo.${awsRegion}.amazonaws.com/v2/styles/${mapStyle}/descriptor?key=${encodeURIComponent(locationApiKey)}&color-scheme=Light`
}

export function MapPanel({ outageId, rows, drawerOpen, onUnavailable }: Props) {
  const { selectedId, select } = useSelection()
  const panelRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const hospitals = useRef<HospitalCollection | null>(null)
  const lastResidents = useRef('')
  const fittedOutage = useRef<string | null>(null)
  const onUnavailableRef = useRef(onUnavailable)
  onUnavailableRef.current = onUnavailable
  const [ready, setReady] = useState(false)
  const [route, setRoute] = useState<RouteState>({ status: 'idle' })
  const [drawerInset, setDrawerInset] = useState(0)

  // How much of the map the resident drawer covers on the right, so the camera and
  // the badge stay in the part Jane can see.
  const measureInset = () => {
    const panel = panelRef.current
    const drawer = document.querySelector<HTMLElement>('.drawer')
    if (!panel || !drawer || window.innerWidth <= 1000) return 0
    return Math.max(0, panel.offsetLeft + panel.offsetWidth - drawer.offsetLeft)
  }

  useEffect(() => {
    const map = new maplibregl.Map({
      container: canvasRef.current!,
      style: styleUrl(),
      center: SAN_JOSE,
      zoom: 11,
      attributionControl: { compact: true },
    })
    let loaded = false
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.setMissingStyleImageResolver(async (id) => {
      const img = await drawImage(id, (hid) => hospitals.current?.features.find((f) => f.properties.hospital_id === hid)?.properties.name)
      if (img && !map.hasImage(id)) map.addImage(id, img.data, { pixelRatio: img.pixelRatio })
    })
    // A style that fails before it loads (bad key, 403) hides the panel; the list goes full width.
    map.on('error', (e) => {
      if (!loaded) onUnavailableRef.current()
      else console.warn('Map error', e.error?.message)
    })
    map.on('load', () => {
      loaded = true
      addLayers(map)
      setReady(true)
    })
    map.on('click', 'residents', (e) => {
      const id = e.features?.[0]?.properties?.resident_id as string | undefined
      if (id) select(id)
    })
    map.on('mouseenter', 'residents', () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', 'residents', () => (map.getCanvas().style.cursor = ''))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [select])

  // Hospitals: every row of the CSV, always.
  useEffect(() => {
    if (!ready) return
    const ctl = new AbortController()
    api
      .getHospitals({ signal: ctl.signal })
      .then((fc) => {
        hospitals.current = fc
        source(mapRef.current!, 'hospitals').setData(fc)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.warn('Hospitals unavailable', err.message)
      })
    return () => ctl.abort()
  }, [ready])

  // Residents: setData only when something actually changed.
  useEffect(() => {
    if (!ready) return
    const fc = outageId ? residentFeatures(rows, selectedId) : EMPTY
    const json = JSON.stringify(fc)
    if (json === lastResidents.current) return
    lastResidents.current = json
    source(mapRef.current!, 'residents').setData(fc)
  }, [ready, outageId, rows, selectedId])

  // Fit to the zone once, when an outage's residents first arrive.
  useEffect(() => {
    if (!ready) return
    if (!outageId) {
      fittedOutage.current = null
      return
    }
    if (!rows.length || fittedOutage.current === outageId) return
    fittedOutage.current = outageId
    const bounds = new maplibregl.LngLatBounds()
    rows.forEach((r) => bounds.extend([r.lng, r.lat]))
    mapRef.current!.fitBounds(bounds, { padding: 70, maxZoom: 14, duration: 1000 })
  }, [ready, outageId, rows])

  useLayoutEffect(() => {
    const update = () => setDrawerInset(drawerOpen ? measureInset() : 0)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [drawerOpen])

  // Route on selection: fetch, draw, and fit the resident and hospital once.
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current!
    source(map, 'route').setData(EMPTY)
    if (!selectedId || !outageId) {
      setRoute({ status: 'idle' })
      return
    }
    setRoute({ status: 'loading' })
    const ctl = new AbortController()
    api
      .getHospitalRoute(selectedId, outageId, { signal: ctl.signal })
      .then((r) => {
        source(map, 'route').setData({ type: 'Feature', geometry: r.geometry, properties: {} })
        // A straight line is an estimate, not a route: draw it dashed.
        map.setPaintProperty('route-line', 'line-dasharray', r.basis === 'straight_line' ? [1.2, 1.6] : undefined)
        setRoute({ status: 'ready', route: r })
        const bounds = new maplibregl.LngLatBounds()
        r.geometry.coordinates.forEach((c) => bounds.extend(c))
        map.fitBounds(bounds, {
          padding: { top: 132, bottom: 56, left: 56, right: 56 + measureInset() },
          maxZoom: 15,
          duration: 900,
        })
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setRoute({ status: 'error' })
      })
    return () => ctl.abort()
  }, [ready, selectedId, outageId])

  return (
    <section className="panel map-panel" ref={panelRef} aria-label="Map of residents and hospitals">
      <div className="map-canvas" ref={canvasRef} />

      {route.status !== 'idle' && (
        <div className="map-chip" role="status" aria-live="polite">
          {route.status === 'loading' && <p className="rc-wait">Finding the route to the nearest hospital</p>}
          {route.status === 'error' && (
            <p className="rc-wait">Route unavailable right now. The list still shows the drive time from the outage start.</p>
          )}
          {route.status === 'ready' && <RouteChip route={route.route} />}
        </div>
      )}

      {!outageId && (
        <p className="map-empty">Residents appear on the map when an outage starts. Hospitals are always shown.</p>
      )}

      <div className="map-legend" aria-label="Map legend" style={{ maxWidth: `calc(100% - ${drawerInset + 150}px)` }}>
        {GROUP_ORDER.map((g) => (
          <span key={g} className="lg-item">
            <Glyph group={g} size={11} />
            {GROUP_LABEL[g]}
          </span>
        ))}
        <span className="lg-item">
          <HospitalGlyph size={12} />
          Hospital
        </span>
        <span className="lg-note">Numbers are list ranks</span>
      </div>

      <span className="map-badge" style={{ right: drawerInset + 12 }}>
        Synthetic data
      </span>
    </section>
  )
}

function RouteChip({ route }: { route: HospitalRoute }) {
  const live = route.basis === 'live_traffic' && route.drive_minutes !== null
  return (
    <div className="rc">
      <p className="rc-main">
        <span className="rc-big num">{live ? `${route.drive_minutes} min` : `${route.distance_km.toFixed(1)} km`}</span>
        <span className="rc-lead">{live ? 'drive to' : 'straight-line to'}</span>
      </p>
      <p className="rc-hosp">{route.hospital.name}</p>
      <p className="rc-meta">
        {live ? (
          <>
            <span className="num">{route.distance_km.toFixed(1)} km</span>, live traffic as of{' '}
            <span className="num">{clock(route.computed_at)}</span> real time
          </>
        ) : (
          'Not a drive time. Routing was unavailable for this address.'
        )}
      </p>
      {route.hospital.phone && (
        <p className="rc-meta">
          Call ahead <a href={`tel:${route.hospital.phone.replace(/[^\d+]/g, '')}`}>{route.hospital.phone}</a>
        </p>
      )}
    </div>
  )
}
