import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import { useMotionPrefs } from '../lib/motion'
import Globe, { type GlobePoint } from '../components/Globe'
import Segmented from '../components/Segmented'
import { AskButton } from '../components/TopBar'
import { BudgetArc, MoneyFigure } from '../components/Money'
import { Stamp } from '../components/Stamp'
import {
  Empty,
  ErrorNote,
  Glyph,
  Meta,
  MotionList,
  MotionRow,
  Note,
  Pill,
  SectionLabel,
  SkeletonRows,
} from '../components/ui'
import { Download, Plus, Ticket, Trash2 } from '../components/icons'

type Section = 'plan' | 'bookings' | 'money'

export default function TripScreen() {
  const { trip, signOut } = useApp()
  const [section, setSection] = useState<Section>('plan')
  const { reduced, spring } = useMotionPrefs()
  useScreenContext({ surface: 'trip' })

  const mapData = useAsync(() => api.map({}), [])

  // The route on the globe: stops with coordinates, in order, plus every pin.
  const stops = useMemo(
    () =>
      (trip?.destinations ?? [])
        .filter((stop) => stop.lat !== null && stop.lon !== null)
        .map((stop) => [stop.lat as number, stop.lon as number] as [number, number]),
    [trip?.destinations],
  )
  const points = useMemo<GlobePoint[]>(() => {
    const pins: GlobePoint[] = (mapData.data?.features ?? []).map((feature) => ({
      lat: feature.geometry.coordinates[1],
      lon: feature.geometry.coordinates[0],
      size: 0.05,
    }))
    const route: GlobePoint[] = stops.map(([lat, lon]) => ({ lat, lon, size: 0.11, hot: true }))
    return [...pins, ...route]
  }, [mapData.data, stops])
  const current = trip?.destinations.find((stop) => stop.is_current)
  const focus: [number, number] | undefined =
    current?.lat != null && current?.lon != null ? [current.lat, current.lon] : stops[0]

  const dates = `${trip?.start_date ?? 'no fixed start'} → ${trip?.end_date ?? 'open ended'}`

  return (
    <div className="screen">
      <header className="hero" style={{ paddingBottom: 'var(--s-3)' }}>
        <div className="hero__top">
          <span className="t-small dim">Your trip</span>
          <AskButton />
        </div>
        <div className="row row--top" style={{ gap: 'var(--s-3)' }}>
          <div className="grow">
            <motion.h1
              className="t-display hero__title"
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring}
            >
              {trip?.name ?? 'Trip'}
            </motion.h1>
            <div className="hero__line">
              <span className="num">{dates}</span>
              {trip?.total_budget != null && (
                <span className="num">
                  {trip.total_budget} {trip.base_currency} budget
                </span>
              )}
            </div>
            {current && (
              <div style={{ marginTop: 'var(--s-3)' }}>
                <Stamp tone="coral" size="sm" rotate={-5}>
                  Now in {current.name}
                </Stamp>
              </div>
            )}
          </div>
          {/* The trip on a globe: route stops joined by arcs, every pin as a dot. */}
          <motion.div
            className="trip-globe"
            initial={reduced ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <Globe points={points} route={stops} focus={focus} size={148} spin={0.0018} />
          </motion.div>
        </div>
      </header>

      <Segmented
        label="Trip sections"
        value={section}
        onChange={setSection}
        options={[
          { value: 'plan', label: 'Plan' },
          { value: 'bookings', label: 'Bookings' },
          { value: 'money', label: 'Money' },
        ]}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={section}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: -6 }}
          transition={spring}
        >
          {section === 'plan' && <PlanSection />}
          {section === 'bookings' && <BookingsSection />}
          {section === 'money' && <MoneySection />}
        </motion.div>
      </AnimatePresence>

      <SectionLabel>Account</SectionLabel>
      <div className="pad stack">
        <a className="btn btn--block" href={api.exportUrl} download>
          <Download size={16} strokeWidth={2.2} />
          Export everything
        </a>
        <p className="t-small dimmer">
          The export contains places, sources, notes, statuses, route, bookings and expenses.
        </p>
        <button className="btn btn--ghost btn--block" onClick={signOut}>
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
  const destinations = trip?.destinations ?? []
  const currentIndex = destinations.findIndex((stop) => stop.is_current)

  return (
    <>
      <SectionLabel count={destinations.length}>Route</SectionLabel>
      <MotionList className="stepper" as="ol">
        {destinations.map((destination, index) => {
          const state =
            index === currentIndex ? 'current' : currentIndex >= 0 && index < currentIndex ? 'past' : 'ahead'
          return (
            <MotionRow key={destination.id} className={`stepper__item stepper__item--${state}`}>
              <span className="stepper__spine">
                <span className="stepper__num">{index + 1}</span>
              </span>
              <div className="stepper__body">
                <div className="row between row--top">
                  <p className="stepper__name">{destination.name}</p>
                  {destination.is_current && (
                    <Stamp tone="coral" size="sm" rotate={4}>
                      Here now
                    </Stamp>
                  )}
                </div>
                <Meta parts={[destination.country, destination.arrive_on ?? 'no date']} />
              </div>
            </MotionRow>
          )
        })}
      </MotionList>

      <form className="pad row" style={{ paddingTop: 'var(--s-3)', gap: 'var(--s-2)' }} onSubmit={addStop}>
        <input
          className="input grow"
          placeholder="Add a stop — dates optional"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="New route stop"
        />
        <button className="btn btn--ink" type="submit" disabled={!name.trim()} aria-label="Add stop" style={{ paddingInline: 14 }}>
          <Plus size={18} strokeWidth={2.4} />
        </button>
      </form>

      <SectionLabel>Day plan</SectionLabel>
      {itinerary.loading && !itinerary.data && <SkeletonRows rows={3} />}
      {itinerary.error && <ErrorNote message={itinerary.error} onRetry={itinerary.reload} />}
      {itinerary.data?.length === 0 && (
        <Empty
          stamp="Open day"
          title="Nothing scheduled"
          body="Add a place to a day from its page, or ask the assistant whether now is a good moment."
        />
      )}

      {Object.entries(byDate).map(([date, items]) => (
        <section key={date}>
          <p className="pad t-head num" style={{ paddingTop: 'var(--s-4)', paddingBottom: 'var(--s-2)' }}>
            {date}
          </p>
          <ol className="timeline">
            {items.map((item) => (
              <li key={item.id} className="timeline__item">
                <span className="timeline__time">{item.start_time ?? '—'}</span>
                <span className="timeline__spine">
                  <span className="timeline__dot" />
                </span>
                <span className="timeline__body">
                  <span className="t-head grow clamp-1">{item.title}</span>
                  <button
                    className="icon-btn"
                    style={{ width: 36, height: 36, marginRight: -8 }}
                    aria-label={`Remove ${item.title}`}
                    onClick={() => api.removeFromPlan(item.id).then(itinerary.reload)}
                  >
                    <Trash2 size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
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
      <div className="pad" style={{ paddingTop: 'var(--s-4)' }}>
        <Note Icon={Ticket}>
          TripStash never books anything itself. Reserve with the provider, then bring the
          confirmation back here so it attaches to your route.
        </Note>
      </div>

      {bookings.loading && !bookings.data && <SkeletonRows rows={2} />}

      {bookings.data && bookings.data.length > 0 && (
        <MotionList>
          {bookings.data.map((booking) => (
            <MotionRow key={String(booking.id)}>
              <div className="item item--static">
                <Glyph Icon={Ticket} tint="gold" />
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
            </MotionRow>
          ))}
        </MotionList>
      )}

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
        <button className="btn btn--ink btn--block" type="submit" disabled={busy || !form.title.trim()}>
          Save booking
        </button>
      </form>
    </>
  )
}

const CATEGORIES = ['food', 'accommodation', 'transport', 'activity', 'other']

function MoneySection() {
  const { trip } = useApp()
  const { reduced } = useMotionPrefs()
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
          <div className="card card--ink" style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'center' }}>
            <div className="grow">
              <MoneyFigure amount={total} currency={expenses.data.currency} />
              {trip?.total_budget != null && (
                <p className="t-small dimmer num" style={{ marginTop: 8 }}>
                  of {trip.total_budget} {trip.base_currency}
                </p>
              )}
            </div>
            {trip?.total_budget != null && (
              <div style={{ width: 116, flex: 'none', color: 'var(--paper)' }}>
                <BudgetArc spent={total} budget={trip.total_budget} />
              </div>
            )}
          </div>

          <div className="stack-2" style={{ marginTop: 'var(--s-5)' }}>
            {Object.entries(expenses.data.by_category).map(([category, amount]) => (
              <div key={category}>
                <div className="row between t-small">
                  <span style={{ textTransform: 'capitalize' }}>{category}</span>
                  <span className="num dim">{amount.toFixed(0)}</span>
                </div>
                <div className="meter meter--teal" style={{ marginTop: 4 }}>
                  <motion.span
                    initial={reduced ? false : { width: 0 }}
                    animate={{ width: `${(amount / max) * 100}%` }}
                    transition={{ type: 'spring', stiffness: 80, damping: 20 }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <form className="pad stack" onSubmit={submit} style={{ paddingTop: 'var(--s-6)' }}>
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
          <label className="field" style={{ width: 96 }}>
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
            <Pill key={category} on={form.category === category} onClick={() => setForm({ ...form, category })}>
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

        <button className="btn btn--ink btn--block" type="submit" disabled={busy || !form.amount}>
          Add expense
        </button>
      </form>

      {expenses.data && expenses.data.items.length > 0 && (
        <MotionList>
          {expenses.data.items.map((item) => (
            <MotionRow key={item.id}>
              <div className="item item--static">
                <div className="item__body">
                  <p className="t-head clamp-1">{item.note || item.category}</p>
                  <Meta parts={[item.spent_on, item.category]} />
                </div>
                <span className="t-head num" style={{ flex: 'none' }}>
                  {item.amount} {item.currency}
                </span>
              </div>
            </MotionRow>
          ))}
        </MotionList>
      )}
    </>
  )
}
