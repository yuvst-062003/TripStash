import { useState } from 'react'
import { ApiError, api } from '../lib/api'
import { Note } from './ui'
import { Check, Download } from './icons'

/**
 * "Export everything" as a real download: the export needs the bearer token,
 * which a plain link cannot carry, and it says when it is working, done or
 * failed — the browser's own download UI is off-screen in a standalone PWA.
 */
export default function ExportButton({ className = 'btn btn--block' }: { className?: string }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (busy) return
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      // Never a blink: the busy state lasts long enough to be read.
      const [blob] = await Promise.all([api.exportBlob(), new Promise((r) => setTimeout(r, 400))])
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'tripstash-export.json'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setDone(true)
      window.setTimeout(() => setDone(false), 4000)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status >= 500
            ? 'TripStash couldn’t build the export. Try again in a moment.'
            : err.message
          : 'Couldn’t reach TripStash. Check your connection and try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={run} aria-busy={busy}>
        {done ? <Check size={16} strokeWidth={2.4} /> : <Download size={16} strokeWidth={2.2} />}
        {busy ? 'Exporting…' : done ? 'Exported' : 'Export everything'}
      </button>
      <p className="sr-only" aria-live="polite">
        {done ? 'Downloaded tripstash-export.json' : ''}
      </p>
      {done && (
        <p className="t-small dimmer" style={{ marginTop: -4 }}>
          Downloaded tripstash-export.json.
        </p>
      )}
      {error && (
        <div role="alert">
          <Note tone="danger">{error}</Note>
        </div>
      )}
    </>
  )
}
