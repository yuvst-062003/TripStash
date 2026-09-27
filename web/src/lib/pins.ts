/**
 * Which markers belong on the map right now.
 *
 * Pure, and deliberately separate from the component that draws them: the
 * rules about what gets a pin are worth testing, and a test should not need a
 * WebGL context to check that a place with no coordinates is left off.
 */
import type { Scope } from './scope'

export interface Pin {
  id: string
  name: string
  lat: number
  lon: number
  /** True for the one the current scope names. Coral means "you are here". */
  here: boolean
  yours: number
  found: number
}

interface Placed {
  lat: number | null
  lon: number | null
}

type CountryRow = Placed & { key: string; name: string; video_count: number; found_count?: number }
type CityRow = Placed & { key: string; name: string; video_count: number; found_count?: number }
type PlaceRow = Placed & {
  trip_place_id: string
  name: string
  video_count: number
  found_count?: number
}

export interface PinData {
  countries?: CountryRow[]
  cities?: CityRow[]
  places?: PlaceRow[]
}

export function pinsFor(scope: Scope, data: PinData): Pin[] {
  const selected =
    scope.level === 'country'
      ? scope.countryKey
      : scope.level === 'city'
        ? scope.cityKey
        : scope.level === 'place'
          ? scope.tripPlaceId
          : null

  type Row = { id: string; name: string; total: number; found: number } & Placed
  const rows: Row[] =
    scope.level === 'world'
      ? (data.countries ?? []).map((c) => ({
          id: c.key,
          name: c.name,
          total: c.video_count,
          found: c.found_count ?? 0,
          lat: c.lat,
          lon: c.lon,
        }))
      : scope.level === 'country'
        ? (data.cities ?? []).map((c) => ({
            id: c.key,
            name: c.name,
            total: c.video_count,
            found: c.found_count ?? 0,
            lat: c.lat,
            lon: c.lon,
          }))
        : (data.places ?? []).map((p) => ({
            id: p.trip_place_id,
            name: p.name,
            total: p.video_count,
            found: p.found_count ?? 0,
            lat: p.lat,
            lon: p.lon,
          }))

  return rows
    .filter((r): r is Row & { lat: number; lon: number } => r.lat !== null && r.lon !== null)
    .map((r) => ({
      id: r.id,
      name: r.name,
      lat: r.lat,
      lon: r.lon,
      here: r.id === selected,
      yours: Math.max(0, r.total - r.found),
      found: r.found,
    }))
}

