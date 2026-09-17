import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import L from 'leaflet'
import { Link } from 'react-router-dom'
import { AnimatePresence, animate, motion, useMotionValue, type PanInfo } from 'motion/react'
import { api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import { useMotionPrefs } from '../lib/motion'
import type { MapFeature, PlaceStatus } from '../lib/types'
import { STATUS_STAMP, Stamp, StatusStamp } from '../components/Stamp'
import {
  Empty,
  ErrorNote,
  Freshness,
  Glyph,
  Meta,
  MotionList,
  MotionRow,
  Pill,
  SkeletonRows,
  categoryTint,
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
const SNAP = { peek: 0.28, half: 0.55, full: 0.9 } as const
type Snap = keyof typeof SNAP
const SNAP_ORDER: Snap[] = ['peek', 'half', 'full']

/** OSM tiles; the colour scheme is handled in CSS on the tile pane. */
const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

const STATUS_COLOUR: Record<PlaceStatus, string> = {
  inbox: 'var(--ink-3)',
  saved: 'var(--ink)',
  must_visit: 'var(--coral)',
  planned: 'var(--teal)',
  visited: 'var(--ink-3)',
  archived: 'var(--ink-3)',
}

/** A stamp pin: a tinted ring with the category glyph inside. */
function pinIcon(feature: MapFeature, active: boolean, index = 0): L.DivIcon {
  const { status, is_favourite: favourite, name, category } = feature.properties
  const Icon = CATEGORY_ICON[category] ?? CATEGORY_ICON.other
  const size = active ? 40 : 28
  const html = renderToStaticMarkup(
    <div
      className={`pin${favourite ? ' pin--fav' : ''}${active ? ' pin--active' : ''}`}
      style={{ '--pin': STATUS_COLOUR[status], '--i': Math.min(index, 12) } as React.CSSProperties}
    >
      <Icon strokeWidth={2.6} />
    </div>,
  )
  return L.divIcon({
    className: '',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    ...({ alt: `${name} — ${STATUS_STAMP[status].label}` } as object),
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
  const { reduced, spring } = useMotionPrefs()

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
    // Attribution is required. It sits bottom-right, opposite the locate
    // control and above the sheet, so nothing overlaps it.
    map.attributionControl.setPosition('bottomright').setPrefix('')
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map)
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
      paddingTopLeft: [24, 120],
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
    features.forEach((feature, index) => {
      const [lon, lat] = feature.geometry.coordinates
      const active = selected?.properties.trip_place_id === feature.properties.trip_place_id
      bounds.push([lat, lon])
      L.marker([lat, lon], { icon: pinIcon(feature, active, index), keyboard: true, riseOnHover: true })
        .on('click', () => {
          setSelected(feature)
          setSnap('half')
          // Lift the pin above the sheet that is about to cover the lower half.
          const zoom = map.getZoom()
          const point = map.project([lat, lon], zoom)
          point.y += (window.innerHeight * SNAP.half) / 2
          map.panTo(map.unproject(point, zoom), { animate: !reduced })
        })
        .addTo(layer)
    })
    if (bounds.length && !selected) {
      map.fitBounds(L.latLngBounds(bounds), visiblePadding())
    }
  }, [features, selected, visiblePadding, reduced])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !position) return
    meRef.current?.remove()
    meRef.current = L.marker([position.lat, position.lon], {
      icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16] }),
      interactive: false,
    }).addTo(map)
  }, [position])

  useEffect(() => {
    const id = window.setTimeout(() => mapRef.current?.invalidateSize(), 360)
    return () => window.clearTimeout(id)
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
              style={hasFilters || showFilters ? { color: 'var(--ink)', background: 'var(--paper-2)' } : undefined}
            >
              <Filter size={17} />
            </button>
          )}
        </div>

        <AnimatePresence initial={false}>
          {showFilters && (
            <motion.div
              className="rail"
              initial={reduced ? false : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -8 }}
              transition={spring}
            >
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
                  Icon={STATUS_STAMP[status].Icon}
                >
                  {STATUS_STAMP[status].label}
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="map-side">
        <motion.button
          className="icon-btn icon-btn--glass"
          onClick={requestLocation}
          whileTap={{ scale: 0.92 }}
          aria-label="Centre on my location"
          style={location.status === 'granted' ? { color: 'var(--teal)' } : undefined}
        >
          <Crosshair size={19} />
        </motion.button>
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
  const { reduced, spring } = useMotionPrefs()
  const height = useMotionValue(window.innerHeight * SNAP[snap])
  const panStart = useRef(0)
  const sectionRef = useRef<HTMLElement | null>(null)
  const contentSized = Boolean(selected) && snap !== 'full'

  // One variable drives everything that must sit above the sheet — the
  // locate button, the FAB and the attribution — measured from the real
  // height, so a content-sized card and a mid-drag sheet both stay clear.
  useEffect(() => {
    const node = sectionRef.current
    if (!node) return
    const root = document.documentElement
    const apply = () => {
      const px = Math.round(node.getBoundingClientRect().height)
      root.style.setProperty('--sheet-h', `${px}px`)
      root.style.setProperty('--fab-bottom', `calc(${px}px + var(--nav-h) + var(--s-3))`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--sheet-h')
      root.style.removeProperty('--fab-bottom')
    }
  }, [])

  // The sheet follows the finger while dragging, then springs to a snap.
  useEffect(() => {
    const controls = animate(height, window.innerHeight * SNAP[snap], reduced ? { duration: 0 } : spring)
    return () => controls.stop()
  }, [snap, height, reduced, spring])

  const step = (direction: 1 | -1) => {
    const index = SNAP_ORDER.indexOf(snap)
    onSnap(SNAP_ORDER[Math.min(SNAP_ORDER.length - 1, Math.max(0, index + direction))])
  }

  const onPanStart = () => {
    panStart.current = height.get()
  }
  const onPan = (_: PointerEvent, info: PanInfo) => {
    if (contentSized) return
    const max = window.innerHeight * SNAP.full
    const min = window.innerHeight * SNAP.peek
    height.set(Math.min(max, Math.max(min, panStart.current - info.offset.y)))
  }
  const onPanEnd = (_: PointerEvent, info: PanInfo) => {
    if (contentSized) {
      // Content-sized card: a drag up opens the full page-height sheet, down collapses.
      if (Math.abs(info.offset.y) < 24) step(1)
      else step(info.offset.y < 0 ? 1 : -1)
      return
    }
    // A flick decides by direction; a slow drag decides by nearest point.
    if (Math.abs(info.velocity.y) > 600) {
      step(info.velocity.y < 0 ? 1 : -1)
      return
    }
    const current = height.get() / window.innerHeight
    const nearest = SNAP_ORDER.reduce((best, key) =>
      Math.abs(SNAP[key] - current) < Math.abs(SNAP[best] - current) ? key : best,
    )
    if (nearest === snap) animate(height, window.innerHeight * SNAP[snap], spring)
    else onSnap(nearest)
  }

  return (
    <motion.section
      ref={sectionRef}
      className={`map-sheet${contentSized ? ' map-sheet--auto' : ''}`}
      style={contentSized ? undefined : { height }}
      aria-label="Saved places"
    >
      <motion.button
        className="map-sheet__handle"
        onPanStart={onPanStart}
        onPan={onPan}
        onPanEnd={onPanEnd}
        onClick={() => step(snap === 'full' ? -1 : 1)}
        aria-label={snap === 'peek' ? 'Expand list' : 'Collapse list'}
      >
        <span className="drawer__grip" style={{ margin: '0 auto var(--s-3)' }} />
        <span className="row between">
          <span className="t-title grow clamp-1" style={{ fontSize: '1.25rem' }}>
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
            <span className="t-small dimmer">{snap === 'peek' ? 'Pull up' : 'Pull down'}</span>
          )}
        </span>
      </motion.button>

      <div className="map-sheet__body">
        {error && <ErrorNote message={error} onRetry={onRetry} />}
        {loading && <SkeletonRows rows={4} />}

        {selected ? (
          <MarkerDetail feature={selected} />
        ) : features.length === 0 && !loading ? (
          hasFilters ? (
            <Empty
              stamp="No match"
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
              stamp="Empty map"
              title="Nothing pinned yet"
              body="Save a link, a screenshot or a downloaded video, confirm what it found, and the pins land here."
            />
          )
        ) : (
          <MotionList>
            {features.map((feature, index) => {
              const props = feature.properties
              return (
                <MotionRow key={props.trip_place_id}>
                  <Link className="item" to={`/places/${props.trip_place_id}`}>
                    <Glyph
                      Icon={CATEGORY_ICON[props.category] ?? CATEGORY_ICON.other}
                      tint={categoryTint(props.category)}
                    />
                    <div className="item__body">
                      <div className="row between row--top" style={{ gap: 'var(--s-2)' }}>
                        <p className="item__title grow clamp-1">{props.name}</p>
                        <StatusStamp status={props.status} rotate={index % 2 ? 4 : -6} />
                      </div>
                      <Meta
                        parts={[
                          props.category,
                          `${props.source_count} source${props.source_count === 1 ? '' : 's'}`,
                        ]}
                      />
                      {props.reason_saved && (
                        <p className="t-small dim clamp-2" style={{ marginTop: 4 }}>
                          {props.reason_saved}
                        </p>
                      )}
                    </div>
                    <ChevronRight size={18} className="item__chev" />
                  </Link>
                </MotionRow>
              )
            })}
          </MotionList>
        )}
      </div>
    </motion.section>
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
      <div className="row between">
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
        <StatusStamp status={props.status} rotate={-6} />
      </div>

      {hours ? (
        <div className="row between" style={{ marginTop: 'var(--s-3)' }}>
          <p className="t-small grow">
            <span className="dimmer">Hours </span>
            {hours.primary.value}
          </p>
          <Freshness status={hours.primary.freshness} label={hours.primary.age_label} />
        </div>
      ) : (
        <p className="t-small dimmer" style={{ marginTop: 'var(--s-3)' }}>
          No opening hours on record — TripStash will not guess them.
        </p>
      )}

      {props.reason_saved && (
        <blockquote className="quote" style={{ marginTop: 'var(--s-4)' }}>
          {props.reason_saved}
        </blockquote>
      )}

      <div className="row" style={{ marginTop: 'var(--s-4)', gap: 'var(--s-2)' }}>
        {page && (
          <a className="btn btn--ink grow" href={page.actions.primary[0].url} target="_blank" rel="noreferrer">
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
        <Link className="btn btn--ghost" to={`/places/${props.trip_place_id}`}>
          Details
        </Link>
      </div>
      {props.is_favourite && (
        <div style={{ marginTop: 'var(--s-3)' }}>
          <Stamp tone="gold" size="sm" rotate={-4}>
            Favourite
          </Stamp>
        </div>
      )}
    </div>
  )
}
