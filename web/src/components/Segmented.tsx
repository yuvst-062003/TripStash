import { useId, useRef } from 'react'
import { motion } from 'motion/react'
import { tick } from '../lib/haptics'
import { INSTANT, useMotionPrefs } from '../lib/motion'

/**
 * Segmented control. One ink pill slides between options; the label text
 * stays put so the eye tracks the pill, not the words.
 *
 * Real tabs: one tab stop, arrows move between them, and with a `name` the
 * panels can point back (`{name}-tab-{value}` / `{name}-panel-{value}`).
 */
export default function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  name,
  even,
  kind = 'tabs',
}: {
  value: T
  onChange: (next: T) => void
  options: { value: T; label: string; badge?: number; lang?: string }[]
  label: string
  name?: string
  /** Equal thirds for a settings control; the default lets labels size a scrolling one. */
  even?: boolean
  /** Tabs switch content; radios choose a setting. Screen readers say which. */
  kind?: 'tabs' | 'radio'
}) {
  const id = useId()
  const base = name ?? id
  const { spring } = useMotionPrefs()
  const tabs = useRef<Map<T, HTMLButtonElement>>(new Map())
  // When the page's direction just flipped (a language change), the pill's old
  // position only exists because of the mirror: it snaps with everything else.
  const dir = typeof document === 'undefined' ? 'ltr' : document.documentElement.dir || 'ltr'
  const lastDir = useRef(dir)
  const flipped = lastDir.current !== dir
  lastDir.current = dir
  const rtl = dir === 'rtl'
  const choose = (next: T) => {
    if (next === value) return
    tick()
    onChange(next)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
    const back = rtl ? 'ArrowRight' : 'ArrowLeft'
    const step = event.key === forward ? 1 : event.key === back ? -1 : 0
    if (!step) return
    event.preventDefault()
    const at = options.findIndex((option) => option.value === value)
    const next = options[(at + step + options.length) % options.length]
    choose(next.value)
    tabs.current.get(next.value)?.focus()
  }

  return (
    <div
      className={`seg${even ? ' seg--even' : ''}`}
      role={kind === 'radio' ? 'radiogroup' : 'tablist'}
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) tabs.current.set(option.value, node)
              else tabs.current.delete(option.value)
            }}
            id={`${base}-tab-${option.value}`}
            role={kind === 'radio' ? 'radio' : 'tab'}
            type="button"
            className="seg__item"
            aria-selected={kind === 'tabs' ? selected : undefined}
            aria-checked={kind === 'radio' ? selected : undefined}
            aria-controls={name && kind === 'tabs' ? `${name}-panel-${option.value}` : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => choose(option.value)}
          >
            {selected && (
              <motion.span
                className="seg__pill"
                layoutId={`seg-${id}`}
                transition={flipped ? INSTANT : spring}
                style={{ borderRadius: 19 }}
                aria-hidden
              />
            )}
            <span className="seg__label" lang={option.lang}>
              {option.label}
              {option.badge ? <span className="seg__badge">{option.badge}</span> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
