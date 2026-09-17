import { useEffect } from 'react'
import NumberFlow from '@number-flow/react'
import { motion, useSpring, useTransform } from 'motion/react'
import { useMotionPrefs } from '../lib/motion'

// The figure lands with the arc: one ease, 450 ms, for every part of the card.
const TIMING = { duration: 450, easing: 'cubic-bezier(0.2, 0, 0, 1)' }

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
        transformTiming={TIMING}
        spinTiming={TIMING}
        opacityTiming={TIMING}
      />
      <span className="t-head dimmer" style={{ letterSpacing: 0 }}>
        {currency}
      </span>
    </span>
  )
}

/**
 * Budget as an arc. The track is the whole budget; the drawn stroke is what
 * has gone. Past the budget the stroke turns coral and the arc fills, while
 * the number keeps telling the truth ("108%").
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
  const percent = budget > 0 ? (spent / budget) * 100 : 0
  const over = budget > 0 && spent > budget
  // A 240° arc, open at the bottom.
  const r = 52
  const c = 2 * Math.PI * r
  const arcLength = c * (240 / 360)
  // One spring drives the stroke and the number, so they never disagree.
  const value = useSpring(percent, { stiffness: 170, damping: 26 })
  useEffect(() => {
    if (reduced) value.jump(percent)
    else value.set(percent)
  }, [percent, reduced, value])
  const offset = useTransform(value, (v) => arcLength * (1 - Math.min(1, v / 100)))
  const text = useTransform(value, (v) => `${Math.round(v)}%`)
  return (
    <svg className="arc" viewBox="0 0 120 92" role="img" aria-label={label ?? `${Math.round(percent)}% of budget spent`}>
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
        style={{ strokeDashoffset: offset }}
      />
      <motion.text
        x="60"
        y="72"
        textAnchor="middle"
        fontFamily="var(--font)"
        fontWeight="800"
        fontSize="26"
        fill="currentColor"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {text}
      </motion.text>
    </svg>
  )
}
