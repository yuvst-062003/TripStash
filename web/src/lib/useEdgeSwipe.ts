/**
 * Swipe from the left edge to step out one level.
 *
 * Split into a plain state machine and a React hook around it, so the rules can
 * be tested without a touch screen. It tracks the finger rather than firing on
 * release, because a gesture that shows nothing until it commits is one people
 * learn not to trust.
 */
import { useEffect, useRef } from 'react'
import type { TouchEvent } from 'react'

/** Only a swipe that starts this close to the edge counts as "go back". */
const EDGE_PX = 24
/** And only one that travels this far commits. */
const COMMIT_PX = 72

export interface Swipe {
  start(x: number): void
  move(x: number): void
  end(): void
  progress(): number
}

export function edgeSwipe(onOut: () => void): Swipe {
  let from: number | null = null
  let travelled = 0

  return {
    start(x) {
      from = x <= EDGE_PX ? x : null
      travelled = 0
    },
    move(x) {
      if (from === null) return
      travelled = Math.max(0, x - from)
    },
    end() {
      const commit = from !== null && travelled >= COMMIT_PX
      from = null
      travelled = 0
      if (commit) onOut()
    },
    progress() {
      return from === null ? 0 : Math.min(1, travelled / COMMIT_PX)
    },
  }
}

export function useEdgeSwipe(onOut: () => void, enabled: boolean) {
  const machine = useRef<Swipe>(edgeSwipe(onOut))

  useEffect(() => {
    machine.current = edgeSwipe(onOut)
  }, [onOut])

  if (!enabled) return {}

  return {
    onTouchStart: (e: TouchEvent) => machine.current.start(e.touches[0]?.clientX ?? 0),
    onTouchMove: (e: TouchEvent) => machine.current.move(e.touches[0]?.clientX ?? 0),
    onTouchEnd: () => machine.current.end(),
  }
}
