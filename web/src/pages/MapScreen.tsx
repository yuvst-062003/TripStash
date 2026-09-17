import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import L from 'leaflet'
import { Link } from 'react-router-dom'
import { AnimatePresence, animate, motion, useMotionValue, type PanInfo } from 'motion/react'
import { api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { addTintPane } from '../lib/mapTint'
import { useAsync } from '../lib/hooks'
import { useMotionPrefs } from '../lib/motion'
import type { MapFeature, PlaceStatus } from '../lib/types'
import { STATUS_STAMP, Stamp, StatusStamp } from '../components/Stamp'
import {
  CATEGORY_LABEL,
  CacheNote,
  Empty,
  ErrorNote,
  Freshness,
  Glyph,
  Meta,
  MotionList,
  MotionRow,
  Note,
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
/** A selected place's card sizes to its content, up to this share of the viewport. */
const CARD_MAX = 0.6

/** OSM tiles; the colour scheme is handled in CSS on the tile pane and a tint pane. */
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

/** Pins closer than this on screen become one cluster pin. */
const CLUSTER_PX = 30
const PIN = 44

/**
 * A stamp pin inside a 44px hit area. Status is a badge icon, not just a
 * hue; must-visit is a filled coral disc so it reads by weight.
 */
function pinIcon(feature: MapFeature, enter: boolean, index = 0): L.DivIcon {
  const { status, is_favourite: favourite, category } = feature.properties
  const Icon = CATEGORY_ICON[category] ?? CATEGORY_ICON.other
  const StatusIcon = STATUS_STAMP[status].Icon
  const classes = ['pin']
  if (favourite) classes.push('pin--fav')
  if (status === 'must_visit') classes.push('pin--must')
  if (enter) classes.push('pin--enter')
  const html = renderToStaticMarkup(
    <div className="pin-hit">
      <div
        className={classes.join(' ')}
        style={{ '--pin': STATUS_COLOUR[status], '--i': Math.min(index, 12) } as React.CSSProperties}
      >
        <Icon strokeWidth={2.6} />
        {status !== 'saved' && (
          <span className="pin__badge">
            <StatusIcon strokeWidth={3} />
          </span>
        )}
      </div>
    </div>,
  )
  return L.divIcon({ className: '', html, iconSize: [PIN, PIN], iconAnchor: [PIN / 2, PIN / 2] })
}

function clusterIcon(count: number): L.DivIcon {
  const html = renderToStaticMarkup(
    <div className="pin-hit">
      <div className="pin pin--cluster">{count}</div>
    </div>,
  )
  return L.divIcon({ className: '', html, iconSize: [PIN, PIN], iconAnchor: [PIN / 2, PIN / 2] })
}

/** The traveller's own saves on a familiar base map. */
export default function MapScreen() {
  const { position, location, requestLocation, trip, openSave } = useApp()
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
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const clustersRef = useRef<L.LayerGroup | null>(null)
  const meRef = useRef<L.Marker | null>(null)
  const drawnOnce = useRef(false)
  const fittedIds = useRef('')
  const featuresRef = useRef<MapFeature[]>([])
  /** The sheet's current height in px, for fit padding. */
  const sheetPx = useRef(window.innerHeight * SNAP.peek)
  const selectRef = useRef<(feature: MapFeature) => void>(() => {})
  /** Where the list was before a pin was tapped, so closing the card goes back there. */
  const snapBefore = useRef<Snap>('peek')

  const all = mapData.data?.features ?? []
  const features = useMemo(() => {
    if (!query.trim()) return all
    const needle = query.trim().toLowerCase()
    return all.filter((feature) => feature.properties.name.toLowerCase().includes(needle))
  }, [all, query])
  featuresRef.current = features

  /**
   * Pins that would overlap on screen become one cluster pin; tapping it
   * zooms to just those places. Re-run after every zoom and data change.
   */
  const layoutPins = useCallback(() => {
    const map = mapRef.current
    const clusters = clustersRef.current
    if (!map || !clusters) return
    clusters.clearLayers()
    const pending = featuresRef.current.filter((f) => markersRef.current.has(f.properties.trip_place_id))
    const placed: { point: L.Point; members: MapFeature[] }[] = []
    for (const feature of pending) {
      const [lon, lat] = feature.geometry.coordinates
      const point = map.latLngToLayerPoint([lat, lon])
      const near = placed.find((group) => group.point.distanceTo(point) < CLUSTER_PX)
      if (near) near.members.push(feature)
      else placed.push({ point, members: [feature] })
    }
    for (const group of placed) {
      const single = group.members.length === 1
      for (const member of group.members) {
        const marker = markersRef.current.get(member.properties.trip_place_id)
        if (!marker) continue
        if (single) {
          if (!map.hasLayer(marker)) marker.addTo(map)
        } else if (map.hasLayer(marker)) {
          marker.remove()
        }
      }
      if (!single) {
        const bounds = L.latLngBounds(
          group.members.map((m) => [m.geometry.coordinates[1], m.geometry.coordinates[0]] as [number, number]),
        )
        L.marker(bounds.getCenter(), { icon: clusterIcon(group.members.length), keyboard: true })
          .on('click', () => map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17, animate: !reduced }))
          .on('add', (event) => {
            const element = (event.target as L.Marker).getElement()
            element?.setAttribute('aria-label', `${group.members.length} places here — tap to zoom in`)
          })
          .addTo(clusters)
      }
    }
  }, [reduced])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    // Nothing is invented: the first view is where you are, else the current
    // stop, else the first stop with a pin, else the world.
    const stop = trip?.destinations.find((d) => d.is_current && d.lat != null) ?? trip?.destinations.find((d) => d.lat != null)
    const first: [number, number] | null = position
      ? [position.lat, position.lon]
      : stop?.lat != null && stop.lon != null
        ? [stop.lat, stop.lon]
        : null
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView(first ?? [20, 0], first ? 11 : 2)
    // Attribution is required. It sits bottom-right, opposite the locate
    // control and above the sheet, so nothing overlaps it.
    map.attributionControl.setPosition('bottomright').setPrefix('')
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map)
    addTintPane(map)
    clustersRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    map.on('zoomend', () => layoutPins())
    return () => {
      map.remove()
      mapRef.current = null
      clustersRef.current = null
      markersRef.current.clear()
      meRef.current = null
    }
  }, [layoutPins])

  /**
   * The search bar and the sheet sit over the map, so a plain `fitBounds`
   * drops pins underneath them.
   */
  const visiblePadding = useCallback(
    (): L.FitBoundsOptions => ({
      paddingTopLeft: [24, 120],
      paddingBottomRight: [24, Math.round(sheetPx.current) + 24],
      maxZoom: 15,
      animate: drawnOnce.current && !reduced,
      duration: 0.35,
    }),
    [reduced],
  )

  // Markers are kept by id: a tap, a filter or a keystroke adds and removes
  // only what changed, so pins never re-mount and the drop-in plays once.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const wanted = new Set(features.map((f) => f.properties.trip_place_id))
    for (const [id, marker] of markersRef.current) {
      if (!wanted.has(id)) {
        marker.remove()
        markersRef.current.delete(id)
      }
    }
    let added = 0
    const enter = !drawnOnce.current
    for (const feature of features) {
      const id = feature.properties.trip_place_id
      if (markersRef.current.has(id)) continue
      const [lon, lat] = feature.geometry.coordinates
      const marker = L.marker([lat, lon], {
        icon: pinIcon(feature, enter, added),
        keyboard: true,
        riseOnHover: true,
      })
        .on('click', () => selectRef.current(feature))
        .on('add', (event) => {
          const element = (event.target as L.Marker).getElement()
          element?.setAttribute(
            'aria-label',
            `${feature.properties.name} — ${STATUS_STAMP[feature.properties.status].label}`,
          )
        })
      markersRef.current.set(id, marker)
      added += 1
    }
    if (enter) {
      // Drop-in classes are only for the first draw; strip them once played.
      window.setTimeout(() => {
        for (const marker of markersRef.current.values()) {
          marker.getElement()?.querySelector('.pin--enter')?.classList.remove('pin--enter')
        }
      }, 1000)
    }
    layoutPins()
    const ids = features.map((f) => f.properties.trip_place_id).sort().join(',')
    if (features.length && ids !== fittedIds.current && !selected) {
      fittedIds.current = ids
      map.fitBounds(
        L.latLngBounds(
          features.map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]] as [number, number]),
        ),
        visiblePadding(),
      )
    }
    drawnOnce.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features])

  // Selection only touches the two pins involved.
  useEffect(() => {
    for (const [id, marker] of markersRef.current) {
      const pin = marker.getElement()?.querySelector('.pin')
      const active = id === selected?.properties.trip_place_id
      pin?.classList.toggle('pin--active', active)
      marker.setZIndexOffset(active ? 1000 : 0)
    }
  }, [selected])

  const select = useCallback(
    (feature: MapFeature) => {
      const map = mapRef.current
      if (!map) return
      setSelected((current) => {
        if (!current) snapBefore.current = snap
        return feature
      })
      setSnap('half')
      // Lift the pin above the card that is about to cover the lower part.
      const [lon, lat] = feature.geometry.coordinates
      const zoom = map.getZoom()
      const point = map.project([lat, lon], zoom)
      point.y += Math.min(window.innerHeight * CARD_MAX, 360) / 2
      map.panTo(map.unproject(point, zoom), { animate: !reduced })
    },
    [reduced, snap],
  )
  selectRef.current = select
  const clearSelection = () => {
    setSelected(null)
    setSnap(snapBefore.current)
  }

  // Your position: a dot, and the map goes to it when you ask.
  const wantCentre = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !position) return
    meRef.current?.remove()
    meRef.current = L.marker([position.lat, position.lon], {
      icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16] }),
      interactive: false,
    }).addTo(map)
    if (wantCentre.current) {
      wantCentre.current = false
      map.flyTo([position.lat, position.lon], Math.max(map.getZoom(), 15), {
        animate: !reduced,
        duration: 0.6,
      })
    }
  }, [position, reduced])
  const locate = () => {
    const map = mapRef.current
    if (location.status === 'granted' && position && map) {
      map.flyTo([position.lat, position.lon], Math.max(map.getZoom(), 15), {
        animate: !reduced,
        duration: 0.6,
      })
      return
    }
    wantCentre.current = true
    requestLocation()
  }

  const toggle = useCallback(
    <T,>(list: T[], value: T, set: (next: T[]) => void) =>
      set(list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]),
    [],
  )

  const hasFilters = statuses.length > 0 || categories.length > 0
  const searching = query.trim() !== ''
  const clearFilters = () => {
    setStatuses([])
    setCategories([])
  }
  const onHeight = useCallback((px: number) => {
    sheetPx.current = px
  }, [])

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
              exit={reduced ? undefined : { opacity: 0, y: -6, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } }}
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
                  {CATEGORY_LABEL[category] ?? category}
                </Pill>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {location.status === 'denied' && (
          <div className="pad">
            <div className="banner banner--warn" style={{ boxShadow: 'var(--shadow-float)' }}>
              <Crosshair size={15} strokeWidth={2.2} />
              <div className="grow">
                {location.message === 'Location was refused.'
                  ? 'Location off — distances and walking times stay hidden until you allow it.'
                  : location.message}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="map-side">
        <motion.button
          className="icon-btn icon-btn--glass"
          onClick={locate}
          whileTap={{ scale: 0.96 }}
          aria-label="Centre on my location"
          aria-busy={location.status === 'locating'}
          style={location.status === 'granted' ? { color: 'var(--teal)' } : undefined}
        >
          <Crosshair size={19} className={location.status === 'locating' ? 'spin' : undefined} />
        </motion.button>
      </div>

      <MapSheet
        snap={snap}
        onSnap={setSnap}
        selected={selected}
        onSelect={select}
        onClearSelection={clearSelection}
        features={features}
        total={all.length}
        query={query}
        loading={mapData.loading && !mapData.data}
        error={mapData.error}
        fromCache={mapData.fromCache}
        onRetry={mapData.reload}
        hasFilters={hasFilters}
        searching={searching}
        onClearFilters={clearFilters}
        onClearSearch={() => setQuery('')}
        onHeight={onHeight}
        onSave={openSave}
        tripName={trip?.name}
      />
    </div>
  )
}

