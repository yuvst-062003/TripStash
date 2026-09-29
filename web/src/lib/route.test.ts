import { describe, expect, it } from 'vitest'
import { greatCircle, isFlight, legsOf, routeFeature, stopFeatures } from './route'

const stop = (name: string, lat: number, lon: number) => ({ name, lat, lon })

const ANTIGUA = stop('Antigua', 14.56, -90.73)
const SAN_JOSE = stop('San José', 9.93, -84.09)
const MEXICO = stop('Mexico City', 19.43, -99.13)
const RIO = stop('Rio de Janeiro', -22.9, -43.17)

describe('legsOf', () => {
  it('joins consecutive stops', () => {
    expect(legsOf([ANTIGUA, SAN_JOSE, RIO])).toHaveLength(2)
  })

  it('has no legs for a single stop, and none for none', () => {
    expect(legsOf([ANTIGUA])).toEqual([])
    expect(legsOf([])).toEqual([])
  })

  it('skips a stop with no coordinates rather than drawing through zero', () => {
    const nowhere = { name: 'Unplaced', lat: null, lon: null }
    expect(legsOf([ANTIGUA, nowhere, SAN_JOSE])).toHaveLength(1)
  })
})

describe('isFlight', () => {
  // The reference draws ground legs along roads and flights as a straight
  // line. Something has to decide which a leg is, and distance is the honest
  // proxy: nobody takes a bus from Mexico City to Rio.
  it('calls a short hop ground travel', () => {
    expect(isFlight(ANTIGUA, SAN_JOSE)).toBe(false)
  })

  it('calls a continental jump a flight', () => {
    expect(isFlight(MEXICO, RIO)).toBe(true)
  })

  it('does not care which way round the two stops are given', () => {
    expect(isFlight(RIO, MEXICO)).toBe(isFlight(MEXICO, RIO))
  })
})

describe('greatCircle', () => {
  // A straight line in screen space is not a straight line on a globe: drawn
  // as two points it cuts through the planet. Interpolating along the great
  // circle is what makes a flight path arc the way it does in the reference.
  it('bends between its ends rather than joining them straight', () => {
    const path = greatCircle(MEXICO, RIO, 32)
    expect(path.length).toBe(32)

    const [startLon, startLat] = path[0]
    const [endLon, endLat] = path[path.length - 1]
    expect(startLon).toBeCloseTo(MEXICO.lon, 1)
    expect(startLat).toBeCloseTo(MEXICO.lat, 1)
    expect(endLon).toBeCloseTo(RIO.lon, 1)
    expect(endLat).toBeCloseTo(RIO.lat, 1)

    // The midpoint must not sit on the straight average of the two ends.
    const [midLon, midLat] = path[16]
    const flatLat = (MEXICO.lat + RIO.lat) / 2
    const flatLon = (MEXICO.lon + RIO.lon) / 2
    expect(Math.abs(midLat - flatLat) + Math.abs(midLon - flatLon)).toBeGreaterThan(0.2)
  })

  it('copes with two stops in the same place', () => {
    const path = greatCircle(ANTIGUA, ANTIGUA, 8)
    expect(path).toHaveLength(8)
    expect(path.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))).toBe(true)
  })
})

describe('routeFeature', () => {
  it('is one line through every stop in order', () => {
    const feature = routeFeature([ANTIGUA, SAN_JOSE, RIO])
    expect(feature.geometry.type).toBe('LineString')
    expect(feature.geometry.coordinates.length).toBeGreaterThan(3)
  })

  it('is empty rather than malformed when there is nothing to draw', () => {
    expect(routeFeature([]).geometry.coordinates).toEqual([])
    expect(routeFeature([ANTIGUA]).geometry.coordinates).toEqual([])
  })
})

describe('stopFeatures', () => {
  it('is one dot per placed stop, numbered in order', () => {
    const dots = stopFeatures([ANTIGUA, SAN_JOSE])
    expect(dots).toHaveLength(2)
    expect(dots[0].properties.order).toBe(1)
    expect(dots[1].properties.name).toBe('San José')
  })

  it('marks which one you are looking at, and only that one', () => {
    const dots = stopFeatures([ANTIGUA, SAN_JOSE], 1)
    expect(dots.filter((d) => d.properties.here)).toHaveLength(1)
    expect(dots[1].properties.here).toBe(true)
  })

  it('leaves out a stop with no coordinates', () => {
    expect(stopFeatures([ANTIGUA, { name: 'Unplaced', lat: null, lon: null }])).toHaveLength(1)
  })
})
