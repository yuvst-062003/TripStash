import { describe, expect, it } from 'vitest'
import { atlasKnows, shapesFor } from './countryShapes'

describe('shapesFor', () => {
  it('returns a shape per country on the route', () => {
    const shapes = shapesFor(['Guatemala', 'Belize'])
    expect(shapes.map((s) => s.properties.name)).toEqual(['Guatemala', 'Belize'])
    expect(shapes.every((s) => s.geometry)).toBe(true)
  })

  it('returns nothing for a trip that touches nothing', () => {
    expect(shapesFor([])).toEqual([])
  })

  // The map should show this traveller's trip, not the world.
  it('leaves out everywhere they are not going', () => {
    const shapes = shapesFor(['Guatemala'])
    expect(shapes).toHaveLength(1)
  })

  it('matches however the name is spelled', () => {
    expect(shapesFor(['panama'])).toHaveLength(1)
    expect(shapesFor(['Panamá'])).toHaveLength(1)
  })

  it('marks the country being looked at, and only that one', () => {
    const shapes = shapesFor(['Guatemala', 'Belize'], 'Guatemala')
    expect(shapes.filter((s) => s.properties.here).map((s) => s.properties.name)).toEqual([
      'Guatemala',
    ])
  })

  it('does not repeat a country listed twice', () => {
    expect(shapesFor(['Guatemala', 'guatemala'])).toHaveLength(1)
  })

  // A mis-drawn country looks deliberate, which is worse than an absent one.
  it('leaves out a name the atlas does not carry rather than guessing', () => {
    expect(shapesFor(['Country not known', 'Guatemala'])).toHaveLength(1)
    expect(atlasKnows('Country not known')).toBe(false)
    expect(atlasKnows('Guatemala')).toBe(true)
  })
})
