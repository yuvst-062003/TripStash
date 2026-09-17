import { useMemo } from 'react'
import { motion } from 'motion/react'
import { useMotionPrefs } from '../lib/motion'

/**
 * Topographic contour lines, drawn once from a seeded noise walk so they
 * look like a real map rather than concentric circles, then drifted very
 * slowly. Decorative, so hidden from assistive tech and frozen under
 * reduced motion.
 */
function ring(cx: number, cy: number, r: number, seed: number): string {
  const points: string[] = []
  const n = 48
  for (let i = 0; i <= n; i += 1) {
    const t = (i / n) * Math.PI * 2
    const wobble =
      1 +
      0.16 * Math.sin(t * 3 + seed) +
      0.09 * Math.sin(t * 5 + seed * 1.7) +
      0.05 * Math.sin(t * 8 + seed * 0.4)
    const x = cx + Math.cos(t) * r * wobble
    const y = cy + Math.sin(t) * r * wobble * 0.82
    points.push(`${x.toFixed(1)} ${y.toFixed(1)}`)
  }
  return `M ${points.join(' L ')} Z`
}

export default function Contours() {
  const { reduced } = useMotionPrefs()
  const paths = useMemo(() => {
    const out: string[] = []
    // Two hills, one large and one small, like a headland and an island.
    for (let i = 1; i <= 9; i += 1) out.push(ring(300, 340, i * 42, 1.3))
    for (let i = 1; i <= 5; i += 1) out.push(ring(760, 620, i * 34, 4.1))
    return out
  }, [])

  return (
    <div className="contours" aria-hidden>
      <motion.svg
        viewBox="0 0 1000 900"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        preserveAspectRatio="xMidYMid slice"
        animate={reduced ? undefined : { x: [0, -40, 0], y: [0, 24, 0], rotate: [0, 1.5, 0] }}
        transition={{ duration: 40, repeat: Infinity, ease: 'easeInOut' }}
      >
        {paths.map((d, index) => (
          <path key={index} d={d} strokeOpacity={index % 3 === 0 ? 1 : 0.55} />
        ))}
      </motion.svg>
    </div>
  )
}
