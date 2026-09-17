import { useEffect, useRef } from 'react'
import L from 'leaflet'

/**
 * A small, non-interactive map of the place itself.
 *
 * This is a map product, so the honest header image is the location — not
 * invented artwork. With no tile connection it degrades to a plain surface
 * showing the coordinates rather than pretending to be a photograph.
 */
export default function MiniMap({ lat, lon, label }: { lat: number; lon: number; label: string }) {
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
    }).setView([lat, lon], 15)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    L.marker([lat, lon], {
      icon: L.divIcon({
        className: '',
        html: '<div class="marker marker--active"><span class="marker__dot"></span></div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      }),
      interactive: false,
    }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [lat, lon])

  return (
    <div className="minimap">
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} role="img" aria-label={`Map showing ${label}`} />
      {/* Always visible: useful on its own, and the honest fallback when the
          tiles cannot load. */}
      <span className="minimap__coords num">
        {lat.toFixed(4)}, {lon.toFixed(4)}
      </span>
    </div>
  )
}
