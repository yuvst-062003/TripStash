import { useEffect, useRef } from 'react'
import {
  geoCentroid,
  geoDistance,
  geoGraticule10,
  geoInterpolate,
  geoOrthographic,
  geoPath,
} from 'd3-geo'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import land110 from 'world-atlas/land-110m.json'
import countries110 from 'world-atlas/countries-110m.json'
import { drift } from '../lib/globeClock'
import { useMotionPrefs } from '../lib/motion'

export interface GlobePoint {
  lat: number
  lon: number
  size?: number
  hot?: boolean
}

const LAND = feature(
  land110 as unknown as Topology,
  (land110 as unknown as Topology).objects.land as GeometryCollection,
)
const GRATICULE = geoGraticule10()

/** Real country polygons, so a country is a shape with borders, not a dot. */
const COUNTRIES = feature(
  countries110 as unknown as Topology,
  (countries110 as unknown as Topology).objects.countries as GeometryCollection,
).features as GeoCountry[]

interface GeoCountry {
  type: string
  properties: { name?: string }
  geometry: unknown
}

/**
 * Match a country however it is spelled.
 *
 * The atlas writes "Panama" where the traveller's data may write "Panamá", so
 * marks are stripped and case folded before comparing - the same rule the API
 * uses, kept identical on purpose so the two can never disagree about which
 * country is which.
 */
