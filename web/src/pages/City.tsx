/**
 * A city: your pins on it, the clips you saved there, and what is good to know.
 *
 * The clips rail leads, because it is the row no guidebook can show — your own
 * video, opening at the second the claim came from. Below it the map, which
 * needs filters once a city holds more than a handful of pins, and a route mode
 * that hides everything that is not yours and numbers the rest in walking
 * order. That is the bridge from a map of saved pins to an itinerary.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import L from 'leaflet'
import { api } from '../lib/api'
import { useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import type { KnowledgeItem, MapFeature, ReelSpot } from '../lib/types'
import { loadCountries } from '../lib/basemap'
import { ErrorNote, Note, SkeletonRows } from '../components/ui'
import TopBar from '../components/TopBar'
import {
  ArrowLeft,
  CATEGORY_ICON,
  ChevronRight,
  Film,
  KNOWLEDGE_ICON,
  MapPin,
  Play,
  Route as RouteIcon,
} from '../components/icons'
import { haversineKm, walkingMinutesIfWalkable } from '../lib/distance'

/** The chips over the map. Category groups, because "Food" is what people mean. */
const FILTERS: { key: string; label: string; categories: string[] | null; mineOnly?: boolean }[] = [
  { key: 'all', label: 'All', categories: null },
  { key: 'mine', label: 'Mine', categories: null, mineOnly: true },
  { key: 'food', label: 'Food', categories: ['restaurant', 'cafe', 'bar'] },
  { key: 'stay', label: 'Stay', categories: ['accommodation'] },
  { key: 'views', label: 'Views', categories: ['viewpoint', 'nature', 'attraction'] },
]

