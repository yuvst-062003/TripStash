import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ApiError, api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import { EXIT, useMotionPrefs } from '../lib/motion'
import { STAMP_PATTERN, tick } from '../lib/haptics'
import type { GlobePoint } from '../components/Globe'
import { type Flight, isShortLeg } from '../components/EarthGlobe'
import Planet from '../components/Planet'
import Starfield from '../components/Starfield'
import { Stamp } from '../components/Stamp'
import { CATEGORY_LABEL, Glyph, KNOWLEDGE_LABEL, Note, categoryTint, fmtDay, knowledgeTint } from '../components/ui'
import type { AskCard, Destination, Recommendation } from '../lib/types'
import { CATEGORY_ICON, Check, ChevronRight, KNOWLEDGE_ICON, MapPin, Plus, Search, Trash2, X } from '../components/icons'

interface Suggestion {
  name: string
  region: string | null
  country: string | null
  lat: number
  lon: number
}

const PLACE_KINDS = new Set(['city', 'town', 'village', 'municipality', 'hamlet', 'suburb', 'island'])

const normal = (text: string | null | undefined) =>
  (text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

/** Kilometres between two points, near enough for "is this the same town". */
function kmBetween(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180
  const x = (b[1] - a[1]) * rad * Math.cos(((a[0] + b[0]) / 2) * rad)
  const y = (b[0] - a[0]) * rad
  return Math.sqrt(x * x + y * y) * 6371
}

/** The same stop under another name: "Antigua" and "Antigua Guatemala", or a pin within 15 km. */
function sameStop(existing: Destination, candidate: { name: string; country?: string | null; lat?: number; lon?: number }) {
  const a = normal(existing.name)
  const b = normal(candidate.name)
  const sameCountry = !candidate.country || !existing.country || normal(existing.country) === normal(candidate.country)
  if (sameCountry && (a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `))) return true
  if (existing.lat != null && existing.lon != null && candidate.lat != null && candidate.lon != null) {
    return kmBetween([existing.lat, existing.lon], [candidate.lat, candidate.lon]) < 15
  }
  return false
}

/**
 * City lookup through OpenStreetMap's Nominatim — free, no key, and honest
 * about what it is. Nominatim ignores its own "cities only" flag, so the rows
 * are filtered here: places, not amenities or whole countries. Fails loudly
 * offline: a stop can still be added by name, without a pin.
 */
async function lookup(query: string, signal: AbortSignal): Promise<Suggestion[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '8')
  url.searchParams.set('addressdetails', '1')
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Lookup failed (${response.status})`)
  const rows = (await response.json()) as {
    display_name: string
    name?: string
    lat: string
    lon: string
    class?: string
    addresstype?: string
    address?: { country?: string; state?: string; region?: string; county?: string }
  }[]
  const placesOnly = rows.filter(
    (row) => (row.class === 'place' || row.class === 'boundary') && PLACE_KINDS.has(row.addresstype ?? ''),
  )
  const kept = (placesOnly.length ? placesOnly : rows.filter((row) => row.class !== 'amenity' && row.class !== 'shop'))
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const row of kept) {
    const name = row.name || row.display_name.split(',')[0]
    const country = row.address?.country ?? null
    const key = `${normal(name)}|${normal(country)}`
    if (seen.has(key)) continue
    seen.add(key)
    const region = row.address?.state ?? row.address?.region ?? row.address?.county ?? null
    out.push({ name, region: region && region !== name ? region : null, country, lat: Number(row.lat), lon: Number(row.lon) })
  }
  return out.slice(0, 5)
}

/**
 * The journey, full screen: the whole route on the Earth, the stops beneath
 * it, and one place to add the next one. Where you are now is a tap away.
 */
export default function Journey() {
  const { trip, reloadTrip } = useApp()
  const navigate = useNavigate()
  const { reduced, spring, stamp } = useMotionPrefs()
  useScreenContext({ surface: 'trip', label: 'Your route' })

  const mapData = useAsync(() => api.map({}), [], true, 'trip:map')
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  // Pending from the first keystroke, so "no match" is never claimed before looking.
  const [pending, setPending] = useState(false)
  const [lookupFailed, setLookupFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const [flight, setFlight] = useState<Flight | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [stash, setStash] = useState<Recommendation | null>(null)
  const [stashBusy, setStashBusy] = useState(false)
  const [live, setLive] = useState('')
  const chipRefs = useRef(new Map<string, HTMLButtonElement>())
  const panelHead = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)

  const destinations = trip?.destinations ?? []
  const stops = useMemo(
    () =>
      destinations
        .filter((stop) => stop.lat !== null && stop.lon !== null)
        .map((stop) => [stop.lat as number, stop.lon as number] as [number, number]),
    [destinations],
  )
  const current = destinations.find((stop) => stop.is_current)
  const points = useMemo<GlobePoint[]>(() => {
    const pins: GlobePoint[] = (mapData.data?.features ?? []).map((feature) => ({
      lat: feature.geometry.coordinates[1],
      lon: feature.geometry.coordinates[0],
      size: 0.05,
    }))
    // Coral on the globe is one thing only: where you are now.
    if (current?.lat != null && current?.lon != null) pins.push({ lat: current.lat, lon: current.lon, size: 0.11, hot: true })
    return pins
  }, [mapData.data, current?.lat, current?.lon])
  const focus: [number, number] | undefined =
    current?.lat != null && current?.lon != null ? [current.lat, current.lon] : stops[stops.length - 1]
  // A route that spans a region gets the camera close enough to read it.
  const zoom = useMemo(() => {
    if (stops.length === 0) return 3.4
    if (stops.length < 2) return 2.4
    const lats = stops.map((s) => s[0])
    const lons = stops.map((s) => s[1])
    const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons))
    return span < 5 ? 1.6 : span < 12 ? 2.0 : span < 40 ? 2.6 : 3.4
  }, [stops])
  const pickedStop = destinations.find((stop) => stop.id === picked)

  // The current stop's chip is in view when the screen opens.
  useEffect(() => {
    if (!current) return
    chipRefs.current.get(current.id)?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'instant' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  // Debounced lookup while typing.
  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setSuggestions([])
      setPending(false)
      setLookupFailed(false)
      return
    }
    setPending(true)
    setLookupFailed(false)
    const controller = new AbortController()
    const id = window.setTimeout(async () => {
      try {
        setSuggestions(await lookup(term, controller.signal))
        setPending(false)
      } catch (err) {
        if (controller.signal.aborted) return
        setSuggestions([])
        setLookupFailed(true)
        setPending(false)
        void err
      }
    }, 320)
    return () => {
      window.clearTimeout(id)
      controller.abort()
    }
  }, [query])

  // What you stashed for a stop: grounded in your own saves, never a web result.
  async function showStash(stop: Destination) {
    setPicked(stop.id)
    setStashBusy(true)
    setStash(null)
    try {
      const { data } = await api.recommend(stop.name)
      setStash(data)
    } catch {
      setStash(null)
    } finally {
      setStashBusy(false)
    }
  }
  function closeStash() {
    const id = picked
    setPicked(null)
    if (id) window.setTimeout(() => chipRefs.current.get(id)?.focus(), 0)
  }
  useEffect(() => {
    if (!picked) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeStash()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked])

  async function addStop(stop: { name: string; country?: string | null; lat?: number; lon?: number }) {
    if (busy) return
    const twin = destinations.find((d) => sameStop(d, stop))
    if (twin) {
      const at = destinations.indexOf(twin) + 1
      setError(`${twin.name} is already stop ${at} on your route.`)
      setQuery('')
      setSuggestions([])
      chipRefs.current.get(twin.id)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduced ? 'instant' : 'smooth' })
      chipRefs.current.get(twin.id)?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.addDestination({
        name: stop.name,
        country: stop.country ?? null,
        lat: stop.lat ?? null,
        lon: stop.lon ?? null,
      })
      tick()
      setAdded(stop.name)
      setLive(`${stop.name} added to the route`)
      setQuery('')
      setSuggestions([])
      setPicked(null)
      // Fly the new leg: from the last stop with coordinates to this one.
      const last = stops[stops.length - 1]
      if (last && stop.lat != null && stop.lon != null) {
        const to: [number, number] = [stop.lat, stop.lon]
        setFlight({ from: last, to, key: Date.now(), short: isShortLeg(last, to) })
      }
      reloadTrip()
      window.setTimeout(() => setAdded(null), 1600)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t add that stop. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function markHere(stop: Destination) {
    setError(null)
    try {
      await api.updateDestination(stop.id, { is_current: true })
      window.setTimeout(() => tick(STAMP_PATTERN), reduced ? 0 : 170)
      setLive(`You’re in ${stop.name} now`)
      reloadTrip()
      panelHead.current?.focus()
    } catch {
      setError('Couldn’t mark you there. Check your connection and try again.')
    }
  }

  async function removeStop(stop: Destination) {
    if (!confirm(`Remove ${stop.name} from the route? What you saved for it stays.`)) return
    setError(null)
    try {
      await api.removeDestination(stop.id)
      tick()
      setLive(`${stop.name} removed from the route`)
      setPicked(null)
      reloadTrip()
    } catch {
      setError(`Couldn’t remove ${stop.name}. Check your connection and try again.`)
    }
  }

  const globeSize = Math.min(560, Math.round(window.innerWidth * 1.35))
  const term = query.trim()
  const settled = term.length >= 2 && !pending
  const showList = term.length >= 2

  return (
    <div className="journey-screen night">
      <Starfield count={140} />

      <div className="journey-screen__globe" style={{ width: globeSize, height: globeSize, marginLeft: -globeSize / 2 }}>
        <Planet
          points={points}
          route={stops}
          focus={focus}
          flight={flight}
          size={globeSize}
          sway={0.35 * (zoom / 3.4) ** 3}
          zoom={zoom}
          touchAction="none"
        />
      </div>

      <header className="journey-screen__top">
        <button className="icon-btn icon-btn--glass" onClick={() => navigate('/trip')} aria-label="Back to the trip">
          <X size={19} />
        </button>
        <div className="journey-screen__title">
          <h1 className="t-title clamp-1">{trip?.name ?? 'Your route'}</h1>
          <p className="t-small" style={{ color: 'var(--ink-2)' }}>
            {destinations.length === 0
              ? 'Add your first stop'
              : `${destinations.length} stop${destinations.length === 1 ? '' : 's'}${current ? ` · in ${current.name}` : ''}`}
          </p>
        </div>
      </header>

      <div className="journey-screen__panel">
        <p className="sr-only" aria-live="polite">
          {live}
        </p>
        <AnimatePresence mode="popLayout" initial={false}>
          {pickedStop ? (
            <motion.section
              key={`stash-${pickedStop.id}`}
              layout
              className="stash"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6, transition: EXIT }}
              transition={spring}
              aria-label={`What you stashed for ${pickedStop.name}`}
            >
              <div className="row between" style={{ gap: 'var(--s-2)' }} ref={panelHead} tabIndex={-1}>
                <span className="row" style={{ gap: 'var(--s-2)', minWidth: 0 }}>
                  <span className="stop-chip__num">{destinations.indexOf(pickedStop) + 1}</span>
                  <span className="t-head clamp-1">{pickedStop.name}</span>
                </span>
                <span className="row" style={{ gap: 4, flex: 'none' }}>
                  {pickedStop.is_current ? (
                    <motion.span
                      key="here"
                      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.4, rotate: -14 }}
                      animate={{ opacity: 1, scale: 1, rotate: 4 }}
                      transition={{ ...stamp, opacity: { duration: 0.06 } }}
                      style={{ display: 'inline-flex' }}
                    >
                      <Stamp tone="coral" size="sm">
                        Here now
                      </Stamp>
                    </motion.span>
                  ) : (
                    <button className="btn btn--sm btn--ink" style={{ minHeight: 44 }} onClick={() => markHere(pickedStop)}>
                      I’m here now
                    </button>
                  )}
                  <button className="icon-btn" onClick={closeStash} aria-label="Close">
                    <X size={18} />
                  </button>
                </span>
              </div>
              <div className="stash__body">
                <p className="t-small" style={{ color: 'var(--ink-2)', marginTop: 'var(--s-2)' }}>
                  {stashBusy ? 'Looking through your stash…' : stash?.summary}
                </p>
                {stash && stash.cards.length > 0 && <StashCards cards={stash.cards} stop={pickedStop.name} />}
                {stash && !stash.grounded && (
                  <p className="t-small" style={{ color: 'var(--ink-3)', marginTop: 6 }}>
                    Summary written by the assistant from these items only.
                  </p>
                )}
              </div>
              <div className="row" style={{ marginTop: 'var(--s-3)', justifyContent: 'flex-end' }}>
                <button className="btn btn--sm btn--ghost btn--quiet" onClick={() => removeStop(pickedStop)}>
                  <Trash2 size={14} strokeWidth={2.2} />
                  Remove stop
                </button>
              </div>
            </motion.section>
          ) : destinations.length > 0 ? (
            <motion.ol
              key="chips"
              layout
              className="rail rail--bleed"
              aria-label="Stops"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: EXIT }}
              transition={spring}
            >
              {destinations.map((stop, index) => (
                <li key={stop.id}>
                  <motion.button
                    ref={(node) => {
                      if (node) chipRefs.current.set(stop.id, node)
                      else chipRefs.current.delete(stop.id)
                    }}
                    type="button"
                    className={`stop-chip${stop.is_current ? ' stop-chip--current' : ''}`}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => showStash(stop)}
                    aria-label={`${stop.name}: what you stashed for it`}
                  >
                    <span className="stop-chip__num">{index + 1}</span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="t-head clamp-1">{stop.name}</span>
                      {stop.is_current ? (
                        <Stamp tone="coral" size="sm" rotate={-4}>
                          Here now
                        </Stamp>
                      ) : (
                        <span className="t-small clamp-1" style={{ color: 'var(--ink-2)' }}>
                          {stop.country ?? (stop.arrive_on ? `From ${fmtDay(stop.arrive_on)}` : 'No pin yet')}
                        </span>
                      )}
                    </span>
                  </motion.button>
                </li>
              ))}
            </motion.ol>
          ) : null}
        </AnimatePresence>

        {/* Results grow upward from the field, so the field never moves under the finger. */}
        <AnimatePresence initial={false}>
          {showList && (
            <motion.ul
              id="stop-suggest"
              role="listbox"
              aria-label="Matching cities"
              className="suggest"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6, transition: EXIT }}
              transition={spring}
            >
              {suggestions.map((suggestion) => (
                <li key={`${suggestion.lat},${suggestion.lon}`} role="option" aria-selected={false}>
                  <button className="suggest__row" disabled={busy} onClick={() => addStop(suggestion)}>
                    <Plus size={16} strokeWidth={2.4} />
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="t-head clamp-1">{suggestion.name}</span>
                      <span className="t-small clamp-1" style={{ color: 'var(--ink-2)' }}>
                        {[suggestion.region, suggestion.country].filter(Boolean).join(', ') || 'Add to the route'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {!settled && (
                <li className="suggest__wait" role="presentation">
                  <span className="t-small" style={{ color: 'var(--ink-3)' }}>
                    Looking that up…
                  </span>
                </li>
              )}
              {settled && suggestions.length === 0 && (
                <li role="option" aria-selected={false}>
                  <button className="suggest__row" disabled={busy} onClick={() => addStop({ name: term })}>
                    <Plus size={16} strokeWidth={2.4} />
                    <span className="grow">
                      <span className="t-head" style={{ display: 'block' }}>Add “{term}” as written</span>
                      <span className="t-small" style={{ display: 'block', color: 'var(--ink-2)' }}>
                        {lookupFailed
                          ? 'Couldn’t look that up — you may be offline. No pin until you’re back.'
                          : 'No city by that name — it goes on the route without a pin.'}
                      </span>
                    </span>
                  </button>
                </li>
              )}
            </motion.ul>
          )}
        </AnimatePresence>

        {destinations.length === 0 && !showList && (
          <h2 className="t-title" style={{ marginBottom: 'var(--s-3)' }}>
            Where does it start?
          </h2>
        )}
        <div className="searchbar searchbar--space" style={{ marginInline: 0 }}>
          <Search size={17} className="dimmer" />
          <input
            ref={searchInput}
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls="stop-suggest"
            enterKeyHint="done"
            autoCapitalize="words"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setPicked(null)}
            placeholder={destinations.length ? 'Add the next stop — a city' : 'A city, like Antigua or Cusco'}
            aria-label="Search for a city to add"
            autoComplete="off"
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !term) return
              event.preventDefault()
              if (pending) return
              if (suggestions[0]) addStop(suggestions[0])
              else addStop({ name: term })
            }}
          />
          {query && (
            <button className="icon-btn" onClick={() => setQuery('')} aria-label="Clear">
              <X size={16} />
            </button>
          )}
        </div>

        {error && (
          <div style={{ marginTop: 'var(--s-2)' }} role="alert">
            <Note tone="danger">{error}</Note>
          </div>
        )}
        <AnimatePresence>
          {added && (
            <motion.div
              key="added"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.4, rotate: -14 }}
              animate={{ opacity: 1, scale: 1, rotate: -6 }}
              exit={{ opacity: 0, transition: EXIT }}
              transition={{ ...stamp, opacity: { duration: 0.06 } }}
              style={{ marginTop: 'var(--s-3)', display: 'inline-flex' }}
            >
              <Stamp tone="teal" size="lg" Icon={Check} flat>
                {added} added
              </Stamp>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/** Warnings first, then the next event, then places (must-visits lead), then the rest. */
