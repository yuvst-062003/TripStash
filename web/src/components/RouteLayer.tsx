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
import { useEffect, useState } from 'react'
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
  // Bumped once the style is up, to run the drawing below again.
  const [styleReady, setStyleReady] = useState(0)

  useEffect(() => {
    if (!map || map.isStyleLoaded()) return

    // The trip almost always arrives before the imagery does, and a layer
    // cannot be added to a style that has not loaded. The effect below would
    // then return having drawn nothing - and never run again, because its
    // dependencies do not change once the data has landed. The globe came up
    // bare: no countries, no route, no stops, and no error either.
    const ready = () => {
      if (!map.isStyleLoaded()) return
      map.off('styledata', ready)
      setStyleReady((n) => n + 1)
    }
    map.on('styledata', ready)
    return () => {
      map.off('styledata', ready)
    }
  }, [map])

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

    if (!map.getLayer(`${COUNTRIES}-label`)) {
      // The country's name, set on the country. Plain white text with a halo
      // and no box: a box is a second shape competing with the border that is
      // already there, and the reference has none.
      //
      // MapLibre places a polygon's label at its pole of inaccessibility - the
      // point furthest from any edge - so the name lands in the widest part of
      // the country rather than on its coastline.
      map.addLayer({
        id: `${COUNTRIES}-label`,
        type: 'symbol',
        source: COUNTRIES,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 13, 4, 17, 7, 20],
          'text-transform': 'none',
          'text-padding': 10,
          // Lifted clear of the country's centre, because that is exactly
          // where the route runs: a small country like Guatemala had its name
          // sitting on the line and on its own stop dot at the same time.
          'text-offset': [0, -1.1],
          'text-anchor': 'bottom',
          'text-allow-overlap': false,
          // A bigger country wins the space when two names compete, which is
          // also the one whose name is harder to guess from its shape.
          'symbol-sort-key': ['*', -1, ['coalesce', ['get', 'area'], 0]],
          // Fades out once the country fills the screen: at that point its
          // name is in the trail at the top and on the page below, and a third
          // copy across the middle of the map is just in the way.
          'text-optional': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(4, 13, 26, 0.9)',
          'text-halo-width': 1.8,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.95, 6, 0.9, 8, 0],
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
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 4, 3, 7, 8, 12],
          'line-blur': 4,
          // Low enough to read as light around the line rather than as a
          // second, fatter line. The first pass was a scratch across the globe.
          'line-opacity': 0.22,
        },
      })
      map.addLayer({
        id: ROUTE,
        type: 'line',
        source: ROUTE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': COLOURS.route,
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1.4, 3, 2.2, 8, 3.4],
        },
      })
    }

    if (!map.getLayer(STOPS)) {
      // Drawn above the labels on purpose: a stop is the one thing on this
      // screen that must never be obscured, because it is the trip itself.
      map.addLayer({
        id: STOPS,
        type: 'circle',
        source: STOPS,
        paint: {
          // Small on purpose. Six stops within one isthmus merged into a single
          // blob at the first size, which said "somewhere around here" when the
          // whole point of a dot is to say exactly where.
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            1,
            ['case', ['get', 'here'], 5, 3],
            5,
            ['case', ['get', 'here'], 7, 4.5],
          ],
          'circle-color': '#ffffff',
          'circle-stroke-color': COLOURS.route,
          'circle-stroke-width': ['case', ['get', 'here'], 2.5, 1.5],
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
  }, [map, countries, stops, here, hereIndex, onPressCountry, styleReady])

  return null
}
