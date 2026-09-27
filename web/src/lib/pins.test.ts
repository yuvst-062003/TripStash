import { describe, expect, it } from 'vitest'
import { pinsFor } from './pins'
import { WORLD } from './scope'

const countries = [
  { key: 'guatemala', name: 'Guatemala', lat: 15.5, lon: -90.3, video_count: 12, found_count: 3 },
  { key: 'belize', name: 'Belize', lat: 17.2, lon: -88.5, video_count: 3, found_count: 3 },
]

const places = [
  { trip_place_id: 'tp-1', name: 'Acatenango', lat: 14.5, lon: -90.87, video_count: 4, found_count: 3 },
  { trip_place_id: 'tp-2', name: 'Fernando’s', lat: null, lon: null, video_count: 1, found_count: 0 },
]

describe('pinsFor', () => {
  it('pins every country at the world level', () => {
    expect(pinsFor(WORLD, { countries }).map((p) => p.name)).toEqual(['Guatemala', 'Belize'])
  })

  // The column is nullable. A pin at (0, 0) would sit off West Africa and look
  // like data, which is worse than not being on the map at all - the place is
  // still in the list beside it, where it can be read and pressed.
  it('leaves a place with no coordinates off the map entirely', () => {
    const pins = pinsFor({ level: 'city', countryKey: 'g', cityKey: 'a' }, { places })
    expect(pins.map((p) => p.name)).toEqual(['Acatenango'])
    expect(pins.some((p) => p.lat === 0 && p.lon === 0)).toBe(false)
  })

  it('marks the selected pin, and only that one', () => {
    const pins = pinsFor(
      { level: 'place', countryKey: 'g', cityKey: 'a', tripPlaceId: 'tp-1' },
      { places },
    )
    expect(pins.filter((p) => p.here).map((p) => p.id)).toEqual(['tp-1'])
  })

  it('splits each pin into what is yours and what was found', () => {
    const [guatemala] = pinsFor(WORLD, { countries })
    expect(guatemala.yours).toBe(9)
    expect(guatemala.found).toBe(3)
  })

  it('pins nothing when the level has nothing with coordinates', () => {
    expect(pinsFor({ level: 'city', countryKey: 'g', cityKey: 'a' }, { places: [] })).toEqual([])
  })
})
