import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { MediaStage, PlaceSummary, SourceSummary } from '../lib/types'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import ReviewCard from '../components/ReviewCard'
import TopBar from '../components/TopBar'
import {
  CacheNote,
  Empty,
  ErrorNote,
  Glyph,
  KNOWLEDGE_LABEL,
  Meta,
  Note,
  Pill,
  SectionLabel,
  SkeletonRows,
  StatusLabel,
  Tabs,
  pairText,
} from '../components/ui'
import {
  Archive,
  ArrowUpRight,
  Check,
  CircleDashed,
  AlertTriangle,
  CATEGORY_ICON,
  ChevronRight,
  Flag,
  KNOWLEDGE_ICON,
  Link2,
  RefreshCw,
  SOURCE_ICON,
  Search,
  Trash2,
} from '../components/icons'

type View = 'activity' | 'inbox' | 'places' | 'knowledge' | 'sources'
const VIEWS: View[] = ['activity', 'inbox', 'places', 'knowledge', 'sources']

/** The discovery library: what was collected, while Map answers where it is. */
export default function Saved() {
  // The tab lives in the URL, so "Saved → Sources" from Profile lands on
  // Sources and a back press returns to the tab you left.
  const [params, setParams] = useSearchParams()
  const fromUrl = params.get('tab')
  const view: View = VIEWS.includes(fromUrl as View) ? (fromUrl as View) : 'activity'
  const setView = (next: View) =>
    setParams(next === 'activity' ? {} : { tab: next }, { replace: false })
  const { openSave } = useApp()
  useScreenContext({ surface: 'saved' })

  return (
    <div className="screen">
      <TopBar title="Saved" />
      <Tabs
        label="Saved views"
        value={view}
        onChange={setView}
        options={[
          { value: 'activity', label: 'By activity' },
          { value: 'inbox', label: 'Inbox' },
          { value: 'places', label: 'Places' },
          { value: 'knowledge', label: 'Knowledge' },
          { value: 'sources', label: 'Sources' },
        ]}
      />
      {view === 'activity' && <ActivityView onInbox={() => setView('inbox')} />}
      {view === 'inbox' && <InboxView onSave={openSave} />}
      {view === 'places' && <PlacesView />}
      {view === 'knowledge' && <KnowledgeView />}
      {view === 'sources' && <SourcesView />}
    </div>
  )
}

/** What a traveller calls a kind of place, rather than what the database does. */
const KIND_LABEL: Record<string, string> = {
  accommodation: 'Places to stay',
  attraction: 'Sights',
  activity: 'Things to do',
  restaurant: 'Food',
  cafe: 'Cafés',
  bar: 'Bars',
  viewpoint: 'Viewpoints',
  nature: 'Nature',
  shop: 'Shops',
  transport: 'Getting around',
  other: 'Everything else',
}

/**
 * Everything you have gathered, filed by what you DO rather than where it is.
 *
 * The one question the map cannot answer: "every hike I saved" spans four
 * countries, so no single map view holds them, but one heading here does. A
 * place's kind is the honest stand-in for its activity until the summary
 * carries activity tags.
 */
