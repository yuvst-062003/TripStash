import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { type AsyncState, useAsync } from '../lib/hooks'
import { EXIT } from '../lib/motion'
import type { Candidate, KnowledgeItem, SourceSummary } from '../lib/types'
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
  PROVENANCE_LABEL,
  Pill,
  SOURCE_LABEL,
  SectionLabel,
  SkeletonRows,
  categoryTint,
  eventWhen,
  fmtDay,
  knowledgeTint,
  pairText,
  stampToneFor,
} from '../components/ui'
import {
  AlertTriangle,
  Archive,
  ArrowUpRight,
  CATEGORY_ICON,
  ChevronRight,
  Clock,
  Inbox,
  KNOWLEDGE_ICON,
  Link2,
  RefreshCw,
  SOURCE_ICON,
  Search,
  X,
} from '../components/icons'

type View = 'inbox' | 'places' | 'knowledge' | 'sources'
const VIEWS: View[] = ['inbox', 'places', 'knowledge', 'sources']
const isView = (value: string | null): value is View => VIEWS.includes(value as View)

/** Panes slide along the segmented control's axis, the way the pill moved. */
const PANE: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 12 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -12, transition: { ...EXIT, duration: 0.12 } }),
}

/** A source's name, or what it was and when, so no row is ever blank. */
function sourceName(source: Pick<SourceSummary, 'title' | 'filename' | 'url' | 'kind' | 'created_at'>) {
  if (source.title || source.filename) return (source.title || source.filename) as string
  if (source.url) {
    try {
      return new URL(source.url).hostname.replace(/^www\./, '')
    } catch {
      return source.url
    }
  }
  return `${SOURCE_LABEL[source.kind] ?? 'Capture'} · ${fmtDay(source.created_at) ?? ''}`.trim()
}

