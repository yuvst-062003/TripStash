import { useEffect, useRef } from 'react'
import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from 'three'
import { drift } from '../lib/globeClock'
import { useMotionPrefs } from '../lib/motion'
import type { GlobePoint } from './Globe'

const TEXTURE = '/earth/blue-marble-2k.jpg'

// One texture for every globe on the page, fetched once and kept.
let textureCache: Promise<Texture> | null = null
function loadTexture(): Promise<Texture> {
  textureCache ??= new Promise((resolve, reject) => {
    new TextureLoader().load(
      TEXTURE,
      (texture) => {
        texture.colorSpace = SRGBColorSpace
        resolve(texture)
      },
      undefined,
      reject,
    )
  })
  return textureCache
}
/** Start fetching the Earth before a page that shows it is opened. */
export function preloadEarth(): void {
  void loadTexture().catch(() => {
    textureCache = null
  })
}

/** Lat/lon → a point on the unit sphere, matching three's sphere UV layout. */
function toVector(lat: number, lon: number, radius = 1): Vector3 {
  const la = (lat * Math.PI) / 180
  const lo = (lon * Math.PI) / 180
  return new Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)).multiplyScalar(radius)
}

/** Rotation around Y that brings a longitude to face the camera on +z. */
function facing(lon: number): number {
  return -Math.PI / 2 - (lon * Math.PI) / 180
}

const ATMOSPHERE = new ShaderMaterial({
  uniforms: { glow: { value: new Color('#5fb8ff') } },
  vertexShader: `
    varying vec3 vNormal;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 glow;
    varying vec3 vNormal;
    void main() {
      float rim = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.4);
      gl_FragColor = vec4(glow, 1.0) * rim * 1.15;
    }`,
  side: BackSide,
  blending: AdditiveBlending,
  transparent: true,
  depthWrite: false,
})

/**
 * The Earth, photographed: NASA's Blue Marble on a three.js sphere, lit by
 * one sun from the upper left, wrapped in a thin blue atmosphere. The
 * traveller's places are coral pins and the route a raised ribbon between
 * them. It turns slowly on its own, follows a finger, and holds still under
 * reduced motion. Loaded lazily; the vector globe stands in until then.
 */
/** A leg to fly: the plane travels from → to once, keyed so the same leg can be flown again. */
export interface Flight {
  from: [number, number]
  to: [number, number]
  key: number
  /** Too short for a plane to read: the new bead lands instead of a flight. */
  short?: boolean
}

const FLIGHT_MS = 2200
/** Legs shorter than this (about 8°) are too short for a plane to read; the bead lands instead. */
const SHORT_LEG = 0.14
const LANDING_MS = 450

/** Whether a leg is too short to fly (under about 8° on the sphere). */
export function isShortLeg(from: [number, number], to: [number, number]): boolean {
  return toVector(from[0], from[1]).angleTo(toVector(to[0], to[1])) < SHORT_LEG
}

/** Points along a lifted great circle between two stops, the same curve the ribbon uses. */
function legCurve(from: [number, number], to: [number, number]): CatmullRomCurve3 {
  const a = toVector(from[0], from[1])
  const b = toVector(to[0], to[1])
  const angle = a.angleTo(b)
  const peak = 0.03 + (angle / Math.PI) * 0.45
  const samples: Vector3[] = []
  for (let t = 0; t <= 1; t += 1 / 24) {
    const lift = 1.012 + Math.sin(t * Math.PI) * peak
    samples.push(new Vector3().lerpVectors(a, b, t).normalize().multiplyScalar(lift))
  }
  return new CatmullRomCurve3(samples)
}

