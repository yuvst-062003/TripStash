/**
 * API client.
 *
 * Every response records whether it came from the service worker's cache, so
 * screens can label stale live data instead of presenting it as current.
 */
import type {
  AskResponse,
  Candidate,
  HomePayload,
  KnowledgeItem,
  MapFeature,
  PlacePage,
  PlaceSummary,
  ProposedAction,
  ReelClip,
  ReelSpot,
  Resolution,
  Resurfaced,
  SourceSummary,
  Trip,
} from './types'

const TOKEN_KEY = 'tripstash.token'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface Fetched<T> {
  data: T
  fromCache: boolean
}

export const token = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (value: string) => localStorage.setItem(TOKEN_KEY, value),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  query?: Record<string, unknown>,
): Promise<Fetched<T>> {
  const url = new URL(path, window.location.origin)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, String(v)))
    else url.searchParams.set(key, String(value))
  }

  const headers = new Headers(init.headers)
  const accessToken = token.get()
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')

  const response = await fetch(url.toString(), { ...init, headers })
  const fromCache = response.headers.get('x-tripstash-offline') === 'true'

  if (response.status === 401) {
    token.clear()
    throw new ApiError(401, 'Your session expired. Sign in again.')
  }
  if (response.status === 204) return { data: undefined as T, fromCache }
  if (!response.ok) {
    let detail = `Request failed (${response.status})`
    try {
      const body = await response.json()
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(response.status, detail)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return { data: (await response.text()) as unknown as T, fromCache }
  }
  return { data: (await response.json()) as T, fromCache }
}

const get = <T,>(path: string, query?: Record<string, unknown>) => request<T>(path, {}, query)
const post = <T,>(path: string, body?: unknown, query?: Record<string, unknown>) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }, query)
const patch = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
const del = <T,>(path: string, query?: Record<string, unknown>) =>
  request<T>(path, { method: 'DELETE' }, query)

export const api = {
  // auth
  register: (email: string, password: string) =>
    post<{ access_token: string }>('/api/v1/auth/register', { email, password }),
  login: (email: string, password: string) =>
    post<{ access_token: string }>('/api/v1/auth/login', { email, password }),
  me: () => get<{ id: string; email: string; display_name: string | null }>('/api/v1/auth/me'),

  // trip
  currentTrip: () => get<Trip>('/api/v1/trips/current'),
  createTrip: (body: Record<string, unknown>) => post<Trip>('/api/v1/trips', body),
  addDestination: (body: Record<string, unknown>) =>
    post<unknown>('/api/v1/trips/current/destinations', body),

  // home
  home: (query: Record<string, unknown>) => get<HomePayload>('/api/v1/home', query),
  resurface: (query: Record<string, unknown>) =>
    get<{ items: Resurfaced[] }>('/api/v1/resurface', query),

  // capture and review
  captureLink: (body: Record<string, unknown>) => post<SourceSummary>('/api/v1/sources', body),
  // `reader` records which path recovered the caption: the browser, the
  // operating system's share sheet, or the traveller typing it.
  upload: (files: File[], note?: string) => {
    const form = new FormData()
    files.forEach((file) => form.append('files', file))
    if (note) form.append('note', note)
    return request<SourceSummary[]>('/api/v1/sources/upload', { method: 'POST', body: form })
  },
  sources: (status?: string) => get<SourceSummary[]>('/api/v1/sources', { status }),
  // Hashes only. Asking costs kilobytes where uploading would cost gigabytes.
  knownFingerprints: (fingerprints: string[]) =>
    post<{ known: string[]; new_count: number }>('/api/v1/sources/known', { fingerprints }),
  retrySource: (id: string) => post<SourceSummary>(`/api/v1/sources/${id}/retry`),
  deleteSource: (id: string) => del<void>(`/api/v1/sources/${id}`),
  inbox: (sourceId?: string) => get<Candidate[]>('/api/v1/inbox', { source_id: sourceId }),
  editCandidate: (id: string, body: Record<string, unknown>) =>
    patch<Candidate>(`/api/v1/candidates/${id}`, body),
  approveCandidate: (id: string, body: Record<string, unknown>) =>
    post<{ kind: string; trip_place_id?: string }>(`/api/v1/candidates/${id}/approve`, body),
  ignoreCandidate: (id: string) => post<void>(`/api/v1/candidates/${id}/ignore`),

  // places
  places: (query: Record<string, unknown>) => get<PlaceSummary[]>('/api/v1/places', query),
  map: (query: Record<string, unknown>) =>
    get<{ features: MapFeature[]; layer: string }>('/api/v1/map', query),
  place: (id: string, query?: Record<string, unknown>) =>
    get<PlacePage>(`/api/v1/places/${id}`, query),
  updatePlace: (id: string, body: Record<string, unknown>) =>
    patch<PlaceSummary>(`/api/v1/places/${id}`, body),
  recordVisit: (id: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/v1/places/${id}/visits`, body),
  searchProvider: (q: string, lat?: number, lon?: number) =>
    get<Resolution[]>('/api/v1/places/search/provider', { q, lat, lon }),
  collections: () => get<{ id: string; name: string; colour: string | null }[]>('/api/v1/collections'),
  createCollection: (name: string) => post<unknown>('/api/v1/collections', { name }),

  // clips - the traveller's own saved video, scoped to a spot
  reelSpots: (query?: Record<string, unknown>) => get<ReelSpot[]>('/api/v1/reels/spots', query),
  reelSpot: (tripPlaceId: string) => get<ReelSpot>(`/api/v1/reels/spots/${tripPlaceId}`),
  reels: (query?: Record<string, unknown>) => get<ReelClip[]>('/api/v1/reels', query),

  // assistant
  ask: (body: Record<string, unknown>) => post<AskResponse>('/api/v1/ask', body),
  confirmAction: (action: ProposedAction) => post<unknown>('/api/v1/ask/confirm', action),
  knowledge: (query: Record<string, unknown>) => get<KnowledgeItem[]>('/api/v1/knowledge', query),
  updateKnowledge: (id: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/v1/knowledge/${id}`, body),

  // trip operations
  itinerary: (on?: string) =>
    get<{ id: string; title: string; on_date: string; start_time: string | null; trip_place_id: string | null }[]>(
      '/api/v1/itinerary',
      { on },
    ),
  addToPlan: (body: Record<string, unknown>) => post<unknown>('/api/v1/itinerary', body),
  removeFromPlan: (id: string) => del<void>(`/api/v1/itinerary/${id}`),
  bookings: () => get<Record<string, unknown>[]>('/api/v1/bookings'),
  addBooking: (body: Record<string, unknown>) => post<unknown>('/api/v1/bookings', body),
  expenses: () =>
    get<{
      currency: string
      total: number
      by_category: Record<string, number>
      items: {
        id: string
        spent_on: string
        amount: number
        currency: string
        amount_base: number
        category: string
        note: string | null
      }[]
    }>('/api/v1/expenses'),
  addExpense: (body: Record<string, unknown>) => post<unknown>('/api/v1/expenses', body),

  // account
  offlineBundle: () => get<Record<string, unknown>>('/api/v1/offline-bundle'),
  exportUrl: '/api/v1/export',
}
