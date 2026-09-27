import { describe, expect, it } from 'vitest'
import { WORLD, crumbsOf, depthOf, parentOf, parseScope, scopePath } from './scope'

describe('parseScope', () => {
  it('reads the world', () => {
    expect(parseScope('/map')).toEqual({ level: 'world' })
    expect(parseScope('/map/')).toEqual({ level: 'world' })
  })

  it('reads a country', () => {
    expect(parseScope('/map/guatemala')).toEqual({ level: 'country', countryKey: 'guatemala' })
  })

  it('reads a city', () => {
    expect(parseScope('/map/guatemala/antigua')).toEqual({
      level: 'city',
      countryKey: 'guatemala',
      cityKey: 'antigua',
    })
  })

  it('reads a place', () => {
    expect(parseScope('/map/guatemala/antigua/tp-7')).toEqual({
      level: 'place',
      countryKey: 'guatemala',
      cityKey: 'antigua',
      tripPlaceId: 'tp-7',
    })
  })

  it('decodes a key with a space in it', () => {
    expect(parseScope('/map/costa%20rica')).toEqual({ level: 'country', countryKey: 'costa rica' })
  })

  // A stale link from an older build, or one someone hand-edited. The world is
  // the one answer that is never wrong.
  it('falls back to the world rather than throwing', () => {
    expect(parseScope('/map/a/b/c/d/e')).toEqual({ level: 'world' })
    expect(parseScope('/somewhere/else')).toEqual({ level: 'world' })
  })
})

describe('scopePath', () => {
  it('round-trips every level', () => {
    const all = [
      WORLD,
      { level: 'country', countryKey: 'guatemala' },
      { level: 'city', countryKey: 'guatemala', cityKey: 'antigua' },
      { level: 'place', countryKey: 'guatemala', cityKey: 'antigua', tripPlaceId: 'tp-7' },
    ] as const
    for (const scope of all) expect(parseScope(scopePath(scope))).toEqual(scope)
  })

  it('encodes a key with a space in it', () => {
    expect(scopePath({ level: 'country', countryKey: 'costa rica' })).toBe('/map/costa%20rica')
  })
})

describe('parentOf', () => {
  it('steps out one level at a time', () => {
    const place = { level: 'place', countryKey: 'g', cityKey: 'a', tripPlaceId: 't' } as const
    const city = parentOf(place)!
    expect(city).toEqual({ level: 'city', countryKey: 'g', cityKey: 'a' })
    expect(parentOf(city)).toEqual({ level: 'country', countryKey: 'g' })
    expect(parentOf(parentOf(city)!)).toEqual(WORLD)
  })

  it('has nothing above the world', () => {
    expect(parentOf(WORLD)).toBeNull()
  })
})

describe('depthOf', () => {
  it('orders the levels, which is all "in or out" needs to know', () => {
    expect(depthOf(WORLD)).toBe(0)
    expect(depthOf({ level: 'country', countryKey: 'g' })).toBe(1)
    expect(depthOf({ level: 'city', countryKey: 'g', cityKey: 'a' })).toBe(2)
    expect(depthOf({ level: 'place', countryKey: 'g', cityKey: 'a', tripPlaceId: 't' })).toBe(3)
  })
})

describe('crumbsOf', () => {
  it('names each level from the display names it is given', () => {
    const crumbs = crumbsOf(
      { level: 'city', countryKey: 'guatemala', cityKey: 'antigua' },
      { country: 'Guatemala', city: 'Antigua' },
    )
    expect(crumbs.map((c) => c.label)).toEqual(['World', 'Guatemala', 'Antigua'])
    expect(crumbs[1].scope).toEqual({ level: 'country', countryKey: 'guatemala' })
  })

  // The old country heading printed the URL key - "guatemala" - because nobody
  // resolved it. The trail must never do that.
  it('falls back to the key only until the real name has loaded', () => {
    expect(crumbsOf({ level: 'country', countryKey: 'guatemala' }, {}).map((c) => c.label)).toEqual([
      'World',
      'guatemala',
    ])
  })

  it('marks only the last step as where you are', () => {
    const crumbs = crumbsOf({ level: 'city', countryKey: 'g', cityKey: 'a' }, {})
    expect(crumbs.map((c) => c.here)).toEqual([false, false, true])
  })
})
