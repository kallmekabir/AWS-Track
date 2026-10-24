// Amazon Location map (Monochrome, Light) with every resident as a pin colored by
// level and numbered by place in line. Polls never move the camera: it fits the zone
// once, and moves once per selection to bring that person into view.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre 6 loads its worker from a file next to its own module; Vite's dep
// pre-bundling moves that module, so point it at the worker explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { getHospitalRoute, type Hospital, type HospitalRoute, type Resident } from '../api'
import { config } from '../config'
import { LEVEL_LABEL, LEVEL_ORDER } from '../lib/levels'
import { clock, span } from '../lib/time'
import { useSelection } from '../state/selection'
import { Glyph } from '../ui/Glyph'
import { EMPTY, addLayers, hospitalFeatures, residentFeatures, residentsSource } from './layers'
import { drawImage } from './pins'
import './MapPanel.css'

maplibregl.setWorkerUrl(workerUrl)

const SAN_JOSE: [number, number] = [-121.8863, 37.3382]
/** Width of the list's strip while someone is selected (--peek in layout/Dashboard.css). */
const PEEK_PX = 36

interface Props {
  rows: Resident[]
  hospitals: Hospital[]
  hospitalError: boolean
  drawerOpen: boolean
  onUnavailable: () => void
}

function styleUrl() {
  const { awsRegion, mapStyle, locationApiKey } = config
  return `https://maps.geo.${awsRegion}.amazonaws.com/v2/styles/${mapStyle}/descriptor?key=${encodeURIComponent(locationApiKey)}&color-scheme=Light`
}

