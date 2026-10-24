// S06 scratch page: proves the careline-map-key renders Amazon Location tiles on localhost.
// Open http://localhost:5173/map-smoke.html after `npm run dev`. Replaced by src/map/ (W tasks).
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre 6 loads its worker from a file next to its own module; Vite's dep
// pre-bundling moves that module, so point it at the worker explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

maplibregl.setWorkerUrl(workerUrl)

const region = import.meta.env.VITE_AWS_REGION ?? 'us-east-1'
const style = import.meta.env.VITE_MAP_STYLE ?? 'Monochrome'
const key = import.meta.env.VITE_LOCATION_API_KEY
const status = document.getElementById('status')!

if (!key) {
  status.textContent = 'Missing VITE_LOCATION_API_KEY in web/.env.local'
} else {
  const map = new maplibregl.Map({
    container: 'map',
    style: `https://maps.geo.${region}.amazonaws.com/v2/styles/${style}/descriptor?key=${key}&color-scheme=Light`,
    center: [-121.8863, 37.3382], // downtown San Jose (lng, lat)
    zoom: 11,
  })
  map.addControl(new maplibregl.NavigationControl(), 'top-right')
  map.on('load', () => {
    status.textContent = `Map loaded: ${style} Light`
  })
  map.on('error', (e: maplibregl.ErrorEvent) => {
    status.textContent = `Map error: ${e.error?.message ?? 'unknown'}`
  })
}
