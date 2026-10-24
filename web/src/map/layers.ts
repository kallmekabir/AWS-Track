// The residents layer. Pins are a symbol layer rather than a plain circle layer so
// "A person must check" can be a diamond and the top ten pins can carry their place in line.
// Suppliers join the map once app/location.py exposes them (docs/NEXT_STEPS.md, task 10).
import type { FeatureCollection } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { Resident } from '../api'
import { pinId } from './pins'

export const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** Only the top ten pins carry their number, so the list and the map read together. */
const NUMBERED = 10

export function addLayers(map: MapLibreMap) {
  map.addSource('residents', { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'residents',
    type: 'symbol',
    source: 'residents',
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': ['get', 'sort'],
    },
  })
}

/** Rows arrive in /queue order, so a row's position is its place in line. */
export function residentFeatures(rows: Resident[], selectedId: string | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows.map((r, i) => {
      const place = i + 1
      const selected = r.id === selectedId
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: {
          id: r.id,
          icon: pinId(r.status, place <= NUMBERED ? place : 0, selected),
          // Higher draws on top: the selected pin, then first in line down.
          sort: selected ? 1000 : 500 - place,
        },
      }
    }),
  }
}

export function residentsSource(map: MapLibreMap): GeoJSONSource {
  return map.getSource('residents') as GeoJSONSource
}
