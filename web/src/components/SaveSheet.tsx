import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ApiError, api } from '../lib/api'
import { useApp } from '../lib/context'
import { useOnlineStatus } from '../lib/hooks'
import { EXIT, useMotionPrefs } from '../lib/motion'
import { tick } from '../lib/haptics'
import { hasBrowserReader, readLinkInBrowser } from '../lib/linkReader'
import type { SourceSummary } from '../lib/types'
import { DrawerClose } from './Drawer'
import Segmented from './Segmented'
import AlbumSync from './AlbumSync'
import { StampDrop } from './Stamp'
import { Glyph, Meta, Note, SOURCE_LABEL, Sheet, fmtDay } from './ui'
import { Check, Image as ImageIcon, KNOWLEDGE_ICON, Link2, Loader2, Navigation, SOURCE_ICON, X } from './icons'
import { UploadIcon, type UploadIconHandle } from './motion'

type Mode = 'album' | 'link' | 'upload' | 'note' | 'event' | 'place'
const MODES: Mode[] = ['album', 'link', 'upload', 'note', 'event', 'place']

// What the API accepts, spelled out, so the picker never offers what it will refuse.
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/gif,video/mp4,video/quicktime,video/webm,application/pdf,text/plain,text/vtt,.srt'
const ACCEPTED_TYPES = new Set(ACCEPT.split(',').filter((t) => t.includes('/')))
const MAX_MB = 200
const localToday = () => new Date().toLocaleDateString('en-CA')

