import { useState } from 'react'
import { motion } from 'motion/react'
import { ApiError, api } from '../lib/api'
import { FADE, useMotionPrefs } from '../lib/motion'
import { STAMP_PATTERN, tick } from '../lib/haptics'
import Contours from '../components/Contours'
import { StampDrop } from '../components/Stamp'
import { Note } from '../components/ui'
import { Check } from '../components/icons'

const localToday = () => new Date().toLocaleDateString('en-CA')

/** A budget typed like a person types it: "1,000", "$500", "2500". */
function parseBudget(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (!trimmed) return null
  const value = Number(trimmed.replace(/[^\d.]/g, ''))
  return Number.isFinite(value) && value >= 0 && value <= 1_000_000_000 ? value : undefined
}

/**
 * The first screen of an account: one name, and the rest can wait. Creating
 * the trip is the first stamp in the passport; the app arrives behind it.
 */
export default function NewTrip({
  onCreated,
  onSignOut,
}: {
  onCreated: () => void
  onSignOut: () => void
}) {
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [budget, setBudget] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [stamped, setStamped] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const { reduced, spring } = useMotionPrefs()

  const code = currency.trim().toUpperCase()
  const codeOk = /^[A-Z]{3}$/.test(code)
  const parsedBudget = parseBudget(budget)
  const datesOk = !start || !end || end >= start

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || stamped) return
    if (!codeOk) return setError('Use a 3-letter currency code like GTQ.')
    if (parsedBudget === undefined) return setError('Enter the budget as a number, like 2500.')
    if (!datesOk) return setError('The end date is before the start.')
    setBusy(true)
    setError(null)
    try {
      await api.createTrip({
        name: name.trim(),
        base_currency: code,
        total_budget: parsedBudget,
        start_date: start || null,
        end_date: end || null,
      })
      // The stamp lands, then the page gives way to the trip.
      setStamped(true)
      window.setTimeout(() => tick(STAMP_PATTERN), reduced ? 0 : 170)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Couldn’t reach TripStash. Check your connection and try again.',
      )
      setBusy(false)
    }
  }

  return (
    <motion.div
      style={{ position: 'relative', minHeight: '100dvh', overflow: 'hidden' }}
      animate={leaving ? { opacity: 0 } : { opacity: 1 }}
      transition={{ duration: 0.2, ease: 'easeIn' }}
    >
      <Contours />
      <div
        className="pad"
        style={{
          position: 'relative',
          zIndex: 1,
          maxWidth: 480,
          margin: '0 auto',
          paddingTop: 'calc(var(--s-6) + env(safe-area-inset-top))',
          paddingBottom: 'var(--s-10)',
        }}
      >
        <div className="row between" style={{ marginBottom: 'var(--s-8)' }}>
          <span className="t-small dim">New trip</span>
          <button className="btn btn--sm btn--ghost btn--quiet" onClick={onSignOut}>
            Sign out
          </button>
        </div>
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduced ? FADE : spring}
        >
          <h1 className="t-display">Where to?</h1>
          <p className="t dim" style={{ marginTop: 'var(--s-3)', maxWidth: '32ch' }}>
            Dates are optional — leave them blank for a flexible route and add stops as you go.
          </p>
        </motion.div>

        <motion.form
          className="card card--raised stack-4"
          onSubmit={submit}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduced ? FADE : { ...spring, delay: 0.08 }}
          style={{ marginTop: 'var(--s-6)', padding: 'var(--s-5)', position: 'relative' }}
          aria-busy={busy}
        >
          <label className="field">
            <span>Trip name</span>
            <input
              className="input"
              value={name}
              required
              autoFocus
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
              placeholder="Central America"
            />
          </label>

          <div className="row" style={{ gap: 'var(--s-3)' }}>
            <label className="field grow">
              <span>Currency</span>
              <input
                className="input"
                value={currency}
                maxLength={3}
                autoCapitalize="characters"
                aria-invalid={currency.trim() !== '' && !codeOk}
                onChange={(event) => setCurrency(event.target.value)}
              />
            </label>
            <label className="field grow">
              <span>Total budget</span>
              <input
                className="input"
                value={budget}
                inputMode="decimal"
                aria-invalid={parsedBudget === undefined}
                onChange={(event) => setBudget(event.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>

          <div className="row" style={{ gap: 'var(--s-3)' }}>
            <label className="field grow">
              <span>Roughly from</span>
              <input className="input" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
            </label>
            <label className="field grow">
              <span>Roughly until</span>
              <input
                className="input"
                type="date"
                value={end}
                min={start || undefined}
                aria-invalid={!datesOk}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>
          </div>
          {start && start < localToday() && (
            <p className="t-small dimmer">Started already? Fine — the plan and the budget count from today.</p>
          )}

          {error && (
            <div role="alert">
              <Note tone="danger">{error}</Note>
            </div>
          )}

          <button
            className="btn btn--ink btn--block"
            type="submit"
            disabled={!name.trim() || stamped}
            aria-busy={busy && !stamped}
          >
            {stamped ? 'Created' : busy ? 'Creating…' : 'Create trip'}
          </button>

          {/* The first stamp in the passport, then the trip takes over. */}
          <div
            style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}
            aria-live="polite"
          >
            <StampDrop
              show={stamped}
              tone="teal"
              Icon={Check}
              onLand={() => {
                window.setTimeout(() => {
                  setLeaving(true)
                  window.setTimeout(onCreated, reduced ? 0 : 200)
                }, 350)
              }}
            >
              {name.trim() || 'Trip created'}
            </StampDrop>
          </div>
        </motion.form>
      </div>
    </motion.div>
  )
}
