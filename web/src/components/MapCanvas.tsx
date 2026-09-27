/**
 * The map. Mounted once when the map screen opens, never unmounted.
 *
 * This is the whole answer to "it feels like different tabs". There used to be
 * a hand-drawn SVG globe and a Leaflet map, and no camera can travel between
 * two engines - so every move between them was a page change wearing a map.
 * One MapLibre instance can simply fly, and a flight is what a zoom is.
 *
 * The canvas is pixels, so nothing here is the only way to reach anything:
 * every country, city and place is also a real button in the page beside it.
 */
import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { CameraTarget } from '../lib/cameraTarget'
import { flightFor, prefersReducedMotion, safePadding } from '../lib/flight'

/** Free vector tiles, no key, no request limit, no billing account. */
const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

interface Props {
  target: CameraTarget
  going: 'in' | 'out'
  /**
   * How much of the map the page over it covers, in pixels.
   *
   * The map is full-bleed behind that page, so without this the camera centres
   * on ground the traveller cannot see and the globe sits behind the reading.
   * Padding moves the centre into the visible strip instead.
   */
  bottomInset?: number
  /** Handed the instance once it has a style, for the pin layer to use. */
  onReady?: (map: maplibregl.Map) => void
}

export default function MapCanvas({ target, going, bottomInset = 0, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  // A flight a press asked for before the style had loaded, held until it can.
  const pending = useRef<{ target: CameraTarget; going: 'in' | 'out' } | null>(null)
  const ready = useRef(onReady)
  ready.current = onReady
  const [broken, setBroken] = useState(false)
  // A GL context the browser took back. Phones do this under memory pressure,
  // and it is the difference between "the map is loading" and "the map was
  // here a second ago and now is not".
  const [contextLost, setContextLost] = useState(false)
  // Bumped to rebuild the map from scratch once the context returns.
  const [generation, setGeneration] = useState(0)
  const inset = useRef(bottomInset)
  inset.current = bottomInset

  useEffect(() => {
    if (!host.current || map.current) return

    let instance: maplibregl.Map
    try {
      instance = new maplibregl.Map({
        container: host.current,
        style: STYLE,
        center: [0, 20],
        zoom: 1,
        attributionControl: { compact: true },
      })
    } catch {
      // No WebGL context. The list beside the map stays the real control, so
      // the screen is still usable - it just has no picture.
      setBroken(true)
      return
    }
    map.current = instance

    instance.on('load', () => {
      // The projection that makes one camera work from space to a street: it
      // eases from a sphere toward Mercator as you go in, on one tile source.
      instance.setProjection({ type: 'globe' })
      ready.current?.(instance)
      const waiting = pending.current
      if (waiting) {
        pending.current = null
        fly(instance, waiting.target, waiting.going, inset.current)
      }
    })
    // The browser can take the GL context back at any moment - most often on a
    // phone, under memory pressure, a few seconds after everything looked fine.
    // Calling preventDefault is what makes the loss recoverable at all;
    // without it the context is gone for good and the canvas stays blank
    // forever with nothing said about why.
    const canvas = instance.getCanvas()
    const onLost = (event: Event) => {
      event.preventDefault()
      setContextLost(true)
    }
    const onRestored = () => {
      setContextLost(false)
      // MapLibre cannot reliably rebuild its own buffers after a real loss, so
      // the map is recreated rather than resumed.
      setGeneration((n) => n + 1)
    }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)

    instance.on('error', (event) => {
      // A tile that will not load is not worth breaking the screen over; a
      // style that will not load is.
      if (!instance.isStyleLoaded()) setBroken(true)
      if (import.meta.env.DEV) console.warn('map', event?.error?.message ?? event)
    })

    return () => {
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      instance.remove()
      map.current = null
    }
    // `generation` rebuilds the map after a context loss; nothing else here
    // should ever tear it down, because that is what made the old app feel
    // like changing tabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation])

  useEffect(() => {
    const instance = map.current
    if (!instance || !instance.isStyleLoaded()) {
      pending.current = { target, going }
      return
    }
    fly(instance, target, going, bottomInset)
  }, [target, going, bottomInset])

  if (broken) {
    return (
      <div className="mapframe mapframe--broken" data-testid="map-unavailable">
        <p className="t-field">No map on this device. The list below still works.</p>
      </div>
    )
  }

  // Two elements on purpose. MapLibre forces `position: relative` on whatever
  // container it is handed, which silently defeats an `inset: 0` on that same
  // element and leaves the map 0px tall with its tiles loading into nothing.
  // The frame owns the position; the host owns nothing but its size.
  return (
    <div className="mapframe" aria-hidden={contextLost ? undefined : true}>
      <div ref={host} className="mapcanvas" data-testid="map-canvas" />
      {contextLost && (
        <div className="mapframe__lost" role="status" data-testid="map-context-lost">
          <p className="t-field">The map stopped drawing</p>
          <p>
            Your phone took the graphics back, usually to free memory. It should
            return on its own; the list below never needed it.
          </p>
          <button
            type="button"
            className="btn btn--doc-line"
            onClick={() => {
              setContextLost(false)
              setGeneration((n) => n + 1)
            }}
          >
            Draw it again
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Fly to one target.
 *
 * `stop()` first is what lets a second press win. MapLibre queues nothing: a
 * new flyTo during a flight blends with the one in progress and can land
 * between the two. Stopping puts the camera somewhere definite first, so
 * pressing the trail mid-flight takes you where the trail said.
 */
function fly(map: maplibregl.Map, target: CameraTarget, going: 'in' | 'out', bottom: number) {
  const flight = flightFor(target, { going, reducedMotion: prefersReducedMotion() })
  const padding = safePadding(map.getCanvas()?.clientHeight ?? 0, bottom)
  map.stop()

  try {
    if (flight.bounds) map.fitBounds(flight.bounds, { ...flight, padding })
    else map.flyTo({ ...flight, padding } as maplibregl.FlyToOptions)
  } catch {
    // A camera MapLibre cannot compute - a box too thin for the viewport it is
    // left, usually. A map pointing at roughly the right place is a far better
    // outcome than an exception that unmounts the screen.
    const centre = flight.bounds
      ? ([
          (flight.bounds[0][0] + flight.bounds[1][0]) / 2,
          (flight.bounds[0][1] + flight.bounds[1][1]) / 2,
        ] as [number, number])
      : flight.center
    if (centre) map.jumpTo({ center: centre, zoom: flight.zoom ?? map.getZoom() })
  }
}
