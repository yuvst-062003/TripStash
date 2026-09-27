/**
 * Name a place, and it reads.
 *
 * This is the only way into somewhere you have saved nothing about. The map can
 * only show what you already have, so a traveller still choosing between
 * Guatemala and Colombia opens the app to an empty globe and nothing to press.
 * Explore is that person's first screen.
 *
 * Two rules it does not bend:
 *
 * It ASKS before it answers. Ten days of hiking and ten days of coffee towns
 * are not the same country, so a recommendation made without knowing which is
 * a guess wearing a confident voice.
 *
 * Everything it finds lands in CONSIDERING. Research never writes itself into
 * your route, and every clip it brings back is a dry impression until you stamp
 * it - which is why nothing here is drawn as yours.
 */
import { useState } from 'react'
import Evidence from '../components/Evidence'
import { api } from '../lib/api'
import { useApp } from '../lib/context'
import { useAsync } from '../lib/hooks'
import { labelFor } from '../lib/activityLabels'
import { Search } from '../components/icons'
import { Note } from '../components/ui'

/** How many days the traveller has, which changes the answer more than anything. */
const SPANS = ['Under a week', '2 weeks', 'A month', 'Not sure'] as const

type Stage = 'empty' | 'asking' | 'read'

export default function Explore() {
  const { openAsk } = useApp()
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<Stage>('empty')
  const [span, setSpan] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)

  // The picks are the traveller's standing answer to "what do you want out of a
  // trip". Explore borrows them rather than asking from scratch every time.
  const picks = useAsync(() => api.activities(), [], true, 'explore:picks')
  const [forThisRead, setForThisRead] = useState<string[] | null>(null)
  const chosen = forThisRead ?? picks.data?.picked ?? []

  const place = query.trim()

  async function read() {
    if (!place) return
    setLooking(true)
    setOutcome(null)
    try {
      const result = await api.find(place, chosen[0])
      setOutcome(
        result.data.nothing_reason ??
          `Read ${result.data.found + result.data.already_had} clips about ${place}. ` +
            `${result.data.found} are new; ${result.data.already_had} you already had.`,
      )
      setStage('read')
    } catch (error) {
      setOutcome(error instanceof Error ? error.message : 'That search did not come back.')
    } finally {
      setLooking(false)
    }
  }

  return (
    <div className="screen" data-testid="explore">
      <div className="pad pad-y">
        <label htmlFor="explore-q" className="t-field explore__label">
          Write a city, a country or a place
        </label>
        <div className="explore__bar">
          <span className="explore__field">
            <Search size={20} />
            <input
              id="explore-q"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                if (stage !== 'empty') setStage('empty')
              }}
              placeholder="Colombia"
              className="explore__input"
              data-testid="explore-input"
            />
          </span>
          <button
            type="button"
            className="btn btn--doc"
            disabled={!place || looking}
            onClick={() => setStage(stage === 'empty' ? 'asking' : 'read')}
            data-testid="explore-look"
          >
            {looking ? 'Reading' : 'Look'}
          </button>
        </div>
      </div>

      {stage === 'empty' && (
        <div className="explore__blank" data-testid="explore-blank">
          <span className="bigstamp bigstamp--dry" aria-hidden="true">
            <span className="bigstamp__inner" />
            <span className="bigstamp__word t-field">NO ENTRY</span>
            <span className="bigstamp__sub t-field">NOT FILED</span>
          </span>
          <p className="explore__blank-note">
            {place
              ? `Nothing filed for ${place} yet. Press Look and I will read what people actually said about it.`
              : 'Name a place and I will read what people actually said about it — quotes and clips, not a summary.'}
          </p>
        </div>
      )}

      {stage === 'asking' && (
        <div className="pad" data-testid="explore-asking">
          <p className="explore__progress t-field">
            Two things first, because they change the answer.
          </p>

          <fieldset className="askblock">
            <legend className="t-field askblock__legend">Question 1 of 2</legend>
            <p className="t-name t-name--sm">How long have you got in {place}?</p>
            <div className="chips chips--wrap">
              {SPANS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={span === s}
                  className={span === s ? 'btn btn--sm btn--ink' : 'btn btn--sm'}
                  onClick={() => setSpan(s)}
                  data-testid="explore-span"
                >
                  {s}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="askblock">
            <legend className="t-field askblock__legend">Question 2 of 2</legend>
            <p className="t-name t-name--sm">And what do you want out of it?</p>
            <p className="askblock__note">
              These are your picks from Profile. Change them just for this read if you like.
            </p>
            <div className="chips chips--wrap">
              {(picks.data?.available ?? []).map((a) => {
                const on = chosen.includes(a.slug)
                return (
                  <button
                    key={a.slug}
                    type="button"
                    aria-pressed={on}
                    className={on ? 'btn btn--sm btn--teal' : 'btn btn--sm'}
                    onClick={() =>
                      setForThisRead(
                        on ? chosen.filter((s) => s !== a.slug) : [...chosen, a.slug],
                      )
                    }
                    data-testid="explore-pick"
                  >
                    {labelFor(a.slug)}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div className="explore__actions">
            <button
              type="button"
              className="btn btn--doc grow"
              onClick={read}
              disabled={looking}
              data-testid="explore-answer"
            >
              {looking ? 'Reading' : 'Answer and carry on'}
            </button>
            <button type="button" className="btn" onClick={read} disabled={looking}>
              Skip
            </button>
          </div>
          <p className="explore__skip-note">
            Skipping is fine. It reads wider, and asks again when the answer would matter.
          </p>
        </div>
      )}

      {stage === 'read' && (
        <div data-testid="explore-read">
          <div className="pad explore__result-head">
            <p className="t-field">
              {span ? `${span} in ${place}` : `Anything in ${place}`}
              {chosen.length > 0 && `, for ${chosen.map(labelFor).join(' and ').toLowerCase()}`}
            </p>
            <span className="quota t-field" data-testid="explore-quota">
              1 search used
            </span>
          </div>

          {outcome && <Note>{outcome}</Note>}

          <div className="pad">
            <div className="found-note">
              <Evidence yours={0} found={3} />
              <p>
                Everything found lands in <strong>considering</strong>. It is a suggestion until
                you stamp it, and it never writes itself into your route.
              </p>
            </div>
          </div>

          <div className="pad pad-y">
            <button
              type="button"
              className="btn btn--doc grow"
              onClick={() => openAsk({ surface: 'explore', contextLabel: place })}
              data-testid="explore-ask"
            >
              Ask about {place}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
