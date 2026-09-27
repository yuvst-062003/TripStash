import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp } from '../lib/context'
import { useAsync } from '../lib/hooks'
import { Empty, ErrorNote, SkeletonRows } from '../components/ui'

/** The name the API uses for a place whose country never resolved. */
const UNKNOWN_COUNTRY = 'Country not known'

interface Pin {
  lat: number
  lon: number
  label: string
}

/**
 * Where the cities sit relative to each other.
 *
 * Not a tile map and not pretending to be one: it plots real coordinates into
 * the country's own bounding box, so the shape of the route is true even
 * though there is no coastline behind it. A locator, drawn honestly.
 */
function CityLocator({ pins }: { pins: Pin[] }) {
  const lats = pins.map((p) => p.lat)
  const lons = pins.map((p) => p.lon)
  const pad = 0.6
  const north = Math.max(...lats) + pad
  const south = Math.min(...lats) - pad
  const east = Math.max(...lons) + pad
  const west = Math.min(...lons) - pad
  const width = 330
  const height = 190
  const x = (lon: number) => ((lon - west) / (east - west || 1)) * width
  const y = (lat: number) => ((north - lat) / (north - south || 1)) * height

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={`Where ${pins.length} cities sit relative to each other`}
      style={{ background: 'var(--paper-2)', borderRadius: 12 }}
    >
      {pins.map((pin, index) =>
        index === 0 ? null : (
          <line
            key={`leg-${pin.label}`}
            x1={x(pins[index - 1].lon)}
            y1={y(pins[index - 1].lat)}
            x2={x(pin.lon)}
            y2={y(pin.lat)}
            stroke="var(--teal)"
            strokeWidth="1.4"
            strokeDasharray="4 4"
            opacity="0.55"
          />
        ),
      )}
      {pins.map((pin) => (
        <g key={pin.label}>
          <circle cx={x(pin.lon)} cy={y(pin.lat)} r="7" fill="var(--coral)" stroke="#fff" strokeWidth="2" />
          <text
            x={x(pin.lon)}
            y={y(pin.lat) - 12}
            textAnchor="middle"
            fontSize="10"
            fontWeight="700"
            fill="var(--ink)"
          >
            {pin.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

/**
 * One country: its cities on a map, each explained in whoever's words we have.
 *
 * Never an empty screen. A country with nothing saved still offers the two
 * things that can change that - ask, or go looking - because a dead end is the
 * one thing pressing an unexplored country must not produce.
 */
export default function CountryView() {
  const { key } = useParams<{ key: string }>()
  const wanted = key === 'unknown' ? '' : decodeURIComponent(key ?? '')
  const { openAsk } = useApp()

  const cities = useAsync(() => api.cities(wanted || 'unknown'), [wanted])
  const countries = useAsync(() => api.globeCountries(), [], true, 'globe')
  const name =
    countries.data?.find((one) => one.key === wanted)?.name ?? (wanted || UNKNOWN_COUNTRY)

  if (cities.error) return <ErrorNote message={cities.error} onRetry={cities.reload} />
  if (!cities.data) return <SkeletonRows />

  const videos = cities.data.reduce((sum, city) => sum + city.video_count, 0)
  const pins = cities.data
    .filter((city) => city.lat !== null && city.lon !== null)
    .map((city) => ({ lat: city.lat as number, lon: city.lon as number, label: city.name }))

  return (
    <div className="screen" data-testid="country-view">
      <div className="pad pad-y">
        <Link to="/globe" className="t-small" style={{ color: 'var(--teal-ink)' }}>
          Back to the globe
        </Link>
        <h1 className="t-title" style={{ marginTop: 'var(--s-2)' }} data-testid="country-name">
          {name}
        </h1>
        <p className="t-small dim" style={{ marginTop: 'var(--s-2)' }} data-testid="country-totals">
          {cities.data.length} {cities.data.length === 1 ? 'city' : 'cities'}, {videos}{' '}
          {videos === 1 ? 'video' : 'videos'}
        </p>
      </div>

      {pins.length > 1 && (
        <div style={{ padding: '0 var(--s-4)' }} data-testid="country-map">
          <CityLocator pins={pins} />
        </div>
      )}

      <div className="pad" style={{ marginTop: 'var(--s-4)' }}>
        <button
          className="btn btn--ink btn--block"
          onClick={() => openAsk({ surface: 'home', contextLabel: name })}
          data-testid="ask-country"
        >
          Ask what there is to do in {name}
        </button>
      </div>

      {cities.data.length === 0 ? (
        <Empty
          title={`Nothing saved in ${name} yet`}
          body="Ask above and I will look, or share a reel about somewhere here and I will start counting properly."
        />
      ) : (
        <ul className="list" style={{ marginTop: 'var(--s-2)' }}>
          {cities.data.map((city) => (
            <li key={city.key}>
              <Link
                to={`/countries/${encodeURIComponent(wanted || 'unknown')}/cities/${encodeURIComponent(city.key)}`}
                className="item"
                data-testid="country-city"
              >
                <div className="item__body">
                  <p className="item__title">{city.name}</p>
                  {city.explanation ? (
                    <p className="t-small dim" data-testid="city-explanation">
                      {city.explanation}
                    </p>
                  ) : (
                    <p className="t-small dim">
                      {city.in_route ? 'Planned, nothing written yet' : 'From a saved video'}
                    </p>
                  )}
                  <p className="t-small dim">
                    {city.place_count} {city.place_count === 1 ? 'place' : 'places'}
                    {city.video_count > 0 && `, ${city.video_count} on video`}
                  </p>
                </div>
                <span className="t-head num">{city.video_count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