function ActivityView({ onInbox }: { onInbox: () => void }) {
  const places = useAsync(() => api.places({}), [])
  const inbox = useAsync(() => api.inbox(), [])
  const [kind, setKind] = useState<string | null>(null)
  const { openAsk } = useApp()

  const groups = useMemo(() => {
    const by = new Map<string, PlaceSummary[]>()
    for (const place of places.data ?? []) {
      const list = by.get(place.category) ?? []
      list.push(place)
      by.set(place.category, list)
    }
    return [...by.entries()]
      .map(([slug, list]) => ({
        slug,
        label: KIND_LABEL[slug] ?? slug,
        places: list,
        countries: new Set(list.map((p) => p.country ?? '')).size,
      }))
      .sort((a, b) => b.places.length - a.places.length || a.label.localeCompare(b.label))
  }, [places.data])

  if (places.loading && !places.data) return <SkeletonRows rows={4} />
  if (places.error) return <ErrorNote message={places.error} onRetry={places.reload} />

  const total = places.data?.length ?? 0
  const waiting = inbox.data?.length ?? 0
  const shown = kind ? groups.filter((g) => g.slug === kind) : groups
  const label = kind ? (KIND_LABEL[kind] ?? kind) : null

  return (
    <div className="pad" style={{ paddingTop: 'var(--s-3)' }}>
      {waiting > 0 && (
        <button className="waiting" onClick={onInbox}>
          <span className="cliptag cliptag--found num">{waiting}</span>
          <span className="item__body">
            <span className="item__title">{waiting} waiting for you to keep or pass</span>
            <span className="t-sm dim">Found or read for you. They count for nothing until kept.</span>
          </span>
          <ChevronRight size={18} className="dimmer" />
        </button>
      )}

      {groups.length > 0 && (
        <div className="chiprow" role="group" aria-label="Filter by activity">
          <button className="chip-toggle" aria-pressed={kind === null} onClick={() => setKind(null)}>
            All {total}
          </button>
          {groups.map((g) => (
            <button
              key={g.slug}
              className="chip-toggle"
              aria-pressed={kind === g.slug}
              onClick={() => setKind(kind === g.slug ? null : g.slug)}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 && (
        <Empty
          title="Nothing filed yet"
          body="Share a reel, upload a plan, or look somewhere up in Explore. What you keep lands here."
        />
      )}

      {shown.map((group) => (
        <section key={group.slug} className="filegroup">
          <div className="row between filegroup__head">
            <h2 className="t-md">{group.label}</h2>
            <span className="t-xs dim num">
              {group.places.length} across{' '}
              {group.countries === 1 ? '1 country' : `${group.countries} countries`}
            </span>
          </div>
          <ul className="list">
            {group.places.map((place) => (
              <li key={place.trip_place_id}>
                <Link to={`/places/${place.trip_place_id}`} className="item">
                  <Glyph Icon={CATEGORY_ICON[place.category] ?? CATEGORY_ICON.other} />
                  <div className="item__body">
                    <p className="item__title clamp-1">{place.name}</p>
                    <Meta parts={[place.city, place.country]} />
                  </div>
                  <ChevronRight size={18} className="dimmer" style={{ flex: 'none' }} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {total > 0 && (
        <button
          className="btn btn--block"
          style={{ marginBlock: 'var(--s-4)' }}
          onClick={() =>
            openAsk({ surface: 'saved', contextLabel: label ?? 'everything you have saved' })
          }
        >
          {label ? `Ask about your ${label.toLowerCase()}` : 'Ask about everything you saved'}
        </button>
      )}
    </div>
  )
}

function InboxView({ onSave }: { onSave: () => void }) {
  const inbox = useAsync(() => api.inbox(), [])

  if (inbox.loading && !inbox.data) return <SkeletonRows rows={4} />
  if (inbox.error) return <ErrorNote message={inbox.error} onRetry={inbox.reload} />

  const candidates = inbox.data ?? []
  if (candidates.length === 0) {
    return (
      <Empty
        title="Nothing waiting"
        body="Everything captured has been reviewed. New items land here first — nothing reaches the map unconfirmed."
        action={
          <button className="btn btn--accent" onClick={() => onSave()}>
            Save something
          </button>
        }
      />
    )
  }

  // Grouped by type: one video routinely yields a place, a warning and a
  // price, and each is a separate decision.
  const groups = candidates.reduce<Record<string, typeof candidates>>((acc, candidate) => {
    ;(acc[candidate.type] ??= []).push(candidate)
    return acc
  }, {})

  return (
    <>
      <p className="pad t-sm dim" style={{ paddingTop: 'var(--s-3)' }}>
        {candidates.length} item{candidates.length === 1 ? '' : 's'} extracted. Approve, correct or
        ignore each one.
      </p>
      {Object.entries(groups).map(([type, items]) => (
        <section key={type}>
          <SectionLabel>
            {KNOWLEDGE_LABEL[type] ?? type} · {items.length}
          </SectionLabel>
          <ul className="pad stack">
            {items.map((candidate) => (
              <li key={candidate.id}>
                <ReviewCard candidate={candidate} onDecided={inbox.reload} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

function PlacesView() {
  const { position } = useApp()
  const [query, setQuery] = useState('')
  const places = useAsync(
    () => api.places({ q: query || undefined, lat: position?.lat, lon: position?.lon }),
    [query, position?.lat, position?.lon],
  )

  return (
    <>
      <div className="pad" style={{ paddingBlock: 'var(--s-3)' }}>
        <div className="searchbar" style={{ marginInline: 0, boxShadow: 'none' }}>
          <Search size={17} className="dimmer" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your places"
            aria-label="Search saved places"
          />
        </div>
      </div>

      <CacheNote visible={places.fromCache} />
      {places.loading && !places.data && <SkeletonRows rows={5} />}
      {places.error && <ErrorNote message={places.error} onRetry={places.reload} />}
      {places.data?.length === 0 && (
        <Empty
          title="No confirmed places yet"
          body="Approve something from Inbox and it appears here and on the map."
        />
      )}

      <ul className="list">
        {(places.data ?? []).map((place) => (
          <li key={place.trip_place_id}>
            <Link to={`/places/${place.trip_place_id}`} className="item">
              <Glyph Icon={CATEGORY_ICON[place.category] ?? CATEGORY_ICON.other} />
              <div className="item__body">
                <div className="row between" style={{ gap: 'var(--s-2)' }}>
                  <p className="item__title grow clamp-1">{place.name}</p>
                  <StatusLabel status={place.status} />
                </div>
                <Meta
                  parts={[
                    place.category,
                    place.city,
                    place.walking_minutes != null
                      ? `${place.walking_minutes} min walk`
                      : place.distance_km != null && `${Math.round(place.distance_km)} km away`,
                    `${place.source_count} source${place.source_count === 1 ? '' : 's'}`,
                  ]}
                />
                {place.reason_saved && (
                  <p className="t-sm dim clamp-2" style={{ marginTop: 2 }}>
                    {place.reason_saved}
                  </p>
                )}
                {place.needs_review && (
                  <Note tone="warn">Low-confidence extraction — check the name and pin.</Note>
                )}
              </div>
              <ChevronRight size={18} className="dimmer" style={{ flex: 'none', marginTop: 9 }} />
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

const KNOWLEDGE_FILTERS = ['safety', 'transport', 'border', 'price', 'packing', 'route', 'general']

function KnowledgeView() {
  const [type, setType] = useState<string | null>(null)
  const knowledge = useAsync(() => api.knowledge({ type: type ? [type] : undefined }), [type])

  return (
    <>
      <div className="rail" style={{ paddingBlock: 'var(--s-3)' }}>
        <Pill on={type === null} onClick={() => setType(null)}>
          All
        </Pill>
        {KNOWLEDGE_FILTERS.map((item) => (
          <Pill key={item} on={type === item} onClick={() => setType(item)}>
            {KNOWLEDGE_LABEL[item]}
          </Pill>
        ))}
      </div>

      {knowledge.loading && !knowledge.data && <SkeletonRows rows={4} />}
      {knowledge.error && <ErrorNote message={knowledge.error} onRetry={knowledge.reload} />}
      {knowledge.data?.length === 0 && (
        <Empty
          title={type === null ? 'No saved knowledge yet' : `Nothing under ${KNOWLEDGE_LABEL[type] ?? type} yet`}
          body={
            type === null
              ? 'Not everything is a map pin. Safety warnings, transport tips, prices and packing advice live here, each with its source.'
              : 'Your other notes are under All. Save a link or write a note and anything of this kind lands here.'
          }
        />
      )}

      <ul className="list">
        {(knowledge.data ?? []).map((item) => {
          const Icon = KNOWLEDGE_ICON[item.type] ?? KNOWLEDGE_ICON.general
          const { headline, detail } = pairText(item.title, item.body)
          return (
            <li key={item.id}>
              <div className="item" style={{ cursor: 'default' }}>
                <Glyph Icon={Icon} />
                <div className="item__body">
                  <p className="item__title">{headline}</p>
                  {detail && (
                    <p className="t-sm dim" style={{ marginTop: 2 }}>
                      {detail}
                    </p>
                  )}
                  {/* Official facts, creator advice and model inference stay distinct. */}
                  <Meta
                    parts={[
                      KNOWLEDGE_LABEL[item.type] ?? item.type,
                      item.destination_scope,
                      item.provenance,
                      item.source_date,
                      item.user_edited && 'edited by you',
                    ]}
                  />
                  {item.requires_official_verification && (
                    <Note tone="warn" Icon={Flag}>
                      Entry rules change — confirm against the official source.
                    </Note>
                  )}
                </div>
                <button
                  className="icon-btn"
                  aria-label={`Archive ${headline}`}
                  onClick={() => api.updateKnowledge(item.id, { is_archived: true }).then(knowledge.reload)}
                >
                  <Archive size={17} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

const STAGE_ICON = { ok: Check, skipped: CircleDashed, failed: AlertTriangle } as const
const STAGE_COLOUR = {
  ok: 'var(--accent)',
  skipped: 'var(--ink-3)',
  failed: 'var(--danger)',
} as const

function StageList({ stages, source }: { stages: MediaStage[]; source: SourceSummary }) {
  const recovered = [
    source.transcript_chars > 0 && `${source.transcript_chars} chars heard`,
    source.ocr_chars > 0 && `${source.ocr_chars} chars read on screen`,
  ].filter(Boolean)

  return (
    <div style={{ marginTop: 'var(--s-2)' }}>
      <ul className="stack-2">
        {stages.map((stage, index) => {
          const Icon = STAGE_ICON[stage.status]
          return (
            <li key={`${stage.name}-${index}`} className="row" style={{ gap: 'var(--s-2)' }}>
              <Icon
                size={13}
                strokeWidth={2.4}
                style={{ flex: 'none', color: STAGE_COLOUR[stage.status], marginTop: 3 }}
              />
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t-sm">{stage.name}</span>
                <span className="t-sm dimmer"> · {stage.engine}</span>
                {stage.detail && <span className="meta" style={{ display: 'block' }}>{stage.detail}</span>}
              </span>
              <span className="t-sm dimmer num" style={{ flex: 'none' }}>
                {stage.duration_ms < 1000
                  ? `${stage.duration_ms} ms`
                  : `${(stage.duration_ms / 1000).toFixed(1)} s`}
              </span>
            </li>
          )
        })}
      </ul>
      {recovered.length > 0 && (
        <p className="meta" style={{ marginTop: 'var(--s-2)' }}>
          {recovered.map((part, index) => (
            <span key={index}>{part}</span>
          ))}
        </p>
      )}
    </div>
  )
}

function SourcesView() {
  const sources = useAsync(() => api.sources(), [])

  if (sources.loading && !sources.data) return <SkeletonRows rows={4} />
  if (sources.error) return <ErrorNote message={sources.error} onRetry={sources.reload} />
  if (sources.data?.length === 0) {
    return (
      <Empty
        title="No sources yet"
        body="Every link, screenshot and video you capture is kept here, whatever the extraction managed to do with it."
      />
    )
  }

  return (
    <ul className="list">
      {(sources.data ?? []).map((source) => {
        const Icon = SOURCE_ICON[source.kind] ?? Link2
        const failed = source.status === 'failed'
        return (
          <li key={source.id}>
            <div className="item" style={{ cursor: 'default' }}>
              <Glyph Icon={Icon} />
              <div className="item__body">
                <p className="item__title clamp-2" dir="auto">
                  {source.title || source.filename || source.url || source.excerpt || 'Untitled'}
                </p>
                <Meta
                  parts={[
                    source.status.replace('_', ' '),
                    source.kind,
                    source.author,
                    source.published_on,
                    source.duration_seconds != null && `${source.duration_seconds.toFixed(1)}s`,
                    `${source.candidate_count} extracted`,
                  ]}
                />

                {/* What each stage of the media pipeline actually managed to
                    read - the per-item status specification 7.5 asks for. */}
                {source.stages.length > 0 && <StageList stages={source.stages} source={source} />}

                {source.failure_reason && <Note tone="warn">{source.failure_reason}</Note>}
                <div className="row" style={{ gap: 'var(--s-2)', marginTop: 'var(--s-2)' }}>
                  {source.url && (
                    <a className="btn btn--sm btn--plain" href={source.url} target="_blank" rel="noreferrer">
                      Original
                      <ArrowUpRight size={14} strokeWidth={2.2} />
                    </a>
                  )}
                  {failed && (
                    <button
                      className="btn btn--sm btn--plain"
                      onClick={() => api.retrySource(source.id).then(sources.reload)}
                    >
                      <RefreshCw size={14} strokeWidth={2.2} />
                      Retry ({source.attempts})
                    </button>
                  )}
                  <button
                    className="btn btn--sm btn--plain"
                    onClick={() => {
                      if (confirm('Delete this source and its stored file? Places saved from it stay.')) {
                        api.deleteSource(source.id).then(sources.reload)
                      }
                    }}
                  >
                    <Trash2 size={14} strokeWidth={2.2} />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
