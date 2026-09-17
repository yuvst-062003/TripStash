import { Suspense, lazy, useState } from 'react'
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
  interactive,
  className,
  style,
}: {
  points?: GlobePoint[]
  route?: [number, number][]
  focus?: [number, number]
  flight?: Flight | null
  size: number
  spin?: number
  interactive?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const [ready, setReady] = useState(false)
  return (
    <div className={className} style={{ position: 'relative', width: size, height: size, maxWidth: '100%', ...style }}>
      {!ready && (
        <Globe
          points={points}
          route={route}
          focus={focus}
          size={size}
          spin={spin}
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
          interactive={interactive}
          onReady={() => setReady(true)}
          style={{ position: 'absolute', inset: 0 }}
        />
      </Suspense>
    </div>
  )
}
