/**
 * How the camera moves between two scopes.
 *
 * Going in is slower than coming out on purpose: arriving somewhere deserves
 * the longer shot, and leaving should never make you wait.
 *
 * `essential: true` is not a claim that this motion outranks someone's reduced
 * motion setting. MapLibre drops a non-essential camera move entirely under
 * that setting, which would leave the map pointing at the wrong place while the
 * page claimed otherwise. So the move stays essential and its DURATION goes to
 * zero instead: the camera arrives, it just does not travel.
 */
import type { CameraTarget } from './cameraTarget'

export const IN_MS = 1200
export const OUT_MS = 800
const PADDING = 48

export interface Flight {
  duration: number
  essential: true
  center?: [number, number]
  zoom?: number
  bounds?: [[number, number], [number, number]]
  padding?: number
}

export function flightFor(
  target: CameraTarget,
  opts: { going: 'in' | 'out'; reducedMotion: boolean },
): Flight {
  const duration = opts.reducedMotion ? 0 : opts.going === 'in' ? IN_MS : OUT_MS
  const shared = { duration, essential: true as const }
  return target.kind === 'bounds'
    ? { ...shared, bounds: target.bounds, padding: PADDING }
    : { ...shared, center: target.center, zoom: target.zoom }
}

/**
 * How long to wait before the pins for a new level appear.
 *
 * Read from the same numbers the flight uses, so the two cannot drift apart.
 */
export function settleMs(going: 'in' | 'out', reducedMotion: boolean): number {
  if (reducedMotion) return 0
  return going === 'in' ? IN_MS : OUT_MS
}

/** Whether this browser has been asked to keep motion down. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The strip of map the trail needs at the top. */
const TOP_INSET = 56
/** The least map worth flying a camera into. */
const MIN_VISIBLE = 80

export interface Padding {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * Camera padding that cannot swallow the canvas.
 *
 * The map sits full-bleed behind the page, so the camera is told how much is
 * hidden and centres on what is left. A country with many cities makes a tall
 * page, and on a short viewport that inset plus the trail's can exceed the
 * canvas entirely - at which point MapLibre cannot compute a camera at all,
 * throws, and takes the screen down with it.
 *
 * So the padding is clamped to leave a usable strip. The camera then centres a
 * little low rather than not at all, which is the better of the two failures.
 */
export function safePadding(canvasHeight: number, bottomInset: number): Padding {
  if (canvasHeight <= 0) return { top: 0, right: 16, bottom: 0, left: 16 }

  const room = Math.max(0, canvasHeight - MIN_VISIBLE)
  const top = Math.min(TOP_INSET, room)
  const bottom = Math.max(0, Math.min(bottomInset, room - top))
  return { top, right: 16, bottom, left: 16 }
}
