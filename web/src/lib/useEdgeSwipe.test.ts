import { describe, expect, it, vi } from 'vitest'
import { edgeSwipe } from './useEdgeSwipe'

describe('edgeSwipe', () => {
  it('fires once a swipe from the left edge has gone far enough', () => {
    const out = vi.fn()
    const swipe = edgeSwipe(out)
    swipe.start(8)
    swipe.move(90)
    swipe.end()
    expect(out).toHaveBeenCalledTimes(1)
  })

  // A swipe that starts mid-screen is a scroll or a map pan, not a back.
  it('ignores a swipe that did not start at the edge', () => {
    const out = vi.fn()
    const swipe = edgeSwipe(out)
    swipe.start(160)
    swipe.move(260)
    swipe.end()
    expect(out).not.toHaveBeenCalled()
  })

  it('does not fire when the finger comes back', () => {
    const out = vi.fn()
    const swipe = edgeSwipe(out)
    swipe.start(6)
    swipe.move(70)
    swipe.move(10)
    swipe.end()
    expect(out).not.toHaveBeenCalled()
  })

  it('reports how far through the gesture is, so the map can follow the finger', () => {
    const swipe = edgeSwipe(() => {})
    swipe.start(4)
    expect(swipe.progress()).toBe(0)
    swipe.move(44)
    expect(swipe.progress()).toBeGreaterThan(0)
    expect(swipe.progress()).toBeLessThan(1)
    swipe.move(400)
    expect(swipe.progress()).toBe(1)
  })

  it('forgets the gesture after it ends, so the next one starts clean', () => {
    const out = vi.fn()
    const swipe = edgeSwipe(out)
    swipe.start(8)
    swipe.move(90)
    swipe.end()
    swipe.end()
    expect(out).toHaveBeenCalledTimes(1)
  })
})
