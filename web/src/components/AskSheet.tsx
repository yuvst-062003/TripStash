import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { ApiError, api } from '../lib/api'
import { useApp, type AskSeed } from '../lib/context'
import { STAGGER_LIST, STAGGER_ROW, useMotionPrefs } from '../lib/motion'
import { STAMP_PATTERN, tick } from '../lib/haptics'
import type { AskCard, AskResponse, ProposedAction } from '../lib/types'
import { StampDrop } from './Stamp'
import {
  CATEGORY_LABEL,
  ErrorNote,
  Freshness,
  Glyph,
  KNOWLEDGE_LABEL,
  Meta,
  Note,
  PROVENANCE_LABEL,
  Pill,
  Sheet,
  SkeletonRows,
  categoryTint,
  checkedAgo,
  fmtDay,
  knowledgeTint,
  pairText,
} from './ui'
import {
  ArrowUpRight,
  CATEGORY_ICON,
  Check,
  ChevronRight,
  KNOWLEDGE_ICON,
  MapPin,
  Navigation,
  X,
} from './icons'
import { SendIcon, type SendIconHandle } from './motion'

/** What is worth asking depends on where you are asking from. */
function starters(seed: AskSeed): string[] {
  if (seed.tripPlaceId) {
    return ['Is now a good time to go?', 'Why did I save this?', 'How do I get there?', 'Is it open today?']
  }
  if (seed.surface === 'trip') {
    return ['How is my budget doing?', 'Where can I stay?', 'How do I get to the next stop?']
  }
  if (seed.surface === 'map') {
    return ['What have I saved near me?', 'Is anything open now?', 'Where can I stay?']
  }
  return ['What have I saved near me?', 'Is it safe there?', 'How is my budget doing?', 'Where can I stay?']
}

const money = (amount: number, currency: string) =>
  `${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency}`
const norm = (text: string | null | undefined) =>
  (text ?? '')
    .trim()
    .replace(/^[“"']+|[”"'…]+$/g, '')
    .toLowerCase()

/**
 * The answer arrives a word at a time — quickly, capped so a long answer
 * never makes you wait — because a reply that simply appears reads as a
 * template, and one that streams reads as considered. Assistive tech and
 * the clipboard get the plain sentence.
 */
function Reveal({ text }: { text: string }) {
  const { reduced } = useMotionPrefs()
  if (reduced) return <p className="t">{text}</p>
  const words = text.split(' ')
  const animated = Math.min(words.length, 40)
  const step = 0.4 / animated
  return (
    <p className="t">
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.map((word, index) => (
          <span key={index}>
            <motion.span
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: index < animated ? index * step : 0.4 }}
              style={{ display: 'inline-block' }}
            >
              {word}
            </motion.span>{' '}
          </span>
        ))}
      </span>
    </p>
  )
}

/**
 * One assistant, everywhere.
 *
 * The context it is using sits at the top and can be dropped, and anything it
 * wants to change comes back as a proposal to confirm.
 */
