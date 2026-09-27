import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { Empty, ErrorNote, SkeletonRows } from '../components/ui'

/** The name the API uses for a place whose country never resolved. */
const UNKNOWN_COUNTRY = 'Country not known'

/**
 * One country: every place in it that has video, most-evidenced first.
 *
 * The count here must agree with the number on the countries list, so both are
 * read from the same rows rather than estimated separately.
 */
export default function CountryView() {
  const { key } = useParams<{ key: string }>()
  const name = key === 'unknown' ? UNKNOWN_COUNTRY : decodeURIComponent(key ?? '')
  const state = useAsync(() => api.reelSpots({ country: name }), [name])

  if (state.error) return <ErrorNote message={state.error} onRetry={state.reload} />
  if (!state.data) return <SkeletonRows />

  const videos = state.data.reduce((sum, spot) => sum + spot.clip_count, 0)

  return (
    <div className="screen" data-testid="country-view">
      <div className="pad pad-y">
        <Link to="/countries" className="t-small" style={{ color: 'var(--teal-ink)' }}>
          Back to your countries
        </Link>
        <h1 className="t-title" style={{ marginTop: 'var(--s-2)' }} data-testid="country-name">
          {name}
        </h1>
        <p className="t-small dim" style={{ marginTop: 'var(--s-2)' }} data-testid="country-totals">
          {state.data.length} {state.data.length === 1 ? 'place' : 'places'}, {videos}{' '}
          {videos === 1 ? 'video' : 'videos'}
        </p>
      </div>

      {state.data.length === 0 ? (
        <Empty title="No video saved here yet" body="Save a reel about somewhere in this country." />
      ) : (
        <ul className="list">
          {state.data.map((spot) => (
            <li key={spot.trip_place_id}>
              <Link
                to={`/places/${spot.trip_place_id}`}
                className="item"
                data-testid="country-place"
              >
                <span className="item__body">
                  <span className="item__title">{spot.name}</span>
                  <span className="t-small dim">
                    {spot.playable_count === spot.clip_count
                      ? spot.scope_label
                      : `${spot.scope_label}, ${spot.clip_count - spot.playable_count} link only`}
                  </span>
                </span>
                <span className="t-head num">{spot.clip_count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
