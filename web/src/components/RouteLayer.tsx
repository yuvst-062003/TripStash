/**
 * The trip drawn on the globe: the countries it crosses, and the line through
 * them.
 *
 * Added as map layers rather than as DOM markers, because a line has to follow
 * the curve of the globe and a fill has to be clipped by its horizon - neither
 * of which an element positioned on top of the canvas can do.
 *
 * Country fills are pressable, which is how a traveller enters one. That makes
 * this the only part of the map where the picture itself is the control, so
 * every country is also a row in the page below: the canvas is pixels, and
 * pixels cannot be reached by a keyboard or read aloud.
 */
import { useEffect } from 'react'
import type maplibregl from 'maplibre-gl'
import { COLOURS } from '../lib/mapStyle'
import { shapesFor } from '../lib/countryShapes'
import { routeFeature, stopFeatures, type Stop } from '../lib/route'

const COUNTRIES = 'trip-countries'
const ROUTE = 'trip-route'
const STOPS = 'trip-stops'

interface Props {
  map: maplibregl.Map | null
  /** Country names in travelling order. */
  countries: string[]
  /** The stops the line runs through, in order. */
  stops: Stop[]
  /** Which country is being looked at, if any. */
  here?: string | null
  /** Which stop the traveller is on, if any. */
  hereIndex?: number
  onPressCountry?: (name: string) => void
}

export default function RouteLayer({
  map,
  countries,
  stops,
  here,
  hereIndex,
  onPressCountry,
}: Props) {
  useEffect(() => {
    if (!map || !map.isStyleLoaded()) return

    const shapes = shapesFor(countries, here)
    const collection = (features: unknown[]) => ({ type: 'FeatureCollection', features }) as never

    // --- sources ------------------------------------------------------------
    const upsert = (id: string, data: unknown) => {
      const existing = map.getSource(id) as maplibregl.GeoJSONSource | undefined
      if (existing) existing.setData(data as never)
      else map.addSource(id, { type: 'geojson', data: data as never })
    }

    upsert(COUNTRIES, collection(shapes))
    upsert(ROUTE, routeFeature(stops))
    upsert(STOPS, collection(stopFeatures(stops, hereIndex)))

    // --- layers, added once -------------------------------------------------
    if (!map.getLayer(`${COUNTRIES}-fill`)) {
      map.addLayer({
        id: `${COUNTRIES}-fill`,
        type: 'fill',
        source: COUNTRIES,
        paint: {
          // The one you are in is brighter. Everywhere else you are going is
          // lit enough to read as "yours" and no more.
          'fill-color': ['case', ['get', 'here'], COLOURS.route, '#7fd4c1'],
          'fill-opacity': ['case', ['get', 'here'], 0.22, 0.1],
        },
      })
      map.addLayer({
        id: `${COUNTRIES}-line`,
        type: 'line',
        source: COUNTRIES,
        paint: {
          'line-color': COLOURS.border,
          'line-width': ['case', ['get', 'here'], 2.2, 1.2],
          'line-opacity': 0.9,
        },
      })
    }

    if (!map.getLayer(`${ROUTE}-glow`)) {
      // Two lines: a wide soft one under a tight bright one, which is what
      // makes the route read as lit rather than merely coloured.
      map.addLayer({
        id: `${ROUTE}-glow`,
        type: 'line',
        source: ROUTE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': COLOURS.route,
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 7, 6, 14],
          'line-blur': 6,
          'line-opacity': 0.35,
        },
      })
      map.addLayer({
        id: ROUTE,
        type: 'line',
        source: ROUTE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': COLOURS.route,
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 2.5, 6, 4.5],
        },
      })
    }

    if (!map.getLayer(STOPS)) {
      map.addLayer({
        id: STOPS,
        type: 'circle',
        source: STOPS,
        paint: {
          'circle-radius': ['case', ['get', 'here'], 8, 5.5],
          'circle-color': '#ffffff',
          'circle-stroke-color': COLOURS.route,
          'circle-stroke-width': ['case', ['get', 'here'], 3, 2],
        },
      })
    }

    // --- pressing a country -------------------------------------------------
    const press = (event: maplibregl.MapMouseEvent) => {
      const hit = map.queryRenderedFeatures(event.point, { layers: [`${COUNTRIES}-fill`] })[0]
      const name = hit?.properties?.name
      if (typeof name === 'string') onPressCountry?.(name)
    }
    const enter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const leave = () => {
      map.getCanvas().style.cursor = ''
    }

    map.on('click', `${COUNTRIES}-fill`, press)
    map.on('mouseenter', `${COUNTRIES}-fill`, enter)
    map.on('mouseleave', `${COUNTRIES}-fill`, leave)

    return () => {
      map.off('click', `${COUNTRIES}-fill`, press)
      map.off('mouseenter', `${COUNTRIES}-fill`, enter)
      map.off('mouseleave', `${COUNTRIES}-fill`, leave)
    }
  }, [map, countries, stops, here, hereIndex, onPressCountry])

  return null
}
