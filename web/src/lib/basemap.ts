/**
 * The basemap, carried in the app rather than fetched.
 *
 * TripStash is used on buses, in hostels and across borders, which is exactly
 * where a tile server is unreachable. A raster basemap that only works with
 * signal would leave the traveller looking at a grey grid at the moment the
 * map matters most, so the ground is drawn from vector country geometry that
 * ships with the app: real coastlines and real borders, no key, no request.
 *
 * Tiles still layer on top when the network allows — they add the streets this
 * cannot. But the map underneath is always there.
 *
 * The data is Natural Earth via `world-atlas`, which is public domain. Two
 * levels: the 1:110m world for the zoomed-out view, and 1:50m once a country
 * fills the screen, loaded only when it is needed.
 */
import type { Feature, FeatureCollection, Geometry } from 'geojson'

export type Detail = 'world' | 'regional'

export interface CountryProperties {
  name: string
}

export type CountryFeature = Feature<Geometry, CountryProperties>

const cache = new Map<Detail, Promise<FeatureCollection<Geometry, CountryProperties>>>()

/** Zoom at which the coarse world outline starts to look like a polygon. */
export const REGIONAL_FROM_ZOOM = 4

async function build(detail: Detail): Promise<FeatureCollection<Geometry, CountryProperties>> {
  // Dynamic so the 1:50m file is its own chunk and is never fetched by someone
  // who only ever looks at the world view.
  const [{ feature }, topology] = await Promise.all([
    import('topojson-client'),
    detail === 'world'
      ? import('world-atlas/countries-110m.json')
      : import('world-atlas/countries-50m.json'),
  ])
  const topo = (topology as { default?: unknown }).default ?? topology
  // The typings for the topology files are loose; the shape is known.
  const collection = feature(
    topo as never,
    (topo as { objects: { countries: unknown } }).objects.countries as never,
  ) as unknown as FeatureCollection<Geometry, CountryProperties>
  return collection
}

/** Country polygons at the requested detail. Fetched once, then reused. */
export function loadCountries(
  detail: Detail,
): Promise<FeatureCollection<Geometry, CountryProperties>> {
  const existing = cache.get(detail)
  if (existing) return existing
  const pending = build(detail).catch((error) => {
    // A failed load must not poison the cache: the next pan should retry.
    cache.delete(detail)
    throw error
  })
  cache.set(detail, pending)
  return pending
}

/**
 * Natural Earth's names are English and mostly match what a traveller types,
 * but a few differ from the common form. Only the ones that actually come up
 * are listed; guessing at the rest would be worse than matching on the name.
 */
const ALIASES: Record<string, string> = {
  'United States of America': 'United States',
  'Dem. Rep. Congo': 'Democratic Republic of the Congo',
  'Dominican Rep.': 'Dominican Republic',
  'Falkland Is.': 'Falkland Islands',
  'Fr. S. Antarctic Lands': 'French Southern and Antarctic Lands',
  'Bosnia and Herz.': 'Bosnia and Herzegovina',
  'Central African Rep.': 'Central African Republic',
  'Eq. Guinea': 'Equatorial Guinea',
  'S. Sudan': 'South Sudan',
  'Solomon Is.': 'Solomon Islands',
  'Czechia': 'Czech Republic',
}

export function countryName(feature: CountryFeature): string {
  const raw = feature.properties?.name ?? ''
  return ALIASES[raw] ?? raw
}

/** Loose match, so "Brazil" finds the polygon whatever case it arrives in. */
export function matchesCountry(feature: CountryFeature, name: string | null): boolean {
  if (!name) return false
  const wanted = name.trim().toLowerCase()
  if (!wanted) return false
  const raw = (feature.properties?.name ?? '').toLowerCase()
  return raw === wanted || countryName(feature).toLowerCase() === wanted
}
