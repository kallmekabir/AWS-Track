// The residents layer. Pins are a symbol layer rather than a plain circle layer so
// "A person must check" can be a diamond and the top ten pins can carry their place in line.
import type { FeatureCollection } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { Hospital, Resident } from '../api'
import { pinId } from './pins'

export const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** Only the top ten pins carry their number, so the list and the map read together. */
const NUMBERED = 10

export function addLayers(map: MapLibreMap) {
  map.addSource('hospitals', { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'hospitals', type: 'circle', source: 'hospitals',
    paint: { 'circle-radius': 8, 'circle-color': '#286791', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
  })
  map.addLayer({
    id: 'hospital-labels', type: 'symbol', source: 'hospitals',
    layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-anchor': 'top', 'text-offset': [0, 1] },
    paint: { 'text-color': '#17496a', 'text-halo-color': '#fff', 'text-halo-width': 2 },
  })
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

export function hospitalFeatures(hospitals: Hospital[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: hospitals.map((h) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [h.lng, h.lat] },
      properties: { id: h.id, name: h.name, address: h.address },
    })),
  }
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
