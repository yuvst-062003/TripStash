import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import { useMotionPrefs } from '../lib/motion'
import ReviewCard from '../components/ReviewCard'
import Segmented from '../components/Segmented'
import { HeroActions } from '../components/TopBar'
import { Stamp, StatusStamp } from '../components/Stamp'
import {
  CacheNote,
  Empty,
  ErrorNote,
  Glyph,
  KNOWLEDGE_LABEL,
  Meta,
  MotionList,
  MotionRow,
  Note,
  Pill,
  SectionLabel,
  SkeletonRows,
  categoryTint,
  knowledgeTint,
  pairText,
  stampToneFor,
} from '../components/ui'
import {
  Archive,
  ArrowUpRight,
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

type View = 'inbox' | 'places' | 'knowledge' | 'sources'

/** The discovery library: what was collected, while Map answers where it is. */
export default function Saved() {
  const [view, setView] = useState<View>('inbox')
  const { openSave } = useApp()
  useScreenContext({ surface: 'saved' })

  return (
    <div className="screen">
      <header className="hero" style={{ paddingBottom: 'var(--s-2)' }}>
        <div className="hero__top" style={{ marginBottom: 0 }}>
          <h1 className="t-display hero__title">Saved</h1>
          <HeroActions />
        </div>
      </header>
      <Segmented
        label="Saved views"
        value={view}
        onChange={setView}
        options={[
          { value: 'inbox', label: 'Inbox' },
          { value: 'places', label: 'Places' },
          { value: 'knowledge', label: 'Knowledge' },
          { value: 'sources', label: 'Sources' },
        ]}
      />
      <AnimatePresence mode="wait" initial={false}>
        <ViewPane key={view}>
          {view === 'inbox' && <InboxView onSave={openSave} />}
          {view === 'places' && <PlacesView />}
          {view === 'knowledge' && <KnowledgeView />}
          {view === 'sources' && <SourcesView />}
        </ViewPane>
      </AnimatePresence>
    </div>
  )
}

function ViewPane({ children }: { children: React.ReactNode }) {
  const { reduced, spring } = useMotionPrefs()
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? undefined : { opacity: 0, y: -6 }}
      transition={spring}
    >
      {children}
    </motion.div>
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
        stamp="All clear"
        title="Nothing waiting"
        body="Everything captured has been reviewed. New items land here first — nothing reaches the map unconfirmed."
        action={
          <button className="btn btn--coral" onClick={onSave}>
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
      <p className="pad t-small dim" style={{ paddingTop: 'var(--s-4)' }}>
        {candidates.length} item{candidates.length === 1 ? '' : 's'} extracted. Stamp what is right,
        fix what is close, ignore the rest.
      </p>
      {Object.entries(groups).map(([type, items]) => (
        <section key={type}>
          <SectionLabel count={items.length}>{KNOWLEDGE_LABEL[type] ?? type}</SectionLabel>
          <ul className="pad stack">
            <AnimatePresence initial={false}>
              {items.map((candidate) => (
                <motion.li
                  key={candidate.id}
                  layout
                  exit={{ opacity: 0, height: 0, marginTop: 0, overflow: 'hidden' }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                >
                  <ReviewCard candidate={candidate} onDecided={inbox.reload} />
                </motion.li>
              ))}
            </AnimatePresence>
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
      <div className="pad" style={{ paddingBlock: 'var(--s-4) var(--s-3)' }}>
        <div className="searchbar searchbar--flat" style={{ marginInline: 0 }}>
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
          stamp="No pins"
          title="No confirmed places yet"
          body="Approve something from Inbox and it appears here and on the map."
        />
      )}

      {places.data && places.data.length > 0 && (
        <MotionList>
          {places.data.map((place, index) => (
            <MotionRow key={place.trip_place_id}>
              <Link to={`/places/${place.trip_place_id}`} className="item">
                <Glyph
                  Icon={CATEGORY_ICON[place.category] ?? CATEGORY_ICON.other}
                  tint={categoryTint(place.category)}
                />
                <div className="item__body">
                  <div className="row between row--top" style={{ gap: 'var(--s-2)' }}>
                    <p className="item__title grow clamp-1">{place.name}</p>
                    <StatusStamp status={place.status} rotate={index % 2 ? 4 : -6} />
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
                    <p className="t-small dim clamp-2" style={{ marginTop: 4 }}>
                      {place.reason_saved}
                    </p>
                  )}
                  {place.needs_review && (
                    <div style={{ marginTop: 6 }}>
                      <Note tone="warn">Low-confidence extraction — check the name and pin.</Note>
                    </div>
                  )}
                </div>
                <ChevronRight size={18} className="item__chev" />
              </Link>
            </MotionRow>
          ))}
        </MotionList>
      )}
    </>
  )
}

