import { useState } from 'react'
import { ApiError, api } from '../lib/api'
import type { Candidate } from '../lib/types'
import { Banner, Confidence, KNOWLEDGE_LABEL, Meta, Note, pairText } from './ui'
import { Check, Layers, Pencil, X } from './icons'

/**
 * One extracted item awaiting a decision.
 *
 * Everything claimed appears with the words it came from, its confidence and
 * the place it resolved to. Nothing happens until approve, edit, merge or
 * ignore is chosen.
 */
/** Seconds into the media, as a person reads a timecode. */
function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

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

  const needsPin = isPlace && candidate.resolutions.length === 0 && !candidate.duplicate_of_place_id
  const merging = Boolean(candidate.duplicate_of_place_id) && mergeWithDuplicate
  const resolved = candidate.resolutions.find((option) => option.provider_place_id === chosen)
  const { headline, detail } = isPlace
    ? { headline: candidate.title, detail: null }
    : pairText(candidate.title, candidate.body)

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onDecided()
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
    })

  return (
    <article className="card">
      {editing ? (
        <input
          className="input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="Title"
        />
      ) : (
        <h3 className="t-md">{headline}</h3>
      )}

      {detail && (
        <p className="t-sm dim" style={{ marginTop: 4 }}>
          {detail}
        </p>
      )}

      <Meta
        parts={[
          KNOWLEDGE_LABEL[candidate.type] ?? candidate.type,
          candidate.destination_scope,
          resolved && [resolved.category, resolved.city].filter(Boolean).join(', '),
        ]}
      />

      <div className="row between" style={{ marginTop: 6 }}>
        <Confidence value={candidate.confidence} />
        {/* The quote is the proof, and for media it can cite the moment it was
            said or shown. */}
        {candidate.evidence[0] && (
          <span className="t-sm dimmer">
            from the {candidate.evidence[0].channel}
            {candidate.evidence[0].media_timestamp_seconds != null &&
              ` at ${formatTimestamp(candidate.evidence[0].media_timestamp_seconds)}`}
          </span>
        )}
      </div>

      {candidate.evidence.map((evidence, index) => {
        const shown = (detail ?? headline).trim().replace(/…$/, '')
        if (evidence.quote.trim().replace(/…$/, '') === shown) return null
        return (
          <blockquote className="quote" key={index} style={{ marginTop: 'var(--s-3)' }}>
            “{evidence.quote}”
          </blockquote>
        )
      })}

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
          <legend className="t-xs" style={{ marginBottom: 6 }}>
            Which place is this?
          </legend>
          <div className="stack-2">
            {candidate.resolutions.map((option) => (
              <label key={option.provider_place_id} className="check t-sm">
                <input
                  type="radio"
                  name={`resolve-${candidate.id}`}
                  checked={chosen === option.provider_place_id}
                  onChange={() => setChosen(option.provider_place_id)}
                />
                <span className="grow">
                  <span className="t-md">{option.name}</span>
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

      <div className="row" style={{ marginTop: 'var(--s-3)', gap: 'var(--s-2)' }}>
        <button className="btn btn--accent btn--sm" disabled={busy || needsPin} onClick={approve}>
          <Check size={15} strokeWidth={2.4} />
          {busy ? 'Saving…' : merging ? 'Merge and save' : 'Save'}
        </button>
        <button className="btn btn--sm btn--plain" disabled={busy} onClick={() => setEditing((on) => !on)}>
          <Pencil size={14} strokeWidth={2.2} />
          {editing ? 'Done' : 'Edit'}
        </button>
        {!noteOpen && (
          <button className="btn btn--sm btn--plain" disabled={busy} onClick={() => setNoteOpen(true)}>
            Note
          </button>
        )}
        <button
          className="btn btn--sm btn--plain"
          disabled={busy}
          onClick={() => run(() => api.ignoreCandidate(candidate.id))}
        >
          <X size={15} strokeWidth={2.2} />
          Ignore
        </button>
      </div>
    </article>
  )
}
