/**
 * The trip drawn as a line across the globe.
 *
 * Two kinds of leg, drawn differently because they are different: a bus
 * between neighbouring countries follows the ground, and a flight across a
 * continent does not. Distance decides which, because nobody takes a bus from
 * Mexico City to Rio and the app should not draw one.
 *
 * Flights arc. A line between two far-apart points drawn as two coordinates
 * is a straight line in screen space, which on a globe cuts through the
 * planet - so it is interpolated along the great circle instead, which is both
 * the shorter path and the one that looks right.
 */

export interface Stop {
  name: string
  lat: number | null
  lon: number | null
}

/** A stop that can actually be drawn. */
export interface PlacedStop {
  name: string
  lat: number
  lon: number
}

export type Leg = [PlacedStop, PlacedStop]

/** Beyond this, assume nobody is going overland. */
const FLIGHT_KM = 1500

const R_KM = 6371

const rad = (deg: number) => (deg * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

export function placed(stops: Stop[]): PlacedStop[] {
  return stops.filter(
    (s): s is PlacedStop => typeof s.lat === 'number' && typeof s.lon === 'number',
  )
}

export function legsOf(stops: Stop[]): Leg[] {
  const points = placed(stops)
  const legs: Leg[] = []
  for (let i = 0; i < points.length - 1; i += 1) legs.push([points[i], points[i + 1]])
  return legs
}

/** Distance between two points on the surface, in kilometres. */
export function distanceKm(a: PlacedStop, b: PlacedStop): number {
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function isFlight(a: PlacedStop, b: PlacedStop): boolean {
  return distanceKm(a, b) > FLIGHT_KM
}

/**
 * Points along the great circle between two places.
 *
 * Spherical interpolation rather than a straight average of the endpoints,
 * which is what makes a long leg bow the way a flight path does.
 */
export function greatCircle(a: PlacedStop, b: PlacedStop, steps = 48): [number, number][] {
  const lat1 = rad(a.lat)
  const lon1 = rad(a.lon)
  const lat2 = rad(b.lat)
  const lon2 = rad(b.lon)

  const d =
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin((lat2 - lat1) / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
        ),
      ),
    )

  // The two ends are the same place: no arc to draw, and dividing by sin(0)
  // below would produce NaN for every point.
  if (d === 0) return Array.from({ length: steps }, () => [a.lon, a.lat])

  const out: [number, number][] = []
  for (let i = 0; i < steps; i += 1) {
    const f = i / (steps - 1)
    const A = Math.sin((1 - f) * d) / Math.sin(d)
    const B = Math.sin(f * d) / Math.sin(d)
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2)
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2)
    const z = A * Math.sin(lat1) + B * Math.sin(lat2)
    out.push([deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.hypot(x, y)))])
  }
  return out
}

export interface RouteFeature {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: { type: 'LineString'; coordinates: [number, number][] }
}

/**
 * The whole trip as one line.
 *
 * Ground legs are drawn straight between their stops for now; the road
 * geometry is fetched separately and spliced in when it arrives, so the route
 * is visible immediately rather than after a round trip to a routing service.
 */
export function routeFeature(
  stops: Stop[],
  roads?: Map<string, [number, number][]>,
): RouteFeature {
  const legs = legsOf(stops)
  const coordinates: [number, number][] = []

  for (const [from, to] of legs) {
    const known = roads?.get(legKey(from, to))
    const path = known?.length
      ? known
      : isFlight(from, to)
        ? greatCircle(from, to)
        : [
            [from.lon, from.lat] as [number, number],
            [to.lon, to.lat] as [number, number],
          ]

    // The previous leg already ended where this one starts.
    coordinates.push(...(coordinates.length ? path.slice(1) : path))
  }

  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }
}

/** A stable name for one leg, for caching its road geometry. */
export function legKey(a: PlacedStop, b: PlacedStop): string {
  return `${a.lon.toFixed(3)},${a.lat.toFixed(3)}>${b.lon.toFixed(3)},${b.lat.toFixed(3)}`
}

export interface StopFeature {
  type: 'Feature'
  properties: { name: string; order: number; here: boolean }
  geometry: { type: 'Point'; coordinates: [number, number] }
}

/** A dot per stop, numbered in travelling order. */
export function stopFeatures(stops: Stop[], hereIndex?: number): StopFeature[] {
  return placed(stops).map((stop, i) => ({
    type: 'Feature' as const,
    properties: { name: stop.name, order: i + 1, here: i === hereIndex },
    geometry: { type: 'Point' as const, coordinates: [stop.lon, stop.lat] },
  }))
}