const fileSize = (bytes: number) =>
  bytes < 1_048_576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`

/** Why a file cannot be sent, in words, before it is sent. */
function refuse(file: File): string | null {
  if (file.size > MAX_MB * 1_048_576) return `${file.name} is over the ${MAX_MB} MB limit. Trim it or pick a shorter clip.`
  const type = file.type || (file.name.endsWith('.srt') ? 'text/plain' : '')
  if (type && !ACCEPTED_TYPES.has(type)) {
    return `${file.name} is not a supported file. Use a photo (JPG, PNG, HEIC, WebP, GIF), a video (MP4, MOV, WebM), a PDF or a text file.`
  }
  return null
}

const host = (url: string | null) => {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Global Save.
 *
 * Capture takes seconds and organising happens later: every path here writes a
 * Source immediately, then hands it to the review queue. The sheet keeps one
 * height and one place for the primary, whatever kind is being saved.
 */
export default function SaveSheet({
  onClose,
  initialMode = 'link',
}: {
  onClose: () => void
  initialMode?: Mode
}) {
  const { position, location, requestLocation } = useApp()
  const online = useOnlineStatus()
  const navigate = useNavigate()
  const { reduced, spring } = useMotionPrefs()
  const [mode, setMode] = useState<Mode>(initialMode)
  const dir = useRef(1)
  const [url, setUrl] = useState('')
  // Each kind keeps its own words; switching never carries a note into a link.
  const [text, setText] = useState<Record<Mode, string>>({ album: '', link: '', upload: '', note: '', event: '', place: '' })
  const [files, setFiles] = useState<File[]>([])
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SourceSummary[] | null>(null)
  const [event, setEvent] = useState({ title: '', where: '', on: '', until: '' })
  const [eventSaved, setEventSaved] = useState<{ title: string; past: boolean } | null>(null)
  const [reader, setReader] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const uploadRef = useRef<UploadIconHandle>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const previews = useMemo(
    () => files.map((file) => (file.type.startsWith('image/') ? URL.createObjectURL(file) : null)),
    [files],
  )
  useEffect(() => () => previews.forEach((p) => p && URL.revokeObjectURL(p)), [previews])

  const words = text[mode]
  const setWords = (value: string) => setText((all) => ({ ...all, [mode]: value }))

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
        setWords(words.trim() || read.text)
        setReader(read.reader)
      }
    } finally {
      setReading(false)
    }
  }

  function choose(next: Mode) {
    dir.current = Math.sign(MODES.indexOf(next) - MODES.indexOf(mode)) || 1
    setError(null)
    setMode(next)
  }

  function pick(list: FileList | File[] | null) {
    const chosen = Array.from(list ?? [])
    const bad = chosen.map(refuse).find(Boolean)
    setError(bad ?? null)
    setFiles(bad ? [] : chosen)
    if (chosen.length && !bad) tick()
  }

  async function save(submit: React.FormEvent) {
    submit.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'event') {
        // The traveller is the source: an event they write down needs no review.
        await api.createKnowledge({
          type: 'event',
          title: event.title.trim(),
          body: words.trim() || null,
          destination_scope: event.where.trim() || null,
          happens_on: event.on || null,
          ends_on: event.until || null,
        })
        setEventSaved({ title: event.title.trim(), past: (event.until || event.on) < localToday() })
        return
      }
      if (mode === 'upload') {
        const { data } = await api.upload(files, words.trim() || undefined)
        setResult(data)
      } else if (mode === 'place') {
        const { data } = await api.captureLink({
          text: words.trim(),
          kind: 'manual',
          lat: position?.lat ?? null,
          lon: position?.lon ?? null,
        })
        setResult([data])
      } else {
        // A caption without a link is a note; a link is a link.
        const link = mode === 'link' && url.trim()
        const { data } = await api.captureLink({
          url: link || null,
          text: words.trim() || null,
          kind: link ? 'link' : 'note',
          reader: link ? reader : null,
        })
        setResult([data])
      }
    } catch (err) {
      setError(
        !online
          ? 'You’re offline. Nothing was sent — what you typed is kept here. Try again when you’re back.'
          : err instanceof ApiError
            ? err.message
            : 'That could not be saved. Check your connection and try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const canSubmit =
    !busy &&
    Boolean(
      (mode === 'link' && (url.trim() || words.trim())) ||
        (mode === 'upload' && files.length > 0) ||
        (mode === 'event' && event.title.trim() && event.on && (!event.until || event.until >= event.on)) ||
        (mode === 'note' && words.trim()) ||
        (mode === 'place' && words.trim() && position),
    )

  if (eventSaved) {
    return (
      <Sheet title="Saved" onClose={onClose} className="drawer--save">
        <Outcome
          stamp="On the trip"
          tone="teal"
          kind="event"
          title={eventSaved.title}
          meta={[event.where.trim(), event.on && fmtDay(event.on)]}
          note={
            eventSaved.past
              ? 'That date has passed. It is kept under Knowledge, but it will not come back to Home.'
              : 'It comes back to Home as the date gets close.'
          }
          primary={
            <DrawerClose asChild>
              <button className="btn btn--ink grow">Done</button>
            </DrawerClose>
          }
          secondary={
            <button
              className="btn"
              onClick={() => {
                setEventSaved(null)
                setEvent({ title: '', where: '', on: '', until: '' })
                setWords('')
              }}
            >
              Save another
            </button>
          }
        />
      </Sheet>
    )
  }

  if (result) {
    const first = result[0]
    const pending = result.reduce((sum, source) => sum + source.pending_count, 0)
    const duplicate = result.length === 1 && first.duplicate
    const failed = result.filter((source) => source.status === 'failed')
    const title = first.title || first.filename || host(first.url) || (words.trim() ? words.trim().slice(0, 60) : SOURCE_LABEL[first.kind])
    const note = duplicate
      ? `You already saved this. ${first.candidate_count} item${first.candidate_count === 1 ? '' : 's'} came out of it${first.pending_count ? `, ${first.pending_count} still to review` : ', all reviewed'}.`
      : failed.length > 0
        ? failed[0].failure_reason ?? 'Nothing readable came from it yet. It is kept under Sources — retry with a caption or a screenshot.'
        : pending > 0
          ? `${pending} item${pending === 1 ? '' : 's'} extracted and waiting in Inbox. Nothing goes on your map until you confirm it.`
          : 'Nothing worth saving was found in it yet. The original is kept under Sources — add a caption and retry.'
    return (
      <Sheet title="Saved" onClose={onClose} className="drawer--save">
        <Outcome
          stamp={duplicate ? 'Already stashed' : pending > 0 ? 'Stashed' : 'Kept'}
          tone={pending > 0 ? 'teal' : 'muted'}
          kind={first.kind}
          title={title}
          meta={[
            result.length > 1 && `${result.length} files`,
            first.author,
            pending > 0 ? `${pending} to review` : null,
          ]}
          note={note}
          warn={failed.length > 0 || (pending === 0 && !duplicate)}
          primary={
            pending > 0 ? (
              <DrawerClose asChild>
                <button className="btn btn--ink grow" onClick={() => navigate(`/saved?source=${first.id}`)}>
                  Review in Inbox
                </button>
              </DrawerClose>
            ) : failed.length > 0 || duplicate || pending === 0 ? (
              <DrawerClose asChild>
                <button className="btn btn--ink grow" onClick={() => navigate('/saved?tab=sources')}>
                  Open in Sources
                </button>
              </DrawerClose>
            ) : (
              <DrawerClose asChild>
                <button className="btn btn--ink grow">Done</button>
              </DrawerClose>
            )
          }
          secondary={
            <button
              className="btn"
              onClick={() => {
                setResult(null)
                // A failed link keeps its URL so the retry can attach a caption.
                if (!failed.length) setUrl('')
                setWords('')
                setFiles([])
              }}
            >
              Save another
            </button>
          }
        />
      </Sheet>
    )
  }

  const locating = location.status === 'locating'
  const denied = location.status === 'denied'

  return (
    <Sheet
      title="Save"
      onClose={onClose}
      className="drawer--save"
      subhead={
        <Segmented
          name="save"
          label="What to save"
          value={mode}
          onChange={choose}
          options={[
            { value: 'album', label: 'Album' },
            { value: 'link', label: 'Link' },
            { value: 'upload', label: 'Media' },
            { value: 'note', label: 'Note' },
            { value: 'event', label: 'Event' },
            { value: 'place', label: 'Here' },
          ]}
        />
      }
    >
      <form className="pad save__form" onSubmit={save} style={{ paddingTop: 'var(--s-3)' }}>
        <AnimatePresence mode="wait" initial={false} custom={dir.current}>
          <motion.div
            key={mode}
            id={`save-panel-${mode}`}
            role="tabpanel"
            aria-labelledby={`save-tab-${mode}`}
            className="stack"
            custom={dir.current}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 8 * dir.current }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0, transition: EXIT } : { opacity: 0, x: -8 * dir.current, transition: EXIT }}
            transition={spring}
          >
            {mode === 'album' && <AlbumSync onDone={onClose} />}

            {mode === 'link' && (
              <>
                <label className="field">
                  <span>Link</span>
                  <input
                    className="input"
                    type="url"
                    inputMode="url"
                    autoFocus
                    placeholder="Reel, TikTok, article or Maps link"
                    value={url}
                    onChange={(change) => {
                      setUrl(change.target.value)
                      setReader(null)
                    }}
                    onBlur={(change) => void tryReadLink(change.target.value)}
                    onPaste={(change) => {
                      const pasted = change.clipboardData.getData('text')
                      if (pasted) window.setTimeout(() => void tryReadLink(pasted), 0)
                    }}
                  />
                </label>
                {reading && (
                  <p className="row t-small dim" style={{ gap: 6 }}>
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
                    value={words}
                    onChange={(change) => setWords(change.target.value)}
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
                <label
                  className="dropzone"
                  data-over={over}
                  data-chosen={files.length > 0}
                  onPointerEnter={() => uploadRef.current?.startAnimation()}
                  onPointerLeave={() => uploadRef.current?.stopAnimation()}
                  onDragOver={(drag) => {
                    drag.preventDefault()
                    setOver(true)
                  }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(drop) => {
                    drop.preventDefault()
                    setOver(false)
                    pick(drop.dataTransfer.files)
                  }}
                >
                  <Glyph Icon={files.length ? Check : ImageIcon} tint="teal" />
                  <span className="t-head">
                    {files.length ? `${files.length} file${files.length === 1 ? '' : 's'} ready` : 'Choose photos or videos'}
                  </span>
                  <span className="t-small dimmer">
                    {files.length ? 'Tap to change what is picked' : 'Only what you pick here is uploaded'}
                  </span>
                  <span className="sr-only">
                    <UploadIcon ref={uploadRef} size={24} aria-hidden />
                  </span>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept={ACCEPT}
                    className="sr-only"
                    onChange={(change) => pick(change.target.files)}
                  />
                </label>

                {files.length > 0 && (
                  <div className="thumbs" aria-label="Picked files">
                    {files.map((file, index) => (
                      <div className="thumb" key={`${file.name}-${index}`} title={`${file.name} · ${fileSize(file.size)}`}>
                        {previews[index] ? <img src={previews[index] as string} alt="" /> : <ImageIcon size={20} />}
                        <button
                          type="button"
                          className="thumb__x"
                          aria-label={`Remove ${file.name}`}
                          onClick={() => setFiles((list) => list.filter((_, at) => at !== index))}
                        >
                          <X size={12} strokeWidth={2.6} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {files.length > 0 && (
                  <Meta wrap parts={files.slice(0, 3).map((file) => `${file.name} · ${fileSize(file.size)}`).concat(files.length > 3 ? [`and ${files.length - 3} more`] : [])} />
                )}

                <label className="field">
                  <span>What is this?</span>
                  <textarea
                    className="input"
                    placeholder="A sentence helps the extraction a lot."
                    value={words}
                    onChange={(change) => setWords(change.target.value)}
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
                  autoFocus
                  placeholder="A recommendation someone gave you, a warning, a price…"
                  value={words}
                  onChange={(change) => setWords(change.target.value)}
                />
              </label>
            )}

            {mode === 'event' && (
              <>
                <label className="field">
                  <span>What is happening</span>
                  <input
                    className="input"
                    autoFocus
                    maxLength={240}
                    placeholder="Carnaval, full-moon party, market day"
                    value={event.title}
                    onChange={(change) => setEvent({ ...event, title: change.target.value })}
                    required
                  />
                </label>
                <div className="row" style={{ gap: 'var(--s-2)' }}>
                  <label className="field grow">
                    <span>On</span>
                    <input
                      className="input"
                      type="date"
                      value={event.on}
                      onChange={(change) => setEvent({ ...event, on: change.target.value })}
                      required
                    />
                  </label>
                  <label className="field grow">
                    <span>Until</span>
                    <input
                      className="input"
                      type="date"
                      value={event.until}
                      min={event.on || undefined}
                      aria-invalid={Boolean(event.until && event.on && event.until < event.on)}
                      onChange={(change) => setEvent({ ...event, until: change.target.value })}
                    />
                  </label>
                </div>
                {event.until && event.on && event.until < event.on && (
                  <Note tone="danger">Until must be on or after {fmtDay(event.on)}.</Note>
                )}
                {event.on && event.on < localToday() && (
                  <Note tone="warn">That date has passed. It will be kept, but it will not come back to Home.</Note>
                )}
                <label className="field">
                  <span>Where</span>
                  <input
                    className="input"
                    placeholder="Salvador"
                    value={event.where}
                    onChange={(change) => setEvent({ ...event, where: change.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Notes</span>
                  <textarea
                    className="input"
                    rows={2}
                    placeholder="Optional — where to be, what time, who told you"
                    value={words}
                    onChange={(change) => setWords(change.target.value)}
                  />
                </label>
                <p className="t-small dimmer">
                  Events skip the review queue: you are the source. TripStash brings it back on Home
                  as the date gets close.
                </p>
              </>
            )}

            {mode === 'place' && (
              <>
                {position ? (
                  <div className="row" style={{ gap: 'var(--s-3)', alignItems: 'center' }}>
                    <Glyph Icon={Navigation} tint="coral" />
                    <div className="grow">
                      <p className="t-head">Your location</p>
                      <p className="t-small dim num">
                        {position.lat.toFixed(4)}, {position.lon.toFixed(4)} — saved as a place to review in Inbox.
                      </p>
                    </div>
                  </div>
                ) : denied ? (
                  <Note tone="warn">
                    Location was refused, so this spot cannot be pinned. Allow it in your browser settings, or write a note instead.
                  </Note>
                ) : (
                  <button type="button" className="chip" onClick={requestLocation} disabled={locating}>
                    <Navigation size={14} strokeWidth={2.2} />
                    {locating ? 'Locating…' : 'Use my location'}
                  </button>
                )}
                <label className="field">
                  <span>Name this place</span>
                  <input
                    className="input"
                    autoFocus
                    placeholder="Rooftop with the volcano view"
                    value={words}
                    onChange={(change) => setWords(change.target.value)}
                  />
                </label>
                <p className="t-small dimmer">
                  It goes to Inbox as a place with your coordinates. Nothing goes on your map until you confirm it.
                </p>
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {mode !== 'album' && (
        <div className="save__foot">
          {error && (
            <div style={{ marginBottom: 'var(--s-3)' }} role="alert">
              <Note tone="danger">{error}</Note>
            </div>
          )}
          <motion.button
            className="btn btn--coral btn--block"
            type="submit"
            disabled={!canSubmit}
            aria-busy={busy}
            whileTap={{ scale: 0.98 }}
          >
            {busy
              ? 'Saving…'
              : mode === 'event'
                ? 'Put it on the trip'
                : mode === 'place'
                  ? 'Stash this place'
                  : 'Save and extract'}
          </motion.button>
        </div>
        )}
      </form>
    </Sheet>
  )
}

/**
 * What was saved, shown as what it is, with the stamp landing on its corner;
 * the consequence (the count, the note, the buttons) follows the landing.
 */
function Outcome({
  stamp,
  tone,
  kind,
  title,
  meta,
  note,
  warn,
  primary,
  secondary,
}: {
  stamp: string
  tone: 'teal' | 'muted'
  kind: string
  title: string
  meta: (string | null | false | undefined)[]
  note: string
  warn?: boolean
  primary: React.ReactNode
  secondary: React.ReactNode
}) {
  const { reduced, spring } = useMotionPrefs()
  const [show, setShow] = useState(false)
  const [landed, setLanded] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setShow(true), 40)
    // Whatever happens to the animation, the buttons are never withheld for long.
    const fallback = window.setTimeout(() => setLanded(true), 900)
    return () => {
      window.clearTimeout(id)
      window.clearTimeout(fallback)
    }
  }, [])
  const Icon = kind === 'event' ? KNOWLEDGE_ICON.event : SOURCE_ICON[kind] ?? Link2
  return (
    <div className="pad stack" style={{ paddingTop: 'var(--s-4)' }} role="status">
      <div className="capture">
        <div className="row" style={{ gap: 'var(--s-3)', alignItems: 'flex-start' }}>
          <Glyph Icon={Icon} tint={tone === 'teal' ? 'teal' : 'other'} />
          <div className="grow" style={{ minWidth: 0 }}>
            <p className="t-head clamp-2">{title}</p>
            <Meta wrap parts={[SOURCE_LABEL[kind] ?? kind, ...meta]} />
          </div>
        </div>
        <div className="capture__stamp">
          <StampDrop show={show} tone={tone} Icon={Check} onLand={() => setLanded(true)}>
            {stamp}
          </StampDrop>
        </div>
      </div>
      <AnimatePresence>
        {(landed || reduced) && (
          <motion.div
            className="stack"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring}
          >
            {warn ? <Note tone="warn">{note}</Note> : <p className="t-small dim">{note}</p>}
            <div className="row" style={{ gap: 'var(--s-2)', marginTop: 'var(--s-2)' }}>
              {primary}
              {secondary}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

