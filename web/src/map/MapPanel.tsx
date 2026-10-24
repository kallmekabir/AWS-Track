// Amazon Location map (Monochrome, Light) with every resident as a pin colored by
// level and numbered by place in line. Polls never move the camera: it fits the zone
// once, and moves once per selection to bring that person into view.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre 6 loads its worker from a file next to its own module; Vite's dep
// pre-bundling moves that module, so point it at the worker explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { Hospital, Resident } from '../api'
import { config } from '../config'
import { LEVEL_LABEL, LEVEL_ORDER } from '../lib/levels'
import { useSelection } from '../state/selection'
import { Glyph } from '../ui/Glyph'
import { addLayers, hospitalFeatures, residentFeatures, residentsSource } from './layers'
import { drawImage } from './pins'
import './MapPanel.css'

maplibregl.setWorkerUrl(workerUrl)

const SAN_JOSE: [number, number] = [-121.8863, 37.3382]

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

  // How much of the map the details panel covers on the right, so the camera and
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
    mapRef.current!.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 0 })
  }, [ready, rows, hospitals, hospitalError])

  useLayoutEffect(() => {
    const update = () => setDrawerInset(drawerOpen ? measureInset() : 0)
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
    mapRef.current!.easeTo({
      center: [lng, lat],
      padding: { top: 40, bottom: 60, left: 40, right: 40 + measureInset() },
      duration: 700,
    })
  }, [ready, selectedLngLat])

  return (
    <section className="panel map-panel" ref={panelRef} aria-label="Map of residents and hospitals">
      <div className="map-canvas" ref={canvasRef} />

      {/* With the details open, the strip of map left is too narrow; the details name the level in words. */}
      {!drawerOpen && (
        <div className="map-legend" aria-label="Map legend">
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

      <span className="map-badge" style={{ right: drawerInset + 12 }}>
        {hospitalError ? 'Hospital locations unavailable' : `Made-up residents · ${hospitals.length} hospitals`}
      </span>
    </section>
  )
}
