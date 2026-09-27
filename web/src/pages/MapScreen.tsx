/**
 * The map screen: one camera, one scope, four levels.
 *
 * It replaces /globe, /countries, /countries/:key and the city route. Those
 * were four React routes, which is exactly why moving between them felt like
 * changing tabs - each press unmounted one component and mounted another. Here
 * the map is mounted once and the level is a value.
 *
 * The page over the map changes shape by level on purpose. A world is a
 * declaration of what you are carrying; a country is a transit table of nights
 * and legs; a city has a main event, so one place is set large and the rest sit
 * compact beneath it. Giving all three the same list would hide all three.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { useLocation, useNavigate } from 'react-router-dom'
import MapCanvas from '../components/MapCanvas'
import MapPins from '../components/MapPins'
import ScopeTrail from '../components/ScopeTrail'
import Evidence from '../components/Evidence'
import { ArrowLeft, Plus } from '../components/icons'
import { api } from '../lib/api'
import { useApp } from '../lib/context'
import { useAsync } from '../lib/hooks'
import { targetFor } from '../lib/cameraTarget'
import { prefersReducedMotion, settleMs } from '../lib/flight'
import { useEdgeSwipe } from '../lib/useEdgeSwipe'
import { crumbsOf, depthOf, parentOf, parseScope, scopePath, type Scope } from '../lib/scope'
import { ErrorNote, SkeletonRows } from '../components/ui'
import type { CityBreakdown, CityPlace, GlobeCountry } from '../lib/types'

export default function MapScreen() {
  const route = useLocation()
  const navigate = useNavigate()
  const { openAsk } = useApp()

  const scope = useMemo(() => parseScope(route.pathname), [route.pathname])

  // "In or out" is only a comparison of depth, which is why it needs no state
  // machine: the camera reads it, and the page below reads the same answer.
  const previous = useRef(scope)
  const going: 'in' | 'out' = depthOf(scope) >= depthOf(previous.current) ? 'in' : 'out'
  useEffect(() => {
    previous.current = scope
  }, [scope])

  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [settled, setSettled] = useState(false)

  // How much of the map the page over it hides. Measured rather than guessed,
  // because the page is as tall as its content and a world, a country and a
  // place leave very different strips of map visible.
  const sheet = useRef<HTMLElement>(null)
  const [hidden, setHidden] = useState(0)
  useEffect(() => {
    const node = sheet.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(() => setHidden(node.getBoundingClientRect().height))
    watch.observe(node)
    setHidden(node.getBoundingClientRect().height)
    return () => watch.disconnect()
  }, [])

  const countries = useAsync(() => api.globeCountries(), [], true, 'globe')
  const countryKey = scope.level === 'world' ? null : scope.countryKey
  const cities = useAsync(
    () =>
      countryKey
        ? api.cities(countryKey)
        : Promise.resolve({ data: [] as CityBreakdown[], fromCache: false }),
    [countryKey],
  )
  const cityKey = scope.level === 'city' || scope.level === 'place' ? scope.cityKey : null
  const places = useAsync(
    () =>
      countryKey && cityKey
        ? api.cityPlaces(countryKey, cityKey)
        : Promise.resolve({ data: [] as CityPlace[], fromCache: false }),
    [countryKey, cityKey],
  )

  const country = countries.data?.find((c) => c.key === countryKey)
  const city = cities.data?.find((c) => c.key === cityKey)
  const place = places.data?.find(
    (p) => scope.level === 'place' && p.trip_place_id === scope.tripPlaceId,
  )

  const target = useMemo(
    () =>
      targetFor(scope, {
        countryName: country?.name,
        city,
        place,
        countryPoints: (countries.data ?? []).map((c) => ({ lat: c.lat, lon: c.lon })),
      }),
    [scope, country?.name, city, place, countries.data],
  )

  // Pins wait for the camera. The delay is read from the flight's own length so
  // the two cannot drift apart, and a new scope restarts it - which is what
  // makes a second press mid-flight land with the right pins.
  useEffect(() => {
    setSettled(false)
    const wait = settleMs(going, prefersReducedMotion())
    const timer = window.setTimeout(() => setSettled(true), wait)
    return () => window.clearTimeout(timer)
  }, [scope, going])

  const go = useCallback((next: Scope) => navigate(scopePath(next)), [navigate])
  const up = parentOf(scope)
  const goUp = useCallback(() => {
    if (up) go(up)
  }, [up, go])
  const swipe = useEdgeSwipe(goUp, Boolean(up))

  const onPressPin = useCallback(
    (id: string) => {
      if (scope.level === 'world') go({ level: 'country', countryKey: id })
      else if (scope.level === 'country')
        go({ level: 'city', countryKey: scope.countryKey, cityKey: id })
      else if (scope.level === 'city')
        go({
          level: 'place',
          countryKey: scope.countryKey,
          cityKey: scope.cityKey,
          tripPlaceId: id,
        })
    },
    [scope, go],
  )

  if (countries.error) return <ErrorNote message={countries.error} onRetry={countries.reload} />

  const crumbs = crumbsOf(scope, {
    country: country?.name,
    city: city?.name,
    place: place?.name,
  })
  const here = crumbs[crumbs.length - 1].label

  return (
    <div className="screen screen--map" data-testid="map-screen" {...swipe}>
      <MapCanvas target={target} going={going} bottomInset={hidden} onReady={setMap} />
      <MapPins
        map={map}
        scope={scope}
        settled={settled}
        data={{
          countries: countries.data ?? [],
          cities: cities.data ?? [],
          places: places.data ?? [],
        }}
        onPress={onPressPin}
      />

      <ScopeTrail crumbs={crumbs} code={codeFor(scope, country)} onGo={go} />

      {up && (
        <button
          type="button"
          className="map-back"
          data-testid="map-back"
          aria-label={`Back to ${crumbs[crumbs.length - 2].label}`}
          onClick={goUp}
        >
          <ArrowLeft size={20} />
        </button>
      )}

      {scope.level !== 'world' && (
        <button
          type="button"
          className="map-add"
          data-testid="map-add"
          aria-label={`Add a reel, a plan or a video to ${here}`}
          onClick={() => navigate('/save')}
        >
          <Plus size={22} />
        </button>
      )}

      <section className="mapsheet" data-testid="map-sheet" ref={sheet}>
        {!countries.data ? (
          <SkeletonRows />
        ) : (
          <Sheet
            scope={scope}
            here={here}
            countries={countries.data}
            cities={cities.data ?? []}
            places={places.data ?? []}
            place={place}
            onGo={go}
            onAsk={() => openAsk({ surface: scope.level, contextLabel: here })}
          />
        )}
      </section>
    </div>
  )
}

/** The small code in the corner of the trail. A document always has one. */
function codeFor(scope: Scope, country?: GlobeCountry): string | undefined {
  if (scope.level === 'world') return undefined
  if (scope.level === 'country') return country?.name.slice(0, 3).toUpperCase()
  return scope.level === 'city' ? 'z11' : 'z14'
}