function StashCards({ cards, stop }: { cards: AskCard[]; stop: string }) {
  const warnings = cards.filter((card) => card.knowledge_type === 'safety' || card.knowledge_type === 'border')
  const rest = cards.filter((card) => !warnings.includes(card))
  const shown = rest.slice(0, 3)
  const more = cards.length - warnings.length - shown.length
  return (
    <>
      {warnings.map((card, index) => (
        <div key={`w-${index}`} style={{ marginTop: 'var(--s-2)' }}>
          <Note tone="warn">{card.title}</Note>
        </div>
      ))}
      {shown.length > 0 && (
        <ul className="stash__list">
          {shown.map((card, index) => (
            <li key={index}>
              <StashRow card={card} />
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <Link to="/saved?tab=places" className="t-small teal" style={{ display: 'inline-block', marginTop: 'var(--s-2)', fontWeight: 600 }}>
          See all {cards.length} for {stop} in Saved
        </Link>
      )}
    </>
  )
}

function StashRow({ card }: { card: AskCard }) {
  const isPlace = card.type === 'place'
  const category = card.subtitle?.split(',')[0]?.trim() ?? 'other'
  const Icon = isPlace
    ? CATEGORY_ICON[category] ?? MapPin
    : KNOWLEDGE_ICON[card.knowledge_type ?? 'general'] ?? KNOWLEDGE_ICON.general
  const tint = isPlace ? categoryTint(category) : knowledgeTint(card.knowledge_type)
  const label = isPlace ? CATEGORY_LABEL[category] ?? 'Place' : KNOWLEDGE_LABEL[card.knowledge_type ?? 'general']
  const isEvent = card.knowledge_type === 'event'
  const body = (
    <>
      <Glyph Icon={Icon} tint={tint} />
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="t-head clamp-1">{card.title}</span>
        <span className="t-small clamp-2" style={{ color: 'var(--ink-2)' }}>
          {[!isEvent && card.when, label, card.why_saved ?? card.body].filter(Boolean).join(' · ')}
        </span>
      </span>
      {isEvent && card.when && (
        <Stamp tone="gold" size="sm" rotate={-5}>
          {card.when}
        </Stamp>
      )}
      {isPlace && card.status === 'must_visit' && (
        <Stamp tone="coral" size="sm" rotate={-5}>
          Must
        </Stamp>
      )}
      {isPlace && card.trip_place_id && <ChevronRight size={16} className="dimmer" style={{ flex: 'none' }} />}
    </>
  )
  return isPlace && card.trip_place_id ? (
    <Link to={`/places/${card.trip_place_id}`} className="stash__row stash__row--link">
      {body}
    </Link>
  ) : (
    <div className="stash__row">{body}</div>
  )
}