function countryKey(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function isDark(): boolean {
  const forced = document.documentElement.dataset.theme
  if (forced) return forced === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

interface Palette {
  seaLight: string
  seaDark: string
  land: string
  landShade: string
  graticule: string
  glow: string
  rim: string
  pin: string
  pinCool: string
  arc: string
}

function palette(dark: boolean, vivid: boolean): Palette {
  if (vivid) {
    return dark
      ? {
          seaLight: '#2f8fb3',
          seaDark: '#0b3d52',
          land: '#7fcf8a',
          landShade: '#3f8f57',
          graticule: 'rgba(255,255,255,0.08)',
          glow: 'rgba(255, 209, 102, 0.35)',
          rim: 'rgba(255, 209, 102, 0.9)',
          pin: '#ff8a5b',
          pinCool: '#ffd166',
          arc: '#ff8a5b',
        }
      : {
          seaLight: '#5fc0dc',
          seaDark: '#1b6f92',
          land: '#8fd69a',
          landShade: '#4ea866',
          graticule: 'rgba(255,255,255,0.14)',
          glow: 'rgba(255, 209, 102, 0.45)',
          rim: 'rgba(255, 190, 70, 0.95)',
          pin: '#ff6b3d',
          pinCool: '#ffd166',
          arc: '#ff6b3d',
        }
  }
  return dark
    ? {
        seaLight: '#1f5a66',
        seaDark: '#0c2a33',
        land: '#4f9d6b',
        landShade: '#2f6c48',
        graticule: 'rgba(255,255,255,0.06)',
        glow: 'rgba(63, 207, 169, 0.18)',
        rim: 'rgba(63, 207, 169, 0.5)',
        pin: '#ff8a5b',
        pinCool: '#3fcfa9',
        arc: '#ff8a5b',
      }
    : {
        seaLight: '#8fd0dc',
        seaDark: '#3f95ad',
        land: '#a9dfae',
        landShade: '#6dbb7e',
        graticule: 'rgba(255,255,255,0.18)',
        glow: 'rgba(14, 124, 102, 0.16)',
        rim: 'rgba(14, 124, 102, 0.45)',
        pin: '#ff6b3d',
        pinCool: '#0e7c66',
        arc: '#ff6b3d',
      }
}

/**
 * A coloured, turning globe drawn with d3-geo (github.com/d3/d3-geo) on a
 * 2D canvas: real continents from world-atlas, a lit ocean, a rim of
 * atmosphere, the traveller's own places as pins and the route as great
 * circles. It turns slowly on its own, follows a finger when dragged, and
 * holds still under reduced motion.
 */
export default function Globe({
  points = [],
  route = [],
  focus,
  size = 320,
  spin = 0.004,
  sway = 0,
  interactive = true,
  vivid = false,
  outlineCountries = false,
  marked = [],
  selected = null,
  className,
  style,
}: {
  points?: GlobePoint[]
  /** Draw real country borders rather than plain land. */
  outlineCountries?: boolean
  /** Country names to fill, however they are spelled. */
  marked?: string[]
  /** The one country drawn with a heavy border, a centre dot and its name. */
  selected?: string | null
  route?: [number, number][]
  focus?: [number, number]
  size?: number
  spin?: number
  /** Radians of idle drift either side of home instead of a full turn. */
  sway?: number
  interactive?: boolean
  /** Saturated seas and a gold rim — for the sign-in globe. */
  vivid?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drag = useRef<{ x: number; y: number; lambda: number; phi: number } | null>(null)
  const rotation = useRef<[number, number]>([focus ? -focus[1] : 0, focus ? -focus[0] : -18])
  // Home is where the hand last left it; idle drift is measured from there.
  const home = useRef<[number, number]>([...rotation.current])

  // Turning to face the selected country.
  //
  // Without this the globe carries on drifting and a selection can end up on
  // the far side, which is worse than not highlighting it at all: the border
  // is drawn, and the traveller is looking at the wrong hemisphere.
  useEffect(() => {
    if (!selected) return
    const chosen = COUNTRIES.find((c) => countryKey(c.properties?.name) === countryKey(selected))
    if (!chosen) return
    const [lon, lat] = geoCentroid(chosen as never) as [number, number]
    // `home` is the rotation with the idle drift taken back out, because the
    // draw loop adds drift(now) on top of it every frame. Storing the raw
    // angle here would be swamped by that and land on another continent.
    home.current = [-lon - drift(performance.now(), spin, sway) * 57.3, -lat]
    rotation.current = [-lon, -lat]
  }, [selected, spin, sway])
  const { reduced } = useMotionPrefs()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const colours = palette(isDark(), vivid)
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let width = size
    let frame = 0

    const projection = geoOrthographic().clipAngle(90)
    const path = geoPath(projection, context)
    const routePaths = route.slice(1).map((to, index) => {
      const from = route[index]
      const interpolate = geoInterpolate([from[1], from[0]], [to[1], to[0]])
      const coordinates: [number, number][] = []
      for (let t = 0; t <= 1; t += 1 / 24) coordinates.push(interpolate(t))
      return { type: 'LineString', coordinates } as const
    })

    const resize = () => {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(width * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      projection.translate([width / 2, width / 2]).scale(width / 2 - 6)
    }
    resize()

    const draw = () => {
      const [lambda, phi] = rotation.current
      projection.rotate([lambda, phi])
      const cx = width / 2
      const r = width / 2 - 6
      context.clearRect(0, 0, width, width)

      // Atmosphere: a soft halo around the limb.
      const halo = context.createRadialGradient(cx, cx, r * 0.92, cx, cx, r * 1.08)
      halo.addColorStop(0, colours.glow)
      halo.addColorStop(1, 'rgba(0,0,0,0)')
      context.fillStyle = halo
      context.beginPath()
      context.arc(cx, cx, r * 1.08, 0, Math.PI * 2)
      context.fill()

      // Sea, lit from the upper left.
      const sea = context.createRadialGradient(cx - r * 0.45, cx - r * 0.5, r * 0.1, cx, cx, r)
      sea.addColorStop(0, colours.seaLight)
      sea.addColorStop(1, colours.seaDark)
      context.fillStyle = sea
      context.beginPath()
      context.arc(cx, cx, r, 0, Math.PI * 2)
      context.fill()

      context.save()
      context.beginPath()
      context.arc(cx, cx, r, 0, Math.PI * 2)
      context.clip()

      context.beginPath()
      path(GRATICULE)
      context.strokeStyle = colours.graticule
      context.lineWidth = 0.6
      context.stroke()

      // Land: a base fill, then a shaded edge for a little relief.
      context.beginPath()
      path(LAND)
      context.fillStyle = colours.land
      context.fill()
      context.strokeStyle = colours.landShade
      context.lineWidth = 0.9
      context.stroke()

      // Countries: a border each, filled where the trip goes, and the selected
      // one outlined heavily with its name and a dot on its centre. A country
      // is a shape with edges, which is how anyone actually reads a map.
      if (outlineCountries) {
        const markedKeys = new Set(marked.map(countryKey))
        const selectedKey = countryKey(selected)
        for (const country of COUNTRIES) {
          const key = countryKey(country.properties?.name)
          const isMarked = markedKeys.has(key)
          const isSelected = Boolean(selectedKey) && key === selectedKey
          context.beginPath()
          path(country as never)
          if (isSelected) {
            context.fillStyle = colours.pin
            context.fill()
          } else if (isMarked) {
            context.fillStyle = colours.pinCool
            context.fill()
          }
          context.strokeStyle = isSelected ? colours.pin : colours.landShade
          context.lineWidth = isSelected ? 2.2 : 0.7
          context.stroke()
        }

        // The selected country's name, on its own centre, and only while that
        // centre is actually facing us - a label on the far side would float
        // over the ocean on the near one.
        const chosen = COUNTRIES.find((c) => countryKey(c.properties?.name) === selectedKey)
        if (chosen) {
          const centre = geoCentroid(chosen as never) as [number, number]
          const facing = geoDistance(centre, [-lambda, -phi]) < Math.PI / 2 - 0.05
          const at = projection(centre)
          if (facing && at) {
            context.beginPath()
            context.arc(at[0], at[1], 3.4, 0, Math.PI * 2)
            context.fillStyle = '#ffffff'
            context.fill()
            context.font = '700 12px "Bricolage Grotesque", system-ui, sans-serif'
            context.textAlign = 'center'
            context.lineWidth = 3
            context.strokeStyle = 'rgba(0,0,0,0.55)'
            context.strokeText(chosen.properties?.name ?? '', at[0], at[1] - 10)
            context.fillStyle = '#ffffff'
            context.fillText(chosen.properties?.name ?? '', at[0], at[1] - 10)
          }
        }
      }

      // Terminator: the far side of the lit hemisphere darkens.
      const shade = context.createRadialGradient(cx - r * 0.4, cx - r * 0.45, r * 0.2, cx, cx, r * 1.05)
      shade.addColorStop(0, 'rgba(255,255,255,0.10)')
      shade.addColorStop(0.55, 'rgba(0,0,0,0)')
      shade.addColorStop(1, 'rgba(0,0,0,0.38)')
      context.fillStyle = shade
      context.fillRect(0, 0, width, width)

      // Route arcs, then pins, only on the visible hemisphere.
      for (const line of routePaths) {
        context.beginPath()
        path(line)
        context.strokeStyle = colours.arc
        context.lineWidth = 1.8
        context.setLineDash([4, 4])
        context.stroke()
        context.setLineDash([])
      }
      const centre: [number, number] = [-lambda, -phi]
      for (const point of points) {
        const coordinates: [number, number] = [point.lon, point.lat]
        if (geoDistance(coordinates, centre) > Math.PI / 2 - 0.02) continue
        const projected = projection(coordinates)
        if (!projected) continue
        const radius = (point.size ?? 0.06) * (width / 5)
        context.beginPath()
        context.arc(projected[0], projected[1], radius + 2.2, 0, Math.PI * 2)
        context.fillStyle = 'rgba(255,255,255,0.85)'
        context.fill()
        context.beginPath()
        context.arc(projected[0], projected[1], radius, 0, Math.PI * 2)
        context.fillStyle = point.hot ? colours.pin : colours.pinCool
        context.fill()
      }
      context.restore()

      // Rim.
      context.beginPath()
      context.arc(cx, cx, r, 0, Math.PI * 2)
      context.strokeStyle = colours.rim
      context.lineWidth = 1.2
      context.stroke()
    }

    let visible = true
    const tick = () => {
      frame = 0
      if (!visible) return
      if (!reduced && !drag.current) {
        rotation.current = [home.current[0] + drift(performance.now(), spin, sway) * 57.3, home.current[1]]
      }
      draw()
      frame = requestAnimationFrame(tick)
    }
    const wake = () => {
      if (frame) return
      if (reduced) draw()
      else frame = requestAnimationFrame(tick)
    }
    wake()
    // Off screen, the globe stops turning until it is back.
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) wake()
    })
    intersection.observe(canvas)

    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width) || size
      if (next !== width) {
        width = next
        resize()
        if (reduced) draw()
      }
    })
    observer.observe(canvas)

    return () => {
      cancelAnimationFrame(frame)
      intersection.disconnect()
      observer.disconnect()
    }
    // Points and route change identity every render; compare by content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(points),
    JSON.stringify(route),
    size,
    spin,
    sway,
    reduced,
    vivid,
    outlineCountries,
    JSON.stringify(marked),
    selected,
  ])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        width: size,
        height: size,
        maxWidth: '100%',
        aspectRatio: '1',
        touchAction: 'pan-y',
        cursor: interactive ? 'grab' : 'default',
        ...style,
      }}
      aria-hidden
      onPointerDown={(event) => {
        if (!interactive) return
        drag.current = { x: event.clientX, y: event.clientY, lambda: rotation.current[0], phi: rotation.current[1] }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        const k = 0.35
        rotation.current = [
          drag.current.lambda + (event.clientX - drag.current.x) * k,
          Math.max(-60, Math.min(60, drag.current.phi - (event.clientY - drag.current.y) * k)),
        ]
      }}
      onPointerUp={() => {
        drag.current = null
        home.current = [
          rotation.current[0] - drift(performance.now(), spin, sway) * 57.3,
          rotation.current[1],
        ]
      }}
      onPointerCancel={() => {
        drag.current = null
        home.current = [
          rotation.current[0] - drift(performance.now(), spin, sway) * 57.3,
          rotation.current[1],
        ]
      }}
    />
  )
}
