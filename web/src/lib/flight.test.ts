import { describe, expect, it } from 'vitest'
import type { CameraTarget } from './cameraTarget'
import { IN_MS, OUT_MS, flightFor, safePadding, settleMs } from './flight'

const point: CameraTarget = { kind: "point", center: [-90.7, 14.5], zoom: 11 }
const box: CameraTarget = {
  kind: 'bounds',
  bounds: [
    [-92, 13],
    [-88, 18],
  ],
}

describe('flightFor', () => {
  it('takes longer going in than coming out', () => {
    expect(flightFor(point, { going: 'in', reducedMotion: false }).duration).toBe(IN_MS)
    expect(flightFor(point, { going: 'out', reducedMotion: false }).duration).toBe(OUT_MS)
    expect(OUT_MS).toBeLessThan(IN_MS)
  })

  it('cuts straight there when motion is reduced', () => {
    expect(flightFor(point, { going: 'in', reducedMotion: true }).duration).toBe(0)
    expect(flightFor(box, { going: 'out', reducedMotion: true }).duration).toBe(0)
  })

  // MapLibre drops a non-essential camera move entirely under reduced motion,
  // which would leave the map pointing somewhere else than the page says.
  it('keeps every flight essential, so the camera still arrives', () => {
    expect(flightFor(point, { going: 'in', reducedMotion: true }).essential).toBe(true)
  })

  it('carries the centre and zoom of a point target', () => {
    expect(flightFor(point, { going: 'in', reducedMotion: false })).toMatchObject({
      center: [-90.7, 14.5],
      zoom: 11,
    })
  })

  it('carries the box of a bounds target, with room around it', () => {
    const flight = flightFor(box, { going: 'in', reducedMotion: false })
    expect(flight).toMatchObject({ bounds: (box as { bounds: unknown }).bounds })
    expect((flight as { padding: number }).padding).toBeGreaterThan(0)
  })
})

describe('settleMs', () => {
  // Pins appear only once the camera has stopped; during a flight they would
  // slide at a different rate from the map beneath them and read as a bug.
  it('matches the flight it waits for', () => {
    expect(settleMs('in', false)).toBe(IN_MS)
    expect(settleMs('out', false)).toBe(OUT_MS)
  })

  it('is immediate when the flight was skipped', () => {
    expect(settleMs('in', true)).toBe(0)
  })
})

describe('safePadding', () => {
  // A country with many cities makes a tall page, and the camera padding that
  // keeps the globe visible can then swallow the whole canvas. MapLibre cannot
  // compute a camera for a zero-height viewport and throws, which took the
  // entire screen down with it.
  it('never lets the padding consume the canvas', () => {
    const p = safePadding(844, 800)
    expect(p.top + p.bottom).toBeLessThan(844)
  })

  it('leaves a usable strip even when the page is enormous', () => {
    const p = safePadding(600, 5000)
    expect(600 - p.top - p.bottom).toBeGreaterThanOrEqual(80)
  })

  // Fitting a country into a thin strip means zooming out until it fits, and
  // under the globe projection that swings the camera right out to space. On
  // the live site a 436px page on an 844px screen put Guatemala's camera over
  // the South Pacific. The strip has to stay a decent share of the canvas.
  it('keeps a real share of the canvas, not just a sliver', () => {
    const tall = safePadding(844, 436)
    const strip = 844 - tall.top - tall.bottom
    expect(strip / 844).toBeGreaterThanOrEqual(0.4)
  })

  it('gives ground back to the camera rather than to the page', () => {
    // The page keeps its own height on screen; this only limits what the
    // camera is TOLD is hidden, so the fit stays sane.
    expect(safePadding(844, 700).bottom).toBeLessThan(700)
  })

  it('passes a reasonable inset straight through', () => {
    expect(safePadding(844, 300).bottom).toBe(300)
  })

  it('copes with a canvas that has not been measured yet', () => {
    const p = safePadding(0, 300)
    expect(p.bottom).toBe(0)
    expect(p.top).toBe(0)
  })

  it('never returns a negative padding', () => {
    const p = safePadding(100, 90)
    expect(p.bottom).toBeGreaterThanOrEqual(0)
    expect(p.top).toBeGreaterThanOrEqual(0)
  })
})
