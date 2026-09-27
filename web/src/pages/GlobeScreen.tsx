import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Globe from '../components/Globe'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { Empty, ErrorNote, SkeletonRows } from '../components/ui'

/**
 * The world, and where this trip touches it.
 *
 * The globe is the picture; the list below it is the control. That split is
 * deliberate rather than lazy: the globe draws to a canvas, so a country on it
 * is pixels rather than an element, and pixels cannot be reached by a keyboard
 * or read by a screen reader. Every country is therefore also a real button.
 *
 * A country you have never saved anything about is still pressable, because
 * pressing into somewhere unexplored is the point.
 */
export default function GlobeScreen() {
  const state = useAsync(() => api.globeCountries(), [], true, 'globe')
  const [query, setQuery] = useState('')

  const points = useMemo(
    () =>
      (state.data ?? []).map((country) => ({
        lat: country.lat,
        lon: country.lon,
        // Weight by evidence so the globe shows where the thinking is thick.
        size: 0.05 + Math.min(country.video_count, 12) * 0.006,
        hot: country.in_route,
      })),
    [state.data],
  )

  if (state.error) return <ErrorNote message={state.error} onRetry={state.reload} />
  if (!state.data) return <SkeletonRows />

  const needle = query.trim().toLowerCase()
  const shown = needle
    ? state.data.filter((country) => country.name.toLowerCase().includes(needle))
    : state.data

  return (
    <div className="screen" data-testid="globe">
      <div className="pad pad-y">
        <h1 className="t-title">Where this trip goes</h1>
        <p className="t-small dim" style={{ marginTop: 'var(--s-2)' }} data-testid="globe-total">
          {state.data.length} {state.data.length === 1 ? 'country' : 'countries'},{' '}
          {state.data.reduce((sum, c) => sum + c.stop_count, 0)} stops
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', padding: '0 var(--s-4)' }}>
        <Globe points={points} size={300} vivid />
      </div>

      <div className="pad" style={{ marginTop: 'var(--s-4)' }}>
        <label htmlFor="country-search" className="t-small dim">
          Search any country
        </label>
        <input
          id="country-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Belize, Colombia, anywhere"
          data-testid="country-search"
          className="input"
          style={{ marginTop: 'var(--s-2)', width: '100%' }}
        />
      </div>

      {shown.length === 0 ? (
        <Empty
          title="No country by that name here yet"
          body="Save a reel about it, or paste a plan that mentions it, and it will appear on the globe."
        />
      ) : (
        <ul className="list" style={{ marginTop: 'var(--s-2)' }}>
          {shown.map((country) => (
            <li key={country.key}>
              <Link
                to={`/countries/${encodeURIComponent(country.key)}`}
                className="item"
                data-testid="globe-country"
              >
                <div className="item__body">
                  <p className="item__title">{country.name}</p>
                  <p className="t-small dim">
                    {country.in_route
                      ? `${country.stop_count} ${country.stop_count === 1 ? 'stop' : 'stops'} planned`
                      : 'Not on your route yet'}
                    {country.video_count > 0 && `, ${country.video_count} saved`}
                  </p>
                </div>
                <span className="t-head num">{country.video_count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
