import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import { useMotionPrefs } from '../lib/motion'
import { tick } from '../lib/haptics'
import type { GlobePoint } from '../components/Globe'
import type { Flight } from '../components/EarthGlobe'
import Planet from '../components/Planet'
import Starfield from '../components/Starfield'
import { Stamp } from '../components/Stamp'
import { Glyph, KNOWLEDGE_LABEL, Note, categoryTint, knowledgeTint } from '../components/ui'
import type { AskCard, Recommendation } from '../lib/types'
import { CATEGORY_ICON, Check, KNOWLEDGE_ICON, MapPin, Plus, Search, Sparkles, X } from '../components/icons'


interface Suggestion {
  name: string
  country: string | null
  lat: number
  lon: number
}

/**
 * City lookup through OpenStreetMap's Nominatim — free, no key, and honest
 * about what it is. Cities only, so "Guatemala" offers the city, not the
 * country. Fails quietly offline: a stop can still be added by name.
 */
async function lookup(query: string, signal: AbortSignal): Promise<Suggestion[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '5')
  url.searchParams.set('featuretype', 'city')
  url.searchParams.set('addressdetails', '1')
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) return []
  const rows = (await response.json()) as {
    display_name: string
    name?: string
    lat: string
    lon: string
    address?: { country?: string }
  }[]
  return rows.map((row) => ({
    name: row.name || row.display_name.split(',')[0],
    country: row.address?.country ?? null,
    lat: Number(row.lat),
    lon: Number(row.lon),
  }))
}

/**
 * The journey, full screen: the whole route on the Earth, the stops beneath
 * it, and one place to add the next one. Where you are now is a tap away.
 */
