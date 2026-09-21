import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import TopBar from '../components/TopBar'
import {
  CacheNote,
  Empty,
  ErrorNote,
  Glyph,
  KNOWLEDGE_LABEL,
  Meta,
  Note,
  SectionLabel,
  SkeletonRows,
  pairText,
} from '../components/ui'
import {
  AlertTriangle,
  ChevronRight,
  Crosshair,
  Inbox,
  KNOWLEDGE_ICON,
  CATEGORY_ICON,
  MapPin,
  RefreshCw,
} from '../components/icons'

const PHASE_LABEL = {
  before: 'Before the trip',
  during: 'On the road',
  after: 'After the trip',
} as const

/** A contextual dashboard: only what matters now, linking out rather than duplicating. */
export default function Home() {
  const { trip, position, location, requestLocation, openSave } = useApp()
  useScreenContext({ surface: 'home' })

  const home = useAsync(
    () => api.home({ lat: position?.lat, lon: position?.lon }),
    [position?.lat, position?.lon],
  )

  if (home.loading && !home.data) {
    return (
      <div className="screen">
        <TopBar title={trip?.name ?? 'Trip'} />
        <SkeletonRows rows={5} />
      </div>
    )
  }
  if (home.error && !home.data) {
    return (
      <div className="screen">
        <TopBar title={trip?.name ?? 'Trip'} />
        <ErrorNote message={home.error} onRetry={home.reload} />
      </div>
    )
  }
  if (!home.data) return null

  const data = home.data
  const { review_queue: queue, money } = data

  const subtitle = [
    PHASE_LABEL[data.phase],
    data.current_destination?.name,
    data.weather &&
      `${data.weather.summary} ${Math.round(data.weather.temperature_c)}°`,
    data.countdown_days !== null ? `${data.countdown_days} days to go` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="screen">
      <TopBar title={trip?.name ?? 'Trip'} subtitle={subtitle} />
      <CacheNote visible={home.fromCache} />

      {location.status !== 'granted' && (
        <div className="pad" style={{ paddingBlock: 'var(--s-2)' }}>
          <button className="btn btn--sm btn--plain" onClick={requestLocation}>
            <Crosshair size={15} strokeWidth={2.1} />
            {location.status === 'locating' ? 'Locating…' : 'Use my location'}
          </button>
          {location.status === 'denied' && (
            <Note tone="warn">
              Location unavailable, so distances are hidden. Everything else works from your current
              destination.
            </Note>
          )}
        </div>
      )}

      {(queue.pending_candidates > 0 || queue.failed_sources > 0) && (
        <ul className="list" style={{ marginTop: 'var(--s-2)' }}>
          {queue.pending_candidates > 0 && (
            <li>
              <Link to="/saved" className="item">
                <Glyph Icon={Inbox} accent />
                <div className="item__body">
                  <p className="item__title">
                    {queue.pending_candidates} item{queue.pending_candidates === 1 ? '' : 's'} to
                    review
                  </p>
                  <Meta parts={['Nothing reaches your map until you confirm it']} />
                </div>
                <ChevronRight size={18} className="dimmer" style={{ flex: 'none', marginTop: 9 }} />
              </Link>
            </li>
          )}
          {queue.failed_sources > 0 && (
            <li>
              <Link to="/saved" className="item">
                <Glyph Icon={AlertTriangle} />
                <div className="item__body">
                  <p className="item__title">
                    {queue.failed_sources} capture{queue.failed_sources === 1 ? '' : 's'} need a hand
                  </p>
                  <Meta parts={['Kept in Inbox', 'retry or add the place yourself']} />
                </div>
                <RefreshCw size={16} className="dimmer" style={{ flex: 'none', marginTop: 10 }} />
              </Link>
            </li>
          )}
        </ul>
      )}

      <ul className="list" style={{ marginTop: 'var(--s-2)' }}>
        <li>
          <button className="item" onClick={() => openSave('album')}>
            <Glyph Icon={RefreshCw} />
            <div className="item__body">
              <p className="item__title">Sync album</p>
              <Meta parts={['Bring in what you saved since last time']} />
            </div>
            <ChevronRight size={18} className="dimmer" style={{ flex: 'none', marginTop: 9 }} />
          </button>
        </li>
      </ul>

      <SectionLabel action={<Link className="btn btn--sm btn--plain" to="/trip">Plan</Link>}>
        Today
      </SectionLabel>
      {data.today_plan.length === 0 ? (
        <p className="pad t-sm dim">
          Nothing planned.{' '}
          {position ? 'Saved places near you are below.' : 'Share your location to see what is nearby.'}
        </p>
      ) : (
        <ul className="list">
          {data.today_plan.map((item) => (
            <li key={item.id}>
              {item.trip_place_id ? (
                <Link to={`/places/${item.trip_place_id}`} className="item">
                  <span className="t-sm dimmer num" style={{ width: 38, flex: 'none', paddingTop: 2 }}>
                    {item.start_time ?? '—'}
                  </span>
                  <div className="item__body">
                    <p className="item__title clamp-1">{item.title}</p>
                  </div>
                  <ChevronRight size={18} className="dimmer" style={{ flex: 'none' }} />
                </Link>
              ) : (
                <div className="item" style={{ cursor: 'default' }}>
                  <span className="t-sm dimmer num" style={{ width: 38, flex: 'none', paddingTop: 2 }}>
                    {item.start_time ?? '—'}
                  </span>
                  <div className="item__body">
                    <p className="item__title clamp-1">{item.title}</p>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <SectionLabel>Brought back for you</SectionLabel>
      {data.resurfaced.length === 0 ? (
        <Empty
          title="Nothing to resurface yet"
          body="Save a link, a screenshot or a downloaded video and TripStash brings it back when it becomes relevant."
          action={
            <button className="btn btn--accent" onClick={() => openSave()}>
              Save something
            </button>
          }
        />
      ) : (
        <ul className="list">
          {data.resurfaced.map((item, index) => {
            const isPlace = item.kind === 'place'
            const Icon = isPlace
              ? CATEGORY_ICON[item.category ?? 'other'] ?? MapPin
              : KNOWLEDGE_ICON[item.knowledge_type ?? 'general'] ?? KNOWLEDGE_ICON.general
            const { headline, detail } = pairText(item.title, item.body)
            const body = (
              <>
                <Glyph Icon={Icon} />
                <div className="item__body">
                  <div className="row between" style={{ gap: 'var(--s-2)' }}>
                    <p className="item__title grow clamp-2">{headline}</p>
                    {item.distance_km !== null && (
                      <span className="t-sm dimmer num" style={{ flex: 'none' }}>
                        {item.distance_km} km
                      </span>
                    )}
                  </div>
                  {/* Why it is surfacing now is part of the product, not a debug note. */}
                  <p className="t-sm dim" style={{ marginTop: 2 }}>
                    {item.reason}
                  </p>
                  {detail && <p className="t-sm dimmer clamp-2" style={{ marginTop: 2 }}>{detail}</p>}
                </div>
              </>
            )
            return (
              <li key={`${item.kind}-${item.knowledge_item_id ?? item.trip_place_id}-${index}`}>
                {item.trip_place_id ? (
                  <Link to={`/places/${item.trip_place_id}`} className="item">
                    {body}
                    <ChevronRight size={18} className="dimmer" style={{ flex: 'none', marginTop: 9 }} />
                  </Link>
                ) : (
                  <div className="item" style={{ cursor: 'default' }}>
                    {body}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <SectionLabel action={<Link className="btn btn--sm btn--plain" to="/trip">Details</Link>}>
        Money
      </SectionLabel>
      <div className="pad">
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <p className="t-xl num">
            {money.spent_total.toFixed(0)}
            <span className="t-md dimmer"> {money.currency}</span>
          </p>
          <p className="t-sm dimmer num">{money.spent_today.toFixed(2)} today</p>
        </div>
        {money.budget !== null && money.daily && (
          <>
            <div className="meter" style={{ margin: 'var(--s-3) 0 var(--s-2)' }}>
              <span style={{ width: `${Math.min(100, (money.spent_total / money.budget) * 100)}%` }} />
            </div>
            <Meta
              parts={[
                `${money.daily.remaining.toFixed(0)} left`,
                money.daily.per_day !== null &&
                  `${money.daily.per_day.toFixed(0)} a day for ${money.daily.days_left} days`,
              ]}
            />
          </>
        )}
      </div>

      {data.bookings.length > 0 && (
        <>
          <SectionLabel>Bookings</SectionLabel>
          <ul className="list">
            {data.bookings.map((booking) => (
              <li key={booking.id}>
                <div className="item" style={{ cursor: 'default' }}>
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

      <p className="pad t-sm dimmer" style={{ marginTop: 'var(--s-6)' }}>
        {Object.entries(data.place_counts)
          .map(([status, count]) => `${count} ${status.replace('_', ' ')}`)
          .join(' · ')}
      </p>
    </div>
  )
}

export { KNOWLEDGE_LABEL }
