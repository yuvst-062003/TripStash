/**
 * A short tick for the moments that deserve one — a tab change, a stamp
 * landing. Silent where the platform has no vibration API (iOS Safari) or
 * where the person has asked for less motion.
 */
export function tick(pattern: number | number[] = 8) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  try {
    navigator.vibrate(pattern)
  } catch {
    // Some browsers throw when vibration is blocked; nothing to do.
  }
}

/** The stamp: a firm press, a pause, a small bounce. */
export const STAMP_PATTERN = [14, 40, 6]
