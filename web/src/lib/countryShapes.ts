/**
 * The countries the trip passes through, as shapes on the globe.
 *
 * Only those. A world with every border filled is a political map; a world
 * with six filled is this traveller's trip, and the fill is then information
 * rather than decoration.
 *
 * Shapes come from the same atlas the camera takes its country bounds from, so
 * a country's outline and the camera that flies to it can never disagree about
 * where that country is.
 */
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import countries110 from 'world-atlas/countries-110m.json'

export interface CountryShape {
  type: 'Feature'
  properties: { key: string; name: string; here: boolean }
  geometry: unknown
}

/**
 * Match a country however it is spelled.
 *
 * The same rule the camera and the API use - accents stripped, case folded -
 * kept identical on purpose so the three can never disagree about which
 * country is which.
 */
function countryKey(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

const ALL = (() => {
  const collection = feature(
    countries110 as unknown as Topology,
    (countries110 as unknown as Topology).objects.countries as GeometryCollection,
  ) as unknown as { features: { properties?: { name?: string }; geometry: unknown }[] }

  const byKey = new Map<string, { name: string; geometry: unknown }>()
  for (const shape of collection.features) {
    const name = shape.properties?.name
    if (!name) continue
    byKey.set(countryKey(name), { name, geometry: shape.geometry })
  }
  return byKey
})()

/**
 * Shapes for the named countries, in the order given.
 *
 * A name the atlas does not carry is left out rather than guessed at: a
 * mis-drawn country is worse than an absent one, because it looks deliberate.
 */
export function shapesFor(names: string[], hereName?: string | null): CountryShape[] {
  const here = countryKey(hereName)
  const out: CountryShape[] = []
  const seen = new Set<string>()

  for (const name of names) {
    const key = countryKey(name)
    if (!key || seen.has(key)) continue
    const shape = ALL.get(key)
    if (!shape) continue
    seen.add(key)
    out.push({
      type: 'Feature',
      properties: { key, name: shape.name, here: Boolean(here) && key === here },
      geometry: shape.geometry,
    })
  }
  return out
}

/** Whether the atlas knows a country at all, for callers that want to say so. */
export function atlasKnows(name: string): boolean {
  return ALL.has(countryKey(name))
}
