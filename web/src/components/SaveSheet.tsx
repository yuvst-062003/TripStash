import { useState } from 'react'
import { ApiError, api } from '../lib/api'
import { useApp } from '../lib/context'
import type { SourceSummary } from '../lib/types'
import { hasBrowserReader, readLinkInBrowser } from '../lib/linkReader'
import AlbumSync from './AlbumSync'
import { Note, Sheet, Tabs } from './ui'
import { Check, Loader2, Upload } from './icons'

type Mode = 'album' | 'link' | 'upload' | 'note' | 'place'

/**
 * Global Save.
 *
 * Capture takes seconds and organising happens later: every path here writes a
 * Source immediately, then hands it to the review queue.
 */
export default function SaveSheet({
  onClose,
  initialMode = 'link',
}: {
  onClose: () => void
  initialMode?: Mode
}) {
  const { position } = useApp()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SourceSummary[] | null>(null)
  const [reader, setReader] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  /**
   * Ask the platform for the caption from here rather than from the server.
   * The browser is on the traveller's own connection, which is the one a
   * platform will actually answer. Finding nothing is an ordinary outcome.
   */
  async function tryReadLink(candidate: string) {
    const trimmed = candidate.trim()
    if (!trimmed || !hasBrowserReader(trimmed)) return
    setReading(true)
    try {
      const read = await readLinkInBrowser(trimmed)
      if (read?.text) {
        setText((current) => current || read.text || '')
        setReader(read.reader)
      }
    } finally {
      setReading(false)
    }
  }

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
          reader: mode === 'link' ? reader : null,
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
            <button className="btn btn--accent grow" onClick={onClose}>
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
      <Tabs
        label="What to save"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'album', label: 'Album' },
          { value: 'link', label: 'Link' },
          { value: 'upload', label: 'Media' },
          { value: 'note', label: 'Note' },
          { value: 'place', label: 'Here' },
        ]}
      />

      {mode === 'album' && <AlbumSync onDone={onClose} />}

      {mode !== 'album' && (
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
                onChange={(event) => {
                  setUrl(event.target.value)
                  setReader(null)
                }}
                onBlur={(event) => void tryReadLink(event.target.value)}
                onPaste={(event) => {
                  const pasted = event.clipboardData.getData('text')
                  if (pasted) window.setTimeout(() => void tryReadLink(pasted), 0)
                }}
              />
            </label>

            {reading && (
              <p className="row t-sm dim" style={{ gap: 6 }}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                Asking the platform for the caption…
              </p>
            )}
            {reader && !reading && (
              <Note Icon={Check}>Caption read by your browser, straight from the platform.</Note>
            )}
            <label className="field">
              <span>Caption or transcript</span>
              <textarea
                className="input"
                placeholder="Paste the caption too — private posts cannot be read for you"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <p className="t-sm dimmer">
              The link is stored either way. If the platform blocks reading it, paste the caption or
              add a screenshot and nothing is lost.
            </p>
          </>
        )}

        {mode === 'upload' && (
          <>
            <label
              className="btn btn--block"
              style={{ flexDirection: 'column', gap: 4, minHeight: 92, cursor: 'pointer' }}
            >
              <Upload size={20} strokeWidth={1.9} className="dimmer" />
              <span className="t-md">Choose photos or videos</span>
              <span className="t-sm dimmer">Only what you pick here is uploaded</span>
              <input
                type="file"
                multiple
                accept="image/*,video/*,text/plain,.srt,.vtt"
                className="sr-only"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
            </label>

            {files.length > 0 && (
              <p className="t-sm dim num">
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

            <p className="t-sm dimmer">
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
              <p className="t-sm dim num">
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

        <button className="btn btn--accent btn--block" type="submit" disabled={!canSubmit}>
          {busy ? 'Saving…' : 'Save and extract'}
        </button>
      </form>
      )}
    </Sheet>
  )
}
