import { useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ApiError, api } from '../lib/api'
import { useMotionPrefs } from '../lib/motion'
import { STAMP_PATTERN, tick } from '../lib/haptics'
import type { Candidate } from '../lib/types'
import { Banner, Confidence, KNOWLEDGE_LABEL, Meta, Note, knowledgeTint, pairText, stampToneFor } from './ui'
import { Stamp, StampDrop } from './Stamp'
import { Layers, Pencil, StickyNote, X } from './icons'
import { CheckIcon, type CheckIconHandle } from './motion'

type Decision = 'saved' | 'ignored' | null

/**
 * One extracted item awaiting a decision.
 *
 * Everything claimed appears with the words it came from, its confidence and
 * the place it resolved to. Nothing happens until approve, edit, merge or
 * ignore is chosen — and approving is the one moment that gets a stamp.
 */
export default function ReviewCard({
  candidate,
  onDecided,
}: {
  candidate: Candidate
  onDecided: () => void
}) {
  // A stay or transport *tip* has no location: it is knowledge, not a pin.
  const isPlace = candidate.is_place_candidate
  const [chosen, setChosen] = useState(candidate.resolutions[0]?.provider_place_id ?? '')
  const [reason, setReason] = useState(isPlace ? candidate.body ?? '' : '')
  const [editing, setEditing] = useState(false)
  // The note box stays closed until asked for: an always-open textarea doubles
  // the height of every row in a queue meant to be worked through quickly.
  const [noteOpen, setNoteOpen] = useState(isPlace)
  const [title, setTitle] = useState(candidate.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mergeWithDuplicate, setMergeWithDuplicate] = useState(true)
  const [stamped, setStamped] = useState(false)
  const [decision, setDecision] = useState<Decision>(null)
  const checkRef = useRef<CheckIconHandle>(null)
  const { reduced, spring } = useMotionPrefs()

  const needsPin = isPlace && candidate.resolutions.length === 0 && !candidate.duplicate_of_place_id
  const merging = Boolean(candidate.duplicate_of_place_id) && mergeWithDuplicate
  const resolved = candidate.resolutions.find((option) => option.provider_place_id === chosen)
  const { headline, detail } = isPlace
    ? { headline: candidate.title, detail: null }
    : pairText(candidate.title, candidate.body)
  const tint = knowledgeTint(candidate.type)

  async function run(action: () => Promise<unknown>, outcome: Exclude<Decision, null>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      if (outcome === 'saved') {
        // Stamp first, let it land, then let the card go.
        setStamped(true)
        tick(STAMP_PATTERN)
        window.setTimeout(() => setDecision('saved'), reduced ? 0 : 1000)
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
      if (editing && title.trim() !== candidate.title) {
        await api.editCandidate(candidate.id, { title: title.trim() })
      }
      await api.approveCandidate(candidate.id, {
        reason_saved: reason.trim() || null,
        provider_place_id: isPlace && chosen ? chosen : null,
        merge_into_place_id: merging ? candidate.duplicate_of_place_id : null,
      })
    }, 'saved')

  return (
    <motion.article
      className="card"
      style={{ position: 'relative', overflow: 'hidden' }}
      animate={
        decision === 'saved'
          ? { opacity: 0, scale: 0.96 }
          : decision === 'ignored'
            ? { opacity: 0, x: 120 }
            : { opacity: 1, x: 0, scale: 1 }
      }
      transition={reduced ? { duration: 0 } : spring}
      onAnimationComplete={() => {
        if (decision) onDecided()
      }}
    >
      <div className="row between" style={{ marginBottom: 'var(--s-3)' }}>
        <Stamp tone={stampToneFor(tint)} size="sm" rotate={-5}>
          {KNOWLEDGE_LABEL[candidate.type] ?? candidate.type}
        </Stamp>
        {/* The quote is the proof. When it is word for word what is already on
            screen, only its provenance is worth repeating. */}
        {candidate.evidence[0] && (
          <span className="t-small dimmer">from the {candidate.evidence[0].channel}</span>
        )}
      </div>

      {editing ? (
        <input
          className="input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="Title"
        />
      ) : (
        <h3 className="t-title" style={{ fontSize: '1.25rem' }}>
          {headline}
        </h3>
      )}

      {detail && (
        <p className="t dim" style={{ marginTop: 6 }}>
          {detail}
        </p>
      )}

      <Meta
        className="mt"
        parts={[
          candidate.destination_scope,
          resolved && [resolved.category, resolved.city].filter(Boolean).join(', '),
        ]}
      />

      {candidate.evidence.map((evidence, index) => {
        const shown = (detail ?? headline).trim().replace(/…$/, '')
        if (evidence.quote.trim().replace(/…$/, '') === shown) return null
        return (
          <blockquote className="quote" key={index} style={{ marginTop: 'var(--s-3)' }}>
            “{evidence.quote}”
          </blockquote>
        )
      })}

      <div style={{ marginTop: 'var(--s-3)' }}>
        <Confidence value={candidate.confidence} />
      </div>

      {candidate.duplicate_of_place_id && (
        <div style={{ marginTop: 'var(--s-3)' }}>
          <Banner tone="warn" Icon={Layers}>
            <strong>Possible duplicate.</strong> {candidate.duplicate_reason}.
            <label className="check" style={{ marginTop: 6 }}>
              <input
                type="checkbox"
                checked={mergeWithDuplicate}
                onChange={(event) => setMergeWithDuplicate(event.target.checked)}
              />
              Attach this source to the existing place
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
            No provider match for this name. Approving it needs a pin — add the place from Save, or
            ignore it.
          </Note>
        </div>
      )}

      {noteOpen ? (
        <label className="field" style={{ marginTop: 'var(--s-3)' }}>
          <span>{isPlace ? 'Why you are saving it' : 'Your note'}</span>
          <textarea
            className="input"
            value={reason}
            rows={2}
            autoFocus={!isPlace}
            placeholder={isPlace ? undefined : 'Optional'}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      ) : null}

      {error && (
        <div style={{ marginTop: 'var(--s-2)' }}>
          <Note tone="danger">{error}</Note>
        </div>
      )}

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
          {busy ? 'Saving…' : merging ? 'Merge' : 'Save'}
        </motion.button>
        <button
          className="icon-btn"
          disabled={busy}
          onClick={() => setEditing((on) => !on)}
          aria-label={editing ? 'Done editing' : 'Edit title'}
          aria-pressed={editing}
          style={editing ? { background: 'var(--paper-2)', color: 'var(--ink)' } : undefined}
        >
          <Pencil size={17} strokeWidth={2.2} />
        </button>
        {!noteOpen && (
          <button className="icon-btn" disabled={busy} onClick={() => setNoteOpen(true)} aria-label="Add a note">
            <StickyNote size={17} strokeWidth={2.2} />
          </button>
        )}
        <button
          className="btn btn--ghost"
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
          Saved
        </StampDrop>
      </div>
    </motion.article>
  )
}
