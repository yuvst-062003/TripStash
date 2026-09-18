import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { useApp, type AskSeed } from '../lib/context'
import type { AskResponse, ProposedAction } from '../lib/types'
import {
  Freshness,
  Glyph,
  KNOWLEDGE_LABEL,
  Meta,
  Note,
  Pill,
  Sheet,
  SkeletonRows,
  pairText,
} from './ui'
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  KNOWLEDGE_ICON,
  CATEGORY_ICON,
  Navigation,
  Send,
} from './icons'

const STARTERS = [
  'What have I saved near me?',
  'What did I save about safety?',
  'How is my budget doing?',
  'Where can I stay?',
]

/**
 * One assistant, everywhere.
 *
 * The context it is using sits at the top and can be dropped, and anything it
 * wants to change comes back as a proposal to confirm.
 */
export default function AskSheet({ seed, onClose }: { seed: AskSeed; onClose: () => void }) {
  const { position } = useApp()
  const [question, setQuestion] = useState(seed.question ?? '')
  const [useContext, setUseContext] = useState(true)
  const [useLocation, setUseLocation] = useState(Boolean(position))
  const [answer, setAnswer] = useState<AskResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<string[]>([])
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function submit(event?: React.FormEvent) {
    event?.preventDefault()
    if (!question.trim()) return
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.ask({
        question: question.trim(),
        surface: seed.surface,
        trip_place_id: useContext ? seed.tripPlaceId ?? null : null,
        place_id: useContext ? seed.placeId ?? null : null,
        source_id: useContext ? seed.sourceId ?? null : null,
        destination_id: useContext ? seed.destinationId ?? null : null,
        lat: useLocation ? position?.lat ?? null : null,
        lon: useLocation ? position?.lon ?? null : null,
      })
      setAnswer(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The assistant could not be reached.')
    } finally {
      setBusy(false)
    }
  }

  async function confirm(action: ProposedAction) {
    await api.confirmAction(action)
    setApplied((list) => [...list, action.type])
  }

  return (
    <Sheet title="Ask" onClose={onClose}>
      <div className="pad" style={{ paddingTop: 'var(--s-2)' }}>
        <form onSubmit={submit}>
          <div style={{ position: 'relative' }}>
            <textarea
              ref={inputRef}
              className="input"
              rows={2}
              value={question}
              placeholder="What have I saved near me?"
              onChange={(event) => setQuestion(event.target.value)}
              aria-label="Your question"
              style={{ paddingRight: 48 }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
              }}
            />
            <button
              type="submit"
              className="icon-btn"
              disabled={busy || !question.trim()}
              aria-label="Ask"
              style={{
                position: 'absolute',
                right: 4,
                bottom: 4,
                width: 36,
                height: 36,
                background: question.trim() ? 'var(--ink)' : 'transparent',
                color: question.trim() ? 'var(--bg)' : 'var(--ink-3)',
              }}
            >
              <Send size={16} strokeWidth={2.2} />
            </button>
          </div>
        </form>

        {/* The context in use is visible and removable, never implicit. */}
        <div className="row row--wrap" style={{ gap: 'var(--s-2)', marginTop: 'var(--s-2)' }}>
          {seed.contextLabel && (
            <Pill on={useContext} Icon={useContext ? Check : undefined} onClick={() => setUseContext((on) => !on)}>
              {seed.contextLabel}
            </Pill>
          )}
          <Pill on={useContext} onClick={() => setUseContext((on) => !on)}>
            {seed.surface}
          </Pill>
          {position && (
            <Pill on={useLocation} onClick={() => setUseLocation((on) => !on)}>
              my location
            </Pill>
          )}
        </div>
      </div>

      {!answer && !busy && (
        <div className="rail" style={{ paddingTop: 'var(--s-2)' }}>
          {STARTERS.map((starter) => (
            <Pill key={starter} onClick={() => setQuestion(starter)}>
              {starter}
            </Pill>
          ))}
        </div>
      )}

      {busy && <SkeletonRows rows={2} />}

      {error && (
        <div className="pad" style={{ paddingTop: 'var(--s-3)' }}>
          <Note tone="danger">{error}</Note>
        </div>
      )}

      {answer && (
        <>
          <div className="pad" style={{ paddingTop: 'var(--s-4)' }}>
            <p className="t">{answer.answer}</p>
            {answer.disclaimers.map((note) => (
              <div key={note} style={{ marginTop: 'var(--s-2)' }}>
                <Note tone="warn">{note}</Note>
              </div>
            ))}
          </div>

          {answer.proposed_actions.length > 0 && (
            <div className="pad" style={{ marginTop: 'var(--s-4)' }}>
              {answer.proposed_actions.map((action) => (
                <div key={action.type} className="card">
                  <p className="t-md">{action.label}</p>
                  <p className="t-sm dim" style={{ marginTop: 2 }}>
                    {action.preview}
                  </p>
                  <div style={{ marginTop: 'var(--s-3)' }}>
                    {applied.includes(action.type) ? (
                      <span className="row t-sm" style={{ gap: 4, color: 'var(--accent)' }}>
                        <Check size={15} strokeWidth={2.4} /> Done
                      </span>
                    ) : (
                      <button className="btn btn--accent btn--sm" onClick={() => confirm(action)}>
                        Confirm
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {answer.cards.length > 0 && (
            <ul className="list" style={{ marginTop: 'var(--s-4)' }}>
              {answer.cards.map((card, index) => {
                const Icon = card.knowledge_type
                  ? KNOWLEDGE_ICON[card.knowledge_type] ?? KNOWLEDGE_ICON.general
                  : CATEGORY_ICON[card.subtitle?.split(',')[0]?.trim() ?? 'other'] ?? CATEGORY_ICON.other
                const { headline, detail } = pairText(card.title, card.body)
                const inner = (
                  <>
                    {card.type !== 'budget' && <Glyph Icon={Icon} />}
                    <div className="item__body">
                      <div className="row between" style={{ gap: 'var(--s-2)' }}>
                        <p className="item__title grow clamp-1">{headline}</p>
                        {card.walking_minutes != null && (
                          <span className="t-sm dimmer num" style={{ flex: 'none' }}>
                            {card.walking_minutes} min
                          </span>
                        )}
                      </div>
                      <Meta
                        parts={[
                          card.subtitle,
                          card.knowledge_type && KNOWLEDGE_LABEL[card.knowledge_type],
                          card.provenance,
                        ]}
                      />
                      {card.why_saved && <p className="t-sm dim clamp-2">{card.why_saved}</p>}
                      {detail && <p className="t-sm dim clamp-3">{detail}</p>}

                      {card.type === 'budget' && (
                        <p className="t-lg num" style={{ marginTop: 4 }}>
                          {card.spent?.toFixed(0)}{' '}
                          <span className="t-sm dimmer">
                            {card.currency} spent
                            {card.remaining != null && ` · ${card.remaining.toFixed(0)} left`}
                          </span>
                        </p>
                      )}

                      {card.requires_official_verification && (
                        <Note tone="warn">Verify against the official source before relying on this.</Note>
                      )}

                      {card.facts?.map((fact) => (
                        <div className="row between" key={fact.kind} style={{ marginTop: 4 }}>
                          <span className="t-sm grow clamp-1">
                            <span className="dimmer" style={{ textTransform: 'capitalize' }}>
                              {fact.kind}{' '}
                            </span>
                            {fact.primary.value}
                          </span>
                          <Freshness status={fact.primary.freshness} label={fact.primary.age_label} />
                        </div>
                      ))}

                    </div>
                  </>
                )
                // Handoff links live outside the row link: an anchor may not
                // contain another anchor.
                const actions = card.actions.length > 0 && (
                  <div
                    className="pad row"
                    style={{ gap: 'var(--s-3)', paddingBottom: 'var(--s-3)', marginTop: -6 }}
                  >
                    {card.actions.slice(0, 2).map((action) => (
                      <a
                        className="btn btn--sm btn--plain"
                        key={action.key}
                        href={action.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ paddingInline: 0 }}
                      >
                        {action.key === 'navigate' ? (
                          <Navigation size={14} strokeWidth={2.2} />
                        ) : (
                          <ArrowUpRight size={14} strokeWidth={2.2} />
                        )}
                        {action.label}
                      </a>
                    ))}
                  </div>
                )
                return (
                  <li key={`${card.type}-${index}`}>
                    {card.trip_place_id ? (
                      <Link className="item" to={`/places/${card.trip_place_id}`} onClick={onClose}>
                        {inner}
                        <ChevronRight size={17} className="dimmer" style={{ flex: 'none', marginTop: 9 }} />
                      </Link>
                    ) : (
                      <div className="item" style={{ cursor: 'default' }}>
                        {inner}
                      </div>
                    )}
                    {actions}
                  </li>
                )
              })}
            </ul>
          )}

          {answer.citations.length > 0 && (
            <>
              <p className="pad t-xs" style={{ marginTop: 'var(--s-5)' }}>
                Where this came from
              </p>
              <ul className="list">
                {answer.citations.map((citation, index) => (
                  <li key={`${citation.source_id}-${index}`}>
                    <div className="item" style={{ cursor: 'default' }}>
                      <div className="item__body">
                        <p className="t-sm clamp-1">{citation.label}</p>
                        <Meta parts={[citation.provenance, citation.published_on]} />
                        {citation.quote && (
                          <blockquote className="quote" style={{ marginTop: 6 }}>
                            “{citation.quote}”
                          </blockquote>
                        )}
                        {citation.url && (
                          <a
                            className="btn btn--sm btn--plain"
                            href={citation.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ paddingInline: 0, marginTop: 4 }}
                          >
                            Open source
                            <ArrowUpRight size={13} strokeWidth={2.2} />
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="pad t-sm dimmer" style={{ marginTop: 'var(--s-4)' }}>
            Answered from your own trip records in {answer.latency_ms} ms. Nothing was changed.
          </p>
        </>
      )}
    </Sheet>
  )
}
