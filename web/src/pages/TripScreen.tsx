import { useState } from 'react'
import { api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import TopBar from '../components/TopBar'
import {
  Empty,
  ErrorNote,
  Meta,
  Note,
  Pill,
  SectionLabel,
  SkeletonRows,
  Tabs,
} from '../components/ui'
import { Plus, Ticket, Trash2 } from '../components/icons'

type Section = 'plan' | 'bookings' | 'money'

export default function TripScreen() {
  const { trip, signOut } = useApp()
  const [section, setSection] = useState<Section>('plan')
  useScreenContext({ surface: 'trip' })

  const subtitle = [
    `${trip?.start_date ?? 'no fixed start'} → ${trip?.end_date ?? 'open ended'}`,
    trip?.base_currency,
    trip?.total_budget != null ? `budget ${trip.total_budget}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="screen">
      <TopBar title={trip?.name ?? 'Trip'} subtitle={subtitle} />
      <Tabs
        label="Trip sections"
        value={section}
        onChange={setSection}
        options={[
          { value: 'plan', label: 'Plan' },
          { value: 'bookings', label: 'Bookings' },
          { value: 'money', label: 'Money' },
        ]}
      />

      {section === 'plan' && <PlanSection />}
      {section === 'bookings' && <BookingsSection />}
      {section === 'money' && <MoneySection />}

      <SectionLabel>Account</SectionLabel>
      <div className="pad stack">
        <a className="btn btn--block" href={api.exportUrl} download>
          Export everything
        </a>
        <p className="t-sm dimmer">
          The export contains places, sources, notes, statuses, route, bookings and expenses.
        </p>
        <button className="btn btn--plain btn--block" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  )
}

function PlanSection() {
  const { trip, reloadTrip } = useApp()
  const itinerary = useAsync(() => api.itinerary(), [])
  const [name, setName] = useState('')

  async function addStop(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    await api.addDestination({ name: name.trim() })
    setName('')
    reloadTrip()
  }

  const byDate = (itinerary.data ?? []).reduce<Record<string, NonNullable<typeof itinerary.data>>>(
    (acc, item) => {
      ;(acc[item.on_date] ??= []).push(item)
      return acc
    },
    {},
  )

  return (
    <>
      <SectionLabel>Route</SectionLabel>
      <ol className="list">
        {(trip?.destinations ?? []).map((destination, index) => (
          <li key={destination.id}>
            <div className="item" style={{ cursor: 'default' }}>
              <span
                className="t-sm num dimmer"
                style={{ width: 18, flex: 'none', paddingTop: 2, textAlign: 'right' }}
              >
                {index + 1}
              </span>
              <div className="item__body">
                <p className="item__title">{destination.name}</p>
                <Meta
                  parts={[
                    destination.country,
                    destination.is_current && 'here now',
                    destination.arrive_on ?? 'no date',
                  ]}
                />
              </div>
            </div>
          </li>
        ))}
      </ol>

      <form className="pad row" style={{ paddingTop: 'var(--s-3)', gap: 'var(--s-2)' }} onSubmit={addStop}>
        <input
          className="input grow"
          placeholder="Add a stop — dates optional"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="New route stop"
        />
        <button className="btn" type="submit" disabled={!name.trim()} aria-label="Add stop">
          <Plus size={17} strokeWidth={2.4} />
        </button>
      </form>

      <SectionLabel>Day plan</SectionLabel>
      {itinerary.loading && !itinerary.data && <SkeletonRows rows={3} />}
      {itinerary.error && <ErrorNote message={itinerary.error} onRetry={itinerary.reload} />}
      {itinerary.data?.length === 0 && (
        <Empty
          title="Nothing scheduled"
          body="Add a place to a day from its page, or ask the assistant whether now is a good moment."
        />
      )}

      {Object.entries(byDate).map(([date, items]) => (
        <section key={date}>
          <p className="pad t-xs" style={{ paddingTop: 'var(--s-4)', paddingBottom: 'var(--s-2)' }}>
            {date}
          </p>
          <ul className="list">
            {items.map((item) => (
              <li key={item.id}>
                <div className="item" style={{ cursor: 'default' }}>
                  <span className="t-sm dimmer num" style={{ width: 38, flex: 'none', paddingTop: 2 }}>
                    {item.start_time ?? '—'}
                  </span>
                  <div className="item__body">
                    <p className="item__title clamp-1">{item.title}</p>
                  </div>
                  <button
                    className="icon-btn"
                    aria-label={`Remove ${item.title}`}
                    onClick={() => api.removeFromPlan(item.id).then(itinerary.reload)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

function BookingsSection() {
  const bookings = useAsync(() => api.bookings(), [])
  const [form, setForm] = useState({ title: '', provider: '', confirmation_code: '', amount: '' })
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    await api.addBooking({
      title: form.title.trim(),
      provider: form.provider.trim() || null,
      confirmation_code: form.confirmation_code.trim() || null,
      amount: form.amount ? Number(form.amount) : null,
    })
    setForm({ title: '', provider: '', confirmation_code: '', amount: '' })
    setBusy(false)
    bookings.reload()
  }

  return (
    <>
      <div className="pad" style={{ paddingTop: 'var(--s-3)' }}>
        <Note Icon={Ticket}>
          TripStash never books anything itself. Reserve with the provider, then bring the
          confirmation back here so it attaches to your route.
        </Note>
      </div>

      {bookings.loading && !bookings.data && <SkeletonRows rows={2} />}

      <ul className="list" style={{ marginTop: 'var(--s-3)' }}>
        {(bookings.data ?? []).map((booking) => (
          <li key={String(booking.id)}>
            <div className="item" style={{ cursor: 'default' }}>
              <div className="item__body">
                <p className="item__title clamp-1">{String(booking.title)}</p>
                <Meta
                  parts={[
                    String(booking.kind),
                    booking.provider ? String(booking.provider) : null,
                    booking.confirmation_code ? String(booking.confirmation_code) : null,
                  ]}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>

      <SectionLabel>Import a confirmation</SectionLabel>
      <form className="pad stack" onSubmit={submit}>
        <label className="field">
          <span>What was booked</span>
          <input
            className="input"
            value={form.title}
            required
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </label>
        <div className="row" style={{ gap: 'var(--s-2)' }}>
          <label className="field grow">
            <span>Provider</span>
            <input
              className="input"
              value={form.provider}
              onChange={(event) => setForm({ ...form, provider: event.target.value })}
            />
          </label>
          <label className="field grow">
            <span>Confirmation</span>
            <input
              className="input"
              value={form.confirmation_code}
              onChange={(event) => setForm({ ...form, confirmation_code: event.target.value })}
            />
          </label>
        </div>
        <label className="field">
          <span>Amount</span>
          <input
            className="input"
            inputMode="decimal"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
          />
        </label>
        <button className="btn btn--accent btn--block" type="submit" disabled={busy || !form.title.trim()}>
          Save booking
        </button>
      </form>
    </>
  )
}

const CATEGORIES = ['food', 'accommodation', 'transport', 'activity', 'other']

function MoneySection() {
  const { trip } = useApp()
  const expenses = useAsync(() => api.expenses(), [])
  const [form, setForm] = useState({
    amount: '',
    currency: trip?.base_currency ?? 'USD',
    category: 'food',
    note: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.addExpense({
        spent_on: new Date().toISOString().slice(0, 10),
        amount: Number(form.amount),
        currency: form.currency.toUpperCase(),
        category: form.category,
        note: form.note.trim() || null,
        // Idempotency key: a replayed offline queue must not double-charge.
        client_op_id: `expense-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
      setForm({ ...form, amount: '', note: '' })
      expenses.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that expense.')
    } finally {
      setBusy(false)
    }
  }

  const total = expenses.data?.total ?? 0
  const max = Math.max(1, ...Object.values(expenses.data?.by_category ?? {}))

  return (
    <>
      {expenses.data && (
        <div className="pad" style={{ paddingTop: 'var(--s-4)' }}>
          <p className="t-xl num">
            {total.toFixed(0)}
            <span className="t-md dimmer"> {expenses.data.currency}</span>
          </p>

          <div className="stack-2" style={{ marginTop: 'var(--s-4)' }}>
            {Object.entries(expenses.data.by_category).map(([category, amount]) => (
              <div key={category}>
                <div className="row between t-sm">
                  <span style={{ textTransform: 'capitalize' }}>{category}</span>
                  <span className="num dimmer">{amount.toFixed(0)}</span>
                </div>
                <div className="meter" style={{ marginTop: 4 }}>
                  <span style={{ width: `${(amount / max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <form className="pad stack" onSubmit={submit} style={{ paddingTop: 'var(--s-5)' }}>
        <div className="row" style={{ gap: 'var(--s-2)' }}>
          <label className="field grow">
            <span>Amount</span>
            <input
              className="input"
              inputMode="decimal"
              required
              value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
            />
          </label>
          <label className="field" style={{ width: 88 }}>
            <span>Currency</span>
            <input
              className="input"
              maxLength={3}
              value={form.currency}
              onChange={(event) => setForm({ ...form, currency: event.target.value })}
            />
          </label>
        </div>

        <div className="row row--wrap" style={{ gap: 'var(--s-2)' }}>
          {CATEGORIES.map((category) => (
            <Pill
              key={category}
              on={form.category === category}
              onClick={() => setForm({ ...form, category })}
            >
              {category}
            </Pill>
          ))}
        </div>

        <label className="field">
          <span>Note</span>
          <input
            className="input"
            placeholder="Optional"
            value={form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
          />
        </label>

        {error && <Note tone="danger">{error}</Note>}

        <button className="btn btn--accent btn--block" type="submit" disabled={busy || !form.amount}>
          Add expense
        </button>
      </form>

      <ul className="list" style={{ marginTop: 'var(--s-5)' }}>
        {(expenses.data?.items ?? []).map((item) => (
          <li key={item.id}>
            <div className="item" style={{ cursor: 'default' }}>
              <div className="item__body">
                <p className="t clamp-1">{item.note || item.category}</p>
                <Meta parts={[item.spent_on, item.category]} />
              </div>
              <span className="t-md num" style={{ flex: 'none' }}>
                {item.amount} {item.currency}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
