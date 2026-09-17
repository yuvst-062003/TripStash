import { useState } from 'react'
import { ApiError, api } from '../lib/api'
import { Note } from '../components/ui'

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
    <div className="pad" style={{ maxWidth: 440, margin: '0 auto', paddingTop: 'var(--s-10)' }}>
      <h1 className="t-xl">Start a trip</h1>
      <p className="t dim" style={{ marginTop: 6 }}>
        Dates are optional — a flexible route is the point. Add stops later without committing to
        exact days.
      </p>

      <form className="stack-4" onSubmit={submit} style={{ marginTop: 'var(--s-6)' }}>
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

        <button className="btn btn--accent btn--block" type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create trip'}
        </button>
      </form>

      <button className="btn btn--plain btn--block" style={{ marginTop: 'var(--s-5)' }} onClick={onSignOut}>
        Sign out
      </button>
    </div>
  )
}
