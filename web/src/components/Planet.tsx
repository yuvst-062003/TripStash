import { Suspense, lazy, useEffect, useState } from 'react'
import Globe, { type GlobePoint } from './Globe'
import type { Flight } from './EarthGlobe'

// The photographed Earth is three.js plus a 2K texture, so it arrives after
// the page does; the vector globe stands in for the first moments.
const EarthGlobe = lazy(() => import('./EarthGlobe'))

/**
 * A planet that is never blank: the vector globe draws at once and stays
 * underneath until the photographed Earth has its texture, which then fades
 * in over it. One element to the page, whichever is showing.
 */
export default function Planet({
  points,
  route,
  focus,
  flight,
  size,
  spin,
  sway,
  zoom,
  interactive,
  touchAction,
  className,
  style,
}: {
  points?: GlobePoint[]
  route?: [number, number][]
  focus?: [number, number]
  flight?: Flight | null
  size: number
  spin?: number
  sway?: number
  zoom?: number
  interactive?: boolean
  touchAction?: 'none' | 'pan-y'
  className?: string
  style?: React.CSSProperties
}) {
  const [ready, setReady] = useState(false)
  const [standIn, setStandIn] = useState(true)
  // The stand-in stays under the Earth for the length of its fade, then goes.
  useEffect(() => {
    if (!ready) return
    const id = window.setTimeout(() => setStandIn(false), 260)
    return () => window.clearTimeout(id)
  }, [ready])
  return (
    <div className={className} style={{ position: 'relative', width: size, height: size, maxWidth: '100%', ...style }}>
      {standIn && (
        <Globe
          points={points}
          route={route}
          focus={focus}
          size={size}
          spin={spin}
          sway={sway}
          interactive={!ready && interactive}
          vivid
          style={{ position: 'absolute', inset: 0 }}
        />
      )}
      <Suspense fallback={null}>
        <EarthGlobe
          points={points}
          route={route}
          focus={focus}
          flight={flight}
          size={size}
          spin={spin}
          sway={sway}
          zoom={zoom}
          interactive={interactive}
          touchAction={touchAction}
          onReady={() => setReady(true)}
          style={{ position: 'absolute', inset: 0 }}
        />
      </Suspense>
    </div>
  )
}
