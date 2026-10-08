/**
 * A country's cities, as cards you swipe through: a photo you saved for the
 * city and the sentence you wrote about it.
 *
 * The photo is only ever one the traveller supplied - from their plan or their
 * saves - so a card with no photo shows the city's initial rather than an
 * invented picture. The sentence is theirs too, and keeps its own direction
 * (`dir="auto"`), because a plan written in Hebrew reads right to left.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { CityBreakdown } from '../lib/types'
import ClipCounts from './ClipCounts'

export default function CityCards({
  cities,
  nightsFor,
}: {
  cities: CityBreakdown[]
  /** Nights the route spends in a city, when it is on the route. */
  nightsFor?: (city: CityBreakdown) => number | null
}) {
  if (!cities.length) return null
  return (
    <div className="citycards" role="list" aria-label="Cities">
      {cities.map((city) => {
        const nights = nightsFor?.(city) ?? null
        return (
          <Link
            key={city.key}
            role="listitem"
            className="citycard"
            to={`/cities/${encodeURIComponent(city.name)}`}
          >
            <span className="citycard__photo">
              <Photo url={city.photo_url} name={city.name} />
              {city.in_route && (
                <span className="citycard__badge">
                  {nights !== null ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : 'on your route'}
                </span>
              )}
            </span>
            <span className="citycard__body">
              <span className="citycard__name clamp-1">{city.name}</span>
              {city.explanation ? (
                <span className="citycard__line clamp-3" dir="auto">
                  {city.explanation}
                </span>
              ) : (
                <span className="citycard__line dimmer">Nothing written about it yet</span>
              )}
              <span className="citycard__meta t-xs dim num">
                {city.place_count} {city.place_count === 1 ? 'place' : 'places'}
              </span>
              <ClipCounts
                yours={city.video_count - (city.found_count ?? 0)}
                found={city.found_count ?? 0}
              />
            </span>
          </Link>
        )
      })}
    </div>
  )
}

/** The saved photo, or the city's initial when there is none or it will not load. */
function Photo({ url, name }: { url: string | null; name: string }) {
  const [broken, setBroken] = useState(false)
  if (!url || broken) {
    return (
      <span className="citycard__initial" aria-hidden="true">
        {name.slice(0, 1)}
      </span>
    )
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  )
}
