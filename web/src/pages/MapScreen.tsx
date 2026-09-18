import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import L from 'leaflet'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import type { MapFeature, PlaceStatus } from '../lib/types'
import {
  Empty,
  ErrorNote,
  Freshness,
  Glyph,
  Meta,
  Pill,
  STATUS_META,
  SkeletonRows,
  StatusLabel,
} from '../components/ui'
import {
  CATEGORY_ICON,
  ChevronRight,
  Crosshair,
  Filter,
  Navigation,
  Search,
  Sparkles,
  X,
} from '../components/icons'

const STATUS_FILTERS: PlaceStatus[] = ['saved', 'must_visit', 'planned', 'visited']
const CATEGORY_FILTERS = ['attraction', 'restaurant', 'cafe', 'accommodation', 'nature', 'viewpoint']

/** Sheet snap points as a share of the viewport — the map-app pattern. */
const SNAP = { peek: 0.26, half: 0.54, full: 0.88 } as const
type Snap = keyof typeof SNAP

/** A dot with a collar, the way map apps draw a saved place. */
function pinIcon(feature: MapFeature, active: boolean): L.DivIcon {
  const { status, is_favourite: favourite, name } = feature.properties
  const meta = STATUS_META[status]
  const size = active ? 30 : 22
  const html = renderToStaticMarkup(
    <div
      className={`marker${favourite ? ' marker--fav' : ''}${active ? ' marker--active' : ''}`}
      style={{ '--pin': meta.colour } as React.CSSProperties}
    >
      <span className="marker__dot" />
    </div>,
  )
  return L.divIcon({
    className: '',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    ...({ alt: `${name} — ${meta.label}` } as object),
  })
}

/** The traveller's own saves on a familiar base map. */
export default function MapScreen() {
  const { position, location, requestLocation } = useApp()
  const [statuses, setStatuses] = useState<PlaceStatus[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [selected, setSelected] = useState<MapFeature | null>(null)
  const [snap, setSnap] = useState<Snap>('peek')
  const [query, setQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  useScreenContext({
    surface: 'map',
    tripPlaceId: selected?.properties.trip_place_id,
    label: selected?.properties.name,
  })

  const snapRef = useRef<Snap>(snap)
  snapRef.current = snap

  const params = useMemo(
    () => ({
      status: statuses.length ? statuses : undefined,
      category: categories.length ? categories : undefined,
    }),
    [statuses, categories],
  )
  const mapData = useAsync(() => api.map(params), [JSON.stringify(params)])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const meRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([14.5586, -90.7295], 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map)
    // Attribution is required. It sits bottom-right, opposite the locate
    // control and above the sheet, so nothing overlaps it.
    map.attributionControl.setPosition('bottomright').setPrefix('')
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
      meRef.current = null
    }
  }, [])

  const features = useMemo(() => {
    const all = mapData.data?.features ?? []
    if (!query.trim()) return all
    const needle = query.trim().toLowerCase()
    return all.filter((feature) => feature.properties.name.toLowerCase().includes(needle))
  }, [mapData.data, query])

  /**
   * The search bar and the sheet sit over the map, so a plain `fitBounds`
   * drops pins underneath them.
   */
  const visiblePadding = useCallback(
    (): L.FitBoundsOptions => ({
      paddingTopLeft: [24, 110],
      paddingBottomRight: [24, Math.round(window.innerHeight * SNAP[snapRef.current]) + 24],
      maxZoom: 15,
      animate: false,
    }),
    [],
  )

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return

    layer.clearLayers()
    const bounds: L.LatLngExpression[] = []
    for (const feature of features) {
      const [lon, lat] = feature.geometry.coordinates
      const active = selected?.properties.trip_place_id === feature.properties.trip_place_id
      bounds.push([lat, lon])
      L.marker([lat, lon], { icon: pinIcon(feature, active), keyboard: true, riseOnHover: true })
        .on('click', () => {
          setSelected(feature)
          setSnap('half')
          // Lift the pin above the sheet that is about to cover the lower half.
          const zoom = map.getZoom()
          const point = map.project([lat, lon], zoom)
          point.y += (window.innerHeight * SNAP.half) / 2
          map.panTo(map.unproject(point, zoom), { animate: true })
        })
        .addTo(layer)
    }
    if (bounds.length && !selected) {
      map.fitBounds(L.latLngBounds(bounds), visiblePadding())
    }
  }, [features, selected, visiblePadding])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !position) return
    meRef.current?.remove()
    meRef.current = L.marker([position.lat, position.lon], {
      icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16] }),
      interactive: false,
    }).addTo(map)
  }, [position])

  // One variable drives everything that must sit above the sheet.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--sheet-h', `${SNAP[snap] * 100}dvh`)
    root.style.setProperty('--fab-bottom', `calc(${SNAP[snap] * 100}dvh + var(--nav-h) + var(--s-3))`)
    const id = window.setTimeout(() => mapRef.current?.invalidateSize(), 340)
    return () => {
      window.clearTimeout(id)
      root.style.removeProperty('--sheet-h')
      root.style.removeProperty('--fab-bottom')
    }
  }, [snap])

  const toggle = useCallback(
    <T,>(list: T[], value: T, set: (next: T[]) => void) =>
      set(list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]),
    [],
  )

  const hasFilters = statuses.length > 0 || categories.length > 0
  const clearFilters = () => {
    setStatuses([])
    setCategories([])
  }

  return (
    <div className="map-screen">
      <div className="map-canvas" ref={containerRef} role="application" aria-label="Map of your saved places" />

      <div className="map-top">
        <div className="searchbar">
          <Search size={17} className="dimmer" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your saved places"
            aria-label="Search your saved places"
          />
          {query ? (
            <button className="icon-btn" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={17} />
            </button>
          ) : (
            <button
              className="icon-btn"
              onClick={() => setShowFilters((open) => !open)}
              aria-label="Filters"
              aria-expanded={showFilters}
              style={hasFilters ? { color: 'var(--ink)' } : undefined}
            >
              <Filter size={17} />
            </button>
          )}
        </div>

        {showFilters && (
          <div className="rail">
            {hasFilters && (
              <Pill onClick={clearFilters} Icon={X}>
                Clear
              </Pill>
            )}
            {STATUS_FILTERS.map((status) => (
              <Pill
                key={status}
                on={statuses.includes(status)}
                onClick={() => toggle(statuses, status, setStatuses)}
              >
                {STATUS_META[status].label}
              </Pill>
            ))}
            {CATEGORY_FILTERS.map((category) => (
              <Pill
                key={category}
                on={categories.includes(category)}
                onClick={() => toggle(categories, category, setCategories)}
              >
                {category}
              </Pill>
            ))}
          </div>
        )}
      </div>

      <div className="map-side">
        <button
          className="icon-btn icon-btn--raised"
          onClick={requestLocation}
          aria-label="Centre on my location"
          style={location.status === 'granted' ? { color: 'var(--accent)' } : undefined}
        >
          <Crosshair size={19} />
        </button>
      </div>

      <MapSheet
        snap={snap}
        onSnap={setSnap}
        selected={selected}
        onClearSelection={() => setSelected(null)}
        features={features}
        loading={mapData.loading && !mapData.data}
        error={mapData.error}
        onRetry={mapData.reload}
        hasFilters={hasFilters}
        onClearFilters={clearFilters}
      />
    </div>
  )
}