const KNOWLEDGE_FILTERS = ['safety', 'transport', 'border', 'price', 'packing', 'route', 'general']

function KnowledgeView() {
  const [type, setType] = useState<string | null>(null)
  const knowledge = useAsync(() => api.knowledge({ type: type ? [type] : undefined }), [type])

  return (
    <>
      <div className="rail" style={{ paddingBlock: 'var(--s-4) var(--s-3)' }}>
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
          stamp="Nothing here"
          title="No saved knowledge yet"
          body="Not everything is a map pin. Safety warnings, transport tips, prices and packing advice live here, each with its source."
        />
      )}

      {knowledge.data && knowledge.data.length > 0 && (
        <MotionList>
          {knowledge.data.map((item) => {
            const Icon = KNOWLEDGE_ICON[item.type] ?? KNOWLEDGE_ICON.general
            const tint = knowledgeTint(item.type)
            const { headline, detail } = pairText(item.title, item.body)
            return (
              <MotionRow key={item.id}>
                <div className="item item--static">
                  <Glyph Icon={Icon} tint={tint} />
                  <div className="item__body">
                    <div className="row between row--top" style={{ gap: 'var(--s-2)' }}>
                      <p className="item__title grow">{headline}</p>
                      <Stamp tone={stampToneFor(tint)} size="sm" rotate={-5}>
                        {KNOWLEDGE_LABEL[item.type] ?? item.type}
                      </Stamp>
                    </div>
                    {detail && (
                      <p className="t-small dim" style={{ marginTop: 4 }}>
                        {detail}
                      </p>
                    )}
                    {/* Official facts, creator advice and model inference stay distinct. */}
                    <Meta
                      className="mt"
                      parts={[
                        item.destination_scope,
                        item.provenance,
                        item.source_date,
                        item.user_edited && 'edited by you',
                      ]}
                    />
                    {item.requires_official_verification && (
                      <div style={{ marginTop: 6 }}>
                        <Note tone="warn" Icon={Flag}>
                          Entry rules change — confirm against the official source.
                        </Note>
                      </div>
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
              </MotionRow>
            )
          })}
        </MotionList>
      )}
    </>
  )
}

function SourcesView() {
  const sources = useAsync(() => api.sources(), [])

  if (sources.loading && !sources.data) return <SkeletonRows rows={4} />
  if (sources.error) return <ErrorNote message={sources.error} onRetry={sources.reload} />
  if (sources.data?.length === 0) {
    return (
      <Empty
        stamp="No sources"
        title="Nothing captured yet"
        body="Every link, screenshot and video you capture is kept here, whatever the extraction managed to do with it."
      />
    )
  }

  return (
    <MotionList>
      {(sources.data ?? []).map((source) => {
        const Icon = SOURCE_ICON[source.kind] ?? Link2
        const failed = source.status === 'failed'
        return (
          <MotionRow key={source.id}>
            <div className="item item--static">
              <Glyph Icon={Icon} tint={failed ? 'coral' : 'other'} />
              <div className="item__body">
                <p className="item__title clamp-2">
                  {source.title || source.filename || source.url}
                </p>
                <Meta
                  parts={[
                    source.status.replace('_', ' '),
                    source.kind,
                    source.author,
                    source.published_on,
                    `${source.candidate_count} extracted`,
                  ]}
                />
                {source.failure_reason && (
                  <div style={{ marginTop: 6 }}>
                    <Note tone="warn">{source.failure_reason}</Note>
                  </div>
                )}
                <div className="row row--wrap" style={{ gap: 'var(--s-1)', marginTop: 'var(--s-2)' }}>
                  {source.url && (
                    <a className="btn btn--sm btn--ghost" href={source.url} target="_blank" rel="noreferrer">
                      Original
                      <ArrowUpRight size={14} strokeWidth={2.2} />
                    </a>
                  )}
                  {failed && (
                    <button
                      className="btn btn--sm btn--ghost"
                      onClick={() => api.retrySource(source.id).then(sources.reload)}
                    >
                      <RefreshCw size={14} strokeWidth={2.2} />
                      Retry ({source.attempts})
                    </button>
                  )}
                  <button
                    className="btn btn--sm btn--ghost"
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
          </MotionRow>
        )
      })}
    </MotionList>
  )
}