function MapSheet({
  snap,
  onSnap,
  selected,
  onSelect,
  onClearSelection,
  features,
  total,
  query,
  loading,
  error,
  fromCache,
  onRetry,
  hasFilters,
  searching,
  onClearFilters,
  onClearSearch,
  onSave,
  tripName,
  onHeight,
}: {
  snap: Snap
  onSnap: (next: Snap) => void
  selected: MapFeature | null
  onSelect: (feature: MapFeature) => void
  onClearSelection: () => void
  features: MapFeature[]
  total: number
  query: string
  loading: boolean
  error: string | null
  fromCache: boolean
  onRetry: () => void
  hasFilters: boolean
  searching: boolean
  onClearFilters: () => void
  onClearSearch: () => void
  onSave: () => void
  tripName?: string
  onHeight: (px: number) => void
}) {
  const { reduced, spring } = useMotionPrefs()
  const height = useMotionValue(window.innerHeight * SNAP[snap])
  const panStart = useRef(0)
  const sectionRef = useRef<HTMLElement | null>(null)
  const topRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [contentPx, setContentPx] = useState(0)
  // A selected card and a fresh account's empty state are both content-sized.
  const nothingYet = total === 0 && !loading && !error && !searching && !hasFilters
  const contentSized = (Boolean(selected) || nothingYet) && snap !== 'full'

  // A selected place's card is as tall as its content (measured live) up to
  // CARD_MAX; the list uses the snap points. One motion value drives both.
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const measure = () => setContentPx(body.scrollHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    for (const child of Array.from(body.children)) observer.observe(child)
    return () => observer.disconnect()
  }, [selected])

  const target = contentSized
    ? Math.min((topRef.current?.offsetHeight ?? 64) + contentPx, window.innerHeight * CARD_MAX)
    : window.innerHeight * SNAP[snap]

  useEffect(() => {
    const root = document.documentElement
    root.toggleAttribute('data-sheet-live', true)
    const controls = animate(height, target, reduced ? { duration: 0 } : spring)
    controls.then(() => root.toggleAttribute('data-sheet-live', false))
    return () => controls.stop()
  }, [target, height, reduced, spring])

  // One variable drives everything that must sit above the sheet — the
  // locate button, the FAB and the attribution — from the real height.
  useEffect(() => {
    const node = sectionRef.current
    if (!node) return
    const root = document.documentElement
    const apply = () => {
      const px = Math.round(node.getBoundingClientRect().height)
      root.style.setProperty('--sheet-h', `${px}px`)
      root.style.setProperty('--fab-lift', `${px}px`)
      onHeight(px)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--sheet-h')
      root.style.removeProperty('--fab-lift')
      root.toggleAttribute('data-sheet-live', false)
    }
  }, [onHeight])

  const step = (direction: 1 | -1) => {
    const index = SNAP_ORDER.indexOf(snap)
    onSnap(SNAP_ORDER[Math.min(SNAP_ORDER.length - 1, Math.max(0, index + direction))])
  }

  const onPanStart = () => {
    panStart.current = height.get()
    document.documentElement.toggleAttribute('data-sheet-live', true)
  }
  const onPan = (_: PointerEvent, info: PanInfo) => {
    if (contentSized) return
    const max = window.innerHeight * SNAP.full
    const min = window.innerHeight * SNAP.peek
    height.set(Math.min(max, Math.max(min, panStart.current - info.offset.y)))
  }
  const onPanEnd = (_: PointerEvent, info: PanInfo) => {
    if (contentSized) {
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
    if (nearest === snap) {
      animate(height, window.innerHeight * SNAP[snap], spring).then(() =>
        document.documentElement.toggleAttribute('data-sheet-live', false),
      )
    } else {
      onSnap(nearest)
    }
  }

  const title = selected
    ? selected.properties.name
    : loading
      ? 'Loading your places…'
      : searching || hasFilters
        ? `${features.length} of ${total} match`
        : total === 0
          ? (tripName ?? 'Saved places')
          : `${features.length} saved place${features.length === 1 ? '' : 's'}`

  return (
    <motion.section ref={sectionRef} className="map-sheet" style={{ height }} aria-label="Saved places">
      <div className="map-sheet__top" ref={topRef}>
        <motion.button
          className="map-sheet__handle"
          onPanStart={onPanStart}
          onPan={onPan}
          onPanEnd={onPanEnd}
          onClick={() => step(snap === 'full' ? -1 : 1)}
          aria-label={snap === 'full' ? 'Collapse list' : 'Expand list'}
        >
          <span className="drawer__grip" />
          <span className="drawer__title clamp-1">{title}</span>
        </motion.button>
        {selected && (
          <button className="icon-btn map-sheet__close" onClick={onClearSelection} aria-label="Back to the list">
            <X size={18} />
          </button>
        )}
      </div>

      <div className="map-sheet__body" ref={bodyRef}>
        <CacheNote visible={fromCache} />
        {error && <ErrorNote message={error} onRetry={onRetry} />}
        {loading && <SkeletonRows rows={4} />}

        {selected ? (
          <MarkerDetail feature={selected} />
        ) : features.length === 0 && !loading && !error ? (
          searching ? (
            <Empty
              title={`Nothing saved matches "${query.trim()}"`}
              body={`${total} place${total === 1 ? '' : 's'} on your map. Try part of the name.`}
              action={
                <button className="btn" onClick={onClearSearch}>
                  Clear search
                </button>
              }
            />
          ) : hasFilters ? (
            <Empty
              title="No places match these filters"
              body={`${total} place${total === 1 ? '' : 's'} on your map, none in this combination.`}
              action={
                <button className="btn" onClick={onClearFilters}>
                  Clear filters
                </button>
              }
            />
          ) : (
            <Empty
              title="No pins yet"
              body="Save something, confirm it in Inbox, and the pin lands here."
              action={
                <button className="btn btn--ink" onClick={onSave}>
                  Save something
                </button>
              }
            />
          )
        ) : (
          <MotionList>
            {features.map((feature, index) => {
              const props = feature.properties
              return (
                <MotionRow key={props.trip_place_id}>
                  <button className="item" onClick={() => onSelect(feature)}>
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
                          CATEGORY_LABEL[props.category] ?? props.category,
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
                  </button>
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
      <CacheNote visible={detail.fromCache} />
      <div className="row between">
        <Meta
          parts={[
            CATEGORY_LABEL[props.category] ?? props.category,
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
        <div className="row between row--top" style={{ marginTop: 'var(--s-3)' }}>
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
        {page ? (
          <a className="btn btn--ink grow" href={page.actions.primary[0].url} target="_blank" rel="noreferrer">
            <Navigation size={16} strokeWidth={2.2} />
            Navigate
          </a>
        ) : (
          <span className="btn btn--ink grow" aria-busy>
            <Navigation size={16} strokeWidth={2.2} />
            Navigate
          </span>
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
      {detail.error && (
        <div style={{ marginTop: 'var(--s-3)' }}>
          <Note tone="danger">{detail.error}</Note>
        </div>
      )}
    </div>
  )
}
