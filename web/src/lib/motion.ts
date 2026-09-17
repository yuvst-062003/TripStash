import { useReducedMotion, type Transition } from 'motion/react'

/**
 * Two springs for the whole app. UI answers a tap crisply; the stamp lands
 * with a little more bounce because it is the one moment meant to be felt.
 */
export const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 34 }
export const SPRING_STAMP: Transition = { type: 'spring', stiffness: 260, damping: 20 }
export const INSTANT: Transition = { duration: 0 }
/** Under reduced motion movement goes, a short fade stays so changes are still seen. */
export const FADE: Transition = { duration: 0.15, ease: 'linear' }
/** Exits ease in and run shorter than entrances: what leaves should not linger. */
export const EXIT: Transition = { duration: 0.15, ease: [0.4, 0, 1, 1] }

export const FADE_RISE = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

/** Stagger for lists: at most eight rows animate, the rest just appear. */
export const STAGGER_LIST = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
}
export const STAGGER_ROW = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: SPRING },
}

export function useMotionPrefs() {
  const reduced = Boolean(useReducedMotion())
  return {
    reduced,
    spring: reduced ? FADE : SPRING,
    stamp: reduced ? FADE : SPRING_STAMP,
  }
}
