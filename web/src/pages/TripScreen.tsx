import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ApiError, api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import { EXIT, FADE, useMotionPrefs } from '../lib/motion'
import { tick } from '../lib/haptics'
import { currentLocale } from '../lib/prefs'
import type { GlobePoint } from '../components/Globe'
import Planet from '../components/Planet'
import Starfield from '../components/Starfield'
import Segmented from '../components/Segmented'
import { HeroActions } from '../components/TopBar'
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
  fmtDay,
} from '../components/ui'
import { Maximize2, Plus, Ticket, Trash2 } from '../components/icons'

type Section = 'plan' | 'bookings' | 'money'

const localToday = () => new Date().toLocaleDateString('en-CA')
const dayMs = 86_400_000
const dayStart = (date: string) => new Date(`${date}T00:00:00`).getTime()
/** Whole days from today to a date: 1 is tomorrow, -1 was yesterday. */
function daysFromToday(date: string | null | undefined): number | null {
  if (!date) return null
  const then = dayStart(date)
  if (Number.isNaN(then)) return null
  return Math.round((then - dayStart(localToday())) / dayMs)
}
/** "Today", "Tomorrow", "Yesterday", or the day. */
function dayLabel(date: string): string {
  const days = daysFromToday(date)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  return fmtDay(date) ?? date
}

const EXPENSE_CATEGORIES = ['food', 'accommodation', 'transport', 'activity', 'other']
const EXPENSE_LABEL: Record<string, string> = {
  food: 'Food',
  accommodation: 'Stay',
  transport: 'Transport',
  activity: 'Activity',
  other: 'Other',
}
const BOOKING_KINDS = ['stay', 'transport', 'activity']
const BOOKING_LABEL: Record<string, string> = {
  stay: 'Stay',
  transport: 'Transport',
  activity: 'Activity',
}

const money = (amount: number, currency: string) =>
  `${amount.toLocaleString(currentLocale(), { maximumFractionDigits: 0 })} ${currency}`

/** A number typed with a comma decimal still counts. */
const parseAmount = (text: string): number => Number(text.trim().replace(',', '.'))

const failed = (err: unknown, fallback: string) =>
  err instanceof ApiError && err.status === 422
    ? err.message
    : `${fallback} Check your connection and try again.`