interface SheetProps {
  scope: Scope
  here: string
  countries: GlobeCountry[]
  cities: CityBreakdown[]
  places: CityPlace[]
  place?: CityPlace
  onGo: (next: Scope) => void
  onAsk: () => void
}

function Sheet({ scope, here, countries, cities, places, place, onGo, onAsk }: SheetProps) {
  switch (scope.level) {
    case 'world':
      return <WorldSheet countries={countries} onGo={onGo} onAsk={onAsk} />
    case 'country':
      return <CountrySheet here={here} cities={cities} scope={scope} onGo={onGo} onAsk={onAsk} />
    case 'city':
      return <CitySheet here={here} places={places} scope={scope} onGo={onGo} onAsk={onAsk} />
    case 'place':
      return <PlaceSheet place={place} onAsk={onAsk} />
  }
}

/**
 * The world, as a declaration of what you are carrying.
 *
 * Figures right-aligned in a column, the way a customs form lists things, so
 * the eye can run down the numbers without reading a word.
 */
function WorldSheet({
  countries,
  onGo,
  onAsk,
}: {
  countries: GlobeCountry[]
  onGo: (s: Scope) => void
  onAsk: () => void
}) {
  const stops = countries.reduce((sum, c) => sum + c.stop_count, 0)
  const clips = countries.reduce((sum, c) => sum + c.video_count, 0)

  return (
    <>
      <header className="mapsheet__head">
        <h1 className="t-name t-name--lg">Where this trip goes</h1>
        <p className="mapsheet__meta t-field" data-testid="world-meta">
          <span>
            {countries.length} {countries.length === 1 ? 'country' : 'countries'}
          </span>
          <span>{stops} stops</span>
          <span>{clips} clips</span>
        </p>
      </header>

      <div className="declare">
        <div className="declare__head t-field">
          <span className="declare__name">Country</span>
          <span className="declare__stops">Stops</span>
          <span className="declare__marks">Clips</span>
        </div>
        {countries.length === 0 ? (
          <p className="mapsheet__empty">
            No countries yet. Share a reel about somewhere and it appears here.
          </p>
        ) : (
          countries.map((c) => (
            <button
              key={c.key}
              type="button"
              className="declare__row"
              data-testid="world-country"
              onClick={() => onGo({ level: 'country', countryKey: c.key })}
            >
              <span className="declare__name">
                <span className="t-name t-name--md">{c.name}</span>
                <span className="t-field declare__code">{c.name.slice(0, 3).toUpperCase()}</span>
              </span>
              <span className="declare__stops t-field">
                {c.in_route ? c.stop_count : '—'}
              </span>
              <span className="declare__marks">
                <Evidence
                  yours={Math.max(0, c.video_count - (c.found_count ?? 0))}
                  found={c.found_count ?? 0}
                  size="sm"
                />
              </span>
            </button>
          ))
        )}
      </div>

      <Actions primary="Ask anywhere" onPrimary={onAsk} />
    </>
  )
}

