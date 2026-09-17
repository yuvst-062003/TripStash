import { useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ApiError, api } from '../lib/api'
import { EXIT, useMotionPrefs } from '../lib/motion'
import { STAMP_PATTERN, tick } from '../lib/haptics'
import type { Candidate, Evidence } from '../lib/types'
import {
  Banner,
  CHANNEL_LABEL,
  Confidence,
  KNOWLEDGE_LABEL,
  Meta,
  Note,
  eventWhen,
  knowledgeTint,
  pairText,
  stampToneFor,
} from './ui'
import { Stamp, StampDrop } from './Stamp'
import { Layers, Pencil, StickyNote, X } from './icons'
import { CheckIcon, type CheckIconHandle } from './motion'

type Decision = 'saved' | 'ignored' | null

const strip = (text: string) => text.trim().replace(/…$/, '')

/** "from the caption at 1:24" — or the article, note or message it really came from. */
function provenance(evidence: Evidence, sourceKind?: string): string {
  const channel =
    evidence.channel === 'caption' && sourceKind === 'article'
      ? 'article'
      : evidence.channel === 'caption' && sourceKind === 'message'
        ? 'message'
        : evidence.channel === 'text' && sourceKind === 'message'
          ? 'message'
          : evidence.channel
  const where = CHANNEL_LABEL[channel] ?? `from the ${channel}`
  const seconds = evidence.media_timestamp_seconds
  if (seconds == null) return where
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${where} at ${m}:${String(s).padStart(2, '0')}`
}

/**
 * One extracted item awaiting a decision.
 *
 * Everything claimed appears with the words it came from, its confidence and
 * the place it resolved to. Nothing happens until stamp, edit, merge or
 * ignore is chosen — and stamping is the one moment that gets the stamp.
 */
export default function ReviewCard({
  candidate,
  index = 0,
  sourceKind,
  onDecided,
}: {
  candidate: Candidate
  /** Position in the queue: neighbouring stamps tilt opposite ways. */
  index?: number
  /** What the capture was (article, note, message…), so the quote names it honestly. */
  sourceKind?: string
  onDecided: () => void
}) {
  // A stay or transport *tip* has no location: it is knowledge, not a pin.
  const isPlace = candidate.is_place_candidate
  const { headline, detail } = isPlace
    ? { headline: candidate.title, detail: null }
    : pairText(candidate.title, candidate.body)
  const [chosen, setChosen] = useState(candidate.resolutions[0]?.provider_place_id ?? '')
  const [reason, setReason] = useState(isPlace ? candidate.body ?? '' : '')
  const [editing, setEditing] = useState(false)
  // The note box stays closed until asked for: an always-open textarea doubles
  // the height of every row in a queue meant to be worked through quickly.
  const [noteOpen, setNoteOpen] = useState(isPlace)
  // Editing starts from the words on screen, not the API's shortened title.
  const [title, setTitle] = useState(headline)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mergeWithDuplicate, setMergeWithDuplicate] = useState(true)
  const [stamped, setStamped] = useState(false)
  const [decision, setDecision] = useState<Decision>(null)
  const checkRef = useRef<CheckIconHandle>(null)
  const { reduced, spring } = useMotionPrefs()

  const needsPin = isPlace && candidate.resolutions.length === 0 && !candidate.duplicate_of_place_id
  const duplicateName = candidate.duplicate_of_name ?? 'the place already saved'
  const merging = Boolean(candidate.duplicate_of_place_id) && mergeWithDuplicate
  const resolved = candidate.resolutions.find((option) => option.provider_place_id === chosen)
  const tint = knowledgeTint(candidate.type)
  const edited = title.trim() !== headline.trim() && title.trim().length > 0

  // The quote is the proof. When it is word for word the claim itself, the
  // claim is set as the quote; otherwise it stands beneath the claim.
  const evidence = candidate.evidence[0]
  const leadQuote = Boolean(evidence && strip(evidence.quote) === strip(headline))
  const detailQuote = Boolean(evidence && detail && strip(evidence.quote) === strip(detail))

  async function run(action: () => Promise<unknown>, outcome: Exclude<Decision, null>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      if (outcome === 'saved') {
        // The stamp falls, the tick lands with it, the card leaves once it has been read.
        setStamped(true)
        window.setTimeout(() => tick(STAMP_PATTERN), reduced ? 0 : 170)
        window.setTimeout(() => setDecision('saved'), reduced ? 600 : 700)
      } else {
        setDecision('ignored')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not go through.')
      setBusy(false)
    }
  }

  const approve = () =>
    run(async () => {
      const text = title.trim()
      if (edited && !isPlace) {
        // When the sentence is the whole claim, the edit is the claim.
        await api.editCandidate(
          candidate.id,
          detail ? { title: text } : { title: text.slice(0, 240), body: text },
        )
      }
      await api.approveCandidate(candidate.id, {
        reason_saved: reason.trim() || null,
        provider_place_id: isPlace && chosen ? chosen : null,
        merge_into_place_id: merging ? candidate.duplicate_of_place_id : null,
        override_name: edited && isPlace ? text : null,
      })
    }, 'saved')

  const label = busy ? 'Stamping…' : merging ? `Merge into ${duplicateName}` : 'Stamp'

  // Grows with its text where `field-sizing` is not supported yet.
  const fit = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }
  const editor = (
    <textarea
      ref={fit}
      className="input review__edit"
      value={title}
      rows={1}
      autoFocus
      aria-label={isPlace ? 'Place name' : 'What it says'}
      onChange={(event) => setTitle(event.target.value.replace(/\n/g, ' '))}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          setEditing(false)
        }
      }}
    />
  )

  return (
    <motion.article
      className="card"
      style={{ position: 'relative', overflow: 'hidden' }}
      animate={
        decision === 'saved'
          ? { opacity: 0, x: 0, scale: 0.96 }
          : decision === 'ignored'
            ? { opacity: 0, x: 40, scale: 1 }
            : { opacity: 1, x: 0, scale: 1 }
      }
      transition={reduced ? { duration: 0.15 } : decision ? { ...EXIT, duration: 0.18 } : spring}
      onAnimationComplete={(definition) => {
        // Only the full exit counts — motion also completes per-key fallbacks.
        if (decision && typeof definition === 'object' && 'opacity' in definition) onDecided()
      }}
    >
      <div className="review__head">
        <Stamp tone={stampToneFor(tint)} size="sm" rotate={index % 2 ? 4 : -6}>
          {KNOWLEDGE_LABEL[candidate.type] ?? candidate.type}
        </Stamp>
        {/* These change the content, not the decision, so they sit by the stamp. */}
        <div className="review__tools">
          <button
            type="button"
            className="icon-btn"
            disabled={busy}
            onClick={() => setEditing((on) => !on)}
            aria-label={editing ? 'Done editing' : isPlace ? 'Edit the name' : 'Edit the wording'}
            aria-pressed={editing}
          >
            <Pencil size={17} strokeWidth={2.2} />
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={busy}
            onClick={() => setNoteOpen((on) => !on)}
            aria-label={noteOpen ? 'Hide the note' : 'Add a note'}
            aria-pressed={noteOpen}
          >
            <StickyNote size={17} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      <div style={{ marginTop: 'var(--s-3)' }}>
        {leadQuote ? (
          <blockquote className="quote quote--lead">
            {editing ? editor : `“${headline}”`}
            {evidence && <span className="quote__from">— {provenance(evidence, sourceKind)}</span>}
          </blockquote>
        ) : editing ? (
          editor
        ) : (
          <h3 className="t-title" style={{ fontSize: '1.25rem' }}>
            {headline}
          </h3>
        )}
      </div>

      {detail && !detailQuote && (
        <p className="t dim" style={{ marginTop: 6 }}>
          {detail}
        </p>
      )}

      <Meta
        className="mt"
        parts={[
          candidate.type === 'event' && candidate.happens_on
            ? eventWhen(candidate.happens_on, candidate.ends_on)
            : null,
          candidate.destination_scope,
          resolved && [resolved.category, resolved.city].filter(Boolean).join(', '),
        ]}
      />

      {!leadQuote &&
        candidate.evidence.map((item, at) => (
          <blockquote className="quote" key={at} style={{ marginTop: 'var(--s-3)' }}>
            “{item.quote}”
            <span className="quote__from">— {provenance(item, sourceKind)}</span>
          </blockquote>
        ))}

      <div style={{ marginTop: 'var(--s-3)' }}>
        <Confidence value={candidate.confidence} />
      </div>

      {candidate.duplicate_of_place_id && (
        <div style={{ marginTop: 'var(--s-3)' }}>
          <Banner tone="warn" Icon={Layers}>
            <strong>Looks like {duplicateName}.</strong>{' '}
            {candidate.duplicate_reason?.replace(/ - /g, ' — ')}
            <label className="check" style={{ marginTop: 6 }}>
              <input
                type="checkbox"
                checked={mergeWithDuplicate}
                onChange={(event) => setMergeWithDuplicate(event.target.checked)}
              />
              Add this source to {duplicateName}
            </label>
          </Banner>
        </div>
      )}

      {isPlace && candidate.resolutions.length > 0 && !merging && (
        <fieldset style={{ border: 0, padding: 0, margin: 'var(--s-3) 0 0' }}>
          <legend className="t-small dim" style={{ marginBottom: 6 }}>
            Which place is this?
          </legend>
          <div className="stack-2">
            {candidate.resolutions.map((option) => (
              <label key={option.provider_place_id} className="check t-small">
                <input
                  type="radio"
                  name={`resolve-${candidate.id}`}
                  checked={chosen === option.provider_place_id}
                  onChange={() => setChosen(option.provider_place_id)}
                />
                <span className="grow">
                  <span className="t-head">{option.name}</span>
                  <span className="meta" style={{ display: 'block' }}>
                    {[option.category, option.city, option.country].filter(Boolean).join(', ')} ·{' '}
                    <span className="num">{Math.round(option.match_confidence * 100)}%</span> match
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {needsPin && (
        <div style={{ marginTop: 'var(--s-3)' }}>
          <Note tone="warn">
            No provider match for this name. Stamping it needs a pin — add the place from Save, or
            ignore it.
          </Note>
        </div>
      )}

      {/* The note opens in place; the grid track animates, not the height. */}
      <div className="reveal" data-open={noteOpen}>
        <div>
          <label className="field">
            <span>{isPlace ? 'Why you are saving it' : 'Your note'}</span>
            <textarea
              className="input"
              value={reason}
              rows={2}
              tabIndex={noteOpen ? 0 : -1}
              placeholder={isPlace ? undefined : 'Kept under the tip, in your words'}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 'var(--s-2)' }}>
          <Note tone="danger">{error}</Note>
        </div>
      )}

      {/* One decision, two outcomes. */}
      <div className="row" style={{ marginTop: 'var(--s-4)', gap: 'var(--s-2)' }}>
        <motion.button
          className="btn btn--ink grow"
          disabled={busy || needsPin}
          onClick={approve}
          whileTap={{ scale: 0.97 }}
          onPointerEnter={() => checkRef.current?.startAnimation()}
          onPointerLeave={() => checkRef.current?.stopAnimation()}
        >
          <CheckIcon ref={checkRef} size={17} aria-hidden />
          {label}
        </motion.button>
        <button
          className="btn btn--ghost"
          style={{ flex: '0 0 auto' }}
          disabled={busy}
          onClick={() => run(() => api.ignoreCandidate(candidate.id), 'ignored')}
        >
          <X size={16} strokeWidth={2.4} />
          Ignore
        </button>
      </div>

      {/* The stamp lands over the card, centred, then the card leaves. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          pointerEvents: 'none',
        }}
        aria-live="polite"
      >
        <StampDrop show={stamped} tone="teal">
          {isPlace ? 'Pinned' : 'Saved'}
        </StampDrop>
      </div>
    </motion.article>
  )
}
