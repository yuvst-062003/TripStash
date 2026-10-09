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
import { Link, useSearchParams } from 'react-router-dom'
import L from 'leaflet'
import { api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import type { HomePayload, Route, RouteCheck, RouteStop } from '../lib/types'
import {
  type CountryFeature,
  loadCountries,
  matchesCountry,
  prefersReducedMotion,
} from '../lib/basemap'
import { CacheNote, ErrorNote, Note, SkeletonRows } from '../components/ui'
import CityCards from '../components/CityCards'
import { StopIdeas, StopSuggestions, TravellerVoices, TripChecks } from '../components/TripAdvice'
import {
  AlertTriangle,
  ArrowLeft,
  CloudSun,
  Lightbulb,
  Sparkles,
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
      `<span class="stoppin__label" dir="auto">${escapeHtml(label)}</span>` +
      `</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

/**
 * Hide the stop names that would land on top of one another.
 *
 * Twenty stops seen from a continent away put a dozen names in one thumbnail
 * of map, and a pile of overlapping words says nothing. Names are kept in
 * route order - the stop you are at first, then the earlier stop wins - and a
 * name that would overlap one already kept is hidden until you zoom in far
 * enough to separate them. The numbered pin always stays, so no stop vanishes.
 */
function declutterLabels(container: HTMLElement | null) {
  if (!container) return
  const labels = [...container.querySelectorAll<HTMLElement>('.stoppin__label')]
  labels.forEach((label) => (label.style.visibility = 'visible'))
  const ordered = [
    ...labels.filter((l) => l.closest('.stoppin--current')),
    ...labels.filter((l) => !l.closest('.stoppin--current')),
  ]
  const kept: DOMRect[] = []
  const frame = container.getBoundingClientRect()
  const pins = [...container.querySelectorAll<HTMLElement>('.stoppin')].map((p) =>
    p.getBoundingClientRect(),
  )
  const overlaps = (a: DOMRect, b: DOMRect) =>
    a.left < b.right + 2 && a.right > b.left - 2 && a.top < b.bottom + 2 && a.bottom > b.top - 2
  const blocked = (label: HTMLElement) => {
    const box = label.getBoundingClientRect()
    const own = label.parentElement?.getBoundingClientRect()
    const hitsPin = pins.some((pin) => own && !sameRect(pin, own) && overlaps(box, pin))
    // A name running off the screen is as unreadable as one under another.
    const offScreen = box.left < frame.left + 4 || box.right > frame.right - 4
    return offScreen || hitsPin || kept.some((other) => overlaps(box, other))
  }
  for (const label of ordered) {
    label.removeAttribute('data-flip')
    if (blocked(label)) {
      // Try the other side of its own pin before giving up on the name.
      label.setAttribute('data-flip', '')
      if (blocked(label)) {
        label.removeAttribute('data-flip')
        label.style.visibility = 'hidden'
        continue
      }
    }
    kept.push(label.getBoundingClientRect())
  }
}

function sameRect(a: DOMRect, b: DOMRect) {
  return a.left === b.left && a.top === b.top
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
  const { trip, openSave, openAsk, position } = useApp()
  // The country the camera has flown into, or null for the whole route.
  // Pressing a country or a stop sets it; the sheet follows the camera.
  // In the URL rather than in state: opening a city from the pane and
  // pressing back should land on the pane, not on the whole route.
  const [params, setParams] = useSearchParams()
  const focus = params.get('in')
  const setFocus = useCallback(
    (name: string | null) => setParams(name ? { in: name } : {}),
    [setParams],
  )
  const countryCities = useAsync(
    () => api.cities(focus ?? ''),
    [focus],
    Boolean(focus),
  )
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
  // Each route country's outline bounds, so a press can frame the country.
  const boundsRef = useRef<Map<string, L.LatLngBounds>>(new Map())
  const framedRef = useRef(false)

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
    map.on('zoomend moveend', () => declutterLabels(containerRef.current))
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
      boundsRef.current = new Map()
      landRef.current = L.geoJSON(countries, {
        pane: 'basemap',
        onEachFeature: (featureIn, layer) => {
          const name = [...routeCountries].find((n) =>
            matchesCountry(featureIn as CountryFeature, n),
          )
          if (!name) return
          boundsRef.current.set(name, (layer as L.Polygon).getBounds())
          // A country on the route flies in on a press, like a stop does.
          layer.on('click', () => setFocus(name))
        },
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
      const marker = L.marker(points[index], {
        icon: pin(index, stop, placed.length),
        keyboard: true,
      }).addTo(layer)
      const country = stop.destination.country
      if (country) marker.on('click', () => setFocus(country))
    })
    requestAnimationFrame(() => declutterLabels(containerRef.current))
  }, [placed])

  // The camera: the whole route, or the country you pressed. Kept apart from
  // drawing so a nights change redraws the route without moving the camera.
  const routeKey = placed.map((s) => s.destination.id).join(',')
  useEffect(() => {
    const map = mapRef.current
    if (!map || !placed.length) return
    const points = placed.map(
      (stop) => [stop.destination.lat as number, stop.destination.lon as number] as [number, number],
    )

    // The sheet covers the lower half, so a plain fitBounds hides the stops
    // underneath it.
    // Fit the route into the band that is actually clear: below the header
    // and any map note, above the zoom-out pill and the sheet. Measuring the
    // sheet beats guessing a fraction, which drifts as its content changes.
    // Once the itinerary has been scrolled, the sheet's top is above the
    // viewport and the band it leaves would be negative: adding a stop then
    // framed the route against a band that did not exist and landed the
    // camera on an empty patch of jungle. The sheet never sits higher than
    // its resting position for the purpose of framing.
    const resting = window.innerHeight * 0.5
    const measured = document.querySelector('.tripsheet')?.getBoundingClientRect().top
    const sheetTop = Math.max(measured ?? window.innerHeight * 0.68, resting)
    const noteBottom = Math.max(
      document.querySelector('.mapnote')?.getBoundingClientRect().bottom ?? 110,
      110,
    )
    map.invalidateSize({ animate: false })
    const padding = {
      paddingTopLeft: [40, Math.round(noteBottom) + 24] as [number, number],
      paddingBottomRight: [40, Math.round(window.innerHeight - sheetTop) + 72] as [number, number],
    }
    if (focus) {
      const inCountry = points.filter((_, i) => placed[i].destination.country === focus)
      // Your stops in it frame the country better than its outline does: a
      // country as big as Brazil is mostly places you are not going.
      const bounds = inCountry.length
        ? L.latLngBounds(inCountry).pad(inCountry.length === 1 ? 2 : 0.5)
        : (boundsRef.current.get(focus) ?? null)
      if (bounds) {
        if (prefersReducedMotion()) map.fitBounds(bounds, { ...padding, maxZoom: 9, animate: false })
        else map.flyToBounds(bounds, { ...padding, maxZoom: 9, duration: 1.1 })
      }
      return
    }
    // The first framing is instant: an animated flight started before the map
    // has its real size lands on the wrong place. Later moves fly.
    if (!framedRef.current) {
      framedRef.current = true
      map.fitBounds(L.latLngBounds(points), { ...padding, maxZoom: 9, animate: false })
      return
    }
    if (prefersReducedMotion()) {
      map.fitBounds(L.latLngBounds(points), { ...padding, maxZoom: 9, animate: false })
      return
    }
    map.flyToBounds(L.latLngBounds(points), { ...padding, maxZoom: 9, duration: 0.9 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- routeKey stands for placed
  }, [routeKey, focus])

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

  const setOnRoute = useCallback(async (destinationId: string, onRoute: boolean) => {
    setSaving(destinationId)
    setRouteError(null)
    try {
      const updated = await api.setOnRoute(destinationId, onRoute)
      setRoute(updated.data)
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : 'Could not move that stop.')
    } finally {
      setSaving(null)
    }
  }, [])

  const removeStop = useCallback(async (destinationId: string) => {
    setSaving(destinationId)
    setRouteError(null)
    try {
      await api.removeDestination(destinationId)
      // The stops after it move up and re-date, so take the whole route back.
      const fresh = await api.route()
      setRoute(fresh.data)
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : 'Could not remove that stop.')
    } finally {
      setSaving(null)
    }
  }, [])

  const applyFix = useCallback(
    async (check: RouteCheck) => {
      const stop = route?.stops.find((s) => s.destination.id === check.fix?.payload.destination_id)
      if (stop && check.fix) await setNights(stop, check.fix.payload.nights)
    },
    [route, setNights],
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

        {/* Pinch is the real gesture; this is its discoverable twin. Inside a
            country, the same place takes you back out to the whole route. */}
        {focus ? (
          <button className="zoomout" onClick={() => setFocus(null)}>
            <ArrowLeft size={16} />
            Whole trip
          </button>
        ) : (
          <Link className="zoomout" to="/explore">
            <ZoomOut size={16} />
            Zoom out to Explore
          </Link>
        )}

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
            {focus ? (
              <CountryPane
                name={focus}
                state={countryCities}
                route={route}
                onBack={() => setFocus(null)}
                onAsk={() => openAsk({ surface: 'trip', contextLabel: focus })}
              />
            ) : (
            <>
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
                loadError={loaded.error}
                onRetry={loaded.reload}
                saving={saving}
                error={routeError}
                onNights={setNights}
                onAdd={addStop}
                onFix={applyFix}
                onOnRoute={setOnRoute}
                onRemove={removeStop}
                onAsk={() => openAsk({ surface: 'trip', contextLabel: 'your route' })}
                onFocus={setFocus}
              />
            ) : (
              <TodayPane state={today} />
            )}
            </>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function PlanPane({
  route,
  loadError,
  onRetry,
  saving,
  error,
  onNights,
  onAdd,
  onFix,
  onOnRoute,
  onRemove,
  onAsk,
  onFocus,
}: {
  route: Route | null
  loadError: string | null
  onRetry: () => void
  saving: string | null
  error: string | null
  onNights: (stop: RouteStop, next: number | null) => void
  onAdd: (name: string, afterPosition: number | null) => Promise<void>
  onFix: (check: RouteCheck) => Promise<void>
  onOnRoute: (destinationId: string, onRoute: boolean) => Promise<void>
  onRemove: (destinationId: string) => Promise<void>
  onAsk: () => void
  onFocus: (country: string) => void
}) {
  // Which `+` is open. `null` is closed, a number is the position the new stop
  // goes after (so inserting mid-route does not reorder what is there), and
  // 'end' is the append slot at the bottom.
  const [insertAfter, setInsertAfter] = useState<number | 'end' | null>(null)
  // A route that could not be loaded is not an empty route. Saying "no stops
  // yet" over a failed request tells the traveller their trip is gone.
  if (!route && loadError) {
    return <ErrorNote message={loadError} onRetry={onRetry} />
  }
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

      <button className="btn btn--block askroute" onClick={onAsk}>
        <Sparkles size={16} /> Ask about your route
      </button>

      <TripChecks
        version={route.stops.map((s) => `${s.destination.id}:${s.nights}`).join(',')}
        onFix={onFix}
      />

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
                      afterId={route.stops[index - 1].destination.id}
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
                onFocus={onFocus}
                onSetAside={() => onOnRoute(stop.destination.id, false)}
                onRemove={() => onRemove(stop.destination.id)}
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
            afterId={route.stops[route.stops.length - 1]?.destination.id}
            onCancel={() => setInsertAfter(null)}
            onAdd={async (name) => {
              await onAdd(name, null)
              setInsertAfter(null)
            }}
          />
        )}
      </div>

      {(route.alternatives ?? []).length > 0 && (
        <section className="alts" aria-label="Alternatives">
          <h3 className="alts__head">
            Alternatives <span className="t-xs dim num">{route.alternatives?.length}</span>
          </h3>
          <p className="t-sm dim">Kept with their places, not on the route and holding no days.</p>
          {route.alternatives?.map((alt) => (
            <div key={alt.id} className="alt">
              <div className="alt__text">
                <span className="alt__name" dir="auto">
                  {alt.name}
                  {alt.country && <span className="t-xs dim"> · {alt.country}</span>}
                </span>
                {alt.notes && (
                  <span className="t-sm dim clamp-2" dir="auto">
                    {alt.notes}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="btn btn--sm"
                disabled={saving === alt.id}
                onClick={() => onOnRoute(alt.id, true)}
              >
                Put back on the route
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

/**
 * Naming a new stop. Nights are left undecided on purpose — the traveller
 * picks the place first and the length after, and a default would be a number
 * nobody chose appearing in their itinerary.
 */
function AddStop({
  afterId,
  onAdd,
  onCancel,
}: {
  afterId?: string
  onAdd: (name: string) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  // State lags a tap by a render, so two taps in one tick both saw `busy`
  // as false and added the stop twice. A ref is set before anything waits.
  const inFlight = useRef(false)
  const fieldRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    fieldRef.current?.focus()
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      await onAdd(trimmed)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <form className="addstop" onSubmit={submit}>
      <input
        ref={fieldRef}
        className="addstop__field"
        dir="auto"
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
      <div className="addstop__suggest">
        <StopSuggestions after={afterId} onAdd={onAdd} />
        <TravellerVoices after={afterId} />
      </div>
    </form>
  )
}

function Stop({
  stop,
  index,
  busy,
  onNights,
  onFocus,
  onSetAside,
  onRemove,
}: {
  stop: RouteStop
  index: number
  busy: boolean
  onNights: (stop: RouteStop, next: number | null) => void
  onFocus: (country: string) => void
  onSetAside: () => void
  onRemove: () => void
}) {
  const [ideas, setIdeas] = useState(false)
  // Removing is the one route edit with no undo, so it asks once, in place.
  const [confirming, setConfirming] = useState(false)
  const nights = stop.nights
  const arrive = stopDate(stop.arrive_on)
  const depart = stopDate(stop.depart_on)

  return (
    <>
    <div className={`stop${stop.destination.is_current ? ' stop--current' : ''}`}>
      <span className="stop__n" aria-hidden="true">
        {index + 1}
      </span>
      <div className="stop__main">
        <button
          className="stop__name stop__namebtn"
          dir="auto"
          onClick={() => stop.destination.country && onFocus(stop.destination.country)}
          aria-label={`Fly to ${stop.destination.name}, ${stop.destination.country ?? ''}`}
        >
          {stop.destination.name}
        </button>
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
    <div className="stop__extras">
      <button
        className="stop__ideas"
        aria-expanded={ideas}
        onClick={() => setIdeas(!ideas)}
      >
        <Lightbulb size={13} /> {ideas ? 'Hide ideas' : `Ideas for ${stop.destination.name}`}
      </button>
      <button className="stop__aside" disabled={busy} onClick={onSetAside}>
        Set aside as alternative
      </button>
      <button
        className="stop__remove"
        disabled={busy}
        aria-expanded={confirming}
        onClick={() => setConfirming((on) => !on)}
      >
        Remove
      </button>
    </div>
    {confirming && (
      <div className="stop__confirm" role="group" aria-label={`Remove ${stop.destination.name}?`}>
        <span dir="auto">Remove {stop.destination.name} from the route? Its nights go with it.</span>
        <button
          type="button"
          className="btn btn--sm btn--accent"
          disabled={busy}
          onClick={() => {
            setConfirming(false)
            onRemove()
          }}
        >
          Remove
        </button>
        <button type="button" className="btn btn--sm btn--plain" onClick={() => setConfirming(false)}>
          Keep
        </button>
      </div>
    )}
    {ideas && <StopIdeas name={stop.destination.name} />}
    </>
  )
}

/**
 * Inside one country: its cities as cards, with your sentence and your photo,
 * and the nights the route spends in each.
 */
function CountryPane({
  name,
  state,
  route,
  onBack,
  onAsk,
}: {
  name: string
  state: { data: import('../lib/types').CityBreakdown[] | null; loading: boolean; error: string | null; reload: () => void }
  route: Route | null
  onBack: () => void
  onAsk: () => void
}) {
  const nightsFor = (city: import('../lib/types').CityBreakdown) => {
    const stops = (route?.stops ?? []).filter(
      (s) =>
        s.destination.id === city.destination_id ||
        s.destination.name.toLowerCase() === city.name.toLowerCase(),
    )
    if (!stops.length || stops.some((s) => s.nights === null)) return null
    return stops.reduce((sum, s) => sum + (s.nights ?? 0), 0)
  }
  const cities = state.data ?? []
  const onRoute = cities.filter((c) => c.in_route).length

  return (
    <div className="countrypane">
      <div className="countrypane__head">
        <button className="iconbtn" onClick={onBack} aria-label="Back to the whole trip">
          <ArrowLeft size={19} />
        </button>
        <div className="grow">
          <h2 className="t-lg">{name}</h2>
          <p className="t-xs dim num">
            {cities.length} {cities.length === 1 ? 'city' : 'cities'}
            {onRoute > 0 && ` · ${onRoute} on your route`}
          </p>
        </div>
      </div>
      {state.loading && !state.data && <SkeletonRows rows={2} />}
      {state.error && <ErrorNote message={state.error} onRetry={state.reload} />}
      <CityCards cities={cities} nightsFor={nightsFor} />
      <Link className="btn btn--block" to={`/explore/${encodeURIComponent(name)}`}>
        Everything in {name}
      </Link>
      <button className="btn btn--block askroute" onClick={onAsk}>
        <Sparkles size={16} /> Ask about {name}
      </button>
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
