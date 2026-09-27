import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The service worker decides which version of the app a returning visitor gets.
 *
 * It shipped serving navigations cache-first from a cache whose name never
 * changed, which meant the shell cached on a browser's first visit was the
 * shell it kept - not for a while, but permanently, because nothing ever
 * re-fetched it and nothing ever evicted it. Every deploy was invisible to
 * everyone who had already opened the app once.
 *
 * These read the worker's source because that is the only place the rule lives;
 * there is no module to import and no way to run it here.
 */
const SW = readFileSync('public/sw.js', 'utf8')

describe('the service worker', () => {
  it('fetches the app shell from the network before the cache', () => {
    expect(SW).toContain('shellFirst')
    // The navigation branch must come before the generic cache-first one.
    const navigate = SW.indexOf("request.mode === 'navigate'")
    const generic = SW.indexOf('event.respondWith(cacheFirst(request))')
    expect(navigate).toBeGreaterThan(-1)
    expect(navigate).toBeLessThan(generic)
  })

  it('still opens offline, from the last shell that worked', () => {
    const shell = SW.slice(SW.indexOf('async function shellFirst'))
    expect(shell).toContain('catch')
    expect(shell).toContain("cache.match('/index.html')")
  })

  it('names a cache version that was bumped past the frozen one', () => {
    // v1 is the cache holding a stale shell on every existing install. The
    // activate handler only deletes caches it does not recognise, so the name
    // has to change for that shell to be dropped.
    const name = SW.match(/SHELL_CACHE = '([^']+)'/)?.[1]
    expect(name).toBeDefined()
    expect(name).not.toBe('tripstash-shell-v1')
  })

  it('drops caches it no longer recognises when it activates', () => {
    expect(SW).toContain('caches.delete')
    expect(SW).toContain('self.clients.claim()')
    expect(SW).toContain('self.skipWaiting()')
  })

  it('leaves hashed assets on cache-first, where that is correct', () => {
    // An asset's name changes when its content does, so a cached one can never
    // be the wrong version.
    expect(SW).toContain('cacheFirst')
  })
})
