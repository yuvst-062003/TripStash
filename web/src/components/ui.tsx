import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { motion } from 'motion/react'
import { cn } from '../lib/cn'
import { STAGGER_LIST, STAGGER_ROW, useMotionPrefs } from '../lib/motion'
import type { PlaceStatus } from '../lib/types'
import Drawer from './Drawer'
import Segmented from './Segmented'
import { STATUS_STAMP, Stamp, StatusStamp, type StampTone } from './Stamp'
import { AlertTriangle, Clock, type IconComponent } from './icons'

/* -------------------------------------------------------------------------
   Vocabulary
------------------------------------------------------------------------- */

/** Kept for callers that still read the old name; the stamp is the source. */
export const STATUS_META: Record<PlaceStatus, { label: string; Icon: IconComponent; colour: string }> = {
  inbox: { ...STATUS_STAMP.inbox, colour: 'var(--status-inbox)' },
  saved: { ...STATUS_STAMP.saved, colour: 'var(--status-saved)' },
  must_visit: { ...STATUS_STAMP.must_visit, colour: 'var(--status-must)' },
  planned: { ...STATUS_STAMP.planned, colour: 'var(--status-planned)' },
  visited: { ...STATUS_STAMP.visited, colour: 'var(--status-visited)' },
  archived: { ...STATUS_STAMP.archived, colour: 'var(--status-archived)' },
}

export const KNOWLEDGE_LABEL: Record<string, string> = {
  place: 'Place',
  accommodation: 'Stay',
  safety: 'Safety',
  border: 'Entry',
  transport: 'Transport',
  route: 'Route',
  price: 'Price',
  packing: 'Packing',
  event: 'Event',
  general: 'Tip',
}

export type Tint = 'food' | 'stay' | 'nature' | 'view' | 'transport' | 'other' | 'teal' | 'coral' | 'gold'

/** Category → tint. Food is coral, stays are teal, nature is green, views are gold. */
export function categoryTint(category: string | null | undefined): Tint {
  switch (category) {
    case 'restaurant':
    case 'cafe':
    case 'bar':
      return 'food'
    case 'accommodation':
      return 'stay'
    case 'nature':
    case 'activity':
      return 'nature'
    case 'viewpoint':
    case 'attraction':
      return 'view'
    case 'transport':
      return 'transport'
    default:
      return 'other'
  }
}

/** Tint → stamp tone, so a category stamp and its glyph tile agree. */
export function stampToneFor(tint: Tint): StampTone {
  switch (tint) {
    case 'food':
    case 'coral':
      return 'coral'
    case 'stay':
    case 'nature':
    case 'teal':
      return 'teal'
    case 'view':
    case 'gold':
      return 'gold'
    case 'transport':
      return 'ink'
    default:
      return 'muted'
  }
}

export function knowledgeTint(type: string | null | undefined): Tint {
  switch (type) {
    case 'safety':
    case 'border':
      return 'coral'
    case 'price':
    case 'event':
      return 'gold'
    case 'accommodation':
      return 'stay'
    case 'transport':
    case 'route':
      return 'transport'
    default:
      return 'teal'
  }
}

