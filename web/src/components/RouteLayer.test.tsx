/**
 * The route only exists if it is actually drawn.
 *
 * A layer cannot be added to a style that has not loaded, and the trip almost
 * always arrives before the imagery does. Handled badly, the globe comes up
 * bare - no countries, no route, no stops - and says nothing, because nothing
 * failed: the drawing simply never ran.
 */
import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import RouteLayer from './RouteLayer'

type Handler = (...args: unknown[]) => void

function fakeMap(styleLoaded: boolean) {
  const handlers = new Map<string, Set<Handler>>()
  const layers = new Set<string>()
  const sources = new Set<string>()

  const map = {
    loaded: styleLoaded,
    isStyleLoaded: () => map.loaded,
    getSource: (id: string) => (sources.has(id) ? { setData: () => {} } : undefined),
    addSource: (id: string) => sources.add(id),
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    addLayer: (spec: { id: string }) => layers.add(spec.id),
    getCanvas: () => ({ style: {} }),
    queryRenderedFeatures: () => [],
    on: (event: string, a: unknown, b?: unknown) => {
      const handler = (typeof a === 'function' ? a : b) as Handler
      const key = typeof a === 'function' ? event : `${event}:${a}`
      if (!handlers.has(key)) handlers.set(key, new Set())
      handlers.get(key)!.add(handler)
    },
    off: (event: string, a: unknown, b?: unknown) => {
      const handler = (typeof a === 'function' ? a : b) as Handler
      const key = typeof a === 'function' ? event : `${event}:${a}`
      handlers.get(key)?.delete(handler)
    },
    fire: (event: string) => {
      for (const handler of handlers.get(event) ?? []) handler()
    },
    layers,
  }
  return map
}

const COUNTRIES = ['Mexico', 'Guatemala']
const STOPS = [
  { name: 'Mexico', lat: 19.4, lon: -99.1 },
  { name: 'Guatemala', lat: 14.5, lon: -90.7 },
]

const draw = (map: ReturnType<typeof fakeMap>) =>
  render(
    <RouteLayer map={map as never} countries={COUNTRIES} stops={STOPS} />,
  )

describe('drawing the trip on the globe', () => {
  it('draws the countries, the route and the stops once the style is up', () => {
    const map = fakeMap(true)

    draw(map)

    expect(map.layers).toContain('trip-countries-fill')
    expect(map.layers).toContain('trip-countries-label')
    expect(map.layers).toContain('trip-route')
    expect(map.layers).toContain('trip-stops')
  })

  it('waits rather than drawing into a style that has not loaded', () => {
    const map = fakeMap(false)

    draw(map)

    expect(map.layers.size).toBe(0)
  })

  it('draws as soon as the style arrives, which is the whole bug', () => {
    const map = fakeMap(false)
    draw(map)
    expect(map.layers.size).toBe(0)

    map.loaded = true
    act(() => map.fire('styledata'))

    expect(map.layers).toContain('trip-route')
    expect(map.layers).toContain('trip-countries-fill')
  })

  it('does not act on a styledata that arrives before the style is ready', () => {
    const map = fakeMap(false)
    draw(map)

    act(() => map.fire('styledata'))

    expect(map.layers.size).toBe(0)
  })
})