/** A country, as a transit table: nights and how you get there. */
function CountrySheet({
  here,
  cities,
  scope,
  onGo,
  onAsk,
}: {
  here: string
  cities: CityBreakdown[]
  scope: Scope & { level: 'country' }
  onGo: (s: Scope) => void
  onAsk: () => void
}) {
  const clips = cities.reduce((s, c) => s + c.video_count, 0)
  const found = cities.reduce((s, c) => s + (c.found_count ?? 0), 0)

  return (
    <>
      <header className="mapsheet__head">
        <h1 className="t-name t-name--lg">{here}</h1>
        <p className="mapsheet__meta t-field">
          <span>
            {cities.length} {cities.length === 1 ? 'city' : 'cities'}
          </span>
          <span>{clips} clips</span>
          {found > 0 && <span>{found} found</span>}
        </p>
      </header>

      <div className="legs">
        {cities.length === 0 ? (
          <p className="mapsheet__empty">
            Nothing saved in {here} yet. Ask below and I will look for something.
          </p>
        ) : (
          cities.map((c) => (
            <button
              key={c.key}
              type="button"
              className="leg"
              data-testid="country-city"
              onClick={() =>
                onGo({ level: 'city', countryKey: scope.countryKey, cityKey: c.key })
              }
            >
              <span className="leg__top">
                <span className="t-name t-name--md">{c.name}</span>
                <Evidence
                  yours={Math.max(0, c.video_count - (c.found_count ?? 0))}
                  found={c.found_count ?? 0}
                  size="sm"
                />
              </span>
              <span className="leg__meta t-field">
                <span>
                  {c.place_count} {c.place_count === 1 ? 'thing' : 'things'}
                </span>
                <span>{c.in_route ? 'on your route' : 'not on your route'}</span>
              </span>
              {c.explanation && (
                <span className="leg__note" dir="auto">
                  {c.explanation}
                </span>
              )}
            </button>
          ))
        )}
      </div>

      <Actions primary={`Ask about ${here}`} onPrimary={onAsk} />
    </>
  )
}

/**
 * A city has a main event.
 *
 * The place with the most behind it is set large with its quote; the rest sit
 * compact underneath. A uniform list would hide the one thing you opened the
 * city to look at.
 */
