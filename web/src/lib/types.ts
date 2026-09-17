export type KnowledgeType =
  | 'place'
  | 'accommodation'
  | 'safety'
  | 'border'
  | 'transport'
  | 'route'
  | 'price'
  | 'packing'
  | 'general'

export type PlaceStatus = 'inbox' | 'saved' | 'must_visit' | 'planned' | 'visited' | 'archived'

export interface Trip {
  id: string
  name: string
  start_date: string | null
  end_date: string | null
  base_currency: string
  total_budget: number | null
  interests: string[]
  phase: 'before' | 'during' | 'after'
  destinations: Destination[]
}

export interface Destination {
  id: string
  name: string
  country: string | null
  lat: number | null
  lon: number | null
  position: number
  arrive_on: string | null
  depart_on: string | null
  is_current: boolean
  notes: string | null
}

export interface MediaStage {
  name: string
  engine: string
  status: 'ok' | 'skipped' | 'failed'
  duration_ms: number
  detail: string | null
}

export interface SourceSummary {
  id: string
  kind: string
  status: 'queued' | 'processing' | 'needs_review' | 'completed' | 'failed'
  url: string | null
  title: string | null
  author: string | null
  filename: string | null
  media_type: string | null
  byte_size: number | null
  published_on: string | null
  created_at: string
  processed_at: string | null
  failure_reason: string | null
  attempts: number
  candidate_count: number
  pending_count: number
  file_url: string | null
  duration_seconds: number | null
  stages: MediaStage[]
  transcript_chars: number
  ocr_chars: number
}

export interface Evidence {
  quote: string
  media_timestamp_seconds: number | null
  channel: string
}

export interface Resolution {
  provider: string
  provider_place_id: string
  name: string
  lat: number
  lon: number
  category: string
  address: string | null
  city: string | null
  country: string | null
  match_confidence: number
}

export interface Candidate {
  id: string
  source_id: string
  type: KnowledgeType
  status: string
  title: string
  body: string | null
  category: string | null
  destination_scope: string | null
  confidence: number
  is_place_candidate: boolean
  evidence: Evidence[]
  resolutions: Resolution[]
  duplicate_of_place_id: string | null
  duplicate_reason: string | null
}

export interface PlaceSummary {
  trip_place_id: string
  place_id: string
  name: string
  category: string
  city: string | null
  country: string | null
  lat: number
  lon: number
  status: PlaceStatus
  is_favourite: boolean
  needs_review: boolean
  reason_saved: string | null
  source_count: number
  distance_km: number | null
  walking_minutes: number | null
}

export interface MapFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: {
    trip_place_id: string
    place_id: string
    name: string
    category: string
    status: PlaceStatus
    is_favourite: boolean
    needs_review: boolean
    reason_saved: string | null
    source_count: number
  }
}

export interface FactGroup {
  kind: string
  primary: {
    value: string
    provenance: string
    source_label: string | null
    source_url: string | null
    confidence: number
    checked_at: string
    freshness: 'fresh' | 'ageing' | 'stale'
    age_label: string
  }
  alternatives: FactGroup['primary'][]
  has_conflict: boolean
  conflict_note: string | null
}

export interface PlacePage {
  header: {
    trip_place_id: string
    place_id: string
    name: string
    category: string
    city: string | null
    country: string | null
    address: string | null
    status: PlaceStatus
    is_favourite: boolean
    needs_review: boolean
    coordinates: { lat: number; lon: number }
    distance_km: number | null
    walking_minutes: number | null
  }
  overview: {
    why_saved: string | null
    notes: string | null
    expected_cost: number | null
    expected_duration_minutes: number | null
    best_time: string | null
    collections: { id: string; name: string }[]
  }
  saved_content: {
    source_id: string
    kind: string
    title: string | null
    url: string | null
    author: string | null
    published_on: string | null
    captured_at: string
    provenance: string
    takeaway: string | null
    quote: string | null
    media_timestamp_seconds: number | null
  }[]
  live_information: {
    facts: FactGroup[]
    weather: {
      summary: string
      temperature_c: number
      precipitation_probability: number
      for_date: string
      checked_at: string
    }
  }
  knowledge: {
    id: string
    type: KnowledgeType
    title: string
    body: string | null
    confidence: number
    requires_official_verification: boolean
  }[]
  plan: { id: string; on_date: string; start_time: string | null; title: string }[]
  personal_record: {
    rating: number | null
    visits: {
      id: string
      visited_on: string
      rating: number | null
      notes: string | null
      actual_cost: number | null
      currency: string | null
    }[]
  }
  actions: { primary: HandoffAction[]; secondary: HandoffAction[] }
  suggested_questions: string[]
}

export interface HandoffAction {
  key: string
  label: string
  url: string
  web_fallback: string | null
  note: string | null
}

export interface AskCard {
  type: 'place' | 'knowledge' | 'budget' | 'handoff'
  title: string
  subtitle?: string | null
  body?: string | null
  trip_place_id?: string
  place_id?: string
  knowledge_item_id?: string
  knowledge_type?: KnowledgeType
  why_saved?: string | null
  distance_km?: number | null
  walking_minutes?: number | null
  confidence?: number
  provenance?: string
  requires_official_verification?: boolean
  currency?: string
  spent?: number
  spent_today?: number
  budget?: number | null
  remaining?: number | null
  facts?: FactGroup[]
  actions: HandoffAction[]
}

export interface ProposedAction {
  type: string
  label: string
  preview: string
  payload: Record<string, unknown>
}

export interface AskResponse {
  answer: string
  context: Record<string, unknown>
  cards: AskCard[]
  citations: {
    kind: string
    label: string
    url: string | null
    source_id: string
    captured_at: string
    published_on: string | null
    provenance: string
    takeaway?: string | null
    quote?: string | null
  }[]
  disclaimers: string[]
  proposed_actions: ProposedAction[]
  tools_used: string[]
  applied_changes: unknown[]
  latency_ms: number
}

export interface HomePayload {
  phase: 'before' | 'during' | 'after'
  date: string
  trip: { id: string; name: string; base_currency: string }
  countdown_days: number | null
  current_destination: { id: string; name: string; country: string | null } | null
  weather: {
    summary: string
    temperature_c: number
    precipitation_probability: number
    checked_at: string
  } | null
  review_queue: { pending_candidates: number; failed_sources: number }
  place_counts: Record<string, number>
  today_plan: {
    id: string
    title: string
    start_time: string | null
    trip_place_id: string | null
    is_done: boolean
  }[]
  money: {
    currency: string
    spent_total: number
    spent_today: number
    budget: number | null
    daily: { remaining: number; per_day: number | null; days_left: number | null } | null
  }
  bookings: {
    id: string
    title: string
    kind: string
    start_at: string | null
    cancellation_deadline: string | null
  }[]
  resurfaced: Resurfaced[]
  empty_state: string | null
}

export interface Resurfaced {
  kind: 'place' | 'knowledge'
  title: string
  body: string | null
  reason: string
  confidence: number
  knowledge_item_id: string | null
  trip_place_id: string | null
  place_id: string | null
  category: string | null
  knowledge_type: KnowledgeType | null
  distance_km: number | null
}

export interface KnowledgeItem {
  id: string
  type: KnowledgeType
  title: string
  body: string | null
  category: string | null
  destination_scope: string | null
  confidence: number
  provenance: string
  source_id: string | null
  source_date: string | null
  requires_official_verification: boolean
  user_edited: boolean
  is_archived: boolean
  evidence: Evidence[]
}
