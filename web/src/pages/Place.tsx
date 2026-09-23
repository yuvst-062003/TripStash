import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion, useScroll, useTransform } from 'motion/react'
import { ApiError, api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import { EXIT, useMotionPrefs } from '../lib/motion'
import { STAMP_PATTERN, tick } from '../lib/haptics'
import type { FactGroup, PlacePage, PlaceStatus } from '../lib/types'
import MiniMap from '../components/MiniMap'
import { STATUS_STAMP, Stamp, StatusStamp } from '../components/Stamp'
import {
  Banner,
  CATEGORY_LABEL,
  CacheNote,
  Empty,
  ErrorNote,
  Freshness,
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
  checkedAgo,
  fmtDay,
  knowledgeTint,
  pairText,
  stampToneFor,
} from '../components/ui'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  Copy,
  Flag,
  KNOWLEDGE_ICON,
  Navigation,
  Play,
  Sparkles,
  Star,
} from '../components/icons'

const STATUSES: PlaceStatus[] = ['saved', 'must_visit', 'planned', 'visited', 'archived']
const FACT_LABEL: Record<string, string> = {
  hours: 'Hours',
  price: 'Price level',
  phone: 'Phone',
  website: 'Website',
  address: 'Address',
  access: 'Getting in',
  ticket: 'Tickets',
  closure: 'Closure',
}
const PRICE_LABEL: Record<string, string> = {
  $: 'cheap',
  $$: 'mid-range',
  $$$: 'pricey',
  $$$$: 'a splurge',
}
/** Provider adapters by display name; anything unlisted (the test double) is not shown. */
const PROVIDER_NAME: Record<string, string> = {
  google: 'Google Maps',
  osm: 'OpenStreetMap',
  foursquare: 'Foursquare',
}

