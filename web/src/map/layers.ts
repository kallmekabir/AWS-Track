// Sources and layers for the map panel (map spec section 8.3). Residents are a symbol
// layer rather than a plain circle layer so review pins can be diamonds and the top
// ten pins can carry their rank number.
import type { FeatureCollection } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { PriorityRow } from '../api/types'
import { NAVY } from './colors'
import { pinId } from './pins'

export const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** Only the top ten pins carry their rank, so the list and the map read together. */
const NUMBERED = 10

export function addLayers(map: MapLibreMap) {
  map.addSource('route', { type: 'geojson', data: EMPTY })
  map.addSource('hospitals', { type: 'geojson', data: EMPTY })
  map.addSource('residents', { type: 'geojson', data: EMPTY })

  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 9 },
  })
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': NAVY, 'line-width': 4.5 },
  })
  map.addLayer({
    id: 'hospitals',
    type: 'symbol',
    source: 'hospitals',
    layout: { 'icon-image': 'hosp', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
  })
  map.addLayer({
    id: 'hospital-labels',
    type: 'symbol',
    source: 'hospitals',
    minzoom: 13,
    layout: {
      'icon-image': ['concat', 'hlabel|', ['get', 'hospital_id']],
      'icon-anchor': 'left',
      'icon-offset': [15, 0],
    },
  })
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

export function residentFeatures(rows: PriorityRow[], selectedId: string | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => {
      const selected = r.resident_id === selectedId
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: {
          resident_id: r.resident_id,
          icon: pinId(r.triage_group, r.rank <= NUMBERED ? r.rank : 0, selected),
          // Higher draws on top: the selected pin, then rank 1 down.
          sort: selected ? 1000 : 500 - r.rank,
        },
      }
    }),
  }
}

export function source(map: MapLibreMap, id: 'route' | 'hospitals' | 'residents'): GeoJSONSource {
  return map.getSource(id) as GeoJSONSource
}
