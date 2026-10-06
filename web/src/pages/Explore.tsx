/**
 * Explore: the same map, further away.
 *
 * The trip screen's map zoomed out until the stops become countries. That is
 * the whole idea — discovery is a continuation of planning rather than a
 * separate place — so this reuses the vector ground the trip map draws on and
 * changes only the distance.
 *
 * Countries carrying something of yours are filled; the ones your route
 * already passes through are ringed and marked, so the two readings of one map
 * stay visibly joined.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import { api } from '../lib/api'
import { useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import type { Scope } from '../lib/types'
import { type CountryFeature, loadCountries, matchesCountry } from '../lib/basemap'
import { ErrorNote, Note, SkeletonRows } from '../components/ui'
import { ChevronRight, Film, MapPin, Route as RouteIcon } from '../components/icons'

const WORLD_VIEW: [number, number] = [10, -30]

export default function Explore() {
  useScreenContext({ surface: 'map' })
  const navigate = useNavigate()
  const countries = useAsync(() => api.exploreCountries(), [])
  const [focused, setFocused] = useState<string | null>(null)

  const scopes = useMemo(() => countries.data ?? [], [countries.data])
  const byName = useMemo(() => {
    const index = new Map<string, Scope>()
    for (const scope of scopes) index.set(scope.name.toLowerCase(), scope)
    return index
  }, [scopes])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const landRef = useRef<L.GeoJSON | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
      worldCopyJump: true,
      minZoom: 1,
    }).setView(WORLD_VIEW, 2)
    mapRef.current = map
    const resize = () => map.invalidateSize({ animate: false })
    requestAnimationFrame(resize)
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      map.remove()
      mapRef.current = null
      landRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    // The world outline is the small file; nobody needs 1:50m to pick a country.
    loadCountries('world').then((geometry) => {
      const map = mapRef.current
      if (cancelled || !map) return
      landRef.current?.remove()

      const read = (token: string) =>
        getComputedStyle(document.documentElement).getPropertyValue(token).trim()

      landRef.current = L.geoJSON(geometry, {
        style: (featureIn) => {
          const scope = scopeFor(featureIn as CountryFeature, scopes)
          if (!scope) {
            return {
              fillColor: read('--globe-land') || '#16293f',
              fillOpacity: 1,
              color: read('--globe-land-line') || '#35537a',
              weight: 0.5,
            }
          }
          // Yours, and whether the route already goes there. Fill and stroke
          // weight carry it as well as colour does.
          return {
            fillColor: read(scope.on_route ? '--map-land-route' : '--map-land-mine') || '#14362c',
            fillOpacity: 1,
            color:
              read(scope.on_route ? '--map-land-route-line' : '--map-land-mine-line') || '#2f7d5f',
            weight: scope.on_route ? 2 : 1.2,
          }
        },
        onEachFeature: (featureIn, layer) => {
          const scope = scopeFor(featureIn as CountryFeature, scopes)
          if (!scope) return
          layer.bindTooltip(`${scope.name} · ${scope.place_count} saved`, { sticky: true })
          layer.on('click', () => setFocused(scope.name))
        },
      }).addTo(map)
    })
    return () => {
      cancelled = true
    }
  }, [scopes])

  // Open framed on what you have, not on an arbitrary slice of ocean.
  const framed = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map || framed.current) return
    const points = scopes
      .filter((scope) => scope.lat !== null && scope.lon !== null)
      .map((scope) => [scope.lat as number, scope.lon as number] as [number, number])
    if (!points.length) return
    framed.current = true
    // Reserve the sheet's real height, measured, so what you have is framed in
    // the strip that is actually visible.
    const sheetTop =
      document.querySelector('.tripsheet')?.getBoundingClientRect().top ??
      window.innerHeight * 0.45
    map.fitBounds(L.latLngBounds(points).pad(points.length === 1 ? 6 : 0.6), {
      paddingTopLeft: [32, 130],
      paddingBottomRight: [32, Math.round(window.innerHeight - sheetTop) + 32],
      maxZoom: 5,
      animate: false,
    })
  }, [scopes])

  // Tapping a country on the map frames it, rather than jumping straight in:
  // seeing where it is answers half the question.
  useEffect(() => {
    const map = mapRef.current
    const scope = focused ? byName.get(focused.toLowerCase()) : null
    if (!map || !scope || scope.lat === null || scope.lon === null) return
    map.flyTo([scope.lat, scope.lon], 4, { duration: 0.6 })
  }, [focused, byName])

  return (
    <div className="trip">
      <div className="trip__map trip__map--globe" ref={containerRef} aria-hidden="true" />

      <div className="trip__over">
        <header className="trip__head">
          <div className="trip__titles grow">
            <div className="trip__owner">Explore</div>
            <div className="trip__name">Where you have been looking</div>
          </div>
        </header>

        <div className="trip__spacer" />

        <section className="tripsheet tripsheet--fill">
          <div className="tripsheet__grip" aria-hidden="true" />
          <div className="tripsheet__body">
            {countries.loading && !countries.data && <SkeletonRows rows={4} />}
            {countries.error && !countries.data && (
              <ErrorNote message={countries.error} onRetry={countries.reload} />
            )}

            {countries.data && !countries.data.length && (
              <Note tone="neutral" Icon={MapPin}>
                Nothing saved anywhere yet. Save a link or a video and the places in it land here,
                grouped by country.
              </Note>
            )}

            {scopes.map((scope) => (
              <button
                key={scope.name}
                className={`scope${focused === scope.name ? ' scope--focused' : ''}`}
                onClick={() => navigate(`/explore/${encodeURIComponent(scope.name)}`)}
              >
                <span className="scope__main">
                  <span className="scope__name">
                    {scope.name}
                    {scope.on_route && (
                      <span className="scope__tag">
                        <RouteIcon size={12} /> on your route
                      </span>
                    )}
                  </span>
                  <span className="scope__counts num">
                    <MapPin size={13} /> {scope.place_count}{' '}
                    {scope.place_count === 1 ? 'place' : 'places'}
                    {scope.clip_count > 0 && (
                      <>
                        {' · '}
                        <Film size={13} /> {scope.clip_count}
                      </>
                    )}
                    {scope.visited_count > 0 && <> · {scope.visited_count} visited</>}
                  </span>
                </span>
                <ChevronRight size={18} />
              </button>
            ))}

            {scopes.length > 0 && (
              <p className="scope__footnote">
                Counted from your own library. TripStash does not know what anyone else saved.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function scopeFor(feature: CountryFeature, scopes: Scope[]): Scope | null {
  return scopes.find((scope) => matchesCountry(feature, scope.name)) ?? null
}
