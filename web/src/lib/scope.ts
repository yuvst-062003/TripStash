/**
 * Where the map is looking.
 *
 * One value. The camera reads it, the page over the map reads it, the filter
 * chips read it, and the assistant inherits it. Three things write it - a press
 * on the map, a press in the list, and an answer from the assistant - and they
 * cannot disagree, because there is only one value to disagree about.
 *
 * The URL mirrors it so a link still opens the right city and the phone's own
 * back button still means something. It no longer decides what is mounted:
 * that was the old shape, and it is why moving between a country and a city
 * felt like changing tabs. One map stays mounted; only this value changes.
 */
export type Scope =
  | { level: 'world' }
  | { level: 'country'; countryKey: string }
  | { level: 'city'; countryKey: string; cityKey: string }
  | { level: 'place'; countryKey: string; cityKey: string; tripPlaceId: string }

export const WORLD: Scope = { level: 'world' }

/** Display names for a scope's levels, as far as they have loaded. */
export interface ScopeNames {
  country?: string
  city?: string
  place?: string
}

export interface Crumb {
  label: string
  scope: Scope
  here: boolean
}

const DEPTH = { world: 0, country: 1, city: 2, place: 3 } as const

/** How deep a scope is. Comparing two tells you whether you are going in or out. */
export function depthOf(scope: Scope): number {
  return DEPTH[scope.level]
}

export function parseScope(pathname: string): Scope {
  if (!pathname.startsWith('/map')) return WORLD
  const parts = pathname
    .slice('/map'.length)
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)

  const [countryKey, cityKey, tripPlaceId] = parts
  switch (parts.length) {
    case 0:
      return WORLD
    case 1:
      return { level: 'country', countryKey }
    case 2:
      return { level: 'city', countryKey, cityKey }
    case 3:
      return { level: 'place', countryKey, cityKey, tripPlaceId }
    default:
      // More segments than any level has.
      return WORLD
  }
}

export function scopePath(scope: Scope): string {
  const keys =
    scope.level === 'world'
      ? []
      : scope.level === 'country'
        ? [scope.countryKey]
        : scope.level === 'city'
          ? [scope.countryKey, scope.cityKey]
          : [scope.countryKey, scope.cityKey, scope.tripPlaceId]
  return ['/map', ...keys.map(encodeURIComponent)].join('/')
}

export function parentOf(scope: Scope): Scope | null {
  switch (scope.level) {
    case 'world':
      return null
    case 'country':
      return WORLD
    case 'city':
      return { level: 'country', countryKey: scope.countryKey }
    case 'place':
      return { level: 'city', countryKey: scope.countryKey, cityKey: scope.cityKey }
  }
}

export function crumbsOf(scope: Scope, names: ScopeNames): Crumb[] {
  const steps: Crumb[] = [{ label: 'World', scope: WORLD, here: scope.level === 'world' }]
  if (scope.level === 'world') return steps

  steps.push({
    label: names.country ?? scope.countryKey,
    scope: { level: 'country', countryKey: scope.countryKey },
    here: scope.level === 'country',
  })
  if (scope.level === 'country') return steps

  steps.push({
    label: names.city ?? scope.cityKey,
    scope: { level: 'city', countryKey: scope.countryKey, cityKey: scope.cityKey },
    here: scope.level === 'city',
  })
  if (scope.level === 'city') return steps

  steps.push({ label: names.place ?? 'Here', scope, here: true })
  return steps
}
