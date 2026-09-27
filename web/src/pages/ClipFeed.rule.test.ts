import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * A blunt test for a blunt rule.
 *
 * Nothing in the feed may hand the traveller to another app, a browser tab or a
 * search page. That is the rule the whole screen turns on, and it takes one
 * innocent-looking chip to break it - which is exactly how the "Original" link
 * got there in the first place.
 *
 * Reading the source is cruder than rendering the component, and it is also the
 * only check that cannot be satisfied by a code path the test happens not to
 * reach. If this fails, the question to ask is not how to make it pass.
 */
const FILES = ['src/pages/ClipFeed.tsx', 'src/lib/videoSource.ts']

describe('the feed never leaves the app', () => {
  for (const file of FILES) {
    const source = readFileSync(file, 'utf8')

    it(`${file} opens no tab`, () => {
      expect(source).not.toContain('target="_blank"')
      expect(source).not.toContain("target='_blank'")
    })

    it(`${file} opens no window`, () => {
      expect(source).not.toContain('window.open')
    })

    it(`${file} navigates nowhere`, () => {
      expect(source).not.toContain('location.href')
      expect(source).not.toContain('location.assign')
      expect(source).not.toContain('location.replace')
    })
  }

  it('does not re-host anyone else’s video', () => {
    // Downloading a creator's clip to serve it ourselves would give us full
    // control over the player and would also be theft. The check is for the
    // ACT, not the word: the file's comments discuss downloading in order to
    // rule it out, and the first version of this test failed on those.
    const source = readFileSync('src/lib/videoSource.ts', 'utf8')
    expect(source).not.toMatch(/fetch\s*\(/)
    expect(source).not.toMatch(/XMLHttpRequest/)
    expect(source).not.toMatch(/createObjectURL/)
  })
})
