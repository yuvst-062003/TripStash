/**
 * The assistant on the trip screen: what it noticed, what you stashed for a
 * stop, and where the route could go next.
 *
 * All of it is read-only until you press something. A fix arrives as a card
 * with Add and Dismiss - the same rule the assistant follows everywhere - and
 * Dismiss is remembered on this device only, because declining a suggestion is
 * not a fact worth keeping about someone.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import type { Discover, RouteCheck, Voice } from '../lib/types'
import { SkeletonRows } from './ui'
import { ArrowUpRight, Lightbulb, Plus, Sparkles, X } from './icons'

const DISMISSED_KEY = 'tripstash.dismissed-checks'

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function remember(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]))
  } catch {
    /* private mode: it just comes back next time */
  }
}

/** What the assistant noticed about the route, newest route each time. */
export function TripChecks({
  version,
  onFix,
}: {
  /** Changes whenever the route does, so the checks are read again. */
  version: string
  onFix: (check: RouteCheck) => Promise<void>
}) {
  const checks = useAsync(() => api.routeChecks(), [version])
  const [dismissed, setDismissed] = useState(readDismissed)
  const [busy, setBusy] = useState<string | null>(null)

  const open = (checks.data ?? []).filter((c) => !dismissed.has(c.id))
  if (!open.length) return null

  const dismiss = (id: string) => {
    const next = new Set(dismissed).add(id)
    setDismissed(next)
    remember(next)
  }

  return (
    <section className="advice" aria-label="Trip check">
      <h3 className="advice__head">
        <Sparkles size={15} /> Trip check
        <span className="t-xs dim num">{open.length}</span>
      </h3>
      {open.map((check) => (
        <div key={check.id} className="advice__item">
          <div className="advice__text">
            <span className="advice__title" dir="auto">
              {check.title}
            </span>
            <span className="t-sm dim">{check.body}</span>
          </div>
          <div className="advice__actions">
            {check.fix && (
              <button
              type="button"
                className="btn btn--sm btn--accent"
                disabled={busy === check.id}
                onClick={async () => {
                  setBusy(check.id)
                  try {
                    await onFix(check)
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                {check.fix.label}
              </button>
            )}
            <button
              type="button" className="btn btn--sm" onClick={() => dismiss(check.id)}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </section>
  )
}

/** What you stashed for one stop, ranked for now. Never a web result. */
export function StopIdeas({ name }: { name: string }) {
  const ideas = useAsync(() => api.recommend(name), [name])
  if (ideas.loading && !ideas.data) return <SkeletonRows rows={2} />
  const data = ideas.data
  if (!data) return null
  const cards = data.cards.slice(0, 4)
  return (
    <div className="ideas">
      <p className="t-sm dim" dir="auto">
        <Lightbulb size={13} /> {data.summary}
      </p>
      {cards.map((card, index) =>
        card.trip_place_id ? (
          <Link key={index} className="ideas__row" to={`/places/${card.trip_place_id}`}>
            <span className="ideas__title clamp-1">{card.title}</span>
            {card.why_saved && (
              <span className="t-xs dim clamp-1" dir="auto">
                {card.why_saved}
              </span>
            )}
          </Link>
        ) : (
          <div key={index} className="ideas__row">
            <span className="ideas__title clamp-1">{card.title}</span>
            {card.subtitle && <span className="t-xs dim clamp-1">{card.subtitle}</span>}
          </div>
        ),
      )}
    </div>
  )
}

/** Cities from your own library the route skips, cheapest detour first. */
export function StopSuggestions({
  after,
  onAdd,
}: {
  after: string | undefined
  onAdd: (name: string) => Promise<void>
}) {
  const suggestions = useAsync(() => api.stopSuggestions(after), [after])
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)

  if (suggestions.loading && !suggestions.data) return <SkeletonRows rows={2} />
  const shown = (suggestions.data ?? []).filter((s) => !hidden.has(s.name))

  if (!shown.length) {
    return (
      <p className="suggest__empty t-sm dim">
        <Sparkles size={13} /> Every city you saved is already on the route.{' '}
        <Link to="/explore">Look somewhere up in Explore</Link> to find a new one.
      </p>
    )
  }

  return (
    <div className="suggest">
      <p className="t-xs dim">
        <Sparkles size={12} /> Suggested from your saved places
      </p>
      {shown.map((s) => (
        <div key={s.name} className="suggest__item">
          <div className="advice__text">
            <span className="advice__title">
              {s.name}
              {s.country && <span className="t-xs dim"> · {s.country}</span>}
            </span>
            <span className="t-sm dim">
              {s.why}
              {s.detour_km > 0 && ` · ${Math.round(s.detour_km)} km out of the way`}
            </span>
          </div>
          <div className="advice__actions">
            <button
              type="button"
              className="btn btn--sm btn--accent"
              disabled={busy === s.name}
              onClick={async () => {
                setBusy(s.name)
                try {
                  await onAdd(s.name)
                } finally {
                  setBusy(null)
                }
              }}
            >
              <Plus size={14} /> Add
            </button>
            <button
              type="button"
              className="iconbtn iconbtn--sm"
              aria-label={`Dismiss ${s.name}`}
              onClick={() => setHidden(new Set(hidden).add(s.name))}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

const SOURCE_LABEL: Record<Voice['source'], string> = {
  gringo: 'Gringo',
  reddit: 'Reddit travellers',
  youtube: 'YouTube travellers',
  web: 'Around the web',
}
const SOURCE_ORDER: Voice['source'][] = ['gringo', 'reddit', 'youtube', 'web']

/**
 * What travellers say about the stretch after a stop.
 *
 * Read here, kept there: each is a snippet with a link to where it was said,
 * labelled by source. Gringo arrives through a search engine because its own
 * rules turn other bots away. A source that is not connected says so rather
 * than showing a stand-in as if it were real.
 */
export function TravellerVoices({ after }: { after: string | undefined }) {
  const state = useAsync(() => api.discover(after), [after])
  if (state.loading && !state.data) return <SkeletonRows rows={2} />
  const data: Discover | null = state.data
  if (!data) return null
  const offline = SOURCE_ORDER.filter((source) => !data.live[source])

  return (
    <div className="voices">
      <p className="t-xs dim">
        <Sparkles size={12} /> What travellers say about this stretch
      </p>
      {SOURCE_ORDER.filter((source) => data.live[source] && data[source].length).map((source) => (
        <section key={source} className="voices__group">
          <h4 className={`voices__source voices__source--${source}`}>{SOURCE_LABEL[source]}</h4>
          {data[source].map((voice) => (
            <a
              key={voice.url}
              className="voice"
              href={voice.url}
              target="_blank"
              rel="noreferrer"
            >
              <span className="voice__title clamp-2" dir="auto">
                {voice.title}
              </span>
              {voice.snippet && (
                <span className="voice__snippet clamp-3" dir="auto">
                  “{voice.snippet}”
                </span>
              )}
              <span className="t-xs dim">
                {voice.by} <ArrowUpRight size={11} />
              </span>
            </a>
          ))}
        </section>
      ))}
      {offline.length > 0 && (
        <p className="t-sm dimmer">
          Not connected yet: {offline.map((s) => SOURCE_LABEL[s]).join(', ')}. They read once their
          keys are set on the server.
        </p>
      )}
    </div>
  )
}