export function MapPanel({ rows, hospitals, hospitalError, drawerOpen, onUnavailable }: Props) {
  const { selectedId, select } = useSelection()
  const panelRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const lastResidents = useRef('')
  const fitted = useRef(false)
  const onUnavailableRef = useRef(onUnavailable)
  onUnavailableRef.current = onUnavailable
  const [ready, setReady] = useState(false)
  const [drawerInset, setDrawerInset] = useState(0)
  const [listInset, setListInset] = useState(0)
  const [route, setRoute] = useState<{ key: string; data?: HospitalRoute; error?: string } | null>(null)

  // How much of the map the details panel covers on the right, so the camera and
  // the badge stay in the part Jane can see.
  const measureInset = () => {
    const panel = panelRef.current
    const drawer = document.querySelector<HTMLElement>('.drawer')
    if (!panel || !drawer || window.innerWidth <= 1000) return 0
    return Math.max(0, panel.offsetLeft + panel.offsetWidth - drawer.offsetLeft)
  }

  // How much of the map the ranked list covers on the left once its slide finishes:
  // all of it with nobody selected, only its strip while someone is.
  const measureListInset = (collapsed: boolean) => {
    const dock = document.querySelector<HTMLElement>('.list-dock')
    if (!dock || getComputedStyle(dock).position !== 'absolute') return 0 // stacked layout
    return collapsed ? PEEK_PX : dock.offsetWidth
  }

  const zoneBounds = useRef<maplibregl.LngLatBounds | null>(null)
  const fitZone = (duration: number) => {
    if (!zoneBounds.current) return
    mapRef.current!.fitBounds(zoneBounds.current, {
      padding: { top: 80, bottom: 80, right: 80, left: 80 + measureListInset(false) },
      maxZoom: 15, duration,
    })
  }

  useEffect(() => {
    const map = new maplibregl.Map({
      container: canvasRef.current!,
      style: styleUrl(),
      center: SAN_JOSE,
      zoom: 13,
      attributionControl: { compact: true },
    })
    let loaded = false
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.setMissingStyleImageResolver(async (id) => {
      const img = await drawImage(id)
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
      const id = e.features?.[0]?.properties?.id as string | undefined
      if (id) select(id)
    })
    map.on('mouseenter', 'residents', () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', 'residents', () => (map.getCanvas().style.cursor = ''))
    map.on('click', 'hospitals', (e) => {
      const feature = e.features?.[0]
      if (!feature || feature.geometry.type !== 'Point') return
      const text = document.createElement('div')
      text.textContent = `${feature.properties?.name} · ${feature.properties?.address}`
      new maplibregl.Popup().setLngLat(feature.geometry.coordinates as [number, number]).setDOMContent(text).addTo(map)
    })
    map.on('mouseenter', 'hospitals', () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', 'hospitals', () => (map.getCanvas().style.cursor = ''))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [select])

  // Pins: setData only when something actually changed.
  useEffect(() => {
    if (!ready) return
    const fc = residentFeatures(rows, selectedId)
    const json = JSON.stringify(fc)
    if (json === lastResidents.current) return
    lastResidents.current = json
    residentsSource(mapRef.current!).setData(fc)
  }, [ready, rows, selectedId])

  useEffect(() => {
    if (!ready) return
    const source = mapRef.current!.getSource('hospitals') as maplibregl.GeoJSONSource
    source.setData(hospitalFeatures(hospitals))
  }, [ready, hospitals])

  // Fit to the zone once, when the residents first arrive.
  useEffect(() => {
    if (!ready || fitted.current || !rows.length || (!hospitals.length && !hospitalError)) return
    fitted.current = true
    const bounds = new maplibregl.LngLatBounds()
    rows.forEach((r) => bounds.extend([r.lng, r.lat]))
    hospitals.forEach((h) => bounds.extend([h.lng, h.lat]))
    zoneBounds.current = bounds
    if (!drawerOpen) fitZone(0)
  }, [ready, rows, hospitals, hospitalError, drawerOpen])

  // Closing the details slides the list back over the map: bring the whole zone back
  // into the part of the map left showing.
  const wasOpen = useRef(drawerOpen)
  useEffect(() => {
    if (ready && wasOpen.current && !drawerOpen) fitZone(900)
    wasOpen.current = drawerOpen
  }, [ready, drawerOpen])

  useLayoutEffect(() => {
    const update = () => {
      setDrawerInset(drawerOpen ? measureInset() : 0)
      setListInset(measureListInset(drawerOpen))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [drawerOpen])

  // Bring the selected person into the visible part of the map, once per selection.
  // A string key, so a poll that returns the same person doesn't move the camera.
  const selectedPos = rows.find((r) => r.id === selectedId)
  const selectedLngLat = selectedPos ? `${selectedPos.lng},${selectedPos.lat}` : null
  useEffect(() => {
    if (!ready || !selectedLngLat) return
    const [lng, lat] = selectedLngLat.split(',').map(Number)
    // An offset, not padding: easeTo's padding sticks to the map and would be added to
    // every later fitBounds, zooming the route and the zone far too far out.
    mapRef.current!.easeTo({
      center: [lng, lat],
      offset: [(measureListInset(true) - measureInset()) / 2, 25],
      duration: 900,
    })
  }, [ready, selectedLngLat])

  // Primitive dependencies keep queue polling from requesting or refitting a route.
  const routeKey = selectedPos ? JSON.stringify([
    selectedPos.id, selectedPos.lng, selectedPos.lat, selectedPos.nearest_hospital_id,
  ]) : null
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current!
    const source = map.getSource('hospital-route') as maplibregl.GeoJSONSource
    source.setData(EMPTY)
    if (!routeKey) return
    const [id, lng, lat] = JSON.parse(routeKey) as [string, number, number]
    const controller = new AbortController()
    getHospitalRoute(id, controller.signal).then((data) => {
      if (controller.signal.aborted) return
      source.setData({ type: 'Feature', properties: {}, geometry: data.geometry })
      setRoute({ key: routeKey, data })
      const bounds = new maplibregl.LngLatBounds()
      data.geometry.coordinates.forEach((pos) => bounds.extend(pos))
      bounds.extend([data.hospital.lng, data.hospital.lat])
      bounds.extend([lng, lat])
      // Frame home, route and hospital with room around them, so the drive reads at a glance.
      map.fitBounds(bounds, {
        padding: { top: 130, bottom: 90, left: 90 + measureListInset(true), right: 90 + measureInset() },
        maxZoom: 14.5, duration: 1200, essential: true,
      })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setRoute({ key: routeKey, error: error instanceof Error ? error.message : 'Hospital route unavailable' })
      }
    })
    return () => {
      controller.abort()
    }
  }, [ready, routeKey])

  const currentRoute = route?.key === routeKey ? route : null

  return (
    <section className="panel map-panel" ref={panelRef} aria-label="Map of residents and hospitals">
      <div className="map-canvas" ref={canvasRef} />

      {routeKey && (
        <div className="map-route" style={{ left: listInset + 12, right: drawerInset + 12 }} role="status" aria-live="polite">
          {currentRoute?.data ? (
            <>
              <strong>{span(currentRoute.data.drive_minutes)} drive to {currentRoute.data.hospital.name}</strong>
              <span>{currentRoute.data.distance_km.toFixed(1)} km · Traffic as of {clock(currentRoute.data.computed_at)}</span>
            </>
          ) : currentRoute?.error ? (
            <span>Hospital route unavailable: {currentRoute.error}</span>
          ) : <span>Finding hospital route…</span>}
        </div>
      )}

      {/* With the details open, the strip of map left is too narrow; the details name the level in words. */}
      {!drawerOpen && (
        <div className="map-legend" aria-label="Map legend"
          style={{ left: listInset + 12, maxWidth: `calc(100% - ${listInset + 160}px)` }}>
          {LEVEL_ORDER.map((s) => (
            <span key={s} className="lg-item">
              <Glyph status={s} size={11} />
              {LEVEL_LABEL[s]}
            </span>
          ))}
          <span className="lg-note">Numbers are places in line</span>
          <span className="lg-item"><span style={{ color: '#286791' }} aria-hidden="true">●</span> Hospitals</span>
        </div>
      )}
    </section>
  )
}
