import { useEffect, useRef } from 'react'
import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  CatmullRomCurve3,
  Color,
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
  TextureLoader,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from 'three'
import { useMotionPrefs } from '../lib/motion'
import type { GlobePoint } from './Globe'

const TEXTURE = '/earth/blue-marble-2k.jpg'

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
export default function EarthGlobe({
  points = [],
  route = [],
  focus,
  size = 320,
  spin = 0.0025,
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
  const hostRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ x: number; y: number; ry: number; rx: number } | null>(null)
  const rotation = useRef({ y: facing(focus ? focus[1] : -70), x: focus ? (-focus[0] * Math.PI) / 180 * 0.5 : 0.25 })
  const { reduced } = useMotionPrefs()

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let width = size
    let frame = 0
    let disposed = false

    const renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setSize(width, width)
    renderer.outputColorSpace = SRGBColorSpace
    host.appendChild(renderer.domElement)

    const scene = new Scene()
    const camera = new PerspectiveCamera(35, 1, 0.1, 20)
    camera.position.set(0, 0, 3.3)

    const sun = new DirectionalLight(0xffffff, 2.6)
    sun.position.set(-2.2, 1.6, 2.6)
    scene.add(sun)
    scene.add(new AmbientLight(0x9fb4d8, 0.9))

    const world = new Group()
    scene.add(world)

    const geometry = new SphereGeometry(1, 64, 64)
    const material = new MeshPhongMaterial({ shininess: 6, specular: new Color('#1b2a44') })
    const earth = new Mesh(geometry, material)
    world.add(earth)

    const haloGeometry = new SphereGeometry(1.12, 48, 48)
    scene.add(new Mesh(haloGeometry, ATMOSPHERE))

    // Pins: a coral bead with a soft white collar, sitting just above the surface.
    const pinGeometry = new SphereGeometry(1, 12, 12)
    const coral = new MeshBasicMaterial({ color: new Color('#ff6a3d') })
    const gold = new MeshBasicMaterial({ color: new Color('#ffc83d') })
    const teal = new MeshBasicMaterial({ color: new Color('#3fd9b0') })
    const collar = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })
    const addBead = (lat: number, lon: number, radius: number, fill: MeshBasicMaterial, lift = 1.008) => {
      const bead = new Mesh(pinGeometry, fill)
      bead.position.copy(toVector(lat, lon, lift))
      bead.scale.setScalar(radius)
      world.add(bead)
      const ring = new Mesh(pinGeometry, collar)
      ring.position.copy(bead.position)
      ring.scale.setScalar(radius * 1.5)
      world.add(ring)
    }
    for (const point of points) addBead(point.lat, point.lon, (point.size ?? 0.06) * 0.28, point.hot ? coral : gold)

    // Route: a teal ribbon along the great circle, lifted like a flight path —
    // the longer the hop, the higher it arcs — with a stop dot at each end.
    const tubes: TubeGeometry[] = []
    for (let index = 1; index < route.length; index += 1) {
      const from = toVector(route[index - 1][0], route[index - 1][1])
      const to = toVector(route[index][0], route[index][1])
      const angle = from.angleTo(to)
      const peak = 0.03 + (angle / Math.PI) * 0.45
      const samples: Vector3[] = []
      for (let t = 0; t <= 1; t += 1 / 24) {
        const lift = 1.012 + Math.sin(t * Math.PI) * peak
        samples.push(new Vector3().lerpVectors(from, to, t).normalize().multiplyScalar(lift))
      }
      const tube = new TubeGeometry(new CatmullRomCurve3(samples), 48, 0.008, 8, false)
      tubes.push(tube)
      world.add(new Mesh(tube, teal))
    }
    route.forEach(([lat, lon], index) => addBead(lat, lon, index === 0 ? 0.018 : 0.013, teal, 1.014))

    new TextureLoader().load(TEXTURE, (texture) => {
      if (disposed) return
      texture.colorSpace = SRGBColorSpace
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
      material.map = texture
      material.needsUpdate = true
      if (reduced) render()
    })

    const render = () => {
      world.rotation.y = rotation.current.y
      world.rotation.x = rotation.current.x
      renderer.render(scene, camera)
    }
    const tick = () => {
      if (!reduced && !drag.current) rotation.current.y -= spin
      render()
      frame = requestAnimationFrame(tick)
    }
    if (reduced) render()
    else frame = requestAnimationFrame(tick)

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
      cancelAnimationFrame(frame)
      observer.disconnect()
      geometry.dispose()
      haloGeometry.dispose()
      pinGeometry.dispose()
      tubes.forEach((tube) => tube.dispose())
      material.map?.dispose()
      material.dispose()
      coral.dispose()
      gold.dispose()
      teal.dispose()
      collar.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
    // Points and route change identity every render; compare by content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points), JSON.stringify(route), size, spin, reduced])

  return (
    <div
      ref={hostRef}
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
        drag.current = { x: event.clientX, y: event.clientY, ry: rotation.current.y, rx: rotation.current.x }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        rotation.current = {
          y: drag.current.ry + (event.clientX - drag.current.x) * 0.006,
          x: Math.max(-1, Math.min(1, drag.current.rx + (event.clientY - drag.current.y) * 0.004)),
        }
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
    />
  )
}
