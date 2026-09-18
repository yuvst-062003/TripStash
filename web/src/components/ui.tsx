import type { ReactNode } from 'react'
import { useEffect } from 'react'
import type { PlaceStatus } from '../lib/types'
import {
  AlertTriangle,
  CheckCheck,
  CircleDashed,
  Clock,
  type IconComponent,
  MapPin,
  Route,
  Star,
  X,
} from './icons'

/* -------------------------------------------------------------------------
   Status vocabulary. Icon and word carry the meaning; colour is only a third
   signal (specification 12.1).
------------------------------------------------------------------------- */

export const STATUS_META: Record<
  PlaceStatus,
  { label: string; Icon: IconComponent; colour: string }
> = {
  inbox: { label: 'In review', Icon: CircleDashed, colour: 'var(--status-inbox)' },
  saved: { label: 'Saved', Icon: MapPin, colour: 'var(--status-saved)' },
  must_visit: { label: 'Must visit', Icon: Star, colour: 'var(--status-must)' },
  planned: { label: 'Planned', Icon: Route, colour: 'var(--status-planned)' },
  visited: { label: 'Visited', Icon: CheckCheck, colour: 'var(--status-visited)' },
  archived: { label: 'Archived', Icon: X, colour: 'var(--status-archived)' },
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
  general: 'Tip',
}

/* -------------------------------------------------------------------------
   Text pairing

   A typed item carries a short title and the sentence it came from. When the
   title is only a truncation of that sentence, showing both is noise, so one
   rule decides the headline and whether a detail line survives.
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

/** One line of dot-separated metadata, the way a map app writes it. */
export function Meta({
  parts,
  wrap,
}: {
  parts: (string | number | null | undefined | false)[]
  wrap?: boolean
}) {
  const kept = parts.filter((part): part is string | number => part !== null && part !== undefined && part !== false && part !== '')
  if (kept.length === 0) return null
  return (
    <p className={wrap ? 'meta' : 'meta clamp-1'}>
      {kept.map((part, index) => (
        <span key={index}>{part}</span>
      ))}
    </p>
  )
}

export function Glyph({
  Icon,
  size = 'md',
  accent,
}: {
  Icon: IconComponent
  size?: 'md' | 'lg'
  accent?: boolean
}) {
  return (
    <span className={`glyph${size === 'lg' ? ' glyph--lg' : ''}${accent ? ' glyph--accent' : ''}`}>
      <Icon size={size === 'lg' ? 20 : 17} strokeWidth={1.9} />
    </span>
  )
}

export function StatusLabel({ status }: { status: PlaceStatus }) {
  const meta = STATUS_META[status]
  return (
    <span className="row t-sm" style={{ gap: 4, color: meta.colour, flex: 'none' }}>
      <meta.Icon size={13} strokeWidth={2.4} />
      {meta.label}
    </span>
  )
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
  const className = `pill${on ? ' pill--on' : ''}`
  if (!onClick) {
    return (
      <span className={className} title={title} style={{ cursor: 'default' }}>
        {Icon && <Icon size={14} strokeWidth={2} />}
        {children}
      </span>
    )
  }
  return (
    <button type="button" className={className} onClick={onClick} aria-pressed={on} title={title}>
      {Icon && <Icon size={14} strokeWidth={2} />}
      {children}
    </button>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (next: T) => void
  options: { value: T; label: string; badge?: number }[]
  label: string
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          type="button"
          className="tabs__item"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.badge ? <span className="dimmer num"> {option.badge}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function SectionLabel({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="section-label">
      <h2 className="t-xs">{children}</h2>
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
    <p className={`note${tone === 'neutral' ? '' : ` note--${tone}`}`}>
      <Chosen size={15} strokeWidth={2} />
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
    <div className={`banner${tone === 'neutral' ? '' : ` banner--${tone}`}`}>
      <Chosen size={15} strokeWidth={2} />
      <div className="grow">{children}</div>
    </div>
  )
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="t-md" style={{ color: 'var(--ink-2)' }}>
        {title}
      </p>
      {body && (
        <p className="t-sm" style={{ marginTop: 6, maxWidth: '36ch', marginInline: 'auto' }}>
          {body}
        </p>
      )}
      {action && <div style={{ marginTop: 'var(--s-4)' }}>{action}</div>}
    </div>
  )
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="list" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <li key={index}>
          <div className="item">
            <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 'var(--r-md)' }} />
            <div className="item__body">
              <div className="skeleton" style={{ height: 13, width: '58%' }} />
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
    <div className="pad" style={{ paddingBlock: 'var(--s-3)' }}>
      <div className="banner banner--danger">
        <AlertTriangle size={15} strokeWidth={2} />
        <div className="grow row between">
          <span className="grow">{message}</span>
          {onRetry && (
            <button className="btn btn--sm btn--plain" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Shown whenever data came from the cache, so nothing stale looks current. */
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

/**
 * Freshness is an exception report. A fresh value is expected, so it stays
 * quiet; only ageing and stale values are called out.
 */
export function Freshness({ status, label }: { status: string; label: string }) {
  if (status === 'fresh') {
    return <span className="t-sm dimmer">{label}</span>
  }
  return (
    <span className="row t-sm" style={{ gap: 4, color: 'var(--warn)', flex: 'none' }}>
      <Clock size={13} strokeWidth={2.2} />
      {label}
    </span>
  )
}

export function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  return (
    <span className="t-sm dimmer num" title={`Extraction confidence ${pct}%`}>
      {pct}% confident
    </span>
  )
}

/* -------------------------------------------------------------------------
   Sheet shell
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
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  useEscapeToClose(onClose)
  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet__grip" />
        <div className="sheet__head">
          <h2 className="t-lg grow clamp-1">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  )
}
