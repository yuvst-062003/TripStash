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
  Recommendation,
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

/** Turns FastAPI's `detail` — a string, or Pydantic's list of field errors — into a sentence. */
function describeDetail(detail: unknown): string | null {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const parts = detail.map((entry: { loc?: unknown[]; msg?: string }) => {
      const field = String(entry.loc?.[entry.loc.length - 1] ?? '')
      if (field === 'email') return 'Enter a valid email address.'
      if (field === 'password') return 'Use at least 10 characters.'
      return entry.msg?.replace(/^Value error, /, '') ?? null
    })
    const text = parts.filter(Boolean).join(' ')
    return text || null
  }
  return null
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

  // A 401 anywhere but the sign-in endpoints means the token is dead. On
  // sign-in itself it means a wrong password, and the API's own words apply.
  if (response.status === 401 && !path.startsWith('/api/v1/auth/')) {
    token.clear()
    throw new ApiError(401, 'Your session expired. Sign in again.')
  }
  if (response.status === 204) return { data: undefined as T, fromCache }
  if (!response.ok) {
    let detail = `Request failed (${response.status})`
    try {
      const body = await response.json()
      detail = describeDetail(body.detail) ?? detail
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
  createKnowledge: (body: Record<string, unknown>) => post<{ id: string }>('/api/v1/knowledge', body),
  recommend: (q: string) => get<Recommendation>('/api/v1/recommend', { q }),
  updateDestination: (id: string, body: Record<string, unknown>) =>
    request<unknown>(`/api/v1/trips/current/destinations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  removeDestination: (id: string) =>
    request<void>(`/api/v1/trips/current/destinations/${id}`, { method: 'DELETE' }),

  // home
  home: (query: Record<string, unknown>) => get<HomePayload>('/api/v1/home', query),
  resurface: (query: Record<string, unknown>) =>
    get<{ items: Resurfaced[] }>('/api/v1/resurface', query),

  // capture and review
  captureLink: (body: Record<string, unknown>) => post<SourceSummary>('/api/v1/sources', body),
  upload: (files: File[], note?: string) => {
    const form = new FormData()
    files.forEach((file) => form.append('files', file))
    if (note) form.append('note', note)
    return request<SourceSummary[]>('/api/v1/sources/upload', { method: 'POST', body: form })
  },
  sources: (status?: string) => get<SourceSummary[]>('/api/v1/sources', { status }),
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
