import { useEffect, useRef } from 'react'
import createGlobe, { type Arc, type COBEOptions, type Marker } from 'cobe'
import { useMotionPrefs } from '../lib/motion'

export interface GlobePoint {
  lat: number
  lon: number
  size?: number
  hot?: boolean
}

/**
 * Longitude/latitude → the globe's phi/theta, so a point faces the viewer.
 * COBE shows longitude 0 at phi 0 and turns west as phi grows.
 */
function anglesFor(lat: number, lon: number): [number, number] {
  return [(-lon * Math.PI) / 180, ((lat * Math.PI) / 180) * 0.6]
}

function isDark(): boolean {
  const forced = document.documentElement.dataset.theme
  if (forced) return forced === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * A WebGL globe (github.com/shuding/cobe, ~5 KB) drawn in the app's palette.
 *
 * Points are the traveller's own places; arcs join route stops in order. It
 * turns slowly on its own, follows a finger when dragged, and holds still
 * under reduced motion.
 */
export default function Globe({
  points = [],
  route = [],
  focus,
  size = 320,
  spin = 0.004,
  interactive = true,
  className,
  style,
}: {
  points?: GlobePoint[]
  route?: [number, number][]
  focus?: [number, number]
  size?: number
  spin?: number
  interactive?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pointerStart = useRef<number | null>(null)
  const dragOffset = useRef(0)
  const { reduced } = useMotionPrefs()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dark = isDark()
    const [focusPhi, focusTheta] = focus ? anglesFor(focus[0], focus[1]) : [0, 0.28]

    const markers: Marker[] = points.map((point) => ({
      location: [point.lat, point.lon],
      size: point.size ?? 0.06,
      color: point.hot ? [1, 0.42, 0.24] : dark ? [0.25, 0.81, 0.66] : [0.05, 0.49, 0.4],
    }))
    const arcs: Arc[] = route.slice(1).map((to, index) => ({ from: route[index], to }))

    let phi = focusPhi
    let width = size
    let frame = 0
    const globe = createGlobe(canvas, {
      devicePixelRatio: Math.min(2, window.devicePixelRatio || 1),
      width: width * 2,
      height: width * 2,
      phi,
      theta: focusTheta,
      dark: dark ? 1 : 0,
      diffuse: dark ? 1.4 : 1.1,
      mapSamples: 18000,
      mapBrightness: dark ? 5 : 3.2,
      mapBaseBrightness: dark ? 0.06 : 0.12,
      baseColor: dark ? [0.16, 0.3, 0.29] : [0.6, 0.76, 0.68],
      markerColor: [1, 0.42, 0.24],
      glowColor: dark ? [0.04, 0.09, 0.09] : [0.9, 0.94, 0.9],
      markers,
      arcs,
      arcColor: [1, 0.42, 0.24],
      arcWidth: 0.5,
      arcHeight: 0.22,
      markerElevation: 0.01,
      opacity: 0.96,
    })

    // COBE v2 draws inside update(), so the app owns the frame loop: idle
    // spin plus whatever the finger added, and a resize when the box changes.
    let lastWidth = width
    const tick = () => {
      if (!reduced && pointerStart.current === null) phi += spin
      const state: Partial<COBEOptions> = { phi: phi + dragOffset.current }
      if (width !== lastWidth) {
        lastWidth = width
        state.width = width * 2
        state.height = width * 2
      }
      globe.update(state)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    const observer = new ResizeObserver(([entry]) => {
      width = Math.round(entry.contentRect.width) || size
    })
    observer.observe(canvas)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      globe.destroy()
    }
    // Points and route change identity every render; compare by content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points), JSON.stringify(route), focus?.[0], focus?.[1], size, spin, reduced])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size, maxWidth: '100%', aspectRatio: '1', touchAction: 'pan-y', ...style }}
      aria-hidden
      onPointerDown={(event) => {
        if (!interactive) return
        pointerStart.current = event.clientX - dragOffset.current
        event.currentTarget.style.cursor = 'grabbing'
      }}
      onPointerMove={(event) => {
        if (!interactive || pointerStart.current === null) return
        dragOffset.current = (event.clientX - pointerStart.current) / 160
      }}
      onPointerUp={(event) => {
        pointerStart.current = null
        event.currentTarget.style.cursor = 'grab'
      }}
      onPointerLeave={() => {
        pointerStart.current = null
      }}
    />
  )
}
