/**
 * One clock for every globe on the page. The vector stand-in and the
 * photographed Earth both read their idle angle from it, so when one fades
 * into the other nothing jumps.
 */
const EPOCH = typeof performance === 'undefined' ? 0 : performance.now()

/**
 * Idle drift in radians at `now`: a slow sine either side of home when
 * swaying (the route stays in view), otherwise a steady turn — land moving
 * east, the way the real one goes. Time-based, so frame rate does not matter.
 */
export function drift(now: number, spin: number, sway: number): number {
  return sway > 0 ? Math.sin(now / 3200) * sway : spin * 60 * ((now - EPOCH) / 1000)
}
