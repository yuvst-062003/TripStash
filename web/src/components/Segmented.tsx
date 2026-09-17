import { useId, useRef } from 'react'
import { motion } from 'motion/react'
import { useMotionPrefs } from '../lib/motion'

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
}: {
  value: T
  onChange: (next: T) => void
  options: { value: T; label: string; badge?: number }[]
  label: string
  name?: string
}) {
  const id = useId()
  const base = name ?? id
  const { spring } = useMotionPrefs()
  const tabs = useRef<Map<T, HTMLButtonElement>>(new Map())

  function onKeyDown(event: React.KeyboardEvent) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const at = options.findIndex((option) => option.value === value)
    const next = options[(at + step + options.length) % options.length]
    onChange(next.value)
    tabs.current.get(next.value)?.focus()
  }

  return (
    <div className="seg" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
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
            role="tab"
            type="button"
            className="seg__item"
            aria-selected={selected}
            aria-controls={name ? `${name}-panel-${option.value}` : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
          >
            {selected && (
              <motion.span className="seg__pill" layoutId={`seg-${id}`} transition={spring} aria-hidden />
            )}
            <span className="seg__label">
              {option.label}
              {option.badge ? <span className="seg__badge">{option.badge}</span> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