export default function EarthGlobe({
  points = [],
  route = [],
  focus,
  flight,
  size = 320,
  spin = 0.0025,
  sway = 0,
  zoom = 3.4,
  interactive = true,
  touchAction = 'pan-y',
  onReady,
  className,
  style,
}: {
  points?: GlobePoint[]
  route?: [number, number][]
  focus?: [number, number]
  /** When set (or its key changes), a small plane flies that leg once. */
  flight?: Flight | null
  size?: number
  spin?: number
  /** Radians of idle drift either side of where it was left, instead of turning away. */
  sway?: number
  /** Camera distance: 3.4 matches the vector stand-in's silhouette; ~2 fills the frame with a region. */
  zoom?: number
  interactive?: boolean
  /** 'none' where the globe is the whole screen; 'pan-y' inside a scrolling page. */
  touchAction?: 'none' | 'pan-y'
  /** Fires once the photographed Earth is on screen, so a stand-in can leave. */
  onReady?: () => void
  className?: string
  style?: React.CSSProperties
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ x: number; y: number; ry: number; rx: number; vy: number; t: number } | null>(null)
  const momentum = useRef(0)
  const aim = (at: [number, number]) => ({ y: facing(at[1]), x: (at[0] * Math.PI) / 180 })
  const rotation = useRef(focus ? aim(focus) : { y: facing(-70), x: 0.25 })
  // Home is where the globe was left; idle drift is measured from it, and a
  // new home (the current stop changed) is turned to, not cut to.
  const home = useRef({ ...rotation.current })
  const turning = useRef(false)
  // Spin and sway are read through refs so changing them never rebuilds the scene.
  const spinRef = useRef(spin)
  spinRef.current = spin
  const swayRef = useRef(sway)
  swayRef.current = sway
  const renderRef = useRef<(() => void) | null>(null)
  const { reduced } = useMotionPrefs()

  // The scene, built once per size; markers and flights live in their own
  // groups so a new pin never rebuilds the renderer or re-uploads the texture.
  const sceneRef = useRef<{
    world: Group
    markers: Group
    plane: Group
    render: () => void
    wake: () => void
  } | null>(null)
  const flightRef = useRef<{ curve: CatmullRomCurve3; start: number; target: number } | null>(null)
  const landingRef = useRef<{ bead: Mesh; start: number } | null>(null)
  const readyRef = useRef(onReady)
  readyRef.current = onReady

  const focusKey = focus ? `${focus[0]},${focus[1]}` : ''
  const firstFocus = useRef(true)
  useEffect(() => {
    if (!focus) return
    home.current = aim(focus)
    // First paint and reduced motion land on it directly; otherwise it is a turn.
    if (firstFocus.current || reduced) rotation.current = { ...home.current }
    else turning.current = true
    firstFocus.current = false
    if (reduced) renderRef.current?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let width = size
    let frame = 0
    let disposed = false
    let visible = true

    const dpr = window.devicePixelRatio || 1
    // 1.5× is plenty for a textured sphere and halves the fill cost on 3× phones.
    const renderer = new WebGLRenderer({ alpha: true, antialias: dpr < 2, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(1.5, dpr))
    renderer.setSize(width, width)
    renderer.outputColorSpace = SRGBColorSpace
    // Arrives invisible; fades in once the photograph is on the sphere.
    renderer.domElement.style.opacity = '0'
    renderer.domElement.style.transition = 'opacity 200ms linear'
    host.appendChild(renderer.domElement)

    const scene = new Scene()
    const camera = new PerspectiveCamera(35, 1, 0.1, 20)
    camera.position.set(0, 0, zoom)

    const sun = new DirectionalLight(0xffffff, 2.6)
    sun.position.set(-2.2, 1.6, 2.6)
    scene.add(sun)
    scene.add(new AmbientLight(0x9fb4d8, 0.9))

    const world = new Group()
    scene.add(world)
    const markers = new Group()
    world.add(markers)

    const geometry = new SphereGeometry(1, 64, 64)
    const material = new MeshPhongMaterial({ shininess: 6, specular: new Color('#1b2a44') })
    const earth = new Mesh(geometry, material)
    world.add(earth)

    const haloGeometry = new SphereGeometry(1.12, 48, 48)
    scene.add(new Mesh(haloGeometry, ATMOSPHERE))

    // The plane: gold — what is happening now — big enough to tell from a pin,
    // hidden until there is a leg to fly.
    const plane = new Group()
    const goldPaint = new MeshBasicMaterial({ color: new Color('#ffd166') })
    const fuselage = new Mesh(new ConeGeometry(0.012, 0.05, 8), goldPaint)
    fuselage.rotation.x = Math.PI / 2
    const wing = new Mesh(new BoxGeometry(0.06, 0.004, 0.014), goldPaint)
    const tail = new Mesh(new BoxGeometry(0.02, 0.004, 0.008), goldPaint)
    tail.position.set(0, 0.008, -0.02)
    plane.add(fuselage, wing, tail)
    plane.scale.setScalar(1.1 * (zoom / 3.4))
    plane.visible = false
    world.add(plane)

    const render = () => {
      world.rotation.y = rotation.current.y
      world.rotation.x = rotation.current.x
      renderer.render(scene, camera)
    }
    renderRef.current = render
    const shortest = (delta: number) => Math.atan2(Math.sin(delta), Math.cos(delta))
    const tick = () => {
      frame = 0
      if (!visible) return
      const now = performance.now()
      const flight = flightRef.current
      const landing = landingRef.current
      if (landing) {
        // The new bead lands: big and soft, then settles.
        const t = Math.min(1, (now - landing.start) / LANDING_MS)
        const eased = 1 - Math.pow(1 - t, 3)
        landing.bead.scale.setScalar(landing.bead.userData.radius * (2.2 - 1.2 * eased))
        if (t >= 1) landingRef.current = null
      }
      if (flight) {
        const t = Math.min(1, (now - flight.start) / FLIGHT_MS)
        // Ease in and out so the plane leaves and arrives gently.
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
        const at = flight.curve.getPointAt(eased)
        const ahead = flight.curve.getPointAt(Math.min(1, eased + 0.01))
        plane.position.copy(at)
        plane.up.copy(at.clone().normalize())
        plane.lookAt(ahead)
        if (!drag.current) {
          // Shortest way round to the leg's midpoint, then settle.
          rotation.current.y += shortest(flight.target - rotation.current.y) * 0.06
        }
        if (t >= 1) {
          flightRef.current = null
          home.current = { ...rotation.current }
          window.setTimeout(() => {
            plane.visible = false
          }, 600)
        }
      } else if (!reduced && !drag.current) {
        if (Math.abs(momentum.current) > 0.0004) {
          // The hand's speed carries on, fading, before the drift takes over.
          rotation.current.y += momentum.current
          momentum.current *= 0.94
          if (Math.abs(momentum.current) <= 0.0004) {
            momentum.current = 0
            home.current = { x: rotation.current.x, y: rotation.current.y - drift(now, spinRef.current, swayRef.current) }
          }
        } else {
          const target = home.current.y + drift(now, spinRef.current, swayRef.current)
          if (turning.current) {
            const delta = shortest(target - rotation.current.y)
            rotation.current.y += delta * 0.06
            rotation.current.x += (home.current.x - rotation.current.x) * 0.06
            if (Math.abs(delta) < 0.002) turning.current = false
          } else {
            rotation.current.y = target
            rotation.current.x = home.current.x
          }
        }
      }
      render()
      frame = requestAnimationFrame(tick)
    }
    const wake = () => {
      if (disposed || frame) return
      if (reduced) render()
      else frame = requestAnimationFrame(tick)
    }
    sceneRef.current = { world, markers, plane, render, wake }

    loadTexture().then((texture) => {
      if (disposed) return
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
      material.map = texture
      material.needsUpdate = true
      render()
      renderer.domElement.style.opacity = '1'
      readyRef.current?.()
    })

    wake()

    // Off screen, the planet stops turning; it costs nothing until it is back.
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) wake()
    })
    intersection.observe(host)

    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width) || size
      if (next !== width) {
        width = next
        renderer.setSize(width, width)
        if (reduced) render()
      }
    })
    observer.observe(host)

    return () => {
      disposed = true
      renderRef.current = null
      sceneRef.current = null
      cancelAnimationFrame(frame)
      intersection.disconnect()
      observer.disconnect()
      geometry.dispose()
      haloGeometry.dispose()
      material.dispose()
      goldPaint.dispose()
      fuselage.geometry.dispose()
      wing.geometry.dispose()
      tail.geometry.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [size, reduced, zoom])

  // Pins and the route ribbon: rebuilt in place when they change.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const { markers } = scene
    const disposables: { dispose: () => void }[] = []
    // Closer camera, smaller marks: a bead should read the same size on screen.
    const k = zoom / 3.4

    // Pins: a bead with a soft white collar, sitting just above the surface.
    // Coral is the current stop; gold is a saved place; teal is the route.
    const pinGeometry = new SphereGeometry(1, 12, 12)
    const coral = new MeshBasicMaterial({ color: new Color('#ff6a3d') })
    const gold = new MeshBasicMaterial({ color: new Color('#ffc83d') })
    const teal = new MeshBasicMaterial({ color: new Color('#3fd9b0') })
    const collar = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })
    disposables.push(pinGeometry, coral, gold, teal, collar)
    const addBead = (lat: number, lon: number, radius: number, fill: MeshBasicMaterial, lift = 1.008) => {
      const bead = new Mesh(pinGeometry, fill)
      bead.position.copy(toVector(lat, lon, lift))
      bead.scale.setScalar(radius)
      bead.userData.radius = radius
      markers.add(bead)
      const ring = new Mesh(pinGeometry, collar)
      ring.position.copy(bead.position)
      ring.scale.setScalar(radius * 1.5)
      markers.add(ring)
      return bead
    }
    for (const point of points) addBead(point.lat, point.lon, (point.size ?? 0.06) * 0.28 * k, point.hot ? coral : gold)

    // Route: a teal ribbon along the great circle, lifted like a flight path —
    // the longer the hop, the higher it arcs — with a stop dot at each end.
    for (let index = 1; index < route.length; index += 1) {
      const tube = new TubeGeometry(legCurve(route[index - 1], route[index]), 48, 0.011 * k, 8, false)
      disposables.push(tube)
      markers.add(new Mesh(tube, teal))
    }
    const beads = route.map(([lat, lon], index) => addBead(lat, lon, (index === 0 ? 0.018 : 0.013) * k, teal, 1.014))
    // A leg just added and too short to fly: its new bead lands instead.
    if (flight && beads.length && flight.short) {
      landingRef.current = { bead: beads[beads.length - 1], start: performance.now() }
    }
    scene.wake()
    if (reduced) scene.render()

    return () => {
      landingRef.current = null
      markers.clear()
      disposables.forEach((item) => item.dispose())
    }
    // Points and route change identity every render; compare by content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points), JSON.stringify(route), reduced, size, zoom, flight?.key])

  // The flight: keyed on the leg alone, so a trip reload mid-air never restarts it.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !flight) return
    const { plane } = scene
    const mid = facing((flight.from[1] + flight.to[1]) / 2)
    if (reduced) {
      // No plane: the globe is simply turned to the new leg.
      rotation.current = { ...rotation.current, y: mid }
      home.current = { ...rotation.current }
      scene.render()
      return
    }
    if (flight.short) {
      home.current = { ...home.current, y: mid }
      turning.current = true
      scene.wake()
      return
    }
    flightRef.current = {
      curve: legCurve(flight.from, flight.to),
      start: performance.now(),
      // Turn so the middle of the leg faces the viewer while the plane is in the air.
      target: mid,
    }
    plane.visible = true
    scene.wake()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight?.key, reduced])

  return (
    <div
      ref={hostRef}
      className={className}
      style={{
        width: size,
        height: size,
        maxWidth: '100%',
        aspectRatio: '1',
        touchAction,
        cursor: interactive ? 'grab' : 'default',
        ...style,
      }}
      aria-hidden
      onPointerDown={(event) => {
        if (!interactive) return
        momentum.current = 0
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          ry: rotation.current.y,
          rx: rotation.current.x,
          vy: 0,
          t: performance.now(),
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        const next = drag.current.ry + (event.clientX - drag.current.x) * 0.006
        const now = performance.now()
        // Speed over the last move, in radians per frame, for the let-go.
        const dt = Math.max(1, now - drag.current.t)
        drag.current.vy = ((next - rotation.current.y) / dt) * 16.7
        drag.current.t = now
        rotation.current = {
          y: next,
          x: Math.max(-1, Math.min(1, drag.current.rx + (event.clientY - drag.current.y) * 0.004)),
        }
        // Reduced motion stops the idle spin, not the person's own hand.
        if (reduced) renderRef.current?.()
      }}
      onPointerUp={() => {
        if (!drag.current) return
        momentum.current = reduced ? 0 : Math.max(-0.08, Math.min(0.08, drag.current.vy))
        drag.current = null
        turning.current = false
        home.current = {
          x: rotation.current.x,
          y: rotation.current.y - drift(performance.now(), spinRef.current, swayRef.current),
        }
      }}
      onPointerCancel={() => {
        drag.current = null
        home.current = {
          x: rotation.current.x,
          y: rotation.current.y - drift(performance.now(), spinRef.current, swayRef.current),
        }
      }}
    />
  )
}
