/**
 * Home is the trip.
 *
 * Opening the app lands on the route — the stops numbered in order, joined by
 * a dashed line, with the itinerary in a sheet underneath. Not a globe, not a
 * feed. Zoom out far enough and the stops become countries, which is Explore:
 * one continuous map, read at two distances.
 *
 * The nights steppers are the reason this is a planning tool rather than a
 * picture of one. Nights are the stored truth and the dates are derived, so
 * taking a night off one stop moves every stop after it. That sum happens on
 * the server (`services/itinerary.py`) and the screen renders what comes back
 * — doing the arithmetic here would be a second, drifting implementation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import L from 'leaflet'
import { api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import type { HomePayload, Route, RouteStop } from '../lib/types'
import { type CountryFeature, loadCountries, matchesCountry } from '../lib/basemap'
import { CacheNote, ErrorNote, Note, SkeletonRows } from '../components/ui'
import {
  AlertTriangle,
  CloudSun,
  Minus,
  MoreHorizontal,
  Plus,
  Share2,
  ZoomOut,
} from '../components/icons'

/** Where the map sits when a trip has no coordinates to show yet. */
const FALLBACK_VIEW: [number, number] = [-14.235, -51.925]

function pin(index: number, stop: RouteStop, total: number): L.DivIcon {
  const current = stop.destination.is_current
  const label = stop.destination.name
  return L.divIcon({
    className: '',
    // Leaflet wraps this in its own positioned element, so the pin itself
    // only has to draw; `iconAnchor` centres it on the coordinate.
    html:
      `<div class="stoppin${current ? ' stoppin--current' : ''}` +
      `${index % 2 ? ' stoppin--left' : ''}" ` +
      `aria-label="Stop ${index + 1} of ${total}: ${escapeHtml(label)}">` +
      `${index + 1}` +
      `<span class="stoppin__label">${escapeHtml(label)}</span>` +
      `</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )
}

/**
 * Dates are parsed as UTC and formatted as UTC. Reading "2026-09-14" in the
 * local zone would show the 13th to anyone west of Greenwich — an itinerary
 * that silently disagrees with the server by a day.
 */
function formatDate(iso: string | null, options: Intl.DateTimeFormatOptions): string | null {
  if (!iso) return null
  const parsed = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString(undefined, { ...options, timeZone: 'UTC' })
}

/** "Mon, 14 Sep" — for the summary, where the weekday earns its width. */
const shortDate = (iso: string | null) =>
  formatDate(iso, { weekday: 'short', day: 'numeric', month: 'short' })

/** "14 Sep" — for a stop's own row, where a range has to fit on one line. */
const stopDate = (iso: string | null) => formatDate(iso, { day: 'numeric', month: 'short' })

function nightsLabel(nights: number | null): string {
  if (nights === null) return 'Nights?'
  return nights === 1 ? '1 night' : `${nights} nights`
}

/** A leg's figure, or null when there is nothing honest to show. */
function legText(stop: RouteStop): string | null {
  const leg = stop.leg_in
  if (!leg || leg.distance_km === null) return null
  const distance = `${Math.round(leg.distance_km)} km`
  if (leg.duration_minutes === null) return distance
  const hours = Math.floor(leg.duration_minutes / 60)
  const minutes = leg.duration_minutes % 60
  const time = hours ? `${hours} h${minutes ? ` ${minutes} min` : ''}` : `${minutes} min`
  return `${distance} · ${time}`
}

export default function TripHome() {
  const { trip, openSave, position } = useApp()
  useScreenContext({ surface: 'home' })
  const [mode, setMode] = useState<'plan' | 'today'>('plan')
  const [tilesFailed, setTilesFailed] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [routeError, setRouteError] = useState<string | null>(null)

  const loaded = useAsync(() => api.route(), [trip?.id])
  // The server owns the shift, so a stepper press replaces the whole route
  // with whatever came back rather than patching one row locally.
  const [route, setRoute] = useState<Route | null>(null)
  useEffect(() => {
    if (loaded.data) setRoute(loaded.data)
  }, [loaded.data])

  const today = useAsync(
    () => api.home({ lat: position?.lat, lon: position?.lon }),
    [position?.lat, position?.lon, mode],
    mode === 'today',
  )

  const stops = route?.stops ?? []
  const placed = useMemo(
    () => stops.filter((s) => s.destination.lat !== null && s.destination.lon !== null),
    [stops],
  )

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const landRef = useRef<L.GeoJSON | null>(null)

  // Which countries the route touches, so the ground can say so.
  const routeCountries = useMemo(
    () => new Set(stops.map((s) => s.destination.country).filter(Boolean) as string[]),
    [stops],
  )

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: false,
      // Rendered below instead. Leaflet anchors its own control to the map's
      // bottom edge, which the sheet covers — and tile attribution is a
      // licence condition, so it cannot be left where it might be hidden.
      attributionControl: false,
    }).setView(FALLBACK_VIEW, 4)
    // The vector ground sits in its own pane below the tiles, so street detail
    // layers on top wherever there is signal and the map still reads without.
    map.createPane('basemap')
    const basemapPane = map.getPane('basemap')
    if (basemapPane) basemapPane.style.zIndex = '150'

    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 })
    // A blocked or offline tile server is the ordinary case on the road, not
    // an error state: the coastlines and borders underneath are carried in the
    // app, so what is lost is street detail, and the note below says only that.
    tiles.on('tileerror', () => setTilesFailed(true))
    tiles.addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    // Leaflet caches the container size at construction; after layout settles
    // that figure is stale, which throws off both tiles and fitBounds.
    const resize = () => map.invalidateSize({ animate: false })
    requestAnimationFrame(resize)
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  // The ground: real country outlines, carried in the app.
  useEffect(() => {
    let cancelled = false
    loadCountries('regional').then((countries) => {
      const map = mapRef.current
      if (cancelled || !map) return
      landRef.current?.remove()
      landRef.current = L.geoJSON(countries, {
        pane: 'basemap',
        interactive: false,
        style: (featureIn) => {
          const onRoute = [...routeCountries].some((name) =>
            matchesCountry(featureIn as CountryFeature, name),
          )
          const read = (token: string) =>
            getComputedStyle(document.documentElement).getPropertyValue(token).trim()
          return {
            fillColor: read(onRoute ? '--map-land-route' : '--map-land') || '#10233a',
            fillOpacity: 1,
            color: read(onRoute ? '--map-land-route-line' : '--map-land-line') || '#27405e',
            weight: onRoute ? 1.2 : 0.6,
          }
        },
      }).addTo(map)
    })
    return () => {
      cancelled = true
    }
  }, [routeCountries])

  // Draw the route: numbered pins in order, dashed line between them.
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return

    layer.clearLayers()
    if (!placed.length) return

    const points = placed.map(
      (stop) => [stop.destination.lat as number, stop.destination.lon as number] as [number, number],
    )
    if (points.length > 1) {
      L.polyline(points, {
        color: getComputedStyle(document.documentElement)
          .getPropertyValue('--transport')
          .trim() || '#e8663c',
        weight: 2.5,
        opacity: 0.9,
        dashArray: '7 7',
        interactive: false,
      }).addTo(layer)
    }
    placed.forEach((stop, index) => {
      L.marker(points[index], { icon: pin(index, stop, placed.length), keyboard: true }).addTo(layer)
    })

    // The sheet covers the lower half, so a plain fitBounds hides the stops
    // underneath it.
    // Fit the route into the band that is actually clear: below the header
    // and any map note, above the zoom-out pill and the sheet. Measuring the
    // sheet beats guessing a fraction, which drifts as its content changes.
    const sheetTop =
      document.querySelector('.tripsheet')?.getBoundingClientRect().top ??
      window.innerHeight * 0.68
    const noteBottom = document.querySelector('.mapnote')?.getBoundingClientRect().bottom ?? 110
    map.invalidateSize({ animate: false })
    map.fitBounds(L.latLngBounds(points), {
      paddingTopLeft: [40, Math.round(noteBottom) + 24],
      paddingBottomRight: [40, Math.round(window.innerHeight - sheetTop) + 72],
      maxZoom: 9,
      animate: false,
    })
  }, [placed])

  const addStop = useCallback(
    async (name: string, afterPosition: number | null) => {
      setRouteError(null)
      try {
        await api.addDestination({ name, after_position: afterPosition })
        // The insert re-dates the stops after it, so take the whole route back.
        const fresh = await api.route()
        setRoute(fresh.data)
      } catch (error) {
        setRouteError(error instanceof Error ? error.message : 'Could not add that stop.')
      }
    },
    [],
  )

  const setNights = useCallback(
    async (stop: RouteStop, next: number | null) => {
      setSaving(stop.destination.id)
      setRouteError(null)
      try {
        const updated = await api.setStopNights(stop.destination.id, next)
        setRoute(updated.data)
      } catch (error) {
        setRouteError(error instanceof Error ? error.message : 'Could not change that stop.')
      } finally {
        setSaving(null)
      }
    },
    [],
  )

  if (loaded.loading && !route) {
    return (
      <div className="trip">
        <div className="trip__map" ref={containerRef} />
        <div className="trip__over">
          <div className="trip__spacer" />
          <div className="tripsheet">
            <div className="tripsheet__grip" />
            <div className="tripsheet__body">
              <SkeletonRows rows={4} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="trip">
      <div className="trip__map" ref={containerRef} aria-hidden="true" />

      <div className="trip__over">
        <header className="trip__head">
          <div className="trip__who grow">
            <Link className="trip__avatar" to="/profile" aria-label="You: your picks and sources">
              {(trip?.name ?? 'T').slice(0, 1).toUpperCase()}
            </Link>
            <div className="trip__titles">
              <div className="trip__owner">Your trip</div>
              <div className="trip__name clamp-1">{trip?.name ?? 'Trip'}</div>
            </div>
          </div>
          <Link className="mapbtn" to="/trip" aria-label="Trip settings">
            <MoreHorizontal size={20} />
          </Link>
          <button className="mapbtn" onClick={() => openSave('link')} aria-label="Share the trip">
            <Share2 size={18} />
          </button>
        </header>

        {/* Sits under the header rather than mid-map: the route draws through
            the middle of the screen and a note there would cover it. */}
        {tilesFailed && (
          <p className="mapnote">
            <AlertTriangle size={14} />
            Offline map — street detail returns with a connection
          </p>
        )}

        <div className="trip__spacer" />

        {/* Pinch is the real gesture; this is its discoverable twin. */}
        <Link className="zoomout" to="/explore">
          <ZoomOut size={16} />
          Zoom out to Explore
        </Link>

        {/* Required by the tile licence, so it sits in the layout rather than
            wherever a control happens to land. */}
        <p className="mapcredit">
          ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap
          </a>{' '}
          contributors
        </p>

        <section className="tripsheet">
          <div className="tripsheet__grip" aria-hidden="true" />
          <div className="tripsheet__body">
            <div className="segmented" role="tablist" aria-label="Trip view">
              <button
                role="tab"
                className="segmented__item"
                aria-selected={mode === 'plan'}
                onClick={() => setMode('plan')}
              >
                Plan
              </button>
              <button
                role="tab"
                className="segmented__item"
                aria-selected={mode === 'today'}
                onClick={() => setMode('today')}
              >
                Today
              </button>
            </div>

            {mode === 'plan' ? (
              <PlanPane
                route={route}
                saving={saving}
                error={routeError}
                onNights={setNights}
                onAdd={addStop}
              />
            ) : (
              <TodayPane state={today} />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function PlanPane({
  route,
  saving,
  error,
  onNights,
  onAdd,
}: {
  route: Route | null
  saving: string | null
  error: string | null
  onNights: (stop: RouteStop, next: number | null) => void
  onAdd: (name: string, afterPosition: number | null) => Promise<void>
}) {
  // Which `+` is open. `null` is closed, a number is the position the new stop
  // goes after (so inserting mid-route does not reorder what is there), and
  // 'end' is the append slot at the bottom.
  const [insertAfter, setInsertAfter] = useState<number | 'end' | null>(null)
  if (!route || !route.stops.length) {
    return (
      <Note tone="neutral">
        No stops yet. Add the first one from the trip screen and the route draws itself.
      </Note>
    )
  }

  const start = shortDate(route.start_date)
  const end = shortDate(route.end_date)

  return (
    <>
      <div className="tripsummary">
        <span className="num">
          {route.stops.length} {route.stops.length === 1 ? 'stop' : 'stops'}
        </span>
        <span aria-hidden="true">·</span>
        <span className="num">{route.total_nights} nights</span>
        {start && (
          <>
            <span aria-hidden="true">·</span>
            <span className="num">{start}</span>
          </>
        )}
        {/* Order is mandatory; an end is not. */}
        {route.has_end_date ? (
          end && <span className="chip-flex num">to {end}</span>
        ) : (
          <span className="chip-flex chip-flex--open">No end date</span>
        )}
      </div>

      {error && <Note tone="warn" Icon={AlertTriangle}>{error}</Note>}

      <div className="stops">
        {route.stops.map((stop, index) => {
          const after = index > 0 ? route.stops[index - 1].destination.position : null
          const figure = legText(stop)
          return (
            <div key={stop.destination.id}>
              {index > 0 && (
                <>
                  <div className="leg">
                    <span className="leg__rail" aria-hidden="true" />
                    <span className="leg__text">
                      {figure ?? 'Distance unknown'}
                      {/* The figure is straight-line distance at one documented
                          speed, so it says so rather than posing as a timetable. */}
                      {figure && <span className="leg__estimate">estimate</span>}
                    </span>
                    <button
                      className="leg__insert"
                      onClick={() => setInsertAfter(insertAfter === after ? null : after)}
                      aria-expanded={insertAfter === after}
                      aria-label={`Add a stop before ${stop.destination.name}`}
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  {insertAfter === after && (
                    <AddStop
                      onCancel={() => setInsertAfter(null)}
                      onAdd={async (name) => {
                        await onAdd(name, after)
                        setInsertAfter(null)
                      }}
                    />
                  )}
                </>
              )}
              <Stop
                stop={stop}
                index={index}
                busy={saving === stop.destination.id}
                onNights={onNights}
              />
            </div>
          )
        })}

        {/* The last slot appends rather than inserting. */}
        <div className="leg">
          <span className="leg__rail" aria-hidden="true" />
          <span className="leg__text dimmer">Where next?</span>
          <button
            className="leg__insert"
            onClick={() => setInsertAfter(insertAfter === 'end' ? null : 'end')}
            aria-expanded={insertAfter === 'end'}
            aria-label="Add a stop at the end"
          >
            <Plus size={18} />
          </button>
        </div>
        {insertAfter === 'end' && (
          <AddStop
            onCancel={() => setInsertAfter(null)}
            onAdd={async (name) => {
              await onAdd(name, null)
              setInsertAfter(null)
            }}
          />
        )}
      </div>
    </>
  )
}

/**
 * Naming a new stop. Nights are left undecided on purpose — the traveller
 * picks the place first and the length after, and a default would be a number
 * nobody chose appearing in their itinerary.
 */
function AddStop({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const fieldRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    fieldRef.current?.focus()
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await onAdd(trimmed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="addstop" onSubmit={submit}>
      <input
        ref={fieldRef}
        className="addstop__field"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && onCancel()}
        placeholder="Where to?"
        aria-label="Name of the new stop"
        maxLength={160}
      />
      <button className="addstop__go" type="submit" disabled={!name.trim() || busy}>
        {busy ? 'Adding' : 'Add'}
      </button>
      <button className="addstop__cancel" type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  )
}

function Stop({
  stop,
  index,
  busy,
  onNights,
}: {
  stop: RouteStop
  index: number
  busy: boolean
  onNights: (stop: RouteStop, next: number | null) => void
}) {
  const nights = stop.nights
  const arrive = stopDate(stop.arrive_on)
  const depart = stopDate(stop.depart_on)

  return (
    <div className={`stop${stop.destination.is_current ? ' stop--current' : ''}`}>
      <span className="stop__n" aria-hidden="true">
        {index + 1}
      </span>
      <div className="stop__main">
        <div className="stop__name clamp-1">{stop.destination.name}</div>
        <div className={`stop__when${arrive ? '' : ' stop__when--open'}`}>
          {arrive && depart
            ? `${arrive} – ${depart}`
            : arrive
              ? `From ${arrive}`
              : 'Dates follow the nights above it'}
        </div>
      </div>
      <div className="stepper">
        <button
          className="stepper__btn"
          onClick={() => onNights(stop, nights === null ? null : Math.max(0, nights - 1))}
          disabled={busy || nights === null || nights === 0}
          aria-label={`One night fewer in ${stop.destination.name}`}
        >
          <Minus size={16} />
        </button>
        <span className={`stepper__value${nights === null ? ' stepper__value--open' : ''}`}>
          {nightsLabel(nights)}
        </span>
        <button
          className="stepper__btn"
          onClick={() => onNights(stop, nights === null ? 1 : nights + 1)}
          disabled={busy}
          aria-label={`One night more in ${stop.destination.name}`}
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}

/**
 * Today, not Track. Polarsteps puts `Plan | Track` here, and Track is GPS
 * breadcrumbing — TripStash has no background location and adopting the label
 * would promise code that does not exist. This answers what the app can
 * actually answer, from the payload it already returns.
 */
function TodayPane({
  state,
}: {
  state: { data: HomePayload | null; loading: boolean; error: string | null; fromCache: boolean; reload: () => void }
}) {
  if (state.loading && !state.data) return <SkeletonRows rows={3} />
  if (state.error && !state.data) return <ErrorNote message={state.error} onRetry={state.reload} />
  const home = state.data
  if (!home) return null

  const plan = home.today_plan
  return (
    <div className="today">
      <CacheNote visible={state.fromCache} />

      <div className="today__row">
        <span className="today__k">Today</span>
        <span className="today__v">{shortDate(home.date) ?? home.date}</span>
      </div>
      {home.current_destination && (
        <div className="today__row">
          <span className="today__k">Where you are</span>
          <span className="today__v">{home.current_destination.name}</span>
        </div>
      )}
      {home.weather && (
        <div className="today__row">
          <span className="today__k">
            <CloudSun size={14} /> {home.weather.summary}
          </span>
          <span className="today__v num">{Math.round(home.weather.temperature_c)}°C</span>
        </div>
      )}
      <div className="today__row">
        <span className="today__k">Planned for today</span>
        <span className="today__v num">{plan.length}</span>
      </div>
      <div className="today__row">
        <span className="today__k">Spent today</span>
        <span className="today__v num">
          {home.money.spent_today.toFixed(2)} {home.money.currency}
        </span>
      </div>

      {home.review_queue.pending_candidates > 0 && (
        <Note tone="neutral">
          {home.review_queue.pending_candidates} saved {
            home.review_queue.pending_candidates === 1 ? 'find' : 'finds'
          } waiting for you to approve. Nothing reaches your map until you do.
        </Note>
      )}

      <p className="t-sm dim" style={{ marginTop: 'var(--s-4)' }}>
        <Link to="/today">Open the full dashboard</Link>
      </p>
    </div>
  )
}
