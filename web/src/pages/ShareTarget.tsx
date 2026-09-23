import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { hasBrowserReader, readLinkInBrowser } from '../lib/linkReader'
import type { SourceSummary } from '../lib/types'
import { Note, SkeletonRows } from '../components/ui'
import { Check, Inbox, Link2 } from '../components/icons'

/**
 * Where the operating system's share sheet lands.
 *
 * The manifest has declared this target since the first commit, but the route
 * did not exist, so sharing a post into the installed app fell through to Home
 * and the capture was lost. This is the highest-value path in the whole
 * product: the platform hands over the caption itself, with no fetching, no
 * scraping and nothing to be blocked.
 */
export default function ShareTarget() {
  const [params] = useSearchParams()
  const [result, setResult] = useState<SourceSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('Saving what was shared…')
  // Share targets can re-render; the capture must happen exactly once.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const title = params.get('title')?.trim() || null
    const rawText = params.get('text')?.trim() || null
    let url = params.get('url')?.trim() || null

    // Android frequently puts the link inside `text` rather than `url`.
    let text = rawText
    if (!url && rawText) {
      const match = rawText.match(/https?:\/\/\S+/)
      if (match) {
        url = match[0]
        const remainder = rawText.replace(match[0], '').trim()
        text = remainder || null
      }
    }

    if (!url && !text && !title) {
      setError('Nothing came through with that share.')
      return
    }

    void (async () => {
      let reader = text ? 'share-target' : null

      // The share sheet usually brings the caption. When it does not, the
      // browser can still ask the platform directly - from the traveller's own
      // connection, which is the one the platform will answer.
      if (!text && url && hasBrowserReader(url)) {
        setNote('Asking the platform for the caption…')
        const read = await readLinkInBrowser(url)
        if (read?.text) {
          text = read.text
          reader = read.reader
        }
      }

      try {
        const { data } = await api.captureLink({
          url,
          text,
          title,
          kind: 'link',
          reader,
        })
        setResult(data)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'That could not be saved.')
      }
    })()
  }, [params])

  return (
    <div className="screen">
      <header className="topbar">
        <h1 className="t-head grow">Shared to TripStash</h1>
      </header>

      <div className="pad">
        {!result && !error && (
          <>
            <p className="t-small dim">{note}</p>
            <div style={{ marginTop: 'var(--s-4)' }}>
              <SkeletonRows rows={2} />
            </div>
          </>
        )}

        {error && <Note tone="danger">{error}</Note>}

        {result && (
          <div className="stack">
            <Note Icon={Check}>
              {result.pending_count > 0
                ? `Saved. ${result.pending_count} item${result.pending_count === 1 ? '' : 's'} extracted and waiting in Inbox.`
                : 'Saved. Nothing could be extracted automatically, but the original is kept in Inbox.'}
            </Note>

            <div>
              <p className="t clamp-2">{result.title || result.url}</p>
              {result.url && (
                <p className="meta clamp-1">
                  <Link2 size={12} style={{ verticalAlign: '-1px' }} /> {result.url}
                </p>
              )}
            </div>

            {result.failure_reason && <Note tone="warn">{result.failure_reason}</Note>}

            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <Link className="btn btn--ink grow" to="/saved">
                <Inbox size={16} strokeWidth={2.2} />
                Review it
              </Link>
              <Link className="btn" to="/">
                Done
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
