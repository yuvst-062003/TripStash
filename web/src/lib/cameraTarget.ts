/**
 * Where to point the camera for one scope.
 *
 * Countries are boxed rather than centred, because no single centre-and-zoom
 * fits both Chile and Belize. The box comes from the same atlas the country
 * shapes are drawn from, so a country's outline and its camera target can never
 * disagree about where that country is.
 *
 * Every fallback here goes one level OUT, never to (0, 0). A place with no
 * coordinates should leave you looking at its city; landing at zero would put
 * you in the Gulf of Guinea and look like a bug, because it is one.
 */
import { geoBounds } from 'd3-geo'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import countries110 from 'world-atlas/countries-110m.json'
import type { Scope } from './scope'

export type Bounds = [[number, number], [number, number]]

export type CameraTarget =
  | { kind: 'bounds'; bounds: Bounds }
  | { kind: 'point'; center: [number, number]; zoom: number }

const WHOLE_WORLD: CameraTarget = { kind: 'point', center: [0, 20], zoom: 1 }

/** The zoom a city reads well at, and the one a single address does. */
export const CITY_ZOOM = 11
export const PLACE_ZOOM = 14

/**
 * Match a country however it is spelled.
 *
 * The atlas writes "Panama" where the traveller's data may write "Panamá".
 * This is the same rule `Globe.tsx` and the API's `normalise_country` use, kept
 * identical on purpose so the three can never disagree.
 */
function countryKey(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

const BY_NAME: Map<string, Bounds> = (() => {
  const shapes = feature(
    countries110 as unknown as Topology,
    (countries110 as unknown as Topology).objects.countries as GeometryCollection,
  ).features as { properties?: { name?: string } }[]

  const found = new Map<string, Bounds>()
  for (const shape of shapes) {
    const key = countryKey(shape.properties?.name)
    if (!key) continue
    const [[west, south], [east, north]] = geoBounds(shape as never)
    found.set(key, [
      [west, south],
      [east, north],
    ])
  }
  return found
})()

export function countryBounds(name: string): Bounds | null {
  return BY_NAME.get(countryKey(name)) ?? null
}

interface Placed {
  lat: number | null
  lon: number | null
}

export interface TargetData {
  countryName?: string
  city?: Placed
  place?: Placed
  /**
   * Where the trip's countries are, for framing the world level.
   *
   * The literal whole globe spends most of the screen on oceans the traveller
   * has nothing in, and crushes their countries into a corner where the pins
   * sit on top of each other. Framing what they actually have is both more
   * useful and more legible.
   */
  countryPoints?: { lat: number; lon: number }[]
}

/** Enough zoom to read a continent, for a trip that touches one country. */
const LONE_COUNTRY_ZOOM = 3

function point(spot: Placed | undefined, zoom: number): CameraTarget | null {
  if (!spot || spot.lat === null || spot.lon === null) return null
  return { kind: 'point', center: [spot.lon, spot.lat], zoom }
}

export function targetFor(scope: Scope, data: TargetData): CameraTarget {
  switch (scope.level) {
    case 'world': {
      const points = data.countryPoints ?? []
      if (points.length === 0) return WHOLE_WORLD
      if (points.length === 1) {
        // A single country is a place to look at. Fitting a zero-width box
        // would zoom to the maximum and land you on somebody's roof.
        return { kind: 'point', center: [points[0].lon, points[0].lat], zoom: LONE_COUNTRY_ZOOM }
      }
      const lats = points.map((p) => p.lat)
      const lons = points.map((p) => p.lon)
      return {
        kind: 'bounds',
        bounds: [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
      }
    }

    case 'country': {
      const box = data.countryName ? countryBounds(data.countryName) : null
      return box ? { kind: 'bounds', bounds: box } : WHOLE_WORLD
    }

    case 'city':
      return (
        point(data.city, CITY_ZOOM) ??
        targetFor({ level: 'country', countryKey: scope.countryKey }, data)
      )

    case 'place':
      return (
        point(data.place, PLACE_ZOOM) ??
        point(data.city, CITY_ZOOM) ??
        targetFor({ level: 'country', countryKey: scope.countryKey }, data)
      )
  }
}
