import NumberFlow from '@number-flow/react'
import { motion } from 'motion/react'
import { useMotionPrefs } from '../lib/motion'

/**
 * A rolling money figure. Digits animate between values so a new expense
 * is seen landing, not just replaced.
 */
export function MoneyFigure({
  amount,
  currency,
  size = 'lg',
  decimals = 0,
}: {
  amount: number
  currency: string
  size?: 'lg' | 'xl'
  decimals?: number
}) {
  const { reduced } = useMotionPrefs()
  return (
    <span className={`${size === 'xl' ? 't-display--lg' : 't-display'} num`} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
      <NumberFlow
        value={amount}
        format={{ minimumFractionDigits: decimals, maximumFractionDigits: decimals }}
        animated={!reduced}
      />
      <span className="t-head dimmer" style={{ letterSpacing: 0 }}>
        {currency}
      </span>
    </span>
  )
}

/**
 * Budget as an arc. The track is the whole budget; the drawn stroke is what
 * has gone. Past the budget the stroke turns coral and the arc fills.
 */
export function BudgetArc({
  spent,
  budget,
  label,
}: {
  spent: number
  budget: number
  label?: string
}) {
  const { reduced } = useMotionPrefs()
  const ratio = budget > 0 ? Math.min(1, spent / budget) : 0
  const over = budget > 0 && spent > budget
  // A 240° arc, open at the bottom.
  const r = 52
  const c = 2 * Math.PI * r
  const arcLength = c * (240 / 360)
  return (
    <svg className="arc" viewBox="0 0 120 92" role="img" aria-label={label ?? `${Math.round(ratio * 100)}% of budget spent`}>
      <path
        className="arc__track"
        d="M 14.98 87 A 52 52 0 1 1 105.02 87"
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <motion.path
        className={`arc__value${over ? ' arc__value--over' : ''}`}
        d="M 14.98 87 A 52 52 0 1 1 105.02 87"
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={arcLength}
        initial={false}
        animate={{ strokeDashoffset: arcLength * (1 - ratio) }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 170, damping: 26 }}
      />
      <text
        x="60"
        y="66"
        textAnchor="middle"
        fontFamily="var(--font)"
        fontWeight="800"
        fontSize="26"
        fill="currentColor"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {Math.round(ratio * 100)}%
      </text>
      <text x="60" y="82" textAnchor="middle" fontFamily="var(--font)" fontWeight="500" fontSize="9" fill="currentColor" opacity="0.8">
        of budget
      </text>
    </svg>
  )
}