export default function TripScreen() {
  const { trip } = useApp()
  // Deep links from Home ("Plan", "Details") open the right section.
  const [params, setParams] = useSearchParams()
  const initial = params.get('section')
  const [section, setSectionState] = useState<Section>(
    initial === 'bookings' || initial === 'money' ? initial : 'plan',
  )
  const setSection = (next: Section) => {
    setSectionState(next)
    setParams(next === 'plan' ? {} : { section: next }, { replace: true })
  }
  const { reduced, spring } = useMotionPrefs()
  useScreenContext({ surface: 'trip' })
  // The first section is on screen as the page arrives; only later ones enter.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
  }, [])

  const mapData = useAsync(() => api.map({}), [], true, 'trip:map')

  // The route on the globe: stops with coordinates, in order, plus every pin.
  const destinations = trip?.destinations ?? []
  const stops = useMemo(
    () =>
      destinations
        .filter((stop) => stop.lat !== null && stop.lon !== null)
        .map((stop) => [stop.lat as number, stop.lon as number] as [number, number]),
    [destinations],
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
  const currentIndex = destinations.findIndex((stop) => stop.is_current)
  const current = currentIndex >= 0 ? destinations[currentIndex] : undefined
  const next = currentIndex >= 0 ? destinations[currentIndex + 1] : undefined
  const focus: [number, number] | undefined =
    current?.lat != null && current?.lon != null ? [current.lat, current.lon] : stops[0]

  // What the journey card says: the one thing nothing else on the screen says.
  const toStart = daysFromToday(trip?.start_date)
  const length =
    trip?.start_date && trip?.end_date
      ? Math.round((dayStart(trip.end_date) - dayStart(trip.start_date)) / dayMs) + 1
      : null
  const dayNumber = toStart !== null ? 1 - toStart : null
  const journey: { eyebrow: string | null; line: string; stamp?: string } = (() => {
    if (current) {
      return {
        stamp: `Now in ${current.name}`,
        eyebrow: null,
        line:
          dayNumber !== null && length && dayNumber >= 1 && dayNumber <= length
            ? `Day ${dayNumber} of ${length}${next ? ` · ${next.name} next` : ''}`
            : next
              ? `${next.name} next`
              : 'The last stop on the route',
      }
    }
    if (!trip?.start_date) return { eyebrow: 'No fixed start', line: 'Add a stop and a date when you know' }
    if (trip.phase === 'before' || (toStart !== null && toStart > 0)) {
      return {
        eyebrow: 'Getting close',
        line: toStart === 0 ? 'Leaving today' : toStart === 1 ? 'Tomorrow' : `${toStart} days to go`,
      }
    }
    if (trip.phase === 'after' || (length && dayNumber !== null && dayNumber > length)) {
      return { eyebrow: 'Home again', line: length ? `${length} days on the road` : 'The trip is over' }
    }
    return {
      eyebrow: dayNumber !== null && length ? `Day ${dayNumber} of ${length}` : 'On the road',
      line: destinations.length ? 'Tap a stop to say you’re there' : 'Add your first stop',
    }
  })()

  return (
    <div className="screen">
      <header className="hero" style={{ paddingBottom: 'var(--s-3)' }}>
        <div className="hero__top">
          <span className="t-small dim">Your trip</span>
          <HeroActions />
        </div>
        <motion.h1
          className="t-display hero__title"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
        >
          {trip?.name ?? 'Trip'}
        </motion.h1>
        <Meta
          wrap
          className="mt"
          parts={[
            trip?.start_date && trip?.end_date
              ? `${fmtDay(trip.start_date)} – ${fmtDay(trip.end_date)}`
              : trip?.start_date
                ? `From ${fmtDay(trip.start_date)}`
                : 'No dates yet',
            trip?.total_budget != null && `${money(trip.total_budget, trip.base_currency)} budget`,
          ]}
        />
      </header>

      {/* The journey: the whole route on the planet, and where you are on it. */}
      <div className="pad">
        <motion.section
          className="journey night"
          initial={reduced ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.08 }}
          aria-label="Your route on the globe"
        >
          <Link to="/trip/journey" className="journey__open" aria-label="Open the full route">
            <Maximize2 size={16} strokeWidth={2.4} />
            Open
          </Link>
          <Starfield count={70} />
          <div className="journey__globe">
            <Planet points={points} route={stops} focus={focus} size={300} spin={0.0018} />
          </div>
          <div className="journey__copy">
            {journey.stamp ? (
              <Stamp tone="coral" size="sm" rotate={-5}>
                {journey.stamp}
              </Stamp>
            ) : (
              <p className="t-small" style={{ color: '#c7d3ea' }}>
                {journey.eyebrow}
              </p>
            )}
            <p className="journey__line">{journey.line}</p>
          </div>
        </motion.section>
      </div>

      <Segmented
        name="trip"
        label="Trip sections"
        value={section}
        onChange={setSection}
        options={[
          { value: 'plan', label: 'Plan' },
          { value: 'bookings', label: 'Bookings' },
          { value: 'money', label: 'Money' },
        ]}
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={section}
          id={`trip-panel-${section}`}
          role="tabpanel"
          aria-labelledby={`trip-tab-${section}`}
          initial={!mounted.current ? false : reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0, transition: FADE } : { opacity: 0, y: -6, transition: EXIT }}
          transition={spring}
        >
          {section === 'plan' && <PlanSection />}
          {section === 'bookings' && <BookingsSection />}
          {section === 'money' && <MoneySection />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function PlanSection() {
  const { trip, reloadTrip } = useApp()
  const itinerary = useAsync(() => api.itinerary(), [], true, 'trip:itinerary')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Set<string>>(new Set())
  const stopInput = useRef<HTMLInputElement>(null)

  async function addStop(event: React.FormEvent) {
    event.preventDefault()
    const stop = name.trim()
    if (!stop || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.addDestination({ name: stop })
      setName('')
      tick()
      setStatus(`Added ${stop} to the route`)
      reloadTrip()
      stopInput.current?.focus()
    } catch (err) {
      setError(failed(err, 'Couldn’t add the stop.'))
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: { id: string; title: string }) {
    setError(null)
    setRemoving((set) => new Set(set).add(item.id))
    try {
      await api.removeFromPlan(item.id)
      tick()
      setStatus(`Removed ${item.title}`)
      itinerary.reload()
    } catch (err) {
      setRemoving((set) => {
        const nextSet = new Set(set)
        nextSet.delete(item.id)
        return nextSet
      })
      setError(failed(err, `Couldn’t remove ${item.title}.`))
    }
  }

  const rows = (itinerary.data ?? []).filter((item) => !removing.has(item.id))
  const byDate = rows.reduce<Record<string, typeof rows>>((acc, item) => {
    ;(acc[item.on_date] ??= []).push(item)
    return acc
  }, {})
  const destinations = trip?.destinations ?? []
  const currentIndex = destinations.findIndex((stop) => stop.is_current)

  return (
    <>
      <SectionLabel count={destinations.length > 1 ? destinations.length : undefined}>Route</SectionLabel>
      <MotionList className="stepper" as="ol" animateIn>
        {destinations.map((destination, index) => {
          const state =
            index === currentIndex ? 'current' : currentIndex >= 0 && index < currentIndex ? 'past' : 'ahead'
          return (
            <MotionRow key={destination.id} className={`stepper__item stepper__item--${state}`}>
              <span className="stepper__spine">
                <span className="stepper__num">{index + 1}</span>
              </span>
              <div className="stepper__body">
                <p className="stepper__name">{destination.name}</p>
                <Meta
                  parts={[
                    destination.is_current && 'Here now',
                    destination.country,
                    destination.arrive_on ? fmtDay(destination.arrive_on) : 'No date yet',
                  ]}
                />
              </div>
            </MotionRow>
          )
        })}
      </MotionList>

      <form className="pad" style={{ paddingTop: 'var(--s-3)' }} onSubmit={addStop}>
        <div className="row" style={{ gap: 'var(--s-2)' }}>
          <input
            ref={stopInput}
            className="input grow"
            placeholder="Add a stop — dates optional"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="New route stop"
            enterKeyHint="done"
          />
          <button
            className="btn btn--ink"
            type="submit"
            disabled={!name.trim()}
            aria-busy={busy}
            aria-label="Add stop"
            style={{ paddingInline: 14 }}
          >
            <Plus size={18} strokeWidth={2.4} />
          </button>
        </div>
        {error && (
          <div style={{ marginTop: 'var(--s-2)' }} role="alert">
            <Note tone="danger">{error}</Note>
          </div>
        )}
      </form>
      <p className="sr-only" role="status">
        {status}
      </p>

      <SectionLabel>Day plan</SectionLabel>
      {itinerary.loading && !itinerary.data && <SkeletonRows rows={3} />}
      {itinerary.error && <ErrorNote message={itinerary.error} onRetry={itinerary.reload} />}
      {itinerary.data && rows.length === 0 && (
        <Empty
          stamp="Open day"
          title="Nothing scheduled"
          body="Add a place to a day from its page, or ask the assistant whether now is a good moment."
        />
      )}

      {Object.entries(byDate).map(([date, items]) => {
        const past = (daysFromToday(date) ?? 0) < 0
        return (
          <section key={date}>
            <h3
              className="pad t-head"
              style={{
                paddingTop: 'var(--s-4)',
                paddingBottom: 'var(--s-2)',
                color: past ? 'var(--ink-3)' : undefined,
              }}
            >
              {dayLabel(date)}
              {daysFromToday(date) === 0 && <span className="dimmer"> · {fmtDay(date)}</span>}
            </h3>
            <ol className="timeline">
              <AnimatePresence initial={false}>
                {items.map((item) => (
                  <motion.li
                    key={item.id}
                    className="timeline__item"
                    layout
                    exit={{ opacity: 0, transition: EXIT }}
                  >
                    <span className="timeline__time">
                      {item.start_time ?? '—'}
                      {item.end_time && (
                        <>
                          <br />
                          <span className="dimmer" style={{ font: 'var(--tiny)' }}>
                            {item.end_time}
                          </span>
                        </>
                      )}
                    </span>
                    <span className="timeline__spine">
                      <span className={`timeline__dot${item.is_done ? ' timeline__dot--done' : ''}`} />
                    </span>
                    <span className="timeline__body">
                      <span className="t-head grow clamp-2">{item.title}</span>
                      <button
                        className="icon-btn dimmer"
                        style={{ marginRight: -12, flex: 'none' }}
                        aria-label={`Remove ${item.title}`}
                        onClick={() => remove(item)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          </section>
        )
      })}
    </>
  )
}

function BookingsSection() {
  const { trip } = useApp()
  const bookings = useAsync(() => api.bookings(), [], true, 'trip:bookings')
  const [form, setForm] = useState({ kind: 'stay', title: '', provider: '', confirmation_code: '', amount: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Set<string>>(new Set())
  const titleInput = useRef<HTMLInputElement>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    const amount = form.amount.trim() ? parseAmount(form.amount) : null
    if (amount !== null && !(amount >= 0)) {
      setError('Enter the amount as a number, like 45 or 12.50.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.addBooking({
        kind: form.kind,
        title: form.title.trim(),
        provider: form.provider.trim() || null,
        confirmation_code: form.confirmation_code.trim() || null,
        amount,
      })
      setForm({ kind: form.kind, title: '', provider: '', confirmation_code: '', amount: '' })
      tick()
      setStatus(`Saved ${form.title.trim()}`)
      bookings.reload()
      titleInput.current?.focus()
    } catch (err) {
      setError(failed(err, 'Couldn’t save the booking.'))
    } finally {
      setBusy(false)
    }
  }

  async function remove(booking: { id: string; title: string }) {
    setError(null)
    setRemoving((set) => new Set(set).add(booking.id))
    try {
      await api.removeBooking(booking.id)
      tick()
      setStatus(`Removed ${booking.title}`)
      bookings.reload()
    } catch (err) {
      setRemoving((set) => {
        const nextSet = new Set(set)
        nextSet.delete(booking.id)
        return nextSet
      })
      setError(failed(err, `Couldn’t remove ${booking.title}.`))
    }
  }

  const rows = (bookings.data ?? []).filter((booking) => !removing.has(booking.id))

  return (
    <>
      {bookings.loading && !bookings.data && <SkeletonRows rows={2} />}
      {bookings.error && <ErrorNote message={bookings.error} onRetry={bookings.reload} />}

      {bookings.data && rows.length === 0 && (
        <Empty
          stamp="Nothing booked"
          title="No confirmations yet"
          body="TripStash never books anything itself. Reserve with the provider, then bring the code back here so it sits on your route."
        />
      )}

      {rows.length > 0 && (
        <>
          <SectionLabel count={rows.length > 1 ? rows.length : undefined}>Bookings</SectionLabel>
          <MotionList animateIn>
            <AnimatePresence initial={false}>
              {rows.map((booking) => (
                <MotionRow key={booking.id} layout>
                  <div className="item item--static">
                    <Glyph Icon={Ticket} tint="gold" />
                    <div className="item__body">
                      <p className="item__title clamp-2">{booking.title}</p>
                      <Meta
                        wrap
                        parts={[
                          BOOKING_LABEL[booking.kind] ?? booking.kind,
                          booking.provider,
                          booking.confirmation_code && `Ref ${booking.confirmation_code}`,
                          booking.amount != null && money(booking.amount, booking.currency ?? trip?.base_currency ?? ''),
                        ]}
                      />
                    </div>
                    <button
                      className="icon-btn dimmer"
                      style={{ marginRight: -10, flex: 'none' }}
                      aria-label={`Remove ${booking.title}`}
                      onClick={() => remove(booking)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </MotionRow>
              ))}
            </AnimatePresence>
          </MotionList>
        </>
      )}
      <p className="sr-only" role="status">
        {status}
      </p>

      <SectionLabel>Add a booking</SectionLabel>
      <form className="pad stack" onSubmit={submit}>
        <div role="group" aria-label="What kind" className="row row--wrap" style={{ gap: 'var(--s-2)' }}>
          {BOOKING_KINDS.map((kind) => (
            <Pill key={kind} on={form.kind === kind} onClick={() => setForm({ ...form, kind })}>
              {BOOKING_LABEL[kind]}
            </Pill>
          ))}
        </div>
        <label className="field">
          <span>What was booked</span>
          <input
            ref={titleInput}
            className="input"
            value={form.title}
            required
            placeholder={form.kind === 'stay' ? 'Hostel, 2 nights' : form.kind === 'transport' ? 'Night bus to Flores' : 'Volcano hike'}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </label>
        <div className="row" style={{ gap: 'var(--s-2)' }}>
          <label className="field grow">
            <span>Provider</span>
            <input
              className="input"
              value={form.provider}
              placeholder="Optional"
              onChange={(event) => setForm({ ...form, provider: event.target.value })}
            />
          </label>
          <label className="field grow">
            <span>Confirmation code</span>
            <input
              className="input"
              value={form.confirmation_code}
              placeholder="Optional"
              autoCapitalize="characters"
              onChange={(event) => setForm({ ...form, confirmation_code: event.target.value })}
            />
          </label>
        </div>
        <label className="field">
          <span>Amount{trip ? ` (${trip.base_currency})` : ''}</span>
          <input
            className="input"
            inputMode="decimal"
            value={form.amount}
            placeholder="Optional"
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
          />
        </label>
        {error && (
          <div role="alert">
            <Note tone="danger">{error}</Note>
          </div>
        )}
        <button className="btn btn--ink btn--block" type="submit" disabled={!form.title.trim()} aria-busy={busy}>
          {busy ? 'Saving…' : 'Save booking'}
        </button>
      </form>
    </>
  )
}

function MoneySection() {
  const { trip } = useApp()
  const { reduced, spring } = useMotionPrefs()
  const expenses = useAsync(() => api.expenses(), [], true, 'trip:expenses')
  const [form, setForm] = useState({
    amount: '',
    currency: trip?.base_currency ?? 'USD',
    category: 'food',
    note: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Set<string>>(new Set())
  const amountInput = useRef<HTMLInputElement>(null)
  // Meters grow once per visit, not on every refetch.
  const metersShown = useRef(false)
  useEffect(() => {
    if (expenses.data) metersShown.current = true
  }, [expenses.data])

  const base = expenses.data?.currency ?? trip?.base_currency ?? 'USD'

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    const amount = parseAmount(form.amount)
    if (!(amount > 0)) {
      setError('Enter an amount above 0.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.addExpense({
        spent_on: localToday(),
        amount,
        currency: form.currency.trim().toUpperCase(),
        category: form.category,
        note: form.note.trim() || null,
        // Idempotency key: a replayed offline queue must not double-charge.
        client_op_id: `expense-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
      setForm({ ...form, amount: '', note: '' })
      tick()
      const code = form.currency.trim().toUpperCase()
      setStatus(
        code === data.currency
          ? `Added ${money(amount, code)}`
          : `Added ${money(amount, code)}, about ${money(data.amount_base, data.currency)}`,
      )
      expenses.reload()
      amountInput.current?.focus()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : ''
      setError(
        /unsupported currency pair/i.test(message)
          ? `No rate for ${form.currency.trim().toUpperCase()} yet — enter it in ${base}.`
          : failed(err, 'Couldn’t add the expense.'),
      )
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: { id: string; amount: number; currency: string }) {
    setError(null)
    setRemoving((set) => new Set(set).add(item.id))
    try {
      await api.removeExpense(item.id)
      tick()
      setStatus(`Removed ${money(item.amount, item.currency)}`)
      expenses.reload()
    } catch (err) {
      setRemoving((set) => {
        const nextSet = new Set(set)
        nextSet.delete(item.id)
        return nextSet
      })
      setError(failed(err, 'Couldn’t remove that expense.'))
    }
  }

  const total = expenses.data?.total ?? 0
  const budget = trip?.total_budget ?? null
  const over = budget != null && total > budget
  const items = (expenses.data?.items ?? []).filter((item) => !removing.has(item.id))

  return (
    <>
      <h2 className="sr-only">Money</h2>
      {expenses.loading && !expenses.data && <SkeletonRows rows={2} />}
      {expenses.error && <ErrorNote message={expenses.error} onRetry={expenses.reload} />}
      {expenses.data && (
        <div className="pad" style={{ paddingTop: 'var(--s-4)' }}>
          <div className="card card--ink" style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'center' }}>
            <div className="grow" aria-live="polite">
              <MoneyFigure amount={total} currency={base} />
              {budget != null && (
                <p className="t-small dimmer num" style={{ marginTop: 8 }}>
                  of {money(budget, base)}
                </p>
              )}
              {over && budget != null && (
                <p className="t-small num" style={{ marginTop: 4, color: 'var(--coral)', fontWeight: 600 }}>
                  Over by {money(total - budget, base)}
                </p>
              )}
            </div>
            {budget != null && (
              <div style={{ width: 116, flex: 'none', color: 'var(--paper)' }}>
                <BudgetArc spent={total} budget={budget} />
              </div>
            )}
          </div>

          {/* Each category as its share of what has gone, in the trip's currency. */}
          <div className="stack-2" style={{ marginTop: 'var(--s-5)' }}>
            {Object.entries(expenses.data.by_category).map(([category, amount]) => (
              <div key={category}>
                <div className="row between t-small">
                  <span>{EXPENSE_LABEL[category] ?? category}</span>
                  <span className="num dim">{money(amount, base)}</span>
                </div>
                <div className="meter meter--teal" style={{ marginTop: 4 }}>
                  <motion.span
                    style={{ transformOrigin: 'left' }}
                    initial={reduced || metersShown.current ? false : { scaleX: 0 }}
                    animate={{ scaleX: total > 0 ? amount / total : 0 }}
                    transition={spring}
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
              ref={amountInput}
              className="input"
              inputMode="decimal"
              required
              value={form.amount}
              aria-describedby={error ? 'expense-error' : undefined}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
            />
          </label>
          <label className="field" style={{ width: 96 }}>
            <span>Currency</span>
            <input
              className="input"
              maxLength={3}
              autoCapitalize="characters"
              value={form.currency}
              onChange={(event) => setForm({ ...form, currency: event.target.value })}
            />
          </label>
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="sr-only">Category</legend>
          <div className="row row--wrap" style={{ gap: 'var(--s-2)' }}>
            {EXPENSE_CATEGORIES.map((category) => (
              <Pill key={category} on={form.category === category} onClick={() => setForm({ ...form, category })}>
                {EXPENSE_LABEL[category]}
              </Pill>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>Note</span>
          <input
            className="input"
            placeholder="Optional"
            value={form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
          />
        </label>

        {error && (
          <div id="expense-error" role="alert">
            <Note tone="danger">{error}</Note>
          </div>
        )}

        <button className="btn btn--ink btn--block" type="submit" disabled={!form.amount} aria-busy={busy}>
          {busy ? 'Adding…' : 'Add expense'}
        </button>
      </form>
      <p className="sr-only" role="status">
        {status}
      </p>

      {items.length > 0 && (
        <>
          <SectionLabel count={items.length > 1 ? items.length : undefined}>Expenses</SectionLabel>
          <MotionList animateIn>
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <MotionRow key={item.id} layout>
                  <div className="item item--static">
                    <div className="item__body">
                      <p className="t-head clamp-1">{item.note || EXPENSE_LABEL[item.category] || item.category}</p>
                      <Meta
                        parts={[
                          dayLabel(item.spent_on),
                          item.note && (EXPENSE_LABEL[item.category] ?? item.category),
                          item.currency !== base && `≈ ${money(item.amount_base, base)}`,
                        ]}
                      />
                    </div>
                    <span className="t-head num" style={{ flex: 'none' }}>
                      {money(item.amount, item.currency)}
                    </span>
                    <button
                      className="icon-btn dimmer"
                      style={{ marginRight: -10, marginTop: -10, flex: 'none' }}
                      aria-label={`Remove ${money(item.amount, item.currency)}${item.note ? `, ${item.note}` : ''}`}
                      onClick={() => remove(item)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </MotionRow>
              ))}
            </AnimatePresence>
          </MotionList>
        </>
      )}
    </>
  )
}
