import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import { useMotionPrefs } from '../lib/motion'
import { useColdLoad } from '../App'
import { HeroActions } from '../components/TopBar'
import NumberFlow from '@number-flow/react'
import { BudgetArc, MoneyFigure } from '../components/Money'
import { Stamp } from '../components/Stamp'
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
  SectionLabel,
  categoryTint,
  knowledgeTint,
  pairText,
  stampToneFor,
} from '../components/ui'
import {
  AlertTriangle,
  CATEGORY_ICON,
  ChevronRight,
  CloudSun,
  Crosshair,
  Inbox,
  KNOWLEDGE_ICON,
  MapPin,
  Ticket,
} from '../components/icons'
import type { HomePayload } from '../lib/types'

/** The last dashboard, kept across visits so a return renders at once and refreshes behind. */
let lastHome: HomePayload | null = null
/** On sign-out: the last account's home never shows for the next. */
export function forgetHome(): void {
  lastHome = null
}

/** Today in the traveller's own timezone, as the API expects it (YYYY-MM-DD). */
const localToday = () => new Date().toLocaleDateString('en-CA')

const PHASE_LABEL = {
  before: 'Before the trip',
  during: 'On the road',
  after: 'After the trip',
} as const

/** Day number since the trip started, when it has started. */
function dayOfTrip(start: string | null | undefined, today: string): number | null {
  if (!start) return null
  const from = new Date(`${start}T00:00:00Z`).getTime()
  const now = new Date(`${today}T00:00:00Z`).getTime()
  if (Number.isNaN(from) || Number.isNaN(now) || now < from) return null
  return Math.floor((now - from) / 86_400_000) + 1
}