/** The discovery library: what was collected, while Map answers where it is. */
export default function Saved() {
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<View>(() => {
    const tab = params.get('tab')
    return isView(tab) ? tab : 'inbox'
  })
  const { openSave } = useApp()
  useScreenContext({ surface: 'saved' })
  // A view's rows stagger in the first time it opens; after that they are
  // known and the pane alone cross-fades.
  const seen = useRef<Set<View>>(new Set())
  const dir = useRef(0)
  const fresh = !seen.current.has(view)
  useEffect(() => {
    seen.current.add(view)
  }, [view])
  const inbox = useAsync(() => api.inbox(), [], true, 'saved:inbox')
  const queue = inbox.data?.length ?? 0
  const sourceFilter = params.get('source')
  useEffect(() => {
    if (sourceFilter && view !== 'inbox') {
      dir.current = -1
      setView('inbox')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilter])

  return (
    <div className="screen">
      <header className="hero" style={{ paddingBottom: 'var(--s-2)' }}>
        <div className="hero__top" style={{ marginBottom: 0 }}>
          <h1 className="t-display hero__title">Saved</h1>
          <HeroActions />
        </div>
      </header>
      <Segmented
        name="saved"
        label="Saved views"
        value={view}
        onChange={(next) => {
          dir.current = Math.sign(VIEWS.indexOf(next) - VIEWS.indexOf(view))
          setView(next)
          setParams(next === 'inbox' ? {} : { tab: next }, { replace: true })
        }}
        options={[
          { value: 'inbox', label: 'Inbox', badge: queue },
          { value: 'places', label: 'Places' },
          { value: 'knowledge', label: 'Knowledge' },
          { value: 'sources', label: 'Sources' },
        ]}
      />
      <AnimatePresence mode="wait" initial={false} custom={dir.current}>
        <motion.div
          key={view}
          id={`saved-panel-${view}`}
          role="tabpanel"
          aria-labelledby={`saved-tab-${view}`}
          custom={dir.current}
          variants={PANE}
          initial={fresh ? false : 'enter'}
          animate="center"
          exit="exit"
        >
          {view === 'inbox' && (
            <InboxView
              inbox={inbox}
              onSave={openSave}
              fresh={fresh}
              sourceFilter={sourceFilter}
              onClearFilter={() => setParams({}, { replace: true })}
            />
          )}
          {view === 'places' && <PlacesView fresh={fresh} />}
          {view === 'knowledge' && <KnowledgeView fresh={fresh} />}
          {view === 'sources' && <SourcesView fresh={fresh} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function InboxView({
  inbox,
  onSave,
  fresh,
  sourceFilter,
  onClearFilter,
}: {
  inbox: AsyncState<Candidate[]>
  onSave: () => void
  fresh: boolean
  sourceFilter: string | null
  onClearFilter: () => void
}) {
  const sources = useAsync(() => api.sources(), [], true, 'saved:sources')
  const names = useMemo(
    () => new Map((sources.data ?? []).map((source) => [source.id, sourceName(source)])),
    [sources.data],
  )
  const kinds = useMemo(
    () => new Map((sources.data ?? []).map((source) => [source.id, source.kind])),
    [sources.data],
  )

  if (inbox.loading && !inbox.data) return <SkeletonRows rows={4} />
  if (inbox.error) return <ErrorNote message={inbox.error} onRetry={inbox.reload} />

  const all = inbox.data ?? []
  const candidates = sourceFilter ? all.filter((c) => c.source_id === sourceFilter) : all
  const filterName = sourceFilter ? (names.get(sourceFilter) ?? 'this source') : null

  if (candidates.length === 0) {
    const nothingCaptured = sources.data?.length === 0
    return sourceFilter ? (
      <Empty
        animateIn={fresh}
        stamp="All clear"
        title={`Nothing left from ${filterName}`}
        body="Every item from it has been decided."
        action={
          <button className="btn btn--ghost" onClick={onClearFilter}>
            Show the whole inbox
          </button>
        }
      />
    ) : nothingCaptured ? (
      <Empty
        animateIn={fresh}
        title="Nothing to review yet"
        body="Save a link, a screenshot or a video. What it finds lands here first — nothing reaches the map unconfirmed."
        action={
          <button className="btn btn--ink" onClick={onSave}>
            Save something
          </button>
        }
      />
    ) : (
      <Empty
        animateIn={fresh}
        stamp="All clear"
        title="Nothing waiting"
        body="Everything captured has been reviewed. New items land here first — nothing reaches the map unconfirmed."
        action={
          <button className="btn btn--ink" onClick={onSave}>
            Save something
          </button>
        }
      />
    )
  }

  // Grouped by what was captured: one video routinely yields a place, a
  // warning and a price, and the stamp already says which is which. A queue
  // of singletons is one flat list.
  const bySource = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    const list = bySource.get(candidate.source_id) ?? []
    list.push(candidate)
    bySource.set(candidate.source_id, list)
  }
  const grouped = !sourceFilter && [...bySource.values()].some((items) => items.length > 1)
  const groups: [string, Candidate[]][] = grouped ? [...bySource.entries()] : [['all', candidates]]

  let position = 0
  return (
    <>
      <p className="pad t-small dim" style={{ paddingTop: 'var(--s-4)' }}>
        {sourceFilter ? (
          <>
            {candidates.length} from {filterName}.{' '}
            <button type="button" className="link-btn" onClick={onClearFilter}>
              Show all
            </button>
          </>
        ) : (
          <>
            {candidates.length} item{candidates.length === 1 ? '' : 's'} extracted. Stamp what is
            right, fix what is close, ignore the rest.
          </>
        )}
      </p>
      <AnimatePresence initial={false} mode="popLayout">
        {groups.map(([key, items]) => (
          <motion.section key={key} layout exit={{ opacity: 0, transition: EXIT }}>
            {grouped && (
              <SectionLabel count={items.length > 1 ? items.length : undefined}>
                {names.get(key) ?? 'Captured'}
              </SectionLabel>
            )}
            <ul className="pad stack" style={grouped ? undefined : { paddingTop: 'var(--s-3)' }}>
              <AnimatePresence initial={false} mode="popLayout">
                {items.map((candidate) => {
                  const index = position++
                  return (
                    <motion.li
                      key={candidate.id}
                      layout
                      initial={fresh ? { opacity: 0, y: 8 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, transition: EXIT }}
                      transition={{
                        type: 'spring',
                        stiffness: 420,
                        damping: 34,
                        delay: fresh ? Math.min(index, 8) * 0.04 : 0,
                      }}
                    >
                      <ReviewCard
                        candidate={candidate}
                        index={index}
                        sourceKind={kinds.get(candidate.source_id)}
                        onDecided={inbox.reload}
                      />
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
          </motion.section>
        ))}
      </AnimatePresence>
    </>
  )
}

function PlacesView({ fresh }: { fresh: boolean }) {
  const { position, openSave } = useApp()
  const [query, setQuery] = useState('')
  // One request per pause in typing, not per keystroke.
  const [q, setQ] = useState('')
  useEffect(() => {
    const id = window.setTimeout(() => setQ(query.trim()), 250)
    return () => window.clearTimeout(id)
  }, [query])
  const places = useAsync(
    () => api.places({ q: q || undefined, lat: position?.lat, lon: position?.lon }),
    [q, position?.lat, position?.lon],
    true,
    `saved:places:${q}`,
  )

  return (
    <>
      {(q || (places.data?.length ?? 0) > 0) && (
      <div className="pad" style={{ paddingBlock: 'var(--s-4) var(--s-3)' }}>
        <div className="searchbar searchbar--flat" style={{ marginInline: 0 }}>
          <Search size={17} className="dimmer" />
          <input
            type="search"
            enterKeyHint="search"
            autoCapitalize="none"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your places by name"
            aria-label="Search saved places by name"
          />
          {query && (
            <button
              type="button"
              className="icon-btn"
              style={{ width: 36, height: 36, marginRight: -8 }}
              aria-label="Clear search"
              onClick={() => setQuery('')}
            >
              <X size={16} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
      )}

      <CacheNote visible={places.fromCache} />
      {places.loading && !places.data && <SkeletonRows rows={5} />}
      {places.error && <ErrorNote message={places.error} onRetry={places.reload} />}
      {places.data?.length === 0 &&
        (q ? (
          <Empty
            stamp="No match"
            title={`Nothing named “${q}”`}
            body="Search matches place names only. Try part of the name."
            action={
              <button className="btn btn--ghost" onClick={() => setQuery('')}>
                Clear search
              </button>
            }
          />
        ) : (
          <Empty
            animateIn={fresh}
            title="No places yet"
            body="Save a link, a screenshot or a video, confirm what it found in Inbox, and the place lands here and on the map."
            action={
              <button className="btn btn--ink" onClick={openSave}>
                Save something
              </button>
            }
          />
        ))}

      {places.data && places.data.length > 0 && (
        <MotionList animateIn={fresh}>
          {places.data.map((place, index) => (
            <MotionRow key={place.trip_place_id}>
              <Link to={`/places/${place.trip_place_id}`} className="item">
                <Glyph
                  Icon={CATEGORY_ICON[place.category] ?? CATEGORY_ICON.other}
                  tint={categoryTint(place.category)}
                />
                <div className="item__body">
                  <div className="row between row--top" style={{ gap: 'var(--s-2)' }}>
                    <p className="item__title grow clamp-2">{place.name}</p>
                    {/* Saved is the expected case; only the exception gets a stamp. */}
                    {place.status !== 'saved' && (
                      <StatusStamp status={place.status} rotate={index % 2 ? 4 : -6} />
                    )}
                  </div>
                  <Meta
                    parts={[
                      place.city,
                      place.walking_minutes != null
                        ? `${place.walking_minutes} min walk`
                        : place.distance_km != null && `${Math.round(place.distance_km)} km away`,
                      place.source_count > 1 && `${place.source_count} sources`,
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

const KNOWLEDGE_FILTERS = [
  'event',
  'safety',
  'transport',
  'accommodation',
  'border',
  'price',
  'packing',
  'route',
  'general',
]
const UNDO_MS = 5000

const dayStart = (value: string) => new Date(`${value}T00:00:00`).getTime()
/** An event whose last day is behind us. */
const isPast = (item: KnowledgeItem, todayMs: number) =>
  item.type === 'event' && item.happens_on != null && dayStart(item.ends_on ?? item.happens_on) < todayMs

function KnowledgeView({ fresh }: { fresh: boolean }) {
  const { openSave } = useApp()
  const [type, setType] = useState<string | null>(null)
  const archivedView = type === 'archived'
  const knowledge = useAsync(
    () =>
      api.knowledge(
        archivedView ? { include_archived: true } : { type: type ? [type] : undefined },
      ),
    [type],
    true,
    `saved:knowledge:${type ?? 'all'}`,
  )
  // Archiving is one tap, so it is not final for a few seconds.
  const [archived, setArchived] = useState<Set<string>>(new Set())
  const timers = useRef(new Map<string, number>())
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((id) => window.clearTimeout(id))
  }, [])

  const drop = (id: string) =>
    setArchived((set) => {
      const next = new Set(set)
      next.delete(id)
      return next
    })

  function archive(item: KnowledgeItem) {
    api.updateKnowledge(item.id, { is_archived: true }).then(() => {
      setArchived((set) => new Set(set).add(item.id))
      timers.current.set(
        item.id,
        window.setTimeout(() => {
          timers.current.delete(item.id)
          drop(item.id)
          knowledge.reload()
        }, UNDO_MS),
      )
    })
  }
  function restore(item: KnowledgeItem) {
    window.clearTimeout(timers.current.get(item.id))
    timers.current.delete(item.id)
    api.updateKnowledge(item.id, { is_archived: false }).then(() => {
      drop(item.id)
      if (archivedView) knowledge.reload()
    })
  }

  const todayMs = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today.getTime()
  }, [])

  const items = useMemo(() => {
    const list = (knowledge.data ?? []).filter((item) => (archivedView ? item.is_archived : true))
    if (type !== 'event') return list
    // Events in date order, what has passed at the end.
    return [...list].sort((a, b) => {
      const pa = isPast(a, todayMs) ? 1 : 0
      const pb = isPast(b, todayMs) ? 1 : 0
      if (pa !== pb) return pa - pb
      return (a.happens_on ?? '').localeCompare(b.happens_on ?? '')
    })
  }, [knowledge.data, type, archivedView, todayMs])

  const nothingAtAll = type === null && knowledge.data?.length === 0
  return (
    <>
      {!nothingAtAll && (
      <div className="rail" style={{ paddingBlock: 'var(--s-4) var(--s-3)' }}>
        <Pill on={type === null} onClick={() => setType(null)}>
          All
        </Pill>
        {KNOWLEDGE_FILTERS.map((item) => (
          <Pill key={item} on={type === item} onClick={() => setType(item)}>
            {KNOWLEDGE_LABEL[item]}
          </Pill>
        ))}
        <Pill Icon={Archive} on={archivedView} onClick={() => setType('archived')}>
          Archived
        </Pill>
      </div>
      )}

      {knowledge.loading && !knowledge.data && <SkeletonRows rows={4} />}
      {knowledge.error && <ErrorNote message={knowledge.error} onRetry={knowledge.reload} />}
      {knowledge.data && items.length === 0 && (
        <Empty
          animateIn={fresh}
          title={archivedView ? 'Nothing put away' : type ? `No ${KNOWLEDGE_LABEL[type]?.toLowerCase() ?? type} notes yet` : 'No notes yet'}
          body={
            archivedView
              ? 'Archive a tip and it waits here in case you need it back.'
              : 'Not everything is a pin. Safety warnings, transport tips, prices and packing advice land here, each with its source.'
          }
          action={
            nothingAtAll ? (
              <button className="btn btn--ink" onClick={openSave}>
                Save something
              </button>
            ) : type ? (
              <button className="btn btn--ghost" onClick={() => setType(null)}>
                Show everything
              </button>
            ) : undefined
          }
        />
      )}

      {items.length > 0 && (
        <MotionList animateIn={fresh}>
          {items.map((item, index) => {
            const Icon = KNOWLEDGE_ICON[item.type] ?? KNOWLEDGE_ICON.general
            const tint = knowledgeTint(item.type)
            const { headline, detail } = pairText(item.title, item.body)
            const gone = archived.has(item.id)
            const past = isPast(item, todayMs)
            return (
              <MotionRow key={item.id}>
                {gone ? (
                  <div className="item item--static" role="status">
                    <p className="t-small dim grow">
                      Archived.{' '}
                      <button type="button" className="link-btn" onClick={() => restore(item)}>
                        Undo
                      </button>
                    </p>
                  </div>
                ) : (
                  <div className="item item--static">
                    <div className="item__body">
                      {/* Stamp first, then the claim: the same object it was in Inbox. */}
                      <div className="review__head">
                        <Stamp tone={stampToneFor(tint)} size="sm" Icon={Icon} rotate={index % 2 ? 4 : -6}>
                          {KNOWLEDGE_LABEL[item.type] ?? item.type}
                        </Stamp>
                        <div className="review__tools">
                          {item.is_archived ? (
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={`Put back ${headline}`}
                              onClick={() => restore(item)}
                            >
                              <RefreshCw size={17} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={`Archive ${headline}`}
                              onClick={() => archive(item)}
                            >
                              <Archive size={17} />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="item__title clamp-3" style={{ marginTop: 6 }}>
                        {headline}
                      </p>
                      {detail && (
                        <p className="t-small dim" style={{ marginTop: 4 }}>
                          {detail}
                        </p>
                      )}
                      {item.type === 'event' && item.happens_on && (
                        <p
                          className="t-small mt"
                          style={
                            past
                              ? { color: 'var(--ink-3)' }
                              : { color: 'var(--tint-view)', fontWeight: 600 }
                          }
                        >
                          {eventWhen(item.happens_on, item.ends_on)}
                        </p>
                      )}
                      {/* Official facts, creator advice and model inference stay distinct. */}
                      <Meta
                        className="mt"
                        wrap
                        parts={[
                          item.destination_scope,
                          PROVENANCE_LABEL[item.provenance] ?? item.provenance,
                          item.source_date && `Published ${fmtDay(item.source_date)}`,
                          item.user_edited && item.provenance !== 'user' && 'Edited by you',
                        ]}
                      />
                      {item.requires_official_verification && (
                        <div style={{ marginTop: 6 }}>
                          <Note tone="warn">
                            Entry rules change — confirm against the official source.
                          </Note>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </MotionRow>
            )
          })}
        </MotionList>
      )}
    </>
  )
}

function SourcesView({ fresh }: { fresh: boolean }) {
  const { openSave } = useApp()
  const sources = useAsync(() => api.sources(), [], true, 'saved:sources')

  if (sources.loading && !sources.data) return <SkeletonRows rows={4} />
  if (sources.error) return <ErrorNote message={sources.error} onRetry={sources.reload} />
  if (sources.data?.length === 0) {
    return (
      <Empty
        animateIn={fresh}
        title="Nothing captured yet"
        body="Every link, screenshot and video you save is kept here, whatever the extraction managed to do with it."
        action={
          <button className="btn btn--ink" onClick={openSave}>
            Save something
          </button>
        }
      />
    )
  }

  function remove(source: SourceSummary) {
    const pending = source.pending_count
    const message = [
      `Delete “${sourceName(source)}”?`,
      pending > 0 && `${pending} unreviewed item${pending === 1 ? '' : 's'} will leave Inbox.`,
      'Places stay, but lose this source’s quotes.',
      source.file_url && 'The stored file is removed.',
    ]
      .filter(Boolean)
      .join(' ')
    if (confirm(message)) api.deleteSource(source.id).then(sources.reload)
  }

  return (
    <MotionList animateIn={fresh}>
      {(sources.data ?? []).map((source, index) => {
        const Icon = SOURCE_ICON[source.kind] ?? Link2
        const failed = source.status === 'failed'
        const working = source.status === 'queued' || source.status === 'processing'
        const empty = source.status === 'completed' && source.candidate_count === 0
        const rotate = index % 2 ? 4 : -6
        const name = sourceName(source)
        return (
          <MotionRow key={source.id}>
            <div className="item item--static">
              <Glyph Icon={Icon} tint={failed ? 'coral' : 'other'} />
              <div className="item__body">
                {/* Only the unexpected gets a stamp: work left, work stuck. */}
                {(failed || working || source.pending_count > 0) && (
                  <div style={{ marginBottom: 6 }}>
                    {failed ? (
                      <Stamp tone="warn" size="sm" Icon={AlertTriangle} rotate={rotate}>
                        Failed
                      </Stamp>
                    ) : working ? (
                      <Stamp tone="warn" size="sm" Icon={Clock} rotate={rotate}>
                        Processing
                      </Stamp>
                    ) : (
                      <Link
                        className="stamp-link"
                        to={`/saved?source=${source.id}`}
                        aria-label={`Review ${source.pending_count} from ${name}`}
                      >
                        <Stamp tone="coral" size="sm" Icon={Inbox} rotate={rotate}>
                          {source.pending_count} to review
                        </Stamp>
                      </Link>
                    )}
                  </div>
                )}
                <p className="item__title clamp-2">{name}</p>
                <Meta
                  wrap
                  parts={[
                    SOURCE_LABEL[source.kind] ?? source.kind,
                    source.author,
                    fmtDay(source.published_on),
                    source.candidate_count > 0 &&
                      `${source.candidate_count} item${source.candidate_count === 1 ? '' : 's'}`,
                    (failed || empty) && source.attempts > 1 && `${source.attempts} tries`,
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
                  {(failed || empty) && (
                    <button
                      className="btn btn--sm btn--ghost"
                      onClick={() => api.retrySource(source.id).then(sources.reload)}
                    >
                      <RefreshCw size={14} strokeWidth={2.2} />
                      Retry
                    </button>
                  )}
                  <button
                    className="btn btn--sm btn--ghost btn--quiet"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => remove(source)}
                  >
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