export default function AskSheet({ seed, onClose }: { seed: AskSeed; onClose: () => void }) {
  const { position, requestLocation } = useApp()
  const { reduced } = useMotionPrefs()
  const [question, setQuestion] = useState(seed.question ?? '')
  const [useContext, setUseContext] = useState(Boolean(seed.tripPlaceId || seed.placeId))
  const [useLocation, setUseLocation] = useState(Boolean(position))
  const [answer, setAnswer] = useState<AskResponse | null>(null)
  const [asked, setAsked] = useState('')
  const [seq, setSeq] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<string[]>([])
  const [applying, setApplying] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const sendRef = useRef<SendIconHandle>(null)
  const hasContext = Boolean(seed.contextLabel && (seed.tripPlaceId || seed.placeId))

  async function submit(text?: string) {
    const q = (text ?? question).trim()
    if (!q || busy) return
    setQuestion(q)
    setAsked(q)
    setBusy(true)
    setError(null)
    setAnswer(null)
    setApplied([])
    setDismissed([])
    setActionError(null)
    sendRef.current?.startAnimation()
    try {
      const { data } = await api.ask({
        question: q,
        surface: seed.surface,
        trip_place_id: useContext ? seed.tripPlaceId ?? null : null,
        place_id: useContext ? seed.placeId ?? null : null,
        source_id: useContext ? seed.sourceId ?? null : null,
        destination_id: useContext ? seed.destinationId ?? null : null,
        lat: useLocation ? position?.lat ?? null : null,
        lon: useLocation ? position?.lon ?? null : null,
      })
      setAnswer(data)
      setSeq((n) => n + 1)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'The assistant could not be reached. Check your connection and try again.',
      )
    } finally {
      setBusy(false)
      sendRef.current?.stopAnimation()
    }
  }

  // A question handed in (a pill on a place page) is asked, not just typed.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !seed.question) return
    seeded.current = true
    void submit(seed.question)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function confirm(action: ProposedAction) {
    if (applying) return
    setApplying(action.type)
    setActionError(null)
    try {
      await api.confirmAction(action)
      setApplied((list) => [...list, action.type])
      window.setTimeout(() => tick(STAMP_PATTERN), reduced ? 0 : 170)
    } catch {
      setActionError('Couldn’t add it to today’s plan. Try again.')
    } finally {
      setApplying(null)
    }
  }

  const fit = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, 160)}px`
  }
  const changes = applied.length
  const quotes = new Set((answer?.citations ?? []).map((c) => norm(c.quote)))

  return (
    <Sheet title="Ask" onClose={onClose} className="drawer--tall">
      <div className="pad" style={{ paddingTop: 'var(--s-2)' }}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div style={{ position: 'relative' }}>
            <textarea
              ref={(el) => {
                inputRef.current = el
                fit(el)
              }}
              className="input ask__field"
              rows={2}
              autoFocus
              value={question}
              placeholder={hasContext ? `Ask about ${seed.contextLabel}` : 'What have I saved near me?'}
              onChange={(event) => setQuestion(event.target.value)}
              aria-label="Your question"
              enterKeyHint="send"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
            <motion.button
              type="submit"
              className="icon-btn ask__send"
              disabled={busy || !question.trim()}
              aria-label="Ask"
              aria-busy={busy}
              whileTap={{ scale: 0.9 }}
              data-armed={Boolean(question.trim())}
            >
              <SendIcon ref={sendRef} size={17} aria-hidden />
            </motion.button>
          </div>
        </form>

        {/* The context in use is visible and removable, never implicit. */}
        <div className="row row--wrap" style={{ gap: 'var(--s-2)', marginTop: 'var(--s-2)' }}>
          {hasContext && useContext && (
            <span className="chip chip--on" style={{ paddingRight: 6 }}>
              <MapPin size={14} strokeWidth={2.2} />
              {seed.contextLabel}
              <button
                type="button"
                className="chip__x"
                aria-label={`Stop asking about ${seed.contextLabel}`}
                onClick={() => setUseContext(false)}
              >
                <X size={13} strokeWidth={2.6} />
              </button>
            </span>
          )}
          {hasContext && !useContext && (
            <Pill Icon={MapPin} onClick={() => setUseContext(true)}>
              Ask about {seed.contextLabel}
            </Pill>
          )}
          {position ? (
            <Pill on={useLocation} Icon={useLocation ? Check : undefined} onClick={() => setUseLocation((on) => !on)}>
              My location
            </Pill>
          ) : (
            <Pill Icon={Navigation} onClick={requestLocation}>
              Use my location
            </Pill>
          )}
        </div>

        {error && (
          <div style={{ marginTop: 'var(--s-3)', marginInline: 'calc(-1 * var(--s-4))' }}>
            <ErrorNote message={error} onRetry={() => void submit(asked)} />
          </div>
        )}
      </div>

      {!answer && !busy && (
        <div className="row row--wrap pad" style={{ gap: 'var(--s-2)', paddingTop: 'var(--s-3)' }}>
          {starters(seed).map((starter) => (
            <Pill key={starter} onClick={() => void submit(starter)}>
              {starter}
            </Pill>
          ))}
        </div>
      )}

      <div role="status" aria-live="polite">
        {busy && (
          <div className="pad screen--loading" style={{ paddingTop: 'var(--s-4)' }}>
            <p className="t-small dimmer">Reading your saved records…</p>
            <SkeletonRows rows={2} />
          </div>
        )}

        {answer && (
          <div key={seq}>
            <div className="pad" style={{ paddingTop: 'var(--s-4)' }}>
              <Reveal text={answer.answer} />
            </div>

            {answer.proposed_actions.length > 0 && (
              <div className="pad" style={{ marginTop: 'var(--s-4)' }}>
                {answer.proposed_actions.map((action) => {
                  const done = applied.includes(action.type)
                  const gone = dismissed.includes(action.type)
                  if (gone) return null
                  return (
                    <div key={action.type} className="ask__proposal" style={{ position: 'relative' }}>
                      <p className="t-head">{done ? 'Added to today’s plan' : action.label}</p>
                      <p className="t-small dim" style={{ marginTop: 2 }}>
                        {done ? (
                          <Link to="/trip?section=plan" className="teal" onClick={onClose}>
                            View today’s plan
                          </Link>
                        ) : (
                          action.preview
                        )}
                      </p>
                      {actionError && !done && (
                        <div style={{ marginTop: 'var(--s-2)' }} role="alert">
                          <Note tone="danger">{actionError}</Note>
                        </div>
                      )}
                      {!done && (
                        <div className="row" style={{ marginTop: 'var(--s-3)', gap: 'var(--s-2)' }}>
                          <button
                            className="btn btn--ink"
                            onClick={() => confirm(action)}
                            aria-busy={applying === action.type}
                            disabled={applying !== null}
                          >
                            {applying === action.type ? 'Adding…' : 'Add to today'}
                          </button>
                          <button
                            className="btn btn--ghost"
                            onClick={() => setDismissed((list) => [...list, action.type])}
                            disabled={applying !== null}
                          >
                            Not now
                          </button>
                        </div>
                      )}
                      <div
                        style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}
                        aria-hidden
                      >
                        <StampDrop show={done} tone="teal" Icon={Check}>
                          Added
                        </StampDrop>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {answer.cards.length > 0 && (
              <motion.ul
                className="list"
                style={{ marginTop: 'var(--s-4)' }}
                variants={{ ...STAGGER_LIST, show: { transition: { staggerChildren: 0.05, delayChildren: reduced ? 0 : 0.35 } } }}
                initial={reduced ? false : 'hidden'}
                animate="show"
              >
                {answer.cards.map((card, index) => (
                  <motion.li key={`${card.type}-${index}`} variants={STAGGER_ROW}>
                    <Card card={card} quotes={quotes} onClose={onClose} />
                  </motion.li>
                ))}
              </motion.ul>
            )}

            {answer.cards.length === 0 && (
              <div className="row row--wrap pad" style={{ gap: 'var(--s-2)', paddingTop: 'var(--s-4)' }}>
                {starters(seed).map((starter) => (
                  <Pill key={starter} onClick={() => void submit(starter)}>
                    {starter}
                  </Pill>
                ))}
              </div>
            )}

            {answer.disclaimers.length > 0 && (
              <div className="pad stack-2" style={{ marginTop: 'var(--s-4)' }}>
                {answer.disclaimers.map((note) => (
                  <Note key={note} tone="warn">
                    {note.replace(/ - /g, ' — ')}
                  </Note>
                ))}
              </div>
            )}

            {answer.citations.length > 0 && (
              <>
                <p className="pad t-head" style={{ marginTop: 'var(--s-5)' }}>
                  Where this came from
                </p>
                <ul className="list">
                  {answer.citations.map((citation, index) => (
                    <li key={`${citation.source_id}-${index}`}>
                      <div className="item item--static">
                        <div className="item__body">
                          <p className="t-small clamp-1">{citation.label}</p>
                          <Meta
                            parts={[
                              PROVENANCE_LABEL[citation.provenance] ?? citation.provenance,
                              citation.published_on && `Published ${fmtDay(citation.published_on)}`,
                            ]}
                          />
                          {citation.quote && (
                            <blockquote className="quote" style={{ marginTop: 6 }}>
                              “{citation.quote}”
                            </blockquote>
                          )}
                          {citation.url && (
                            <a
                              className="btn btn--sm btn--ghost"
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

            <p className="pad t-small dimmer" style={{ marginTop: 'var(--s-4)' }}>
              {changes > 0
                ? `${changes} change${changes === 1 ? '' : 's'} made: added to today’s plan.`
                : answer.cards.length === 0
                  ? 'Nothing matched in your saved records. Nothing was changed.'
                  : 'From your saved records only. Nothing was changed.'}
            </p>
          </div>
        )}
      </div>
    </Sheet>
  )
}

/** One card from the answer: a place row, a note, a budget figure or a handoff. */
function Card({ card, quotes, onClose }: { card: AskCard; quotes: Set<string>; onClose: () => void }) {
  const category = card.subtitle?.split(',')[0]?.trim() ?? 'other'
  const city = card.subtitle?.split(',').slice(1).join(',').trim()
  const isKnowledge = card.type === 'knowledge'
  const Icon = card.knowledge_type
    ? KNOWLEDGE_ICON[card.knowledge_type] ?? KNOWLEDGE_ICON.general
    : CATEGORY_ICON[category] ?? CATEGORY_ICON.other
  const tint = card.knowledge_type ? knowledgeTint(card.knowledge_type) : categoryTint(category)
  const { headline, detail } = pairText(card.title, card.body)
  const facts = card.facts ?? []
  const allFresh = facts.length > 0 && facts.every((fact) => fact.primary.freshness === 'fresh')
  const whySaved = card.why_saved && !quotes.has(norm(card.why_saved)) ? card.why_saved : null

  const inner = (
    <>
      {card.type !== 'budget' && <Glyph Icon={Icon} tint={tint} />}
      <div className="item__body">
        {isKnowledge ? (
          <>
            <p className="t-small" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>
              {KNOWLEDGE_LABEL[card.knowledge_type ?? 'general']}
              {card.when && <span className="dimmer"> · {card.when}</span>}
            </p>
            <p className="t clamp-3" style={{ marginTop: 2 }}>
              {headline}
            </p>
            {detail && <p className="t-small dim clamp-3">{detail}</p>}
          </>
        ) : (
          <>
            <div className="row between" style={{ gap: 'var(--s-2)' }}>
              <p className="item__title grow clamp-1">{headline}</p>
              {card.walking_minutes != null && (
                <span className="t-small dimmer num" style={{ flex: 'none' }}>
                  {card.walking_minutes} min
                </span>
              )}
            </div>
            <Meta
              parts={[
                card.type === 'place' && (CATEGORY_LABEL[category] ?? category),
                city,
                card.type !== 'place' && card.subtitle,
                allFresh && checkedAgo(facts[0].primary.checked_at),
              ]}
            />
            {whySaved && <p className="t-small dim clamp-2">{whySaved}</p>}
            {detail && <p className="t-small dim clamp-3">{detail}</p>}
          </>
        )}

        {card.type === 'budget' && card.spent != null && card.currency && (
          <p className="t-title num" style={{ marginTop: 4 }}>
            {money(card.spent, card.currency)}
            <span className="t-small dimmer">
              {' '}
              spent
              {card.remaining != null && ` · ${money(card.remaining, card.currency)} left`}
            </span>
          </p>
        )}

        {card.requires_official_verification && (
          <Note tone="warn">Verify against the official source before relying on this.</Note>
        )}

        {facts.map((fact) => (
          <div className="row between row--top" key={fact.kind} style={{ marginTop: 4, gap: 'var(--s-2)' }}>
            <span className="t-small grow clamp-2">
              <span className="dimmer" style={{ textTransform: 'capitalize' }}>
                {fact.kind}{' '}
              </span>
              {fact.primary.value}
            </span>
            {fact.primary.freshness !== 'fresh' && (
              <Freshness status={fact.primary.freshness} label={fact.primary.age_label} />
            )}
          </div>
        ))}
      </div>
    </>
  )
  // Handoff links live outside the row link: an anchor may not contain another anchor.
  const actions = card.actions.length > 0 && (
    <div className="pad row" style={{ gap: 'var(--s-3)', paddingBottom: 'var(--s-3)', marginTop: -6 }}>
      {card.actions.slice(0, 2).map((action) => (
        <a
          className="btn btn--sm btn--ghost"
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
    <>
      {card.trip_place_id ? (
        <Link className="item" to={`/places/${card.trip_place_id}`} onClick={onClose}>
          {inner}
          <ChevronRight size={17} className="item__chev" />
        </Link>
      ) : (
        <div className="item item--static">{inner}</div>
      )}
      {actions}
    </>
  )
}