function MapSheet({
  snap,
  onSnap,
  selected,
  onClearSelection,
  features,
  loading,
  error,
  onRetry,
  hasFilters,
  onClearFilters,
}: {
  snap: Snap
  onSnap: (next: Snap) => void
  selected: MapFeature | null
  onClearSelection: () => void
  features: MapFeature[]
  loading: boolean
  error: string | null
  onRetry: () => void
  hasFilters: boolean
  onClearFilters: () => void
}) {
  const dragStart = useRef<number | null>(null)
  const order: Snap[] = ['peek', 'half', 'full']
  const step = (direction: 1 | -1) => {
    const index = order.indexOf(snap)
    onSnap(order[Math.min(order.length - 1, Math.max(0, index + direction))])
  }

  return (
    <section
      className="map-sheet"
      // A selected place is a short, finite card: sizing it to its content
      // avoids a half-screen of empty sheet under three lines of text.
      style={
        selected && snap !== 'full'
          ? { height: 'auto', maxHeight: '58dvh' }
          : { height: 'var(--sheet-h)' }
      }
      aria-label="Saved places"
    >
      <button
        className="map-sheet__handle"
        onPointerDown={(event) => {
          dragStart.current = event.clientY
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerUp={(event) => {
          const from = dragStart.current
          dragStart.current = null
          if (from === null) return
          const delta = from - event.clientY
          if (Math.abs(delta) < 24) step(snap === 'full' ? -1 : 1)
          else step(delta > 0 ? 1 : -1)
        }}
        aria-label={snap === 'peek' ? 'Expand list' : 'Collapse list'}
      >
        <span className="sheet__grip" style={{ margin: '0 auto var(--s-2)' }} />
        <span className="row between">
          <span className="t-md grow clamp-1">
            {selected
              ? selected.properties.name
              : `${features.length} saved place${features.length === 1 ? '' : 's'}`}
          </span>
          {selected ? (
            <span
              className="icon-btn"
              onClick={(event) => {
                event.stopPropagation()
                onClearSelection()
              }}
              aria-hidden
            >
              <X size={17} />
            </span>
          ) : (
            <span className="t-sm dimmer">{snap === 'peek' ? 'Pull up' : 'Pull down'}</span>
          )}
        </span>
      </button>

      <div className="map-sheet__body">
        {error && <ErrorNote message={error} onRetry={onRetry} />}
        {loading && <SkeletonRows rows={4} />}

        {selected ? (
          <MarkerDetail feature={selected} />
        ) : features.length === 0 && !loading ? (
          hasFilters ? (
            <Empty
              title="No places match these filters"
              body="Nothing saved fits the current combination."
              action={
                <button className="btn" onClick={onClearFilters}>
                  Clear filters
                </button>
              }
            />
          ) : (
            <Empty
              title="Your map is empty"
              body="Save a link, a screenshot or a downloaded video, confirm what it found, and the pins land here."
            />
          )
        ) : (
          <ul className="list">
            {features.map((feature) => {
              const props = feature.properties
              return (
                <li key={props.trip_place_id}>
                  <Link className="item" to={`/places/${props.trip_place_id}`}>
                    <Glyph Icon={CATEGORY_ICON[props.category] ?? CATEGORY_ICON.other} />
                    <div className="item__body">
                      <div className="row between" style={{ gap: 'var(--s-2)' }}>
                        <p className="item__title grow clamp-1">{props.name}</p>
                        <StatusLabel status={props.status} />
                      </div>
                      <Meta
                        parts={[
                          props.category,
                          `${props.source_count} source${props.source_count === 1 ? '' : 's'}`,
                        ]}
                      />
                      {props.reason_saved && (
                        <p className="t-sm dim clamp-2" style={{ marginTop: 2 }}>
                          {props.reason_saved}
                        </p>
                      )}
                    </div>
                    <ChevronRight size={18} className="dimmer" style={{ flex: 'none', marginTop: 9 }} />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

/** First tap on a marker: a compact recall card, not the full page. */
function MarkerDetail({ feature }: { feature: MapFeature }) {
  const { position, openAsk } = useApp()
  const props = feature.properties
  const detail = useAsync(
    () => api.place(props.trip_place_id, { lat: position?.lat, lon: position?.lon }),
    [props.trip_place_id, position?.lat, position?.lon],
  )
  const page = detail.data
  const hours = page?.live_information.facts.find((fact) => fact.kind === 'hours')

  return (
    <div className="pad" style={{ paddingBottom: 'var(--s-6)' }}>
      <Meta
        parts={[
          props.category,
          page?.header.city,
          page?.header.walking_minutes != null
            ? `${page.header.walking_minutes} min walk`
            : page?.header.distance_km != null && `${Math.round(page.header.distance_km)} km away`,
          `${props.source_count} source${props.source_count === 1 ? '' : 's'}`,
        ]}
      />

      {hours ? (
        <div className="row between" style={{ marginTop: 'var(--s-3)' }}>
          <p className="t-sm grow">
            <span className="dimmer">Hours </span>
            {hours.primary.value}
          </p>
          <Freshness status={hours.primary.freshness} label={hours.primary.age_label} />
        </div>
      ) : (
        <p className="t-sm dimmer" style={{ marginTop: 'var(--s-3)' }}>
          No opening hours on record — TripStash will not guess them.
        </p>
      )}

      {props.reason_saved && (
        <>
          <p className="t-xs" style={{ marginTop: 'var(--s-4)' }}>
            Why you saved it
          </p>
          <p className="t" style={{ marginTop: 4 }}>
            {props.reason_saved}
          </p>
        </>
      )}

      <div className="row" style={{ marginTop: 'var(--s-4)', gap: 'var(--s-2)' }}>
        {page && (
          <a className="btn btn--accent" href={page.actions.primary[0].url} target="_blank" rel="noreferrer">
            <Navigation size={16} strokeWidth={2.2} />
            Navigate
          </a>
        )}
        <button
          className="btn"
          onClick={() =>
            openAsk({
              surface: 'map',
              tripPlaceId: props.trip_place_id,
              question: 'Does visiting now make sense?',
              contextLabel: props.name,
            })
          }
        >
          <Sparkles size={16} strokeWidth={2.1} />
          Ask
        </button>
        <Link className="btn btn--plain" to={`/places/${props.trip_place_id}`}>
          Details
        </Link>
      </div>
    </div>
  )
}