function CitySheet({
  here,
  places,
  scope,
  onGo,
  onAsk,
}: {
  here: string
  places: CityPlace[]
  scope: Scope & { level: 'city' }
  onGo: (s: Scope) => void
  onAsk: () => void
}) {
  const sorted = [...places].sort((a, b) => b.video_count - a.video_count)
  const [lead, ...rest] = sorted
  const clips = places.reduce((s, p) => s + p.video_count, 0)
  const found = places.reduce((s, p) => s + p.found_count, 0)

  const open = (id: string) =>
    onGo({ level: 'place', countryKey: scope.countryKey, cityKey: scope.cityKey, tripPlaceId: id })

  return (
    <>
      <header className="mapsheet__head mapsheet__head--split">
        <div>
          <h1 className="t-name t-name--lg">{here}</h1>
          <p className="mapsheet__meta t-field">
            <span>
              {places.length} {places.length === 1 ? 'thing' : 'things'}
            </span>
            <span>{clips} clips</span>
            {found > 0 && <span>{found} found</span>}
          </p>
        </div>
      </header>

      {!lead ? (
        <p className="mapsheet__empty">
          Nothing in {here} yet. Ask below and I will look for something.
        </p>
      ) : (
        <>
          <button
            type="button"
            className="lead"
            data-testid="city-lead"
            onClick={() => open(lead.trip_place_id)}
          >
            <span className="lead__top">
              <span className="t-name t-name--md">{lead.name}</span>
              <Evidence yours={lead.video_count - lead.found_count} found={lead.found_count} />
            </span>
            {lead.quote && <span className="lead__quote t-quote">&ldquo;{lead.quote}&rdquo;</span>}
            {lead.found_count > 0 && (
              <span className="lead__note t-field">
                {lead.found_count} of these {lead.video_count} were found, so this is mostly not
                yours yet.
              </span>
            )}
          </button>

          <div className="compactlist">
            {rest.map((p) => (
              <button
                key={p.trip_place_id}
                type="button"
                className="compactrow"
                data-testid="city-place"
                onClick={() => open(p.trip_place_id)}
              >
                <span className="compactrow__body">
                  <span className="t-name t-name--sm">{p.name}</span>
                  <span className="t-field compactrow__kind">{p.kind}</span>
                </span>
                <Evidence yours={p.video_count - p.found_count} found={p.found_count} size="sm" />
              </button>
            ))}
          </div>
        </>
      )}

      <Actions primary={`Ask about ${here}`} onPrimary={onAsk} />
    </>
  )
}

/** One place: the quote is the screen, everything else is caption. */
function PlaceSheet({ place, onAsk }: { place?: CityPlace; onAsk: () => void }) {
  if (!place) return <SkeletonRows />

  return (
    <>
      <header className="mapsheet__head">
        <h1 className="t-name t-name--lg">{place.name}</h1>
        <p className="mapsheet__meta t-field">
          {place.lat !== null && place.lon !== null && (
            <>
              <span>{place.lat.toFixed(4)} N</span>
              <span>{Math.abs(place.lon).toFixed(4)} W</span>
            </>
          )}
        </p>
      </header>

      {place.quote && (
        <blockquote className="evidencecard" data-testid="place-quote">
          <p className="t-quote t-quote--hero">&ldquo;{place.quote}&rdquo;</p>
        </blockquote>
      )}

      <div className="placefacts">
        <Evidence yours={place.video_count - place.found_count} found={place.found_count} />
        <span className="t-field placefacts__note">
          {place.found_count > 0
            ? `${place.video_count - place.found_count} of these ${place.video_count} are yours`
            : 'all of these are yours'}
        </span>
      </div>

      <Actions primary="Ask about this" onPrimary={onAsk} />
    </>
  )
}

function Actions({ primary, onPrimary }: { primary: string; onPrimary: () => void }) {
  return (
    <div className="mapsheet__actions">
      <button
        type="button"
        className="btn btn--doc grow"
        data-testid="ask-scope"
        onClick={onPrimary}
      >
        {primary}
      </button>
    </div>
  )
}
