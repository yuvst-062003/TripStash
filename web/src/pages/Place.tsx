import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { motion, useScroll, useTransform } from 'motion/react'
import { api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import type { PlaceStatus } from '../lib/types'
import MiniMap from '../components/MiniMap'
import { STATUS_STAMP, Stamp, StatusStamp } from '../components/Stamp'
import {
  Banner,
  CacheNote,
  ErrorNote,
  Freshness,
  Glyph,
  KNOWLEDGE_LABEL,
  Meta,
  MotionList,
  MotionRow,
  Note,
  Pill,
  SectionLabel,
  SkeletonRows,
  knowledgeTint,
  pairText,
  stampToneFor,
} from '../components/ui'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Flag,
  KNOWLEDGE_ICON,
  Navigation,
  Sparkles,
  Star,
} from '../components/icons'

const STATUSES: PlaceStatus[] = ['saved', 'must_visit', 'planned', 'visited', 'archived']

/** The smart place page: saved evidence and live facts, deliberately separated. */
export default function Place() {
  const { tripPlaceId } = useParams<{ tripPlaceId: string }>()
  const { position, openAsk } = useApp()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const { scrollY } = useScroll()
  // The compact bar fades in as the hero title scrolls under it.
  const barOpacity = useTransform(scrollY, [180, 240], [0, 1])
  const barY = useTransform(scrollY, [180, 240], [-8, 0])

  const page = useAsync(
    () => api.place(tripPlaceId!, { lat: position?.lat, lon: position?.lon }),
    [tripPlaceId, position?.lat, position?.lon],
  )

  useScreenContext(
    tripPlaceId ? { surface: 'place', tripPlaceId, label: page.data?.header.name } : null,
  )

  if (page.loading && !page.data) {
    return (
      <div className="screen">
        <div className="skeleton" style={{ height: 260, borderRadius: 0 }} />
        <SkeletonRows rows={4} />
      </div>
    )
  }
  if (page.error) {
    return (
      <div className="screen">
        <ErrorNote message={page.error} onRetry={page.reload} />
      </div>
    )
  }
  if (!page.data) return null

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

  async function setStatus(status: PlaceStatus) {
    setBusy(true)
    await api.updatePlace(tripPlaceId!, { status })
    setBusy(false)
    page.reload()
  }

  async function addToToday() {
    setBusy(true)
    await api.addToPlan({ trip_place_id: tripPlaceId, on_date: new Date().toISOString().slice(0, 10) })
    setBusy(false)
    page.reload()
  }

  const distance =
    header.walking_minutes != null
      ? `${header.walking_minutes} min walk`
      : header.distance_km != null
        ? `${Math.round(header.distance_km)} km away`
        : null

  return (
    <div className="screen">
      <motion.header
        className="topbar topbar--divided"
        style={{ position: 'fixed', left: 0, right: 0, opacity: barOpacity, y: barY, pointerEvents: 'none' }}
        aria-hidden
      >
        <span style={{ width: 44 }} />
        <h2 className="topbar__title clamp-1 grow" style={{ fontSize: '1.125rem' }}>
          {header.name}
        </h2>
      </motion.header>

      <div className="hero-map">
        <MiniMap
          lat={header.coordinates.lat}
          lon={header.coordinates.lon}
          label={header.name}
          category={header.category}
          fill
        />
        <div className="hero-map__overlay" />
        <button className="icon-btn icon-btn--glass hero-map__back" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft size={19} />
        </button>
        <div className="hero-map__stamp">
          <StatusStamp status={header.status} size="lg" rotate={8} />
        </div>
      </div>

      <div className="place-title">
        <div className="row between row--top">
          <h1 className="t-display grow" style={{ fontSize: 'clamp(2rem, 9vw, 2.75rem)' }}>
            {header.name}
          </h1>
          <motion.button
            className="icon-btn icon-btn--raised"
            whileTap={{ scale: 0.9 }}
            aria-label={header.is_favourite ? 'Remove favourite' : 'Mark favourite'}
            aria-pressed={header.is_favourite}
            onClick={() =>
              api.updatePlace(tripPlaceId!, { is_favourite: !header.is_favourite }).then(page.reload)
            }
            style={header.is_favourite ? { color: 'var(--tint-view)' } : undefined}
          >
            <Star size={19} fill={header.is_favourite ? 'currentColor' : 'none'} />
          </motion.button>
        </div>
        <Meta
          wrap
          className="mt"
          parts={[
            header.category,
            [header.city, header.country].filter(Boolean).join(', '),
            distance,
            `${header.coordinates.lat.toFixed(4)}, ${header.coordinates.lon.toFixed(4)}`,
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
          <button className="btn btn--ghost" onClick={addToToday} disabled={busy} aria-label="Add to today">
            <CalendarDays size={17} strokeWidth={2.1} />
          </button>
        </div>
      </div>

      <CacheNote visible={page.fromCache} />

      <SectionLabel>Why you saved it</SectionLabel>
      <div className="pad">
        {overview.why_saved ? (
          <blockquote className="quote" style={{ whiteSpace: 'pre-line' }}>
            {overview.why_saved}
          </blockquote>
        ) : (
          <p className="t-small dimmer">No reason was recorded for this one.</p>
        )}
        {overview.notes && (
          <p className="t-small dim" style={{ marginTop: 'var(--s-3)' }}>
            {overview.notes}
          </p>
        )}
      </div>

      <SectionLabel count={sources.length}>Saved content</SectionLabel>
      {sources.length === 0 ? (
        <p className="pad t-small dimmer">No source is attached to this place yet.</p>
      ) : (
        <ul className="list">
          {sources.map((source) => (
            <li key={source.source_id}>
              <div className="item item--static">
                <div className="item__body">
                  <p className="item__title clamp-1">{source.title || source.url || source.kind}</p>
                  <Meta
                    parts={[
                      source.provenance,
                      source.author,
                      source.published_on
                        ? `published ${source.published_on}`
                        : `captured ${source.captured_at.slice(0, 10)}`,
                    ]}
                  />
                  {source.quote && (
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
          {live.facts.map((fact) => (
            <li key={fact.kind}>
              <div className="item item--static">
                <div className="item__body">
                  <div className="row between" style={{ gap: 'var(--s-2)' }}>
                    <p className="t grow">
                      <span className="dimmer" style={{ textTransform: 'capitalize' }}>
                        {fact.kind}{' '}
                      </span>
                      {fact.primary.value}
                    </p>
                    <Freshness status={fact.primary.freshness} label={fact.primary.age_label} />
                  </div>
                  <Meta parts={[fact.primary.provenance, fact.primary.source_label]} />
                  {fact.has_conflict && (
                    <div style={{ marginTop: 'var(--s-2)' }}>
                      <Banner tone="warn">
                        {fact.conflict_note}
                        <ul style={{ marginTop: 4 }}>
                          {fact.alternatives.map((alt, index) => (
                            <li key={index}>
                              {alt.value} — {alt.provenance}, {alt.age_label}
                            </li>
                          ))}
                        </ul>
                      </Banner>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="pad t-small dimmer" style={{ marginTop: 'var(--s-3)' }}>
        Weather {live.weather.summary.toLowerCase()}, {Math.round(live.weather.temperature_c)}°C ·{' '}
        {Math.round(live.weather.precipitation_probability * 100)}% rain · checked{' '}
        {live.weather.checked_at.slice(11, 16)} UTC
      </p>

      {knowledge.length > 0 && (
        <>
          <SectionLabel count={knowledge.length}>Related knowledge</SectionLabel>
          <MotionList>
            {knowledge.map((item) => {
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
                          {KNOWLEDGE_LABEL[item.type]}
                        </Stamp>
                      </div>
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
      <div className="rail" style={{ paddingBlock: 'var(--s-2)', gap: 'var(--s-3)' }}>
        {STATUSES.map((status, index) => {
          const meta = STATUS_STAMP[status]
          const on = header.status === status
          return (
            <button
              key={status}
              type="button"
              className="stamp-btn"
              onClick={() => setStatus(status)}
              disabled={busy}
              aria-pressed={on}
            >
              <Stamp tone={meta.tone} Icon={meta.Icon} filled={on} rotate={index % 2 ? 4 : -5}>
                {meta.label}
              </Stamp>
            </button>
          )
        })}
      </div>

      {plan.length > 0 && (
        <>
          <SectionLabel count={plan.length}>Planned</SectionLabel>
          <ul className="list">
            {plan.map((item) => (
              <li key={item.id}>
                <div className="item item--static">
                  <Glyph Icon={CalendarDays} tint="teal" />
                  <div className="item__body">
                    <p className="t-head num">
                      {item.on_date}
                      {item.start_time && ` · ${item.start_time}`}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {record.visits.length > 0 && (
        <>
          <SectionLabel count={record.visits.length}>Your visits</SectionLabel>
          <ul className="list">
            {record.visits.map((visit) => (
              <li key={visit.id}>
                <div className="item item--static">
                  <div className="item__body">
                    <p className="t-head num">
                      {visit.visited_on}
                      {visit.rating && ` · ${visit.rating}/5`}
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
                {action.note && <Meta parts={[action.note]} />}
              </div>
              <ArrowUpRight size={17} className="item__chev" />
            </a>
          </li>
        ))}
      </ul>
      <p className="pad t-small dimmer" style={{ marginTop: 'var(--s-3)' }}>
        Opening any of these hands you to that service. TripStash never completes a booking or a
        purchase on your behalf.
      </p>

      <div className="pad" style={{ marginTop: 'var(--s-6)' }}>
        <Link className="btn btn--block btn--ghost" to="/map">
          Back to map
        </Link>
      </div>
    </div>
  )
}
