import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp } from '../lib/context'
import { useAsync } from '../lib/hooks'
import { Empty, ErrorNote, SkeletonRows } from '../components/ui'

/**
 * One chip on the filter strip.
 *
 * The strip mixes two columns on purpose. `kind` is what a place IS - a
 * hostel, a bar, a viewpoint - and `activity` is what you DO there. Tremendo
 * Hostel answers to both, and a traveller scanning a city does not separate
 * them, so neither does the strip.
 */
interface Chip {
  label: string
  kind?: string
  activity?: string
}

const KIND_LABELS: Record<string, string> = {
  accommodation: 'Hostels',
  bar: 'Bars',
  cafe: 'Cafés',
  restaurant: 'Food',
  viewpoint: 'Viewpoints',
  nature: 'Nature',
  attraction: 'Sights',
  activity: 'Things to do',
  shop: 'Shops',
  transport: 'Transport',
}

const ACTIVITY_LABELS: Record<string, string> = {
  hike: 'Hiking',
  surf: 'Surf',
  volcano: 'Volcano',
  dive: 'Diving',
  spanish: 'Spanish',
  street_food: 'Street food',
  nightlife: 'Nightlife',
  waterfall: 'Waterfalls',
  ruins: 'Ruins',
  wildlife: 'Wildlife',
  coffee: 'Coffee',
  islands: 'Islands',
}

export default function CityView() {
  const { key, city } = useParams<{ key: string; city: string }>()
  const countryKey = decodeURIComponent(key ?? '')
  const cityKey = decodeURIComponent(city ?? '')
  const { openAsk } = useApp()
  const [chip, setChip] = useState<Chip | null>(null)
  const [looking, setLooking] = useState(false)
  const [lookedUp, setLookedUp] = useState<string | null>(null)

  const all = useAsync(() => api.cityPlaces(countryKey, cityKey), [countryKey, cityKey])
  const cities = useAsync(() => api.cities(countryKey), [countryKey])
  const here = cities.data?.find((one) => one.key === cityKey)
  const name = here?.name ?? cityKey

  if (all.error) return <ErrorNote message={all.error} onRetry={all.reload} />
  if (!all.data) return <SkeletonRows />

  // A chip is only offered when something is behind it, so no filter ever
  // returns an empty list.
  const kinds = [...new Set(all.data.map((p) => p.kind))].filter((k) => KIND_LABELS[k])
  const activities = [...new Set(all.data.flatMap((p) => p.activities))]
  const chips: Chip[] = [
    ...kinds.map((k) => ({ label: KIND_LABELS[k], kind: k })),
    ...activities.map((a) => ({ label: ACTIVITY_LABELS[a] ?? a, activity: a })),
  ]

  const shown = chip
    ? all.data.filter((p) =>
        chip.kind ? p.kind === chip.kind : chip.activity ? p.activities.includes(chip.activity) : true,
      )
    : all.data

  const videos = all.data.reduce((sum, p) => sum + p.video_count, 0)
  const found = all.data.reduce((sum, p) => sum + p.found_count, 0)

  return (
    <div className="screen" data-testid="city-view">
      <div className="pad pad-y">
        <Link
          to={`/countries/${encodeURIComponent(countryKey)}`}
          className="t-small"
          style={{ color: 'var(--teal-ink)' }}
        >
          Back to the country
        </Link>
        <h1 className="t-title" style={{ marginTop: 'var(--s-2)' }} data-testid="city-name">
          {name}
        </h1>
        {here?.explanation && (
          <p className="t-small dim" style={{ marginTop: 'var(--s-2)' }} data-testid="city-note">
            {here.explanation}
            {here.explanation_source === 'you' && ' — your words'}
          </p>
        )}
        <p className="t-small dim" style={{ marginTop: 'var(--s-2)' }} data-testid="city-totals">
          {all.data.length} {all.data.length === 1 ? 'thing' : 'things'}, {videos}{' '}
          {videos === 1 ? 'video' : 'videos'}
          {found > 0 && `, ${found} found`}
        </p>
      </div>

      {chips.length > 0 && (
        <div
          className="pad"
          style={{ display: 'flex', gap: 'var(--s-2)', overflowX: 'auto', paddingBottom: 'var(--s-2)' }}
          data-testid="filter-strip"
        >
          <button
            className={chip === null ? 'btn btn--sm btn--ink' : 'btn btn--sm'}
            onClick={() => setChip(null)}
            data-testid="chip-all"
          >
            All
          </button>
          {chips.map((one) => (
            <button
              key={one.label}
              className={chip?.label === one.label ? 'btn btn--sm btn--ink' : 'btn btn--sm'}
              onClick={() => setChip(chip?.label === one.label ? null : one)}
              data-testid={`chip-${one.kind ?? one.activity}`}
              style={{ whiteSpace: 'nowrap' }}
            >
              {one.label}
            </button>
          ))}
        </div>
      )}

      <div className="pad" style={{ display: 'flex', gap: 'var(--s-2)' }}>
        <button
          className="btn btn--ink grow"
          onClick={() => openAsk({ surface: 'map', contextLabel: name })}
          data-testid="ask-city"
        >
          Ask about {name}
        </button>
        <button
          className="btn"
          disabled={looking}
          data-testid="find-more"
          onClick={async () => {
            setLooking(true)
            try {
              const result = await api.find(name, chip?.activity)
              setLookedUp(
                result.data.nothing_reason ??
                  `Found ${result.data.found}${result.data.already_had ? `, you already had ${result.data.already_had}` : ''}.`,
              )
              all.reload()
            } finally {
              setLooking(false)
            }
          }}
        >
          {looking ? 'Looking' : 'Look for more'}
        </button>
      </div>

      {lookedUp && (
        <p className="pad t-small dim" data-testid="find-result">
          {lookedUp} Found clips are marked, and count for nothing until you stamp them.
        </p>
      )}

      {shown.length === 0 ? (
        <Empty
          title="Nothing here yet"
          body="Ask above and I will look, or share a reel about somewhere in this city."
        />
      ) : (
        <ul className="list" style={{ marginTop: 'var(--s-2)' }}>
          {shown.map((place) => (
            <li key={place.trip_place_id}>
              <Link
                to={`/places/${place.trip_place_id}`}
                className="item"
                data-testid="city-place"
              >
                <div className="item__body">
                  <p className="item__title">{place.name}</p>
                  <p className="t-small dim">
                    {[KIND_LABELS[place.kind] ?? place.kind, ...place.activities.map((a) => ACTIVITY_LABELS[a] ?? a)].join(', ')}
                  </p>
                  {place.found_count > 0 && (
                    <p className="t-small" style={{ color: 'var(--warn)' }} data-testid="found-mark">
                      {place.video_count - place.found_count} yours, {place.found_count} found
                    </p>
                  )}
                  {place.quote && (
                    <p className="t-small dim" data-testid="place-quote">
                      “{place.quote}”
                    </p>
                  )}
                </div>
                <span className="t-head num">{place.video_count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
