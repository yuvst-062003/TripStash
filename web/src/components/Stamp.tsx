import type { CSSProperties, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '../lib/cn'
import { useMotionPrefs } from '../lib/motion'
import type { PlaceStatus } from '../lib/types'
import { CheckCheck, CircleDashed, type IconComponent, MapPin, Route, Star, X } from './icons'

export type StampTone = 'ink' | 'teal' | 'coral' | 'gold' | 'muted' | 'warn' | 'paper'
export type StampSize = 'sm' | 'md' | 'lg' | 'xl'

/**
 * The stamp: an inked ring with a word in it, tilted a few degrees.
 *
 * It is the one visual idea in the app. Statuses, categories and the moment
 * of approval all use it, so nothing else is allowed to look like one.
 */
export function Stamp({
  children,
  tone = 'ink',
  size = 'md',
  Icon,
  rotate,
  filled,
  flat,
  className,
  title,
}: {
  children: ReactNode
  tone?: StampTone
  size?: StampSize
  Icon?: IconComponent
  rotate?: number
  filled?: boolean
  flat?: boolean
  className?: string
  title?: string
}) {
  const style = rotate !== undefined ? ({ '--stamp-rotate': `${rotate}deg` } as CSSProperties) : undefined
  return (
    <span
      className={cn(
        'stamp',
        `stamp--${tone}`,
        size !== 'md' && `stamp--${size}`,
        filled && 'stamp--filled',
        flat && 'stamp--flat',
        className,
      )}
      style={style}
      title={title}
    >
      {Icon && <Icon strokeWidth={2.6} aria-hidden />}
      {children}
    </span>
  )
}

/**
 * The stamp landing. Scales down from above with a slight over-rotation and
 * settles — the only choreographed motion in the app, reserved for approve.
 */
export function StampDrop({
  show,
  children,
  tone = 'teal',
  Icon,
}: {
  show: boolean
  children: ReactNode
  tone?: StampTone
  Icon?: IconComponent
}) {
  const { reduced, stamp } = useMotionPrefs()
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          key="stamp"
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.9, rotate: -22 }}
          animate={{ opacity: 1, scale: 1, rotate: -8 }}
          exit={{ opacity: 0 }}
          transition={{ ...stamp, opacity: { duration: 0.06, ease: 'linear' } }}
          style={{ display: 'inline-flex', transformOrigin: 'center' }}
        >
          <Stamp tone={tone} size="xl" Icon={Icon} flat>
            {children}
          </Stamp>
        </motion.span>
      )}
    </AnimatePresence>
  )
}

/* -------------------------------------------------------------------------
   Status vocabulary. Icon and word carry the meaning; the tone is a third
   signal (specification 12.1).
------------------------------------------------------------------------- */

export const STATUS_STAMP: Record<PlaceStatus, { label: string; Icon: IconComponent; tone: StampTone }> = {
  inbox: { label: 'In review', Icon: CircleDashed, tone: 'muted' },
  saved: { label: 'Saved', Icon: MapPin, tone: 'ink' },
  must_visit: { label: 'Must visit', Icon: Star, tone: 'coral' },
  planned: { label: 'Planned', Icon: Route, tone: 'teal' },
  visited: { label: 'Visited', Icon: CheckCheck, tone: 'muted' },
  archived: { label: 'Archived', Icon: X, tone: 'muted' },
}

export function StatusStamp({
  status,
  size = 'sm',
  rotate,
}: {
  status: PlaceStatus
  size?: StampSize
  rotate?: number
}) {
  const meta = STATUS_STAMP[status]
  return (
    <Stamp tone={meta.tone} size={size} Icon={meta.Icon} rotate={rotate} title={meta.label}>
      {meta.label}
    </Stamp>
  )
}
