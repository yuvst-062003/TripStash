/**
 * One stylesheet, one name per thing.
 *
 * `.stepper` was defined twice: once for the Trip screen's route list, and
 * again, a thousand lines later, for the map's destination bar. The second
 * definition does not sit beside the first - it replaces it. The route list
 * inherited `position: absolute; bottom: var(--nav-h)` and was drawn on top of
 * the whole Trip screen, with no error anywhere, because nothing had failed.
 *
 * Nothing in the build catches that, so this does.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync('src/styles/app.css', 'utf8')

/**
 * Names defined twice on purpose, or harmlessly.
 *
 * `sr-only`, `num`, `drawer-overlay` and `save__foot`: the second block adds
 * to the first rather than contradicting it.
 * `slide__scrub`: both belong to the clip feed, the later one moving it.
 * `meter`: a real collision, left alone for now - the Profile cost meter
 * resizes the meters on the album sync and the trip screen. Cosmetic, and
 * not this change's business.
 */
const KNOWN = new Set(['sr-only', 'num', 'drawer-overlay', 'save__foot', 'slide__scrub', 'meter'])

function rootClassBlocks(css: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const [, name] of css.matchAll(/^\.([a-zA-Z0-9_-]+)\s*\{/gm)) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return counts
}

describe('class names in the stylesheet', () => {
  it('defines each one once, or says why not', () => {
    const repeated = [...rootClassBlocks(CSS)]
      .filter(([name, count]) => count > 1 && !KNOWN.has(name))
      .map(([name]) => name)

    expect(repeated).toEqual([])
  })

  it('keeps the map bar and the trip route list apart by name', () => {
    expect(rootClassBlocks(CSS).get('stepper')).toBe(1)
    expect(CSS).toContain('.routebar {')
  })

  it('is not hiding a name that no longer collides', () => {
    // A name that stops being duplicated should leave the list, so the list
    // stays a record of what is actually wrong rather than folklore.
    const counts = rootClassBlocks(CSS)
    const stale = [...KNOWN].filter((name) => (counts.get(name) ?? 0) < 2)
    expect(stale).toEqual([])
  })
})
