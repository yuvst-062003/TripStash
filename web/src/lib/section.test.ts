import { describe, expect, it } from 'vitest'
import { sectionKey } from './section'

describe('sectionKey', () => {
  // The four map levels are ONE screen at four URLs. Keying them apart tears
  // the map down on every press, which is the whole problem this replaced.
  it('treats every map level as the same screen', () => {
    const paths = ['/map', '/map/guatemala', '/map/guatemala/antigua', '/map/guatemala/antigua/tp-7']
    expect(new Set(paths.map(sectionKey)).size).toBe(1)
  })

  it('still separates the screens that really are separate', () => {
    expect(sectionKey('/explore')).not.toBe(sectionKey('/catalog'))
    expect(sectionKey('/trip')).toBe('/trip')
    expect(sectionKey('/profile')).toBe('/profile')
  })
})
