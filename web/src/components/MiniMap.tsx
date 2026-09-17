import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { renderToStaticMarkup } from 'react-dom/server'
import { addTintPane } from '../lib/mapTint'
import { CATEGORY_ICON } from './icons'

/**
 * A small, non-interactive map of the place itself.
 *
 * This is a map product, so the honest header image is the location — not
 * invented artwork. With no tile connection it degrades to a plain surface
 * showing the coordinates rather than pretending to be a photograph.
 */
export default function MiniMap({
  lat,
  lon,
  label,
  category,
  zoom = 15,
  fill,
}: {
  lat: number
  lon: number
  label: string
  category?: string
  zoom?: number
  fill?: boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!ref.current || mapRef.current) return
    const map = L.map(ref.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      keyboard: false,
    }).setView([lat, lon], zoom)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    addTintPane(map)
    const Icon = CATEGORY_ICON[category ?? 'other'] ?? CATEGORY_ICON.other
    L.marker([lat, lon], {
      icon: L.divIcon({
        className: '',
        html: renderToStaticMarkup(
          <div className="pin pin--active" style={{ '--pin': 'var(--ink)' } as React.CSSProperties}>
            <Icon strokeWidth={2.6} />
          </div>,
        ),
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      }),
      interactive: false,
    }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [lat, lon, zoom, category])

  return (
    <div className={fill ? undefined : 'minimap'} style={fill ? { position: 'absolute', inset: 0 } : undefined}>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} role="img" aria-label={`Map showing ${label}`} />
      {!fill && (
        // Always visible: useful on its own, and the honest fallback when the
        // tiles cannot load.
        <span className="hero-map__coords num">
          {lat.toFixed(4)}, {lon.toFixed(4)}
        </span>
      )}
    </div>
  )
}
