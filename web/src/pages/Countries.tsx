import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { Empty, ErrorNote, SkeletonRows } from '../components/ui'

/**
 * Where a library clusters, before any one place is opened.
 *
 * Scope elsewhere resolves to a destination, else a city, else a country, so
 * nothing until now could answer "Guatemala, all 12 videos". A country with no
 * name resolved is still listed: absence is information, not an error.
 */
export default function Countries() {
  const state = useAsync(() => api.countries(), [], true, 'countries')

  if (state.error) return <ErrorNote message={state.error} onRetry={state.reload} />
  if (!state.data) return <SkeletonRows />

  if (state.data.length === 0) {
    return (
      <div className="screen" data-testid="countries">
        <div className="pad pad-y">
          <h1 className="t-title">Where your saves are</h1>
        </div>
        <Empty
          title="Nothing saved yet"
          body="Share a reel, or bring in what you already saved, and it will show up here."
        />
      </div>
    )
  }

  const videos = state.data.reduce((sum, country) => sum + country.video_count, 0)

  return (
    <div className="screen" data-testid="countries">
      <div className="pad pad-y">
        <h1 className="t-title">Where your saves are</h1>
        <p className="t-small dim" style={{ marginTop: 'var(--s-2)' }} data-testid="countries-total">
          {state.data.length} {state.data.length === 1 ? 'country' : 'countries'}, {videos}{' '}
          {videos === 1 ? 'video' : 'videos'}
        </p>
      </div>

      <ul className="list">
        {state.data.map((country) => (
          <li key={country.key || 'unknown'}>
            <Link
              to={`/countries/${encodeURIComponent(country.key || 'unknown')}`}
              className="item"
              data-testid="country-row"
            >
              <div className="item__body">
                <p className="item__title">{country.name}</p>
                <p className="t-small dim">
                  {country.place_count} {country.place_count === 1 ? 'place' : 'places'}
                </p>
              </div>
              <span className="t-head num" data-testid="country-videos">
                {country.video_count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
