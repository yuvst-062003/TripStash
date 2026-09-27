import { describe, expect, it } from 'vitest'
import { WORLD } from './scope'
import { countryBounds, targetFor } from './cameraTarget'

describe('countryBounds', () => {
  it('boxes a country from the atlas', () => {
    const box = countryBounds('Guatemala')
    expect(box).not.toBeNull()
    const [[west, south], [east, north]] = box!
    // Guatemala sits west of the meridian and north of the equator.
    expect(west).toBeLessThan(-88)
    expect(east).toBeLessThan(-88)
    expect(south).toBeGreaterThan(13)
    expect(north).toBeLessThan(18)
  })

  it('matches names the way the rest of the app does, ignoring case and accents', () => {
    expect(countryBounds('guatemala')).toEqual(countryBounds('Guatemala'))
  })

  it('returns null for a country the atlas does not have', () => {
    expect(countryBounds('Country not known')).toBeNull()
    expect(countryBounds('')).toBeNull()
  })
})

describe('targetFor', () => {
  it('shows the whole world at the world level', () => {
    expect(targetFor(WORLD, {})).toEqual({ kind: 'point', center: [0, 20], zoom: 1 })
  })

  it('boxes a country it can find', () => {
    const target = targetFor({ level: 'country', countryKey: 'guatemala' }, { countryName: 'Guatemala' })
    expect(target.kind).toBe('bounds')
  })

  // A country the traveller has saved nothing in, with no atlas entry.
  it('falls back to the world rather than pointing nowhere', () => {
    expect(
      targetFor({ level: 'country', countryKey: 'nowhere' }, { countryName: 'Country not known' }),
    ).toEqual({ kind: 'point', center: [0, 20], zoom: 1 })
  })

  it('flies to a city at city zoom', () => {
    expect(
      targetFor({ level: 'city', countryKey: 'g', cityKey: 'antigua' }, { city: { lat: 14.56, lon: -90.73 } }),
    ).toEqual({ kind: 'point', center: [-90.73, 14.56], zoom: 11 })
  })

  it('flies to a place at street zoom', () => {
    expect(
      targetFor(
        { level: 'place', countryKey: 'g', cityKey: 'a', tripPlaceId: 't' },
        { place: { lat: 14.5, lon: -90.87 } },
      ),
    ).toEqual({ kind: 'point', center: [-90.87, 14.5], zoom: 14 })
  })

  // The column is nullable and a pasted plan can create a place without
  // coordinates. Landing at (0, 0) would put you in the Gulf of Guinea.
  it('stays on the city when a place has no coordinates, never at (0, 0)', () => {
    expect(
      targetFor(
        { level: 'place', countryKey: 'g', cityKey: 'a', tripPlaceId: 't' },
        { city: { lat: 14.56, lon: -90.73 }, place: { lat: null, lon: null } },
      ),
    ).toEqual({ kind: 'point', center: [-90.73, 14.56], zoom: 11 })
  })

  it('falls back through the city to the country when neither has coordinates', () => {
    const target = targetFor(
      { level: 'place', countryKey: 'guatemala', cityKey: 'a', tripPlaceId: 't' },
      { countryName: 'Guatemala', city: { lat: null, lon: null }, place: { lat: null, lon: null } },
    )
    expect(target.kind).toBe('bounds')
  })
})

describe('the world, when you have countries in it', () => {
  const guatemala = { lat: 15.5, lon: -90.3 }
  const belize = { lat: 17.2, lon: -88.5 }

  // Showing the literal whole globe wastes most of the screen on oceans the
  // traveller has nothing in, and crushes their six countries into a corner
  // where the pins overlap each other.
  it('frames the countries the trip actually touches', () => {
    const target = targetFor(WORLD, { countryPoints: [guatemala, belize] })
    expect(target.kind).toBe('bounds')
    if (target.kind !== 'bounds') return
    const [[west, south], [east, north]] = target.bounds
    expect(west).toBeLessThanOrEqual(-90.3)
    expect(east).toBeGreaterThanOrEqual(-88.5)
    expect(south).toBeLessThanOrEqual(15.5)
    expect(north).toBeGreaterThanOrEqual(17.2)
  })

  it('still shows the whole globe when the trip touches nothing yet', () => {
    expect(targetFor(WORLD, { countryPoints: [] })).toEqual({
      kind: 'point',
      center: [0, 20],
      zoom: 1,
    })
    expect(targetFor(WORLD, {})).toEqual({ kind: 'point', center: [0, 20], zoom: 1 })
  })

  // One country is a point, not a box: fitting a zero-width box would zoom to
  // the maximum and put you on someone's roof.
  it('treats a single country as a place to look at, not a box to fit', () => {
    const target = targetFor(WORLD, { countryPoints: [guatemala] })
    expect(target).toEqual({ kind: 'point', center: [-90.3, 15.5], zoom: 3 })
  })
})
