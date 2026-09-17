import { useId } from 'react'
import { motion } from 'motion/react'
import { useMotionPrefs } from '../lib/motion'

/**
 * Segmented control. One ink pill slides between options; the label text
 * stays put so the eye tracks the pill, not the words.
 */
export default function Segmented<T extends string>({
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
  const id = useId()
  const { spring } = useMotionPrefs()
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            className="seg__item"
            aria-selected={selected}
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
