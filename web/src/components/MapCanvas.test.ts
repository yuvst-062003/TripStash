import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The map's behaviour when the browser takes its graphics back.
 *
 * A phone drops the WebGL context under memory pressure, often a few seconds
 * after everything looked fine. Handled badly it reads as "the map showed and
 * then disappeared", with nothing said about why.
 *
 * jsdom has no WebGL at all, so the contract is checked at the source: there is
 * nothing to render and no context to lose in a test environment.
 */
const SRC = readFileSync('src/components/MapCanvas.tsx', 'utf8')

describe('losing the GL context', () => {
  it('listens for the loss', () => {
    expect(SRC).toContain("addEventListener('webglcontextlost'")
  })

  // Without preventDefault the browser never offers the context back, and the
  // canvas stays blank for the rest of the session.
  it('calls preventDefault, which is what makes it recoverable at all', () => {
    const handler = SRC.slice(SRC.indexOf('const onLost'), SRC.indexOf('const onRestored'))
    expect(handler).toContain('event.preventDefault()')
  })

  it('rebuilds the map when the context comes back', () => {
    expect(SRC).toContain("addEventListener('webglcontextrestored'")
    expect(SRC).toContain('setGeneration')
  })

  it('says what happened instead of leaving a blank rectangle', () => {
    expect(SRC).toContain('map-context-lost')
    expect(SRC).toContain('The map stopped drawing')
  })

  it('offers a way to try again by hand', () => {
    expect(SRC).toContain('Draw it again')
  })

  // The whole refactor rests on the map never being torn down by a navigation.
  it('rebuilds only for a context loss, never for a scope change', () => {
    const deps = SRC.slice(SRC.indexOf('}, [generation])') - 400, SRC.indexOf('}, [generation])') + 20)
    expect(deps).toContain('[generation]')
    expect(SRC).not.toContain('}, [scope])')
  })
})
