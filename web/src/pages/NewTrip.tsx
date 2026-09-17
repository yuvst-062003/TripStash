import { useState } from 'react'
import { motion } from 'motion/react'
import { ApiError, api } from '../lib/api'
import { useMotionPrefs } from '../lib/motion'
import Contours from '../components/Contours'
import { Stamp } from '../components/Stamp'
import { Note } from '../components/ui'
import { Compass } from '../components/icons'

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
  const { reduced, spring } = useMotionPrefs()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.createTrip({
        name: name.trim(),
        base_currency: currency.toUpperCase(),
        total_budget: budget ? Number(budget) : null,
        start_date: start || null,
        end_date: end || null,
      })
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the trip.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'relative', minHeight: '100dvh', overflow: 'hidden' }}>
      <Contours />
      <div
        className="pad"
        style={{
          position: 'relative',
          zIndex: 1,
          maxWidth: 480,
          margin: '0 auto',
          paddingTop: 'calc(var(--s-12) + env(safe-area-inset-top))',
          paddingBottom: 'var(--s-10)',
        }}
      >
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
        >
          <Stamp tone="teal" size="lg" Icon={Compass} rotate={-6}>
            New trip
          </Stamp>
          <h1 className="t-display" style={{ marginTop: 'var(--s-4)' }}>
            Where to?
          </h1>
          <p className="t dim" style={{ marginTop: 'var(--s-3)', maxWidth: '32ch' }}>
            Dates are optional — a flexible route is the point. Add stops later without committing
            to exact days.
          </p>
        </motion.div>

        <motion.form
          className="card card--raised stack-4"
          onSubmit={submit}
          initial={reduced ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: reduced ? 0 : 0.08 }}
          style={{ marginTop: 'var(--s-6)', padding: 'var(--s-5)' }}
        >
          <label className="field">
            <span>Trip name</span>
            <input
              className="input"
              value={name}
              required
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
                onChange={(event) => setCurrency(event.target.value)}
              />
            </label>
            <label className="field grow">
              <span>Total budget</span>
              <input
                className="input"
                value={budget}
                inputMode="decimal"
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
              <input className="input" type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
            </label>
          </div>

          {error && <Note tone="danger">{error}</Note>}

          <button className="btn btn--ink btn--block" type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create trip'}
          </button>
        </motion.form>

        <button className="btn btn--ghost btn--block" style={{ marginTop: 'var(--s-5)' }} onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  )
}
