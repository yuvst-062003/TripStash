import { describe, expect, it } from 'vitest'
import { groupByActivity } from './Catalog'
import type { PlaceSummary } from '../lib/types'

const place = (over: Partial<PlaceSummary>): PlaceSummary =>
  ({
    trip_place_id: 'tp',
    place_id: 'p',
    name: 'Somewhere',
    category: 'nature',
    city: 'Antigua',
    country: 'Guatemala',
    lat: 14,
    lon: -90,
    status: 'considering',
    is_favourite: false,
    needs_review: false,
    reason_saved: null,
    source_count: 1,
    distance_km: null,
    walking_minutes: null,
    ...over,
  }) as PlaceSummary

describe('groupByActivity', () => {
  it('gathers places under the activity they answer to', () => {
    const groups = groupByActivity(
      [place({ trip_place_id: '1', category: 'hike' }), place({ trip_place_id: '2', category: 'hike' })],
      (p) => [p.category],
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Hiking')
    expect(groups[0].places).toHaveLength(2)
  })

  // Acatenango is a hike AND a volcano. Hiding it from one list to keep the
  // counts tidy would be arranging the data for the screen's benefit.
  it('lets one place sit under more than one heading', () => {
    const groups = groupByActivity([place({ trip_place_id: '1' })], () => ['hike', 'volcano'])
    expect(groups.map((g) => g.label).sort()).toEqual(['Hiking', 'Volcanoes'])
    expect(groups.every((g) => g.places.length === 1)).toBe(true)
  })

  // This is the whole reason the screen exists: the map cannot show you every
  // hike at once, because they are in different countries.
  it('counts how many countries a heading spans', () => {
    const groups = groupByActivity(
      [
        place({ trip_place_id: '1', country: 'Guatemala' }),
        place({ trip_place_id: '2', country: 'Colombia' }),
        place({ trip_place_id: '3', country: 'Colombia' }),
      ],
      () => ['hike'],
    )
    expect(groups[0].countries).toBe(2)
  })

  it('puts the fullest heading first', () => {
    const groups = groupByActivity(
      [
        place({ trip_place_id: '1', category: 'hike' }),
        place({ trip_place_id: '2', category: 'hike' }),
        place({ trip_place_id: '3', category: 'cafe' }),
      ],
      (p) => [p.category],
    )
    expect(groups.map((g) => g.label)).toEqual(['Hiking', 'Cafés'])
  })

  it('falls back to the raw slug rather than showing nothing', () => {
    const groups = groupByActivity([place({ trip_place_id: '1' })], () => ['something_new'])
    expect(groups[0].label).toBe('something_new')
  })

  it('drops a place that answers to nothing rather than inventing a heading', () => {
    expect(groupByActivity([place({ trip_place_id: '1' })], () => [])).toEqual([])
  })
})
