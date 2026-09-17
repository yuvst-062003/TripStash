import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ApiError, api } from '../lib/api'
import { useApp } from '../lib/context'
import { STAMP_PATTERN, tick } from '../lib/haptics'
import type { SourceSummary } from '../lib/types'
import Segmented from './Segmented'
import { Stamp, StampDrop } from './Stamp'
import { Note, Sheet } from './ui'
import { Check } from './icons'
import { UploadIcon, type UploadIconHandle } from './motion'

type Mode = 'link' | 'upload' | 'note' | 'place'

/**
 * Global Save.
 *
 * Capture takes seconds and organising happens later: every path here writes a
 * Source immediately, then hands it to the review queue.
 */
export default function SaveSheet({ onClose }: { onClose: () => void }) {
  const { position } = useApp()
  const [mode, setMode] = useState<Mode>('link')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SourceSummary[] | null>(null)
  const uploadRef = useRef<UploadIconHandle>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'upload') {
        const { data } = await api.upload(files, text.trim() || undefined)
        setResult(data)
      } else {
        const { data } = await api.captureLink({
          url: mode === 'link' ? url.trim() || null : null,
          text: text.trim() || null,
          kind: mode === 'note' ? 'note' : mode === 'link' ? 'link' : 'manual',
        })
        setResult([data])
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const pending = result?.reduce((sum, source) => sum + source.pending_count, 0) ?? 0
  const failed = result?.filter((source) => source.status === 'failed') ?? []

  const canSubmit =
    !busy &&
    ((mode === 'link' && (url.trim() || text.trim())) ||
      (mode === 'upload' && files.length > 0) ||
      ((mode === 'note' || mode === 'place') && text.trim()))

  if (result) {
    return (
      <Sheet title="Saved" onClose={onClose}>
        <div className="pad stack" style={{ paddingTop: 'var(--s-2)' }}>
          <SavedStamp pending={pending} />
          <Note Icon={Check}>
            {pending > 0
              ? `${pending} item${pending === 1 ? '' : 's'} extracted and waiting in Inbox. Nothing goes on your map until you confirm it.`
              : 'Nothing could be extracted automatically, but the original is kept in Inbox.'}
          </Note>

          {failed.map((source) => (
            <Note tone="warn" key={source.id}>
              {source.filename || source.url} — {source.failure_reason}
            </Note>
          ))}

          <div className="row" style={{ gap: 'var(--s-2)' }}>
            <button className="btn btn--ink grow" onClick={onClose}>
              Done
            </button>
            <button
              className="btn"
              onClick={() => {
                setResult(null)
                setUrl('')
                setText('')
                setFiles([])
              }}
            >
              Save another
            </button>
          </div>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title="Save" onClose={onClose}>
      <Segmented
        label="What to save"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'link', label: 'Link' },
          { value: 'upload', label: 'Media' },
          { value: 'note', label: 'Note' },
          { value: 'place', label: 'Here' },
        ]}
      />

      <form className="pad stack" onSubmit={save} style={{ paddingTop: 'var(--s-4)' }}>
        {mode === 'link' && (
          <>
            <label className="field">
              <span>Link</span>
              <input
                className="input"
                type="url"
                placeholder="Reel, TikTok, article or Maps link"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Caption or transcript</span>
              <textarea
                className="input"
                placeholder="Paste the caption too — private posts cannot be read for you"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <p className="t-small dimmer">
              The link is stored either way. If the platform blocks reading it, paste the caption or
              add a screenshot and nothing is lost.
            </p>
          </>
        )}

        {mode === 'upload' && (
          <>
            <motion.label
              className="card"
              whileTap={{ scale: 0.985 }}
              onPointerEnter={() => uploadRef.current?.startAnimation()}
              onPointerLeave={() => uploadRef.current?.stopAnimation()}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                minHeight: 112,
                justifyContent: 'center',
                cursor: 'pointer',
                borderStyle: 'dashed',
                borderWidth: 2,
              }}
            >
              <UploadIcon ref={uploadRef} size={24} aria-hidden />
              <span className="t-head">Choose photos or videos</span>
              <span className="t-small dimmer">Only what you pick here is uploaded</span>
              <input
                type="file"
                multiple
                accept="image/*,video/*,text/plain,.srt,.vtt"
                className="sr-only"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
            </motion.label>

            {files.length > 0 && (
              <p className="t-small dim num">
                {files.length} file{files.length === 1 ? '' : 's'} ·{' '}
                {(files.reduce((sum, file) => sum + file.size, 0) / 1048576).toFixed(1)} MB
              </p>
            )}

            <label className="field">
              <span>What is this?</span>
              <textarea
                className="input"
                placeholder="A sentence helps the extraction a lot."
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>

            <p className="t-small dimmer">
              TripStash never scans your library. Each file keeps a content hash, so re-importing the
              same clip will not duplicate it.
            </p>
          </>
        )}

        {mode === 'note' && (
          <label className="field">
            <span>Note</span>
            <textarea
              className="input"
              rows={5}
              placeholder="A recommendation someone gave you, a warning, a price…"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
        )}

        {mode === 'place' && (
          <>
            {position ? (
              <p className="t-small dim num">
                Saving {position.lat.toFixed(4)}, {position.lon.toFixed(4)}.
              </p>
            ) : (
              <Note tone="warn">
                No location yet. Allow location from Home or Map first, or write a note instead.
              </Note>
            )}
            <label className="field">
              <span>What is here?</span>
              <input
                className="input"
                placeholder="Rooftop with the volcano view"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
          </>
        )}

        {error && <Note tone="danger">{error}</Note>}

        <motion.button className="btn btn--coral btn--block" type="submit" disabled={!canSubmit} whileTap={{ scale: 0.98 }}>
          {busy ? 'Saving…' : 'Save and extract'}
        </motion.button>
      </form>
    </Sheet>
  )
}

/** The stamp lands as the sheet opens on the result, with a haptic tick. */
function SavedStamp({ pending }: { pending: number }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => {
      setShow(true)
      tick(STAMP_PATTERN)
    }, 120)
    return () => window.clearTimeout(id)
  }, [])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)', minHeight: 72 }}>
      <StampDrop show={show} tone={pending > 0 ? 'teal' : 'muted'} Icon={Check}>
        Stashed
      </StampDrop>
      {pending > 0 && (
        <Stamp tone="coral" size="sm" rotate={5}>
          {pending} to review
        </Stamp>
      )}
    </div>
  )
}
