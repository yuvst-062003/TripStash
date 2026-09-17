import { useState } from 'react'
import { api } from '../lib/api'
import { Note } from './ui'
import { Download } from './icons'

/**
 * "Export everything" as a real download: the export needs the bearer token,
 * which a plain link cannot carry, and it says when it is working or failed.
 */
export default function ExportButton({ className = 'btn btn--block' }: { className?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const blob = await api.exportBlob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'tripstash-export.json'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      setError('Couldn’t build the export. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={run} aria-busy={busy}>
        <Download size={16} strokeWidth={2.2} />
        {busy ? 'Exporting…' : 'Export everything'}
      </button>
      {error && (
        <div role="alert">
          <Note tone="danger">{error}</Note>
        </div>
      )}
    </>
  )
}
