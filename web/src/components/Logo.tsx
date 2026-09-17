import { motion } from 'motion/react'
import { useMotionPrefs } from '../lib/motion'

/**
 * The TripStash mark: a folded paper map with a pin planted in it.
 *
 * The map is yours — three panels, folded the way a paper map is — and the
 * pin is a place you stashed on it. A dashed route runs across the panels to
 * the pin: the thing you saved, brought back on the way.
 *
 * Animated, the map unfolds panel by panel, the route is drawn, and the pin
 * drops in with the stamp spring. Static, it is just the mark.
 */
export default function Logo({
  size = 72,
  animate = false,
  className,
}: {
  size?: number
  animate?: boolean
  className?: string
}) {
  const { reduced, stamp } = useMotionPrefs()
  const play = animate && !reduced
  const ease = [0.16, 1, 0.3, 1] as const

  const panel = (index: number) => ({
    initial: play ? { scaleX: 0, opacity: 0 } : undefined,
    animate: { scaleX: 1, opacity: 1 },
    transition: { duration: 0.42, delay: play ? 0.1 + index * 0.12 : 0, ease },
  })

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="TripStash"
      style={{ overflow: 'visible', display: 'block' }}
    >
      {/* Three panels, each unfolding from its own fold line. */}
      <motion.path
        d="M4 22 L23 16 L23 52 L4 58 Z"
        fill="var(--ink)"
        style={{ transformOrigin: '23px 34px' }}
        {...panel(1)}
      />
      <motion.path
        d="M23 16 L42 22 L42 58 L23 52 Z"
        fill="var(--ink)"
        fillOpacity={0.82}
        style={{ transformOrigin: '23px 34px' }}
        {...panel(0)}
      />
      <motion.path
        d="M42 22 L61 16 L61 52 L42 58 Z"
        fill="var(--ink)"
        style={{ transformOrigin: '42px 34px' }}
        {...panel(2)}
      />

      {/* The route across the map, drawn after the panels are open. */}
      <motion.path
        d="M9 48 C 16 44, 18 36, 26 38 S 40 44, 48 34"
        fill="none"
        stroke="var(--paper)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeDasharray="3.5 3.5"
        initial={play ? { pathLength: 0, opacity: 0 } : undefined}
        animate={{ pathLength: 1, opacity: 0.85 }}
        transition={{ duration: 0.55, delay: play ? 0.55 : 0, ease }}
      />

      {/* The pin, dropped in with the stamp spring, planted where the route ends. */}
      <motion.g
        initial={play ? { y: -26, opacity: 0, scale: 1.25 } : undefined}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ ...stamp, delay: play ? 0.85 : 0 }}
        style={{ transformOrigin: '48px 34px' }}
      >
        <ellipse cx="48" cy="35" rx="6" ry="2.2" fill="rgba(0,0,0,0.28)" />
        <path
          d="M48 6c-6.1 0-11 4.9-11 11 0 8.3 11 19 11 19s11-10.7 11-19c0-6.1-4.9-11-11-11z"
          fill="var(--coral)"
        />
        <circle cx="48" cy="17" r="4.2" fill="var(--paper)" />
      </motion.g>
    </svg>
  )
}