export default function City() {
  const { city = '' } = useParams()
  const name = decodeURIComponent(city)
  useScreenContext({ surface: 'map', label: name })

  const [filter, setFilter] = useState('all')
  const [routeMode, setRouteMode] = useState(false)
  const [tilesFailed, setTilesFailed] = useState(false)

  const places = useAsync(() => api.map({ city: name }), [name])
  const clips = useAsync(() => api.reelSpots({ scope: name }), [name])
  const knowledge = useAsync(() => api.knowledge({ destination_scope: name }), [name])

  const features = useMemo(() => places.data?.features ?? [], [places.data])

  const shown = useMemo(() => {
    const chosen = FILTERS.find((f) => f.key === filter) ?? FILTERS[0]
    let rows = features
    if (chosen.categories) {
      rows = rows.filter((f) => chosen.categories!.includes(f.properties.category))
    }
    if (chosen.mineOnly) {
      // Everything on this map is already yours; "Mine" narrows to the ones
      // you committed to rather than the ones you merely kept.
      rows = rows.filter((f) =>
        ['must_visit', 'planned', 'visited'].includes(f.properties.status),
      )
    }
    return rows
  }, [features, filter])

  /**
   * Route mode numbers your pins in walking order. Nearest-neighbour from the
   * first pin: not the shortest possible tour, and it does not claim to be —
   * the label says "a walking order", and the distance beside it is measured,
   * not guessed.
   */
  const ordered = useMemo(() => {
    if (!routeMode || shown.length < 2) return shown
    const remaining = [...shown]
    const path = [remaining.shift()!]
    while (remaining.length) {
      const last = path[path.length - 1]
      const [lon, lat] = last.geometry.coordinates
      let bestIndex = 0
      let bestDistance = Infinity
      remaining.forEach((candidate, index) => {
        const [cLon, cLat] = candidate.geometry.coordinates
        const distance = haversineKm(lat, lon, cLat, cLon)
        if (distance < bestDistance) {
          bestDistance = distance
          bestIndex = index
        }
      })
      path.push(remaining.splice(bestIndex, 1)[0])
    }
    return path
  }, [routeMode, shown])

  const totalKm = useMemo(() => {
    if (!routeMode || ordered.length < 2) return 0
    let sum = 0
    for (let i = 1; i < ordered.length; i += 1) {
      const [aLon, aLat] = ordered[i - 1].geometry.coordinates
      const [bLon, bLat] = ordered[i].geometry.coordinates
      sum += haversineKm(aLat, aLon, bLat, bLon)
    }
    return sum
  }, [routeMode, ordered])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([0, 0], 2)
    map.createPane('basemap')
    const pane = map.getPane('basemap')
    if (pane) pane.style.zIndex = '150'
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 })
    // At street zoom the carried basemap has no detail to offer, so unlike the
    // trip map this really is a reduced view and says so rather than pretending.
    tiles.on('tileerror', () => setTilesFailed(true))
    tiles.addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    const resize = () => map.invalidateSize({ animate: false })
    requestAnimationFrame(resize)
    window.addEventListener('resize', resize)
    // The carried ground, so the city still sits on real geography offline.
    loadCountries('regional').then((geometry) => {
      if (!mapRef.current) return
      const read = (token: string) =>
        getComputedStyle(document.documentElement).getPropertyValue(token).trim()
      L.geoJSON(geometry, {
        pane: 'basemap',
        interactive: false,
        style: {
          fillColor: read('--map-land') || '#10233a',
          fillOpacity: 1,
          color: read('--map-land-line') || '#27405e',
          weight: 0.6,
        },
      }).addTo(mapRef.current)
    })
    return () => {
      window.removeEventListener('resize', resize)
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  const draw = useCallback(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const rows = routeMode ? ordered : shown
    if (!rows.length) return

    const points = rows.map(
      (f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]] as [number, number],
    )

    if (routeMode && points.length > 1) {
      L.polyline(points, {
        color:
          getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() ||
          '#0e7c5a',
        weight: 2.5,
        opacity: 0.9,
        interactive: false,
      }).addTo(layer)
    }

    rows.forEach((feature, index) => {
      const marker = L.marker(points[index], {
        icon: L.divIcon({
          className: '',
          html: routeMode
            ? `<div class="stoppin">${index + 1}</div>`
            : `<div class="citypin citypin--${feature.properties.status}"></div>`,
          iconSize: routeMode ? [30, 30] : [18, 18],
          iconAnchor: routeMode ? [15, 15] : [9, 9],
        }),
        title: feature.properties.name,
      })
      marker.bindTooltip(feature.properties.name)
      marker.addTo(layer)
    })

    map.fitBounds(L.latLngBounds(points).pad(0.25), {
      paddingTopLeft: [28, 90],
      paddingBottomRight: [28, 40],
      maxZoom: 15,
      animate: false,
    })
  }, [shown, ordered, routeMode])

  useEffect(draw, [draw])

  const spots: ReelSpot[] = clips.data ?? []
  const playable = spots.filter((spot) => spot.playable_count > 0)
  const items: KnowledgeItem[] = (knowledge.data ?? []) as KnowledgeItem[]

  return (
    <div className="screen">
      <TopBar
        title={name}
        leading={
          <Link className="iconbtn" to="/explore" aria-label="Back">
            <ArrowLeft size={19} />
          </Link>
        }
      />

      {/* The clips rail leads: no guidebook can show you your own video. */}
      {playable.length > 0 && (
        <section className="rail">
          <div className="rail__head pad">
            <h2 className="t-md">Your clips here</h2>
            <Link className="t-sm" to={`/clips/feed?scope=${encodeURIComponent(name)}`}>
              Open feed
            </Link>
          </div>
          <div className="rail__track">
            {playable.map((spot) => (
              <Link
                key={spot.trip_place_id}
                className="clipcard"
                to={`/clips/feed?spot=${spot.trip_place_id}`}
              >
                <span className="clipcard__play">
                  <Play size={16} />
                </span>
                <span className="clipcard__name clamp-2">{spot.name}</span>
                <span className="clipcard__count num">
                  <Film size={12} /> {spot.playable_count}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="citymap">
        <div className="citymap__canvas" ref={containerRef} aria-hidden="true" />
        <div className="citymap__chips">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              className="chip-glass"
              aria-pressed={filter === key}
              onClick={() => {
                setFilter(key)
                setRouteMode(false)
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {tilesFailed && (
          <p className="citymap__offline">Streets need a connection — your pins are all here</p>
        )}
        <button
          className="chip-glass citymap__route"
          aria-pressed={routeMode}
          onClick={() => setRouteMode((on) => !on)}
        >
          <RouteIcon size={14} />
          Route
        </button>
        {routeMode && ordered.length > 1 && <RouteSummary stops={ordered.length} km={totalKm} />}
      </div>

      <div className="pad">
        {places.loading && !places.data && <SkeletonRows rows={4} />}
        {places.error && !places.data && (
          <ErrorNote message={places.error} onRetry={places.reload} />
        )}
        {places.data && !shown.length && (
          <Note tone="neutral" Icon={MapPin}>
            {features.length
              ? 'Nothing here matches that filter.'
              : `Nothing saved in ${name} yet.`}
          </Note>
        )}

        <div className="stack-2" style={{ marginTop: 'var(--s-3)' }}>
          {(routeMode ? ordered : shown).map((feature, index) => (
            <PlaceRow key={feature.properties.trip_place_id} feature={feature} index={routeMode ? index : null} />
          ))}
        </div>

        {items.length > 0 && (
          <section style={{ marginTop: 'var(--s-6)' }}>
            <h2 className="t-md">Good to know</h2>
            <div className="stack-2" style={{ marginTop: 'var(--s-3)' }}>
              {items.slice(0, 4).map((item) => {
                const Icon = KNOWLEDGE_ICON[item.type] ?? MapPin
                return (
                  <div key={item.id} className="knowrow">
                    <Icon size={16} />
                    <div className="grow">
                      <div className="t-md">{item.title}</div>
                      <p className="t-sm dim clamp-2">{item.body}</p>
                      {/* Where it came from travels with it, always. */}
                      <p className="knowrow__source">
                        {item.provenance}
                        {item.source_date && ` · ${item.source_date}`}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

/**
 * What route mode actually claims. The order is nearest-neighbour from the
 * first pin, which is a walking order and not the shortest possible one, so
 * it says "a walking order". And past the point where walking stops being a
 * real option, it reports the distance and drops the minutes rather than
 * dressing a four-hour march up as a plan for the afternoon.
 */
function RouteSummary({ stops, km }: { stops: number; km: number }) {
  const minutes = walkingMinutesIfWalkable(km)
  return (
    <p className="citymap__summary num">
      {stops} stops · {km.toFixed(1)} km
      {minutes === null ? (
        <> · too far to walk</>
      ) : (
        <>
          {' '}
          · about {minutes} min, a walking order
          <span className="leg__estimate">estimate</span>
        </>
      )}
    </p>
  )
}

function PlaceRow({ feature, index }: { feature: MapFeature; index: number | null }) {
  const Icon = CATEGORY_ICON[feature.properties.category] ?? MapPin
  return (
    <Link className="scope" to={`/places/${feature.properties.trip_place_id}`}>
      {index === null ? (
        <Icon size={18} />
      ) : (
        <span className="stop__n" aria-hidden="true">
          {index + 1}
        </span>
      )}
      <span className="scope__main">
        <span className="scope__name">{feature.properties.name}</span>
        {feature.properties.reason_saved && (
          <span className="scope__counts clamp-1">{feature.properties.reason_saved}</span>
        )}
      </span>
      <ChevronRight size={18} />
    </Link>
  )
}