export default function Journey() {
  const { trip, reloadTrip } = useApp()
  const navigate = useNavigate()
  const { reduced, spring } = useMotionPrefs()
  useScreenContext({ surface: 'trip', label: 'Your route' })

  const mapData = useAsync(() => api.map({}), [])
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const [flight, setFlight] = useState<Flight | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [stash, setStash] = useState<Recommendation | null>(null)
  const [stashBusy, setStashBusy] = useState(false)

  const destinations = trip?.destinations ?? []
  const stops = useMemo(
    () =>
      destinations
        .filter((stop) => stop.lat !== null && stop.lon !== null)
        .map((stop) => [stop.lat as number, stop.lon as number] as [number, number]),
    [destinations],
  )
  const points = useMemo<GlobePoint[]>(
    () =>
      (mapData.data?.features ?? []).map((feature) => ({
        lat: feature.geometry.coordinates[1],
        lon: feature.geometry.coordinates[0],
        size: 0.05,
      })),
    [mapData.data],
  )
  const current = destinations.find((stop) => stop.is_current)
  const focus: [number, number] | undefined =
    current?.lat != null && current?.lon != null ? [current.lat, current.lon] : stops[stops.length - 1]

  // Debounced lookup while typing.
  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setSuggestions([])
      return
    }
    const controller = new AbortController()
    const id = window.setTimeout(async () => {
      setSearching(true)
      try {
        setSuggestions(await lookup(term, controller.signal))
      } catch {
        setSuggestions([])
      } finally {
        setSearching(false)
      }
    }, 320)
    return () => {
      window.clearTimeout(id)
      controller.abort()
    }
  }, [query])

  // What you stashed for a stop: grounded in your own saves, never a web result.
  async function showStash(name: string) {
    setPicked(name)
    setStashBusy(true)
    try {
      const { data } = await api.recommend(name)
      setStash(data)
    } catch {
      setStash(null)
    } finally {
      setStashBusy(false)
    }
  }

  async function addStop(stop: { name: string; country?: string | null; lat?: number; lon?: number }) {
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
      setQuery('')
      setSuggestions([])
      // Fly the new leg: from the last stop with coordinates to this one.
      const last = stops[stops.length - 1]
      if (last && stop.lat != null && stop.lon != null) {
        setFlight({ from: last, to: [stop.lat, stop.lon], key: Date.now() })
      }
      reloadTrip()
      window.setTimeout(() => setAdded(null), 1600)
      void showStash(stop.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that stop.')
    } finally {
      setBusy(false)
    }
  }

  const globeSize = Math.min(560, Math.round(window.innerWidth * 1.35))

  return (
    <div className="journey-screen">
      <Starfield count={140} />

      <div className="journey-screen__globe" style={{ width: globeSize, height: globeSize, marginLeft: -globeSize / 2 }}>
        <Planet points={points} route={stops} focus={focus} flight={flight} size={globeSize} spin={0.0016} />
      </div>

      <header className="journey-screen__top">
        <button className="icon-btn icon-btn--glass" onClick={() => navigate(-1)} aria-label="Back">
          <X size={19} />
        </button>
        <div className="journey-screen__title">
          <span className="t-head">{trip?.name ?? 'Your route'}</span>
          <span className="t-small" style={{ color: 'var(--ink-2)' }}>
            {stops.length === 0 ? 'Add your first stop' : `${destinations.length} stop${destinations.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <span style={{ width: 44 }} />
      </header>

      <div className="journey-screen__panel">
        {destinations.length > 0 && (
          <div className="rail" style={{ paddingInline: 0, marginBottom: 'var(--s-3)' }}>
            {destinations.map((stop, index) => (
              <motion.button
                key={stop.id}
                type="button"
                className={`stop-chip${stop.is_current ? ' stop-chip--current' : ''}`}
                whileTap={{ scale: 0.96 }}
                onClick={() => (picked === stop.name ? setPicked(null) : void showStash(stop.name))}
                aria-pressed={picked === stop.name}
                title={`What you stashed for ${stop.name}`}
              >
                <span className="stop-chip__num">{index + 1}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t-head clamp-1" style={{ display: 'block' }}>{stop.name}</span>
                  <span className="t-small clamp-1" style={{ display: 'block', color: 'var(--ink-2)' }}>
                    {stop.is_current ? 'Here now' : stop.country ?? stop.arrive_on ?? 'no date'}
                  </span>
                </span>
              </motion.button>
            ))}
          </div>
        )}

        <AnimatePresence initial={false}>
          {picked && (
            <motion.section
              key={picked}
              className="stash"
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: 6 }}
              transition={spring}
              aria-label={`What you stashed for ${picked}`}
            >
              <div className="row between" style={{ marginBottom: 'var(--s-2)' }}>
                <span className="row" style={{ gap: 6 }}>
                  <Sparkles size={15} strokeWidth={2.2} style={{ color: 'var(--teal)' }} />
                  <span className="t-head">{picked}</span>
                </span>
                {(() => {
                  const stop = destinations.find((d) => d.name === picked)
                  if (!stop) return null
                  return stop.is_current ? (
                    <Stamp tone="coral" size="sm" rotate={4}>
                      Here now
                    </Stamp>
                  ) : (
                    <button
                      className="btn btn--sm btn--ghost"
                      onClick={async () => {
                        await api.updateDestination(stop.id, { is_current: true })
                        tick()
                        reloadTrip()
                      }}
                    >
                      I'm here now
                    </button>
                  )
                })()}
              </div>
              <p className="t-small" style={{ color: 'var(--ink-2)' }}>
                {stashBusy ? 'Looking through your stash…' : stash?.summary}
              </p>
              {stash && stash.cards.length > 0 && (
                <ul className="stash__list">
                  {stash.cards.slice(0, 4).map((card, index) => (
                    <li key={index}>
                      <StashRow card={card} />
                    </li>
                  ))}
                </ul>
              )}
              {stash && !stash.grounded && (
                <p className="t-small" style={{ color: 'var(--ink-3)', marginTop: 6 }}>
                  Summary written by the assistant from these items only.
                </p>
              )}
            </motion.section>
          )}
        </AnimatePresence>

        <div className="searchbar searchbar--space" style={{ marginInline: 0 }}>
          <Search size={17} className="dimmer" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={destinations.length ? 'Add the next stop — a city' : 'Where does it start? A city'}
            aria-label="Search for a city to add"
            autoComplete="off"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && query.trim() && suggestions.length === 0) addStop({ name: query.trim() })
            }}
          />
          {query && (
            <button className="icon-btn" onClick={() => setQuery('')} aria-label="Clear">
              <X size={16} />
            </button>
          )}
        </div>

        <AnimatePresence initial={false}>
          {(suggestions.length > 0 || (query.trim().length >= 2 && !searching)) && (
            <motion.ul
              className="suggest"
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: 6 }}
              transition={spring}
            >
              {suggestions.map((suggestion) => (
                <li key={`${suggestion.lat},${suggestion.lon}`}>
                  <button className="suggest__row" disabled={busy} onClick={() => addStop(suggestion)}>
                    <Plus size={16} strokeWidth={2.4} />
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="t-head clamp-1" style={{ display: 'block' }}>{suggestion.name}</span>
                      {suggestion.country && (
                        <span className="t-small clamp-1" style={{ display: 'block', color: 'var(--ink-2)' }}>{suggestion.country}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
              {suggestions.length === 0 && (
                <li>
                  <button className="suggest__row" disabled={busy} onClick={() => addStop({ name: query.trim() })}>
                    <Plus size={16} strokeWidth={2.4} />
                    <span className="grow">
                      <span className="t-head" style={{ display: 'block' }}>Add “{query.trim()}” as written</span>
                      <span className="t-small" style={{ display: 'block', color: 'var(--ink-2)' }}>
                        No match found — it goes on the route without a pin.
                      </span>
                    </span>
                  </button>
                </li>
              )}
            </motion.ul>
          )}
        </AnimatePresence>

        {searching && <p className="t-small" style={{ color: 'var(--ink-3)', marginTop: 'var(--s-2)' }}>Looking that up…</p>}
        {error && (
          <div style={{ marginTop: 'var(--s-2)' }}>
            <Note tone="danger">{error}</Note>
          </div>
        )}
        <AnimatePresence>
          {added && (
            <motion.div
              key="added"
              initial={reduced ? false : { opacity: 0, scale: 1.4, rotate: -14 }}
              animate={{ opacity: 1, scale: 1, rotate: -6 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              style={{ marginTop: 'var(--s-3)', display: 'inline-flex' }}
            >
              <Stamp tone="teal" size="lg" Icon={Check} flat>
                {added} added
              </Stamp>
            </motion.div>
          )}
        </AnimatePresence>
        <p className="t-small" style={{ color: 'var(--ink-3)', marginTop: 'var(--s-3)' }}>
          Search by city, not country. Tap a stop to mark it as where you are now.
        </p>
      </div>
    </div>
  )
}


function StashRow({ card }: { card: AskCard }) {
  const isPlace = card.type === 'place'
  const category = card.subtitle?.split(',')[0]?.trim() ?? 'other'
  const Icon = isPlace
    ? CATEGORY_ICON[category] ?? MapPin
    : KNOWLEDGE_ICON[card.knowledge_type ?? 'general'] ?? KNOWLEDGE_ICON.general
  const tint = isPlace ? categoryTint(category) : knowledgeTint(card.knowledge_type)
  const label = isPlace ? category : KNOWLEDGE_LABEL[card.knowledge_type ?? 'general']
  const when = card.when
  return (
    <div className="stash__row">
      <Glyph Icon={Icon} tint={tint} />
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="t-head clamp-1">{card.title}</span>
        <span className="t-small clamp-2" style={{ color: 'var(--ink-2)' }}>
          {[when, label, card.why_saved ?? card.body].filter(Boolean).join(' · ')}
        </span>
      </span>
      {isPlace && card.status === 'must_visit' && (
        <Stamp tone="coral" size="sm" rotate={-5}>
          Must
        </Stamp>
      )}
    </div>
  )
}
