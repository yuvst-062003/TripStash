/* TripStash service worker.
 *
 * The offline contract (spec 11.3): the app shell always works, the current
 * trip's essentials come from a cached bundle, and anything live is served
 * from cache with a header that tells the UI to label it as stale rather
 * than presenting week-old opening hours as current.
 */

const SHELL_CACHE = 'tripstash-shell-v1'
const DATA_CACHE = 'tripstash-data-v1'

// Endpoints worth keeping for offline use. Everything else is network-only.
const CACHEABLE_API = [
  '/api/v1/offline-bundle',
  '/api/v1/trips/current',
  '/api/v1/home',
  '/api/v1/map',
  '/api/v1/places',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(['/', '/index.html', '/manifest.webmanifest', '/icon.svg'])),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  if (url.pathname.startsWith('/api/')) {
    const cacheable = CACHEABLE_API.some((path) => url.pathname.startsWith(path))
    if (!cacheable) return
    event.respondWith(networkFirst(request))
    return
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request))
  }
})

async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) {
      const copy = response.clone()
      const body = await copy.blob()
      const headers = new Headers(copy.headers)
      headers.set('x-tripstash-cached-at', new Date().toISOString())
      await cache.put(request, new Response(body, { status: copy.status, headers }))
    }
    return response
  } catch (error) {
    const cached = await cache.match(request)
    if (cached) {
      // The UI reads this header and shows a "cached, may be out of date" banner.
      const headers = new Headers(cached.headers)
      headers.set('x-tripstash-offline', 'true')
      return new Response(await cached.blob(), { status: 200, headers })
    }
    throw error
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok && new URL(request.url).origin === self.location.origin) {
      const cache = await caches.open(SHELL_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    const shell = await caches.match('/index.html')
    if (shell) return shell
    throw error
  }
}
