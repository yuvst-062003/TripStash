/**
 * Name a place, and it reads.
 *
 * The only way into somewhere you have saved nothing about: the map can only
 * show what you already have. Two rules it does not bend.
 *
 * It ASKS before it answers. Ten days of hiking and ten days of coffee towns
 * are not the same country, so a read made without knowing which is a guess.
 *
 * Everything it brings back is FOUND. It goes to the inbox to be kept or
 * passed on, and never writes itself into your route.
 */
import { useState } from 'react'
import { api } from '../lib/api'
import { useApp } from '../lib/context'
import { useAsync } from '../lib/hooks'
import type { SourceSummary } from '../lib/types'
import { Note } from './ui'
import { Film, Search, Sparkles } from './icons'

/** How long they have, which changes the answer more than anything. */
const SPANS = ['Under a week', '2 weeks', 'A month', 'Not sure'] as const

type Stage = 'idle' | 'asking' | 'read'

export default function ExploreSearch() {
  const { openAsk } = useApp()
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [span, setSpan] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [found, setFound] = useState<SourceSummary[]>([])

  // The picks are the standing answer to "what do you want out of a trip";
  // Explore borrows them rather than asking from scratch every time.
  const picks = useAsync(() => api.activities(), [])
  const [forThisRead, setForThisRead] = useState<string[] | null>(null)
  const chosen = forThisRead ?? picks.data?.picked ?? []
  const labelOf = (slug: string) =>
    picks.data?.available.find((a) => a.slug === slug)?.label ?? slug

  const place = query.trim()

  async function read() {
    if (!place) return
    setLooking(true)
    setOutcome(null)
    try {
      const { data } = await api.find(place, chosen[0])
      setFound(data.sources ?? [])
      setOutcome(
        data.nothing_reason ??
          `Read ${data.found + data.already_had} clips about ${place}: ` +
            `${data.found} new, ${data.already_had} you already had.`,
      )
      setStage('read')
    } catch (error) {
      setOutcome(error instanceof Error ? error.message : 'That search did not come back.')
    } finally {
      setLooking(false)
    }
  }

  return (
    <section className="exsearch">
      <form
        className="exsearch__bar"
        onSubmit={(event) => {
          event.preventDefault()
          if (place) setStage('asking')
        }}
      >
        <label className="searchfield grow">
          <Search size={18} />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              if (stage !== 'idle') setStage('idle')
            }}
            placeholder="Try Colombia"
            aria-label="Search a city, a country or a place"
          />
        </label>
        <button className="btn btn--accent" type="submit" disabled={!place || looking}>
          Look
        </button>
      </form>

      {stage === 'idle' && (
        <p className="exsearch__hint t-sm dim">
          Somewhere you have saved nothing about? Name it and I will read what people actually
          said — quotes and clips, not a summary.
        </p>
      )}

      {stage === 'asking' && (
        <div className="exsearch__ask">
          <p className="t-sm dim">Two things first, because they change the answer.</p>

          <fieldset className="exsearch__q">
            <legend className="t-xs dim">Question 1 of 2</legend>
            <p className="t-md">How long have you got in {place}?</p>
            <div className="chiprow" role="group" aria-label="How long">
              {SPANS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip-toggle"
                  aria-pressed={span === s}
                  onClick={() => setSpan(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="exsearch__q">
            <legend className="t-xs dim">Question 2 of 2</legend>
            <p className="t-md">What do you want out of it?</p>
            <p className="t-sm dim">Your picks from Profile. Change them just for this read.</p>
            <div className="chiprow" role="group" aria-label="What you want">
              {(picks.data?.available ?? []).map((a) => {
                const on = chosen.includes(a.slug)
                return (
                  <button
                    key={a.slug}
                    type="button"
                    className="chip-toggle"
                    aria-pressed={on}
                    onClick={() =>
                      setForThisRead(on ? chosen.filter((x) => x !== a.slug) : [...chosen, a.slug])
                    }
                  >
                    {a.label}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div className="exsearch__actions">
            <button className="btn btn--accent grow" onClick={read} disabled={looking}>
              {looking ? 'Reading…' : 'Answer and carry on'}
            </button>
            <button className="btn" onClick={read} disabled={looking}>
              Skip
            </button>
          </div>
          <p className="t-xs dim">Skipping is fine. It reads wider.</p>
        </div>
      )}

      {stage === 'read' && (
        <div className="exsearch__read">
          <p className="t-sm dim">
            {span ? `${span} in ${place}` : `Anything in ${place}`}
            {chosen.length > 0 && `, for ${chosen.map(labelOf).join(' and ').toLowerCase()}`}
          </p>
          {outcome && (
            <Note tone="neutral" Icon={Sparkles}>
              {outcome}
            </Note>
          )}

          {found.length > 0 && (
            <ul className="list">
              {found.map((source) => (
                <li key={source.id} className="item">
                  <Film size={18} className="dim" />
                  <span className="item__body">
                    <span className="item__title clamp-2">{source.title ?? source.url}</span>
                    <span className="t-xs dim">{source.author ?? 'found online'}</span>
                  </span>
                  <span className="cliptag cliptag--found">found</span>
                </li>
              ))}
            </ul>
          )}

          <p className="t-xs dim">
            Found clips go to Saved → Inbox, to keep or pass on. Nothing here writes itself into
            your route.
          </p>
          <button
            className="btn btn--block"
            onClick={() => openAsk({ surface: 'explore', contextLabel: place })}
          >
            Ask about {place}
          </button>
        </div>
      )}
    </section>
  )
}
