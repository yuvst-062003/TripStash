import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, type Fetched } from './api'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  fromCache: boolean
  reload: () => void
}

/** Last good payloads by key, so a screen revisited in one session opens on what it showed. */
const remembered = new Map<string, unknown>()

/**
 * Runs a request, keeps the last good data, and surfaces cache provenance.
 * With a `cacheKey` the previous result is shown at once while the request
 * refreshes it — no skeleton on a return visit.
 */
export function useAsync<T>(
  loader: () => Promise<Fetched<T>>,
  deps: unknown[],
  enabled = true,
  cacheKey?: string,
): AsyncState<T> {
  const [data, setData] = useState<T | null>(() =>
    cacheKey && remembered.has(cacheKey) ? (remembered.get(cacheKey) as T) : null,
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [fromCache, setFromCache] = useState(false)
  const [nonce, setNonce] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    loaderRef
      .current()
      .then((result) => {
        if (cancelled) return
        setData(result.data)
        if (cacheKey) remembered.set(cacheKey, result.data)
        setFromCache(result.fromCache)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not reach TripStash.')
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled])

  return { data, error, loading, fromCache, reload: () => setNonce((n) => n + 1) }
}

export interface Position {
  lat: number
  lon: number
}

export type LocationState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'granted'; position: Position }
  | { status: 'denied'; message: string }

/**
 * Foreground geolocation only.
 *
 * A PWA cannot promise background tracking (spec 11.2), so the UI asks at the
 * moment of need and always keeps a manual fallback.
 */
export function useLocation() {
  const [state, setState] = useState<LocationState>({ status: 'idle' })

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState({ status: 'denied', message: 'This browser cannot share a location.' })
      return
    }
    setState({ status: 'locating' })
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setState({
          status: 'granted',
          position: { lat: pos.coords.latitude, lon: pos.coords.longitude },
        }),
      (err) => setState({ status: 'denied', message: err.message || 'Location was refused.' }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }, [])

  const setManual = useCallback((position: Position) => {
    setState({ status: 'granted', position })
  }, [])

  return { state, request, setManual }
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
