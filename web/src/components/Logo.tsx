import { motion } from 'motion/react'
import { useMotionPrefs } from '../lib/motion'

/**
 * The TripStash mark: from content to plan.
 *
 * A folded map whose first panel is a video frame — a Reel, a screenshot,
 * the thing you saved — with a play button. A dashed route runs from that
 * play button across the map to a pin: what you watched, turned into a place
 * on your own map.
 *
 * Animated, the map unfolds, the play button appears, the route is drawn from
 * it, and the pin drops in with the stamp spring. Static, it is just the mark.
 */
export default function Logo({
  size = 72,
  animate = false,
  delay = 0,
  className,
}: {
  size?: number
  animate?: boolean
  /** Seconds to hold before the sequence starts, so it never competes with a bigger move. */
  delay?: number
  className?: string
}) {
  const { reduced } = useMotionPrefs()
  const play = animate && !reduced
  const ease = [0.16, 1, 0.3, 1] as const
  const at = (offset: number) => (play ? delay + offset : 0)
  const drop = { type: 'spring', stiffness: 320, damping: 24 } as const

  const panel = (index: number) => ({
    initial: play ? { scaleX: 0, opacity: 0 } : undefined,
    animate: { scaleX: 1, opacity: 1 },
    transition: { duration: 0.28, delay: at(0.05 + index * 0.05), ease },
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

      {/* The content: a play button on the first panel. */}
      <motion.path
        d="M10.5 28.5 L19 34 L10.5 39.5 Z"
        fill="var(--paper)"
        initial={play ? { scale: 0, opacity: 0 } : undefined}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ ...drop, delay: at(0.2) }}
        style={{ transformOrigin: '14px 34px' }}
      />

      {/* The route: from the play button, across the map, to the pin. */}
      <motion.path
        d="M19 34 C 25 34, 25 45, 32 43 S 41 40, 48 35"
        fill="none"
        stroke="var(--paper)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeDasharray="3.5 3.5"
        initial={play ? { pathLength: 0, opacity: 0 } : undefined}
        animate={{ pathLength: 1, opacity: 0.85 }}
        transition={{ duration: 0.3, delay: at(0.3), ease }}
      />

      {/* The plan: a pin, dropped in with the stamp spring where the route ends. */}
      <motion.g
        initial={play ? { y: -26, opacity: 0, scale: 1.25 } : undefined}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ ...drop, delay: at(0.45) }}
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