/** "Today", "Tomorrow", "In 12 days", "14 Feb – 17 Feb" for an event. */
export function eventWhen(happensOn: string | null | undefined, endsOn?: string | null): string | null {
  if (!happensOn) return null
  const start = new Date(`${happensOn}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((start.getTime() - today.getTime()) / 86_400_000)
  const fmt = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const range = endsOn && endsOn !== happensOn ? `${fmt(happensOn)} – ${fmt(endsOn)}` : fmt(happensOn)
  if (days < 0) return endsOn && new Date(`${endsOn}T00:00:00`) >= today ? `On now · ${range}` : `Past · ${range}`
  if (days === 0) return `Today · ${range}`
  if (days === 1) return `Tomorrow · ${range}`
  return `In ${days} days · ${range}`
}

/* -------------------------------------------------------------------------
   Text pairing
------------------------------------------------------------------------- */

export function pairText(
  title: string,
  body: string | null | undefined,
): { headline: string; detail: string | null } {
  if (!body) return { headline: title, detail: null }
  const stem = title.replace(/…$/, '').trim().toLowerCase()
  const full = body.trim()
  if (stem.length > 0 && full.toLowerCase().startsWith(stem)) {
    return { headline: full, detail: null }
  }
  return { headline: title, detail: full }
}

/* -------------------------------------------------------------------------
   Primitives
------------------------------------------------------------------------- */

export function Meta({
  parts,
  wrap,
  className,
}: {
  parts: (string | number | null | undefined | false)[]
  wrap?: boolean
  className?: string
}) {
  const kept = parts.filter(
    (part): part is string | number => part !== null && part !== undefined && part !== false && part !== '',
  )
  if (kept.length === 0) return null
  return (
    <p className={cn('meta', !wrap && 'clamp-1', className)}>
      {kept.map((part, index) => (
        <span key={index}>{part}</span>
      ))}
    </p>
  )
}

export function Glyph({
  Icon,
  size = 'md',
  tint = 'other',
}: {
  Icon: IconComponent
  size?: 'md' | 'lg'
  tint?: Tint
}) {
  return (
    <span className={cn('glyph', size === 'lg' && 'glyph--lg', `glyph--${tint}`)}>
      <Icon size={size === 'lg' ? 22 : 18} strokeWidth={2} />
    </span>
  )
}

export function StatusLabel({ status }: { status: PlaceStatus }) {
  return <StatusStamp status={status} />
}

export function Pill({
  children,
  Icon,
  on,
  onClick,
  title,
}: {
  children: ReactNode
  Icon?: IconComponent
  on?: boolean
  onClick?: () => void
  title?: string
}) {
  const className = cn('chip', on && 'chip--on', !onClick && 'chip--static')
  if (!onClick) {
    return (
      <span className={className} title={title}>
        {Icon && <Icon size={14} strokeWidth={2.2} />}
        {children}
      </span>
    )
  }
  return (
    <button type="button" className={className} onClick={onClick} aria-pressed={on} title={title}>
      {Icon && <Icon size={14} strokeWidth={2.2} />}
      {children}
    </button>
  )
}

export function Tabs<T extends string>(props: {
  value: T
  onChange: (next: T) => void
  options: { value: T; label: string; badge?: number }[]
  label: string
}) {
  return <Segmented {...props} />
}

export function SectionLabel({
  children,
  action,
  count,
}: {
  children: ReactNode
  action?: ReactNode
  count?: number
}) {
  return (
    <div className="section">
      <h2 className="section__title">
        {children}
        {count !== undefined && <span className="section__count num">{count}</span>}
      </h2>
      {action}
    </div>
  )
}

export function Note({
  children,
  tone = 'neutral',
  Icon,
}: {
  children: ReactNode
  tone?: 'neutral' | 'warn' | 'danger'
  Icon?: IconComponent
}) {
  const Chosen = Icon ?? AlertTriangle
  return (
    <p className={cn('note', tone !== 'neutral' && `note--${tone}`)}>
      <Chosen size={15} strokeWidth={2.2} />
      <span>{children}</span>
    </p>
  )
}

export function Banner({
  children,
  tone = 'neutral',
  Icon,
}: {
  children: ReactNode
  tone?: 'neutral' | 'warn' | 'danger'
  Icon?: IconComponent
}) {
  const Chosen = Icon ?? AlertTriangle
  return (
    <div className={cn('banner', tone !== 'neutral' && `banner--${tone}`)}>
      <Chosen size={15} strokeWidth={2.2} />
      <div className="grow">{children}</div>
    </div>
  )
}

export function Empty({
  title,
  body,
  action,
  stamp,
}: {
  title: string
  body?: string
  action?: ReactNode
  stamp?: string
}) {
  return (
    <div className="empty">
      {stamp && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Stamp tone="muted" size="lg" rotate={-8}>
            {stamp}
          </Stamp>
        </div>
      )}
      <p className="empty__title">{title}</p>
      {body && (
        <p className="t-small" style={{ marginTop: 8, maxWidth: '34ch', marginInline: 'auto' }}>
          {body}
        </p>
      )}
      {action && <div style={{ marginTop: 'var(--s-5)' }}>{action}</div>}
    </div>
  )
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="list" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <li key={index}>
          <div className="item item--static">
            <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 12 }} />
            <div className="item__body">
              <div className="skeleton" style={{ height: 14, width: '58%' }} />
              <div className="skeleton" style={{ height: 11, width: '36%', marginTop: 8 }} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="pad pad-y">
      <div className="banner banner--danger">
        <AlertTriangle size={15} strokeWidth={2.2} />
        <div className="grow row between">
          <span className="grow">{message}</span>
          {onRetry && (
            <button className="btn btn--sm btn--ghost" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function CacheNote({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <div className="pad" style={{ paddingBlock: 'var(--s-2)' }}>
      <Note tone="warn" Icon={Clock}>
        Cached — live details such as opening hours may be out of date.
      </Note>
    </div>
  )
}

/** Freshness is an exception report: only an ageing value gets a stamp. */
export function Freshness({ status, label }: { status: string; label: string }) {
  if (status === 'fresh') {
    return <span className="t-small dimmer">{label}</span>
  }
  return (
    <Stamp tone="warn" size="sm" Icon={Clock} rotate={-4}>
      {label}
    </Stamp>
  )
}

export function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  return (
    <span className="confidence" title={`Extraction confidence ${pct}%`}>
      <span className="confidence__bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="num">{pct}% sure</span>
    </span>
  )
}

/* -------------------------------------------------------------------------
   Animated list — rows stagger in once, then stay put.
------------------------------------------------------------------------- */

export function MotionList({
  children,
  className = 'list',
  as: Tag = 'ul',
  animateIn = true,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  as?: 'ul' | 'ol'
  /** False on a return visit: the rows are already known, they just appear. */
  animateIn?: boolean
  /** Seconds to hold before the first row, so a headline can lead. */
  delay?: number
}) {
  const { reduced } = useMotionPrefs()
  const Component = Tag === 'ol' ? motion.ol : motion.ul
  const variants = delay
    ? { ...STAGGER_LIST, show: { transition: { staggerChildren: 0.04, delayChildren: delay } } }
    : STAGGER_LIST
  return (
    <Component
      className={className}
      variants={variants}
      initial={reduced || !animateIn ? false : 'hidden'}
      animate="show"
    >
      {children}
    </Component>
  )
}

export function MotionRow({ children, className, layout }: { children: ReactNode; className?: string; layout?: boolean }) {
  return (
    <motion.li className={className} variants={STAGGER_ROW} layout={layout}>
      {children}
    </motion.li>
  )
}

/* -------------------------------------------------------------------------
   Sheet shell — now a vaul drawer
------------------------------------------------------------------------- */

export function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
}

export function Sheet({
  title,
  onClose,
  children,
  action,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <Drawer title={title} onClose={onClose} action={action}>
      {children}
    </Drawer>
  )
}