/** A contextual dashboard: only what matters now, linking out rather than duplicating. */
export default function Home() {
  const { trip, position, location, requestLocation, openSave } = useApp()
  const { reduced, spring } = useMotionPrefs()
  // The entrance plays once, on a cold load; a return from another tab just shows the page.
  const fresh = useColdLoad()
  useScreenContext({ surface: 'home' })

  const home = useAsync(
    () => api.home({ lat: position?.lat, lon: position?.lon, on: localToday() }),
    [position?.lat, position?.lon],
  )
  if (home.data) lastHome = home.data
  const data = home.data ?? lastHome

  if (home.loading && !data) {
    return (
      <div className="screen screen--loading" aria-busy>
        <header className="hero">
          <div className="skeleton" style={{ height: 14, width: '40%' }} />
          <div className="skeleton" style={{ height: 48, width: '70%', marginTop: 20 }} />
        </header>
        <div className="pad">
          <div className="skeleton" style={{ height: 88, borderRadius: 16 }} />
        </div>
        <div className="rail" style={{ marginTop: 'var(--s-8)' }} aria-hidden>
          <div className="skeleton" style={{ width: 248, height: 212, borderRadius: 24 }} />
          <div className="skeleton" style={{ width: 248, height: 212, borderRadius: 24 }} />
        </div>
      </div>
    )
  }
  if (home.error && !data) {
    return (
      <div className="screen">
        <header className="hero">
          <h1 className="t-display hero__title">{trip?.name ?? 'Trip'}</h1>
        </header>
        <ErrorNote message={home.error} onRetry={home.reload} />
      </div>
    )
  }
  if (!data) return null

  const { review_queue: queue, money } = data
  const day = data.phase === 'during' ? dayOfTrip(trip?.start_date, data.date) : null
  const headline = data.current_destination?.name ?? trip?.name ?? 'Your trip'
  const queueTotal = queue.pending_candidates + queue.failed_sources

  return (
    <div className="screen">
      <header className="hero">
        <div className="hero__top">
          {/* The eyebrow names the trip only when the headline is a place. */}
          <span className="t-small dim clamp-1">{data.current_destination ? trip?.name : 'Your trip'}</span>
          <HeroActions />
        </div>
        <motion.h1
          className="t-display--lg hero__title"
          initial={reduced || !fresh ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
        >
          {headline}
        </motion.h1>
        <div className="hero__line">
          {day !== null ? (
            <span>Day {day}</span>
          ) : (
            <span>{!trip?.start_date && !trip?.end_date ? 'No dates yet' : PHASE_LABEL[data.phase]}</span>
          )}
          {data.weather && (
            <span className="hero__chip">
              <CloudSun size={14} strokeWidth={2.4} />
              {data.weather.summary} {Math.round(data.weather.temperature_c)}°
              {data.weather.precipitation_probability >= 0.4 &&
                ` · ${Math.round(data.weather.precipitation_probability * 100)}% rain`}
            </span>
          )}
          {data.countdown_days !== null && (
            <span>
              {data.countdown_days === 0
                ? 'Leaving today'
                : data.countdown_days === 1
                  ? 'Tomorrow'
                  : `${data.countdown_days} days to go`}
            </span>
          )}
          {location.status !== 'granted' && (
            <button className="chip" onClick={requestLocation}>
              <Crosshair size={13} strokeWidth={2.4} />
              {location.status === 'locating' ? 'Locating…' : 'Use my location'}
            </button>
          )}
        </div>
        {location.status === 'denied' && data.current_destination && (
          <div style={{ marginTop: 'var(--s-3)' }}>
            <Note tone="warn">
              Location off, so nearby is measured from {data.current_destination.name}'s centre.
            </Note>
          </div>
        )}
      </header>

      <CacheNote visible={home.fromCache} />

      {queueTotal > 0 && (
        <div className="pad">
          <Link to="/saved" className="card card--press" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
            <span className="t-title num" style={{ fontSize: '1.75rem', lineHeight: 1 }}>
              <NumberFlow value={queue.pending_candidates} animated={!reduced} />
            </span>
            <span className="grow">
              <span className="t-head" style={{ display: 'block' }}>
                to review
              </span>
              <span className="t-small dim" style={{ display: 'block', marginTop: 2 }}>
                Nothing reaches the map until you confirm it.
                {queue.failed_sources > 0 &&
                  ` ${queue.failed_sources} capture${queue.failed_sources === 1 ? '' : 's'} need a hand.`}
              </span>
            </span>
            <Stamp
              tone={queue.failed_sources > 0 ? 'warn' : 'muted'}
              size="sm"
              Icon={queue.failed_sources > 0 ? AlertTriangle : Inbox}
              rotate={-8}
            >
              Inbox
            </Stamp>
          </Link>
        </div>
      )}

      <SectionLabel action={<Link className="btn btn--sm btn--ghost" to="/trip?section=plan">Plan</Link>}>
        Today
      </SectionLabel>
      {data.today_plan.length === 0 ? (
        <p className="pad t-small dim">Nothing planned today.</p>
      ) : (
        <ol className="timeline">
          {data.today_plan.map((item) => (
            <li key={item.id} className="timeline__item">
              <span className="timeline__time">{item.start_time ?? '—'}</span>
              <span className="timeline__spine">
                <span className={`timeline__dot${item.is_done ? ' timeline__dot--done' : ''}`} />
              </span>
              {item.trip_place_id ? (
                <Link to={`/places/${item.trip_place_id}`} className="timeline__body">
                  <span className="t-head grow clamp-1">{item.title}</span>
                  <ChevronRight size={17} className="dimmer" />
                </Link>
              ) : (
                <span className="timeline__body">
                  <span className="t-head grow clamp-1">{item.title}</span>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      <SectionLabel>Brought back for you</SectionLabel>
      {data.resurfaced.length === 0 ? (
        <Empty
          animateIn={fresh}
          title="Nothing saved yet"
          body="Save a link, a screenshot or a video and TripStash brings it back when it becomes relevant."
          action={
            <button className="btn btn--ink" onClick={openSave}>
              Save something
            </button>
          }
        />
      ) : (
        <MotionList className="rail" as="ul" animateIn={fresh} delay={0.1}>
          {data.resurfaced.map((item, index) => {
            const isPlace = item.kind === 'place'
            const Icon = isPlace
              ? CATEGORY_ICON[item.category ?? 'other'] ?? MapPin
              : KNOWLEDGE_ICON[item.knowledge_type ?? 'general'] ?? KNOWLEDGE_ICON.general
            const tint = isPlace ? categoryTint(item.category) : knowledgeTint(item.knowledge_type)
            const label = isPlace ? item.category ?? 'place' : KNOWLEDGE_LABEL[item.knowledge_type ?? 'general']
            const { headline: title, detail } = pairText(item.title, item.body)
            const inner = (
              <>
                <div className="row between">
                  <Glyph Icon={Icon} tint={tint} />
                  <Stamp tone={stampToneFor(tint)} size="sm" rotate={index % 2 ? 5 : -6}>
                    {label}
                  </Stamp>
                </div>
                <p className="rail-card__title clamp-3">{title}</p>
                {/* Why it is surfacing now is part of the product, not a debug note. */}
                <p className="rail-card__reason clamp-2">{item.reason}</p>
                {detail && <p className="t-small dimmer clamp-2">{detail}</p>}
                {(item.distance_km !== null || item.trip_place_id) && (
                  <div className="rail-card__foot">
                    <span className="num">{item.distance_km !== null ? `${item.distance_km} km` : ''}</span>
                    {item.trip_place_id && <ChevronRight size={16} />}
                  </div>
                )}
              </>
            )
            return (
              <MotionRow key={`${item.kind}-${item.knowledge_item_id ?? item.trip_place_id}-${index}`}>
                {item.trip_place_id ? (
                  <Link to={`/places/${item.trip_place_id}`} className="rail-card">
                    {inner}
                  </Link>
                ) : (
                  <div className="rail-card">{inner}</div>
                )}
              </MotionRow>
            )
          })}
        </MotionList>
      )}

      <SectionLabel action={<Link className="btn btn--sm btn--ghost" to="/trip?section=money">Details</Link>}>
        Money
      </SectionLabel>
      <div className="pad">
        <div className="card card--ink" style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'center' }}>
          <div className="grow">
            <MoneyFigure amount={money.spent_total} currency={money.currency} />
            <p className="t-small dim num" style={{ marginTop: 6 }}>
              {money.spent_today === 0
                ? 'Nothing spent today'
                : `${money.spent_today.toFixed(0)} ${money.currency} today`}
            </p>
            {money.budget !== null && money.daily && (
              <p className="t-small dimmer num" style={{ marginTop: 10 }}>
                {money.daily.remaining.toFixed(0)} left
                {money.daily.per_day !== null &&
                  ` · ${money.daily.per_day.toFixed(0)} a day for ${money.daily.days_left} days`}
              </p>
            )}
          </div>
          {money.budget !== null && (
            <div style={{ width: 116, flex: 'none' }}>
              <BudgetArc spent={money.spent_total} budget={money.budget} />
            </div>
          )}
        </div>
      </div>

      {data.bookings.length > 0 && (
        <>
          <SectionLabel count={data.bookings.length}>Bookings</SectionLabel>
          <ul className="list">
            {data.bookings.map((booking) => (
              <li key={booking.id}>
                <div className="item item--static">
                  <Glyph Icon={Ticket} tint="gold" />
                  <div className="item__body">
                    <p className="item__title clamp-1">{booking.title}</p>
                    <Meta parts={[booking.kind, booking.start_at?.slice(0, 10)]} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {(() => {
        const total = Object.entries(data.place_counts)
          .filter(([status]) => status !== 'archived' && status !== 'inbox')
          .reduce((sum, [, count]) => sum + count, 0)
        if (total === 0) return null
        return (
          <Link to="/saved" className="pad t-small dim row" style={{ marginTop: 'var(--s-8)', gap: 6 }}>
            {total} place{total === 1 ? '' : 's'} on your map
            <ChevronRight size={14} />
          </Link>
        )
      })()}
    </div>
  )
}

export { KNOWLEDGE_LABEL }