const localToday = () => new Date().toLocaleDateString('en-CA')
const norm = (text: string | null | undefined) =>
  (text ?? '')
    .trim()
    .replace(/^[“"']+|[”"'…]+$/g, '')
    .toLowerCase()

/** The value of a live fact, pressable when it is somewhere you can go. */
function FactValue({ fact }: { fact: FactGroup }) {
  const value = fact.primary.value
  if (fact.kind === 'website') {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="teal" style={{ wordBreak: 'break-all' }}>
        {value.replace(/^https?:\/\//, '').replace(/\/$/, '')}
      </a>
    )
  }
  if (fact.kind === 'phone') return <a href={`tel:${value.replace(/\s+/g, '')}`}>{value}</a>
  if (fact.kind === 'price' && PRICE_LABEL[value]) {
    return (
      <>
        <span className="num">{value}</span>
        <span className="dim"> · {PRICE_LABEL[value]}</span>
      </>
    )
  }
  return <>{value}</>
}

// Mirrors the server's list; a link to one of these can be watched even when
// the app does not hold the file.
const VIDEO_HOSTS = ['tiktok.com', 'instagram.com', 'youtube.com', 'youtu.be', 'vimeo.com']

/** The smart place page: saved evidence and live facts, deliberately separated. */
export default function Place() {
  const { tripPlaceId } = useParams<{ tripPlaceId: string }>()
  const { position, openAsk } = useApp()
  const navigate = useNavigate()
  const { reduced, spring, stamp } = useMotionPrefs()
  const { scrollY } = useScroll()
  // The compact bar's glass and title fade in as the big title scrolls under
  // it; the big title fades out over the same window so one name shows at a time.
  const barOpacity = useTransform(scrollY, [180, 240], [0, 1])
  const barY = useTransform(scrollY, [180, 240], reduced ? [0, 0] : [-8, 0])
  const titleOpacity = useTransform(scrollY, [180, 240], [1, 0])
  // The map scrolls at half speed under the title: depth without a layout change.
  const heroY = useTransform(scrollY, [0, 300], reduced ? [0, 0] : [0, 110])

  const page = useAsync(
    () => api.place(tripPlaceId!, { lat: position?.lat, lon: position?.lon }),
    [tripPlaceId, position?.lat, position?.lon],
  )

  // Status and favourite answer the tap at once; the server's word arrives after.
  const [statusOverride, setStatusOverride] = useState<PlaceStatus | null>(null)
  const [favOverride, setFavOverride] = useState<boolean | null>(null)
  const [pending, setPending] = useState<PlaceStatus | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [planBusy, setPlanBusy] = useState(false)
  const [planNote, setPlanNote] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    setStatusOverride(null)
    setFavOverride(null)
  }, [page.data])

  useScreenContext(
    tripPlaceId ? { surface: 'place', tripPlaceId, label: page.data?.header.name } : null,
  )

  // A deep link has nothing behind it: Back goes to the library instead of out of the app.
  const canGoBack = (window.history.state?.idx ?? 0) > 0
  const goBack = () => (canGoBack ? navigate(-1) : navigate('/saved?tab=places', { replace: true }))
  const backButton = (
    <button className="icon-btn icon-btn--glass" onClick={goBack} aria-label="Back">
      <ArrowLeft size={19} />
    </button>
  )

  if (page.loading && !page.data) {
    return (
      <div className="screen screen--loading" aria-busy>
        <div className="skeleton" style={{ height: 260, borderRadius: 0 }} />
        <div className="pad" style={{ marginTop: 'var(--s-4)' }}>
          <div className="skeleton" style={{ height: 36, width: '70%' }} />
          <div className="skeleton" style={{ height: 16, width: '50%', marginTop: 10 }} />
          <div className="skeleton" style={{ height: 44, marginTop: 'var(--s-5)' }} />
        </div>
      </div>
    )
  }
  if (page.error || !page.data) {
    const gone = page.status === 404
    return (
      <div className="screen">
        <header className="topbar">
          {backButton}
          <h2 className="topbar__title clamp-1 grow" style={{ fontSize: '1.125rem' }}>
            Place
          </h2>
        </header>
        {gone ? (
          <Empty
            stamp="Gone"
            title="This place isn’t in your trip any more."
            body="It may have been merged into another place or removed."
            action={
              <Link className="btn btn--ghost" to="/saved?tab=places">
                Go to Saved
              </Link>
            }
          />
        ) : (
          <ErrorNote message={page.error ?? 'Could not load this place.'} onRetry={page.reload} />
        )}
      </div>
    )
  }

  // Only video is worth a feed; the rest of the saved content reads better as
  // the list below.
  const clipCount = page.data.saved_content.filter(
    (source) => source.kind === 'video' || VIDEO_HOSTS.some((host) => source.url?.includes(host)),
  ).length

  const {
    header,
    overview,
    saved_content: sources,
    live_information: live,
    knowledge,
    plan,
    personal_record: record,
    actions,
    suggested_questions: questions,
  } = page.data
  const status = statusOverride ?? header.status
  const favourite = favOverride ?? header.is_favourite
  const today = localToday()
  const todayRows = plan.filter((item) => item.on_date === today)
  const inToday = todayRows.length > 0

  async function changeStatus(next: PlaceStatus) {
    if (pending || next === status) return
    const previous = status
    setStatusOverride(next)
    setPending(next)
    setActionError(null)
    try {
      await api.updatePlace(tripPlaceId!, { status: next })
      // A visited stamp with no visit behind it would be a stamp on nothing.
      if (next === 'visited' && record.visits.length === 0) {
        await api.recordVisit(tripPlaceId!, { visited_on: today })
      }
      window.setTimeout(() => tick(STAMP_PATTERN), reduced ? 0 : 170)
      page.reload()
    } catch (err) {
      setStatusOverride(previous)
      setActionError(
        err instanceof ApiError
          ? 'Couldn’t change the status. Try again.'
          : 'Couldn’t change the status. Check your connection and try again.',
      )
    } finally {
      setPending(null)
    }
  }

  async function toggleFavourite() {
    const next = !favourite
    setFavOverride(next)
    setActionError(null)
    try {
      await api.updatePlace(tripPlaceId!, { is_favourite: next })
      page.reload()
    } catch {
      setFavOverride(!next)
      setActionError('Couldn’t save the favourite. Check your connection and try again.')
    }
  }

  async function togglePlan() {
    if (planBusy) return
    setPlanBusy(true)
    setActionError(null)
    try {
      if (inToday) {
        for (const row of todayRows) await api.removeFromPlan(row.id)
        // The plan promoted it; leaving the plan lets it go back.
        if (status === 'planned' && plan.length === todayRows.length) {
          await api.updatePlace(tripPlaceId!, { status: 'saved' })
        }
        setPlanNote(null)
      } else {
        await api.addToPlan({ trip_place_id: tripPlaceId, on_date: today })
        tick()
        setPlanNote('Added to today’s plan')
      }
      page.reload()
    } catch {
      setActionError(
        inToday
          ? 'Couldn’t take it off today’s plan. Check your connection and try again.'
          : 'Couldn’t add it to today’s plan. Check your connection and try again.',
      )
    } finally {
      setPlanBusy(false)
    }
  }

  function copyCoordinates() {
    const text = `${header.coordinates.lat.toFixed(5)}, ${header.coordinates.lon.toFixed(5)}`
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  const distance =
    header.walking_minutes != null
      ? `${header.walking_minutes} min walk`
      : header.distance_km != null
        ? `${Math.round(header.distance_km)} km away`
        : null

  // Pictures come from the saved links and uploads; everything else is a source row.
  const isPhoto = (source: PlacePage['saved_content'][number]) =>
    Boolean(source.media_type?.startsWith('image/') && (source.file_url || source.url))
  const photos = sources.filter(isPhoto)
  const documents = sources.filter((source) => !isPhoto(source))
  // The reason is usually the creator's own sentence. Said once, with its
  // author, rather than twice in gold 200px apart.
  const echo = overview.why_saved
    ? documents.find((source) => source.quote && norm(source.quote) === norm(overview.why_saved))
    : undefined
  const sourceTitle = (source: PlacePage['saved_content'][number]) =>
    source.title || source.url || SOURCE_LABEL[source.kind] || source.kind
  const attribution = (source: PlacePage['saved_content'][number]) =>
    [source.author, source.title].filter(Boolean).join(', ') || sourceTitle(source)
  const age = (checkedAt: string) =>
    page.fromCache ? 'checked before you went offline' : checkedAgo(checkedAt)

  return (
    <div className="screen">
      <header className="topbar topbar--float">
        <motion.div className="topbar__glass" style={{ opacity: barOpacity }} aria-hidden />
        {backButton}
        <motion.h2
          className="topbar__title clamp-1 grow"
          style={{ fontSize: '1.125rem', opacity: barOpacity, y: barY }}
          aria-hidden
        >
          {header.name}
        </motion.h2>
      </header>

      <motion.div className="hero-map" style={{ y: heroY }}>
        <MiniMap
          lat={header.coordinates.lat}
          lon={header.coordinates.lon}
          label={header.name}
          category={header.category}
          fill
        />
        <div className="hero-map__overlay" />
        {/* The status stamp lands in the corner each time it changes: this screen's one moment. */}
        <div className="hero-map__stamp">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={status}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.9, rotate: -22 }}
              animate={{ opacity: 1, scale: 1, rotate: 8 }}
              exit={{ opacity: 0, transition: EXIT }}
              transition={{ ...stamp, opacity: { duration: 0.06, ease: 'linear' } }}
              style={{ display: 'inline-flex', transformOrigin: 'center' }}
            >
              <StatusStamp status={status} size="lg" rotate={0} />
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>

      <div className="place-title">
        <div className="row between row--top">
          <motion.h1
            className="t-display grow"
            style={{ fontSize: 'clamp(2rem, 9vw, 2.75rem)', opacity: titleOpacity }}
          >
            {header.name}
          </motion.h1>
          <button
            className="icon-btn icon-btn--glass"
            aria-label={favourite ? 'Remove favourite' : 'Mark favourite'}
            aria-pressed={favourite}
            onClick={toggleFavourite}
            style={favourite ? { color: 'var(--tint-view)' } : undefined}
          >
            <Star size={19} fill={favourite ? 'currentColor' : 'none'} />
          </button>
        </div>
        <Meta
          wrap
          className="mt"
          parts={[
            CATEGORY_LABEL[header.category] ?? header.category,
            header.address ?? [header.city, header.country].filter(Boolean).join(', '),
            distance,
          ]}
        />

        {header.needs_review && (
          <div style={{ marginTop: 'var(--s-3)' }}>
            <Note tone="warn" Icon={AlertTriangle}>
              Low-confidence extraction — check the name and pin are right.
            </Note>
          </div>
        )}

        <div className="row" style={{ marginTop: 'var(--s-5)', gap: 'var(--s-2)' }}>
          <a className="btn btn--ink grow" href={actions.primary[0].url} target="_blank" rel="noreferrer">
            <Navigation size={16} strokeWidth={2.2} />
            Navigate
          </a>
          <button
            className="btn"
            onClick={() => openAsk({ surface: 'place', tripPlaceId, contextLabel: header.name })}
          >
            <Sparkles size={16} strokeWidth={2.1} />
            Ask
          </button>
        </div>
        <button
          className="btn btn--ghost btn--block"
          style={{ marginTop: 'var(--s-2)' }}
          onClick={togglePlan}
          aria-pressed={inToday}
          aria-busy={planBusy}
        >
          {inToday ? <Check size={17} strokeWidth={2.4} /> : <CalendarDays size={17} strokeWidth={2.1} />}
          {inToday ? 'In today’s plan' : 'Add to today'}
        </button>
        <div aria-live="polite">
          {planNote && inToday && (
            <p className="t-small dim" style={{ marginTop: 'var(--s-2)', textAlign: 'center' }}>
              {planNote} ·{' '}
              <Link to="/trip?section=plan" className="teal">
                View plan
              </Link>
            </p>
          )}
        </div>
        {actionError && (
          <div style={{ marginTop: 'var(--s-3)' }} role="alert">
            <Note tone="danger">{actionError}</Note>
          </div>
        )}
      </div>

      <CacheNote visible={page.fromCache} />

      {plan.length > 0 && (
        <>
          <SectionLabel count={plan.length > 1 ? plan.length : undefined}>Planned</SectionLabel>
          <ul className="list">
            {plan.map((item) => (
              <li key={item.id}>
                <div className="item item--static">
                  <Glyph Icon={CalendarDays} tint="teal" />
                  <div className="item__body">
                    <p className="t-head">
                      {item.on_date === today ? 'Today' : fmtDay(item.on_date)}
                      {item.start_time && <span className="num"> · {item.start_time}</span>}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {photos.length > 0 && (
        <div className="photos" aria-label="Photos">
          {photos.map((photo) => (
            <a
              key={photo.source_id}
              className="photo"
              href={photo.url ?? photo.file_url ?? '#'}
              target="_blank"
              rel="noreferrer"
              title={photo.title ?? undefined}
            >
              <img
                src={photo.file_url ?? photo.url ?? ''}
                alt={photo.title ?? ''}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={(event) => {
                  ;(event.currentTarget.parentElement as HTMLElement).style.display = 'none'
                }}
              />
            </a>
          ))}
        </div>
      )}

      <SectionLabel>Why you saved it</SectionLabel>
      <div className="pad">
        {overview.why_saved ? (
          <blockquote className="quote" style={{ whiteSpace: 'pre-line' }}>
            “{overview.why_saved.trim().replace(/^[“"]+|[”"]+$/g, '')}”
            {echo && <span className="quote__from">— {attribution(echo)}</span>}
          </blockquote>
        ) : (
          <p className="t-small dimmer">You didn’t add a reason.</p>
        )}
        {overview.notes && (
          <p className="t-small dim" style={{ marginTop: 'var(--s-3)' }}>
            {overview.notes}
          </p>
        )}
      </div>

      <SectionLabel
        count={documents.length > 1 ? documents.length : undefined}
        action={
          clipCount > 0 ? (
            <Link className="btn btn--sm" to={`/clips/feed?spot=${tripPlaceId}`}>
              <Play size={14} /> Play {clipCount}
            </Link>
          ) : undefined
        }
      >
        Saved content
      </SectionLabel>
      {documents.length === 0 ? (
        <p className="pad t-small dimmer">No source is attached to this place yet.</p>
      ) : (
        <ul className="list">
          {documents.map((source) => (
            <li key={source.source_id}>
              <div className="item item--static">
                <div className="item__body">
                  <p className="item__title clamp-2">{sourceTitle(source)}</p>
                  <Meta
                    wrap
                    parts={[
                      PROVENANCE_LABEL[source.provenance] ?? source.provenance,
                      source.author,
                      source.published_on
                        ? `Published ${fmtDay(source.published_on)}`
                        : `Saved ${fmtDay(source.captured_at)}`,
                    ]}
                  />
                  {source.quote && source !== echo && (
                    <blockquote className="quote" style={{ marginTop: 'var(--s-3)' }}>
                      “{source.quote}”
                    </blockquote>
                  )}
                  {source.url && (
                    <a
                      className="btn btn--sm btn--ghost"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ marginTop: 8, paddingInline: 0 }}
                    >
                      Open original
                      <ArrowUpRight size={14} strokeWidth={2.2} />
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SectionLabel>Live information</SectionLabel>
      {live.facts.length === 0 ? (
        <p className="pad t-small dimmer">
          Nothing verified yet. TripStash will not guess opening hours or prices.
        </p>
      ) : (
        <ul className="list">
          {live.facts.map((fact) => {
            const primary = fact.primary
            return (
              <li key={fact.kind}>
                <div className="item item--static">
                  <div className="item__body">
                    <p className="t-small dimmer">
                      {FACT_LABEL[fact.kind] ?? fact.kind.charAt(0).toUpperCase() + fact.kind.slice(1)}
                    </p>
                    <p className="t" style={{ marginTop: 2 }}>
                      <FactValue fact={fact} />
                    </p>
                    {/* Fresh is the expected case and stays in the grey line; only ageing gets a stamp. */}
                    <Meta
                      wrap
                      parts={[
                        PROVENANCE_LABEL[primary.provenance] ?? primary.provenance,
                        primary.source_label && PROVIDER_NAME[primary.source_label],
                        primary.freshness === 'fresh' && age(primary.checked_at),
                      ]}
                    />
                    {primary.freshness !== 'fresh' && (
                      <div className="mt">
                        <Freshness status={primary.freshness} label={page.fromCache ? 'checked before you went offline' : primary.age_label} />
                      </div>
                    )}
                    {fact.has_conflict && (
                      <div style={{ marginTop: 'var(--s-2)' }}>
                        <Banner tone="warn">
                          {fact.conflict_note}
                          <ul style={{ marginTop: 4 }}>
                            {fact.alternatives.map((alt, index) => (
                              <li key={index}>
                                {alt.value} — {PROVENANCE_LABEL[alt.provenance] ?? alt.provenance},{' '}
                                {alt.age_label}
                              </li>
                            ))}
                          </ul>
                        </Banner>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {/* Today's weather is the one gold line of live information. */}
      <p className="pad t-small" style={{ marginTop: 'var(--s-3)', color: 'var(--tint-view)', fontWeight: 600 }}>
        Today: {live.weather.summary.toLowerCase()}, {Math.round(live.weather.temperature_c)}°C,{' '}
        {Math.round(live.weather.precipitation_probability * 100)}% chance of rain
        <span className="dimmer" style={{ fontWeight: 400 }}>
          {' '}
          · {age(live.weather.checked_at)}
        </span>
      </p>

      {knowledge.length > 0 && (
        <>
          <SectionLabel count={knowledge.length > 1 ? knowledge.length : undefined}>
            Related knowledge
          </SectionLabel>
          <MotionList animateIn={false}>
            {knowledge.map((item, index) => {
              const Icon = KNOWLEDGE_ICON[item.type] ?? KNOWLEDGE_ICON.general
              const tint = knowledgeTint(item.type)
              const { headline, detail } = pairText(item.title, item.body)
              return (
                <MotionRow key={item.id}>
                  <div className="item item--static">
                    <div className="item__body">
                      <Stamp tone={stampToneFor(tint)} size="sm" Icon={Icon} rotate={index % 2 ? 4 : -6}>
                        {KNOWLEDGE_LABEL[item.type]}
                      </Stamp>
                      <p className="item__title clamp-3" style={{ marginTop: 6 }}>
                        {headline}
                      </p>
                      {detail && <p className="t-small dim mt">{detail}</p>}
                      {item.requires_official_verification && (
                        <div style={{ marginTop: 6 }}>
                          <Note tone="warn" Icon={Flag}>
                            Confirm against the official source.
                          </Note>
                        </div>
                      )}
                    </div>
                  </div>
                </MotionRow>
              )
            })}
          </MotionList>
        </>
      )}

      <SectionLabel>Ask about this place</SectionLabel>
      <div className="rail">
        {questions.map((question) => (
          <Pill
            key={question}
            Icon={Sparkles}
            onClick={() => openAsk({ surface: 'place', tripPlaceId, question, contextLabel: header.name })}
          >
            {question}
          </Pill>
        ))}
      </div>

      <SectionLabel>Status</SectionLabel>
      <div className="rail rail--wrap" role="group" aria-label="Status" style={{ paddingBlock: 'var(--s-1)' }}>
        {STATUSES.map((option, index) => {
          const meta = STATUS_STAMP[option]
          const on = status === option
          return (
            <motion.button
              key={option}
              type="button"
              className="stamp-btn"
              onClick={() => changeStatus(option)}
              aria-pressed={on}
              aria-busy={pending === option}
              whileTap={{ scale: 0.94 }}
              transition={spring}
            >
              <Stamp tone={meta.tone} Icon={meta.Icon} filled={on} rotate={index % 2 ? 4 : -5}>
                {meta.label}
              </Stamp>
            </motion.button>
          )
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        Status: {STATUS_STAMP[status].label}
      </p>

      {record.visits.length > 0 && (
        <>
          <SectionLabel count={record.visits.length > 1 ? record.visits.length : undefined}>
            Your visits
          </SectionLabel>
          <ul className="list">
            {record.visits.map((visit) => (
              <li key={visit.id}>
                <div className="item item--static">
                  <Glyph Icon={Check} tint="teal" />
                  <div className="item__body">
                    <p className="t-head">
                      {visit.visited_on === today ? 'Today' : fmtDay(visit.visited_on)}
                      {visit.rating && <span className="num"> · {visit.rating}/5</span>}
                    </p>
                    {visit.notes && <p className="t-small dim">{visit.notes}</p>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <SectionLabel>More actions</SectionLabel>
      <ul className="list">
        {actions.secondary.map((action) => (
          <li key={action.key}>
            <a className="item" href={action.url} target="_blank" rel="noreferrer">
              <div className="item__body">
                <p className="item__title">{action.label}</p>
                {action.note && <Meta wrap parts={[action.note]} />}
              </div>
              <ArrowUpRight size={17} className="item__chev" />
            </a>
          </li>
        ))}
        <li>
          <button type="button" className="item" style={{ width: '100%', textAlign: 'start' }} onClick={copyCoordinates}>
            <div className="item__body">
              <p className="item__title">{copied ? 'Copied' : 'Copy coordinates'}</p>
              <Meta
                parts={[`${header.coordinates.lat.toFixed(5)}, ${header.coordinates.lon.toFixed(5)}`]}
              />
            </div>
            {copied ? (
              <Check size={17} className="item__chev" style={{ color: 'var(--teal-ink)' }} />
            ) : (
              <Copy size={17} className="item__chev" />
            )}
          </button>
        </li>
      </ul>
      <p className="pad t-small dimmer" style={{ marginTop: 'var(--s-3)' }}>
        Opening any of these hands you to that service. TripStash never completes a booking or a
        purchase on your behalf.
      </p>

      <div className="pad" style={{ marginTop: 'var(--s-6)' }}>
        <Link className="btn btn--block btn--ghost" to="/map">
          Open on map
        </Link>
      </div>
    </div>
  )
}
