/**
 * A country lists its cities, never individual spots.
 *
 * Ranking a cafe against a city is a category error, so the rollup stops at
 * the city and each row says what you have there. The counts are yours: there
 * is no corpus of what other travellers saved, so "popular with travellers"
 * would be a label with nothing behind it.
 */
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import TopBar from '../components/TopBar'
import CityCards from '../components/CityCards'
import { ErrorNote, Note, SkeletonRows } from '../components/ui'
import {
  ArrowLeft,
  ChevronRight,
  Film,
  MapPin,
  Route as RouteIcon,
  Search,
} from '../components/icons'

type Sort = 'places' | 'clips' | 'name'

const SORTS: { key: Sort; label: string }[] = [
  { key: 'places', label: 'Most places' },
  { key: 'clips', label: 'Most clips' },
  { key: 'name', label: 'A–Z' },
]

export default function Country() {
  const { country = '' } = useParams()
  const name = decodeURIComponent(country)
  useScreenContext({ surface: 'map', label: name })

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('places')

  const cities = useAsync(() => api.exploreCities({ country: name, sort }), [name, sort])
  // The same cities as cards: your photo and your sentence for each.
  const cards = useAsync(() => api.cities(name), [name])

  // Filtering happens here as you type; the server's `q` is for a cold load.
  const rows = useMemo(() => {
    const all = cities.data ?? []
    const needle = query.trim().toLowerCase()
    if (!needle) return all
    return all.filter((row) => row.name.toLowerCase().includes(needle))
  }, [cities.data, query])

  const totals = useMemo(() => {
    const all = cities.data ?? []
    return {
      places: all.reduce((sum, row) => sum + row.place_count, 0),
      clips: all.reduce((sum, row) => sum + row.clip_count, 0),
      onRoute: all.some((row) => row.on_route),
    }
  }, [cities.data])

  return (
    <div className="screen">
      <TopBar
        title={name}
        leading={
          <Link className="iconbtn" to="/explore" aria-label="Back to Explore">
            <ArrowLeft size={19} />
          </Link>
        }
      />

      <div className="pad">
        <div className="countryhero">
          <h1 className="countryhero__name">{name}</h1>
          <p className="countryhero__counts num">
            {totals.places} {totals.places === 1 ? 'place' : 'places'} saved
            {totals.clips > 0 && ` · ${totals.clips} ${totals.clips === 1 ? 'clip' : 'clips'}`}
            {totals.onRoute && ' · on your route'}
          </p>
        </div>
      </div>

      <CityCards cities={cards.data ?? []} />

      <div className="pad">

        <label className="searchfield">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search cities in ${name}`}
            aria-label={`Search cities in ${name}`}
          />
        </label>

        <div className="chiprow" role="group" aria-label="Sort cities">
          {SORTS.map(({ key, label }) => (
            <button
              key={key}
              className="chip-toggle"
              aria-pressed={sort === key}
              onClick={() => setSort(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {cities.loading && !cities.data && <SkeletonRows rows={4} />}
      {cities.error && !cities.data && (
        <div className="pad">
          <ErrorNote message={cities.error} onRetry={cities.reload} />
        </div>
      )}

      <div className="pad stack-2" style={{ marginTop: 'var(--s-3)' }}>
        {cities.data && !rows.length && (
          <Note tone="neutral" Icon={MapPin}>
            {query
              ? `No city here matches “${query}”.`
              : `Nothing saved in ${name} yet. Save a link and the places in it land here.`}
          </Note>
        )}

        {rows.map((row) => (
          <Link
            key={row.name}
            className="scope"
            to={`/cities/${encodeURIComponent(row.name)}`}
          >
            <span className="scope__main">
              <span className="scope__name">
                {row.name}
                {row.on_route && (
                  <span className="scope__tag">
                    <RouteIcon size={12} /> on your route
                  </span>
                )}
              </span>
              <span className="scope__counts num">
                <MapPin size={13} /> {row.place_count} of yours
                {row.clip_count > 0 && (
                  <>
                    {' · '}
                    <Film size={13} /> {row.clip_count}
                  </>
                )}
                {row.visited_count > 0 && ` · ${row.visited_count} visited`}
              </span>
            </span>
            <ChevronRight size={18} />
          </Link>
        ))}
      </div>
    </div>
  )
}
