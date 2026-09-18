import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import type { PlaceStatus } from '../lib/types'
import MiniMap from '../components/MiniMap'
import {
  Banner,
  CacheNote,
  ErrorNote,
  Freshness,
  Glyph,
  KNOWLEDGE_LABEL,
  Meta,
  Note,
  Pill,
  SectionLabel,
  SkeletonRows,
  STATUS_META,
  pairText,
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
        <div className="skeleton" style={{ height: 172, borderRadius: 0 }} />
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

  return (
    <div className="screen">
      <div style={{ position: 'relative' }}>
        <MiniMap lat={header.coordinates.lat} lon={header.coordinates.lon} label={header.name} />
        <button
          className="icon-btn icon-btn--raised"
          onClick={() => navigate(-1)}
          aria-label="Back"
          style={{ position: 'absolute', top: 'var(--s-3)', left: 'var(--s-3)', zIndex: 500 }}
        >
          <ArrowLeft size={19} />
        </button>
      </div>

      <div className="pad" style={{ paddingTop: 'var(--s-4)' }}>
        <div className="row between row--top">
          <div className="grow">
            <h1 className="t-xl">{header.name}</h1>
            <Meta
              wrap
              parts={[
                STATUS_META[header.status].label,
                header.category,
                [header.city, header.country].filter(Boolean).join(', '),
                header.walking_minutes != null
                  ? `${header.walking_minutes} min walk`
                  : header.distance_km != null && `${Math.round(header.distance_km)} km away`,
              ]}
            />
          </div>
          <button
            className="icon-btn"
            aria-label={header.is_favourite ? 'Remove favourite' : 'Mark favourite'}
            onClick={() =>
              api.updatePlace(tripPlaceId!, { is_favourite: !header.is_favourite }).then(page.reload)
            }
            style={header.is_favourite ? { color: 'var(--accent)' } : undefined}
          >
            <Star size={19} fill={header.is_favourite ? 'currentColor' : 'none'} />
          </button>
        </div>

        {header.needs_review && (
          <div style={{ marginTop: 'var(--s-3)' }}>
            <Note tone="warn" Icon={AlertTriangle}>
              Low-confidence extraction — check the name and pin are right.
            </Note>
          </div>
        )}

        <div className="row" style={{ marginTop: 'var(--s-4)', gap: 'var(--s-2)' }}>
          <a className="btn btn--accent" href={actions.primary[0].url} target="_blank" rel="noreferrer">
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
          <button className="btn btn--plain" onClick={addToToday} disabled={busy}>
            <CalendarDays size={16} strokeWidth={2.1} />
            {busy ? '…' : 'Today'}
          </button>
        </div>
      </div>

      <CacheNote visible={page.fromCache} />

      <SectionLabel>Why you saved it</SectionLabel>
      <div className="pad">
        {overview.why_saved ? (
          <p className="t" style={{ whiteSpace: 'pre-line' }}>
            {overview.why_saved}
          </p>
        ) : (
          <p className="t-sm dimmer">No reason was recorded for this one.</p>
        )}
        {overview.notes && (
          <p className="t-sm dim" style={{ marginTop: 'var(--s-2)' }}>
            {overview.notes}
          </p>
        )}
      </div>

      <SectionLabel>Saved content · {sources.length}</SectionLabel>
      {sources.length === 0 ? (
        <p className="pad t-sm dimmer">No source is attached to this place yet.</p>
      ) : (
        <ul className="list">
          {sources.map((source) => (
            <li key={source.source_id}>
              <div className="item" style={{ cursor: 'default' }}>
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
                    <blockquote className="quote" style={{ marginTop: 'var(--s-2)' }}>
                      “{source.quote}”
                    </blockquote>
                  )}
                  {source.url && (
                    <a
                      className="btn btn--sm btn--plain"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ marginTop: 6, paddingInline: 0 }}
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
        <p className="pad t-sm dimmer">
          Nothing verified yet. TripStash will not guess opening hours or prices.
        </p>
      ) : (
        <ul className="list">
          {live.facts.map((fact) => (
            <li key={fact.kind}>
              <div className="item" style={{ cursor: 'default' }}>
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
      <p className="pad t-sm dimmer" style={{ marginTop: 'var(--s-2)' }}>
        Weather {live.weather.summary.toLowerCase()}, {Math.round(live.weather.temperature_c)}°C ·{' '}
        {Math.round(live.weather.precipitation_probability * 100)}% rain · checked{' '}
        {live.weather.checked_at.slice(11, 16)} UTC
      </p>

      {knowledge.length > 0 && (
        <>
          <SectionLabel>Related knowledge</SectionLabel>
          <ul className="list">
            {knowledge.map((item) => {
              const Icon = KNOWLEDGE_ICON[item.type] ?? KNOWLEDGE_ICON.general
              const { headline, detail } = pairText(item.title, item.body)
              return (
                <li key={item.id}>
                  <div className="item" style={{ cursor: 'default' }}>
                    <Glyph Icon={Icon} />
                    <div className="item__body">
                      <p className="item__title">{headline}</p>
                      {detail && <p className="t-sm dim">{detail}</p>}
                      <Meta parts={[KNOWLEDGE_LABEL[item.type]]} />
                      {item.requires_official_verification && (
                        <Note tone="warn" Icon={Flag}>
                          Confirm against the official source.
                        </Note>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <SectionLabel>Ask about this place</SectionLabel>
      <div className="rail">
        {questions.map((question) => (
          <Pill
            key={question}
            onClick={() => openAsk({ surface: 'place', tripPlaceId, question, contextLabel: header.name })}
          >
            {question}
          </Pill>
        ))}
      </div>

      <SectionLabel>Status</SectionLabel>
      <div className="rail">
        {STATUSES.map((status) => (
          <Pill key={status} on={header.status === status} onClick={() => setStatus(status)}>
            {STATUS_META[status].label}
          </Pill>
        ))}
      </div>

      {plan.length > 0 && (
        <>
          <SectionLabel>Planned</SectionLabel>
          <ul className="list">
            {plan.map((item) => (
              <li key={item.id}>
                <div className="item" style={{ cursor: 'default' }}>
                  <div className="item__body">
                    <p className="t num">
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
          <SectionLabel>Your visits</SectionLabel>
          <ul className="list">
            {record.visits.map((visit) => (
              <li key={visit.id}>
                <div className="item" style={{ cursor: 'default' }}>
                  <div className="item__body">
                    <p className="t num">
                      {visit.visited_on}
                      {visit.rating && ` · ${visit.rating}/5`}
                    </p>
                    {visit.notes && <p className="t-sm dim">{visit.notes}</p>}
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
              <ArrowUpRight size={17} className="dimmer" style={{ flex: 'none', marginTop: 9 }} />
            </a>
          </li>
        ))}
      </ul>
      <p className="pad t-sm dimmer" style={{ marginTop: 'var(--s-3)' }}>
        Opening any of these hands you to that service. TripStash never completes a booking or a
        purchase on your behalf.
      </p>

      <div className="pad" style={{ marginTop: 'var(--s-6)' }}>
        <Link className="btn btn--block btn--plain" to="/map">
          Back to map
        </Link>
      </div>
    </div>
  )
}
