import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../lib/api'
import {
  forgetFolder,
  planSync,
  readRememberedFolder,
  rememberFolder,
  rememberedFolderName,
  supportsFolderMemory,
  type SyncPlan,
  type SyncProgress,
} from '../lib/albumSync'
import type { SourceSummary } from '../lib/types'
import { Note } from './ui'
import { Check, Crosshair, FolderOpen, Loader2, RefreshCw, Trash2 } from './icons'

/**
 * Sync an album, as far as a browser allows.
 *
 * A web app cannot read a photo library on its own. What it can do is take the
 * whole album when you offer it and work out what is genuinely new, by hashing
 * each file on the device and asking the server about the hashes first. That
 * turns "select all" from a gigabyte re-upload into a few kilobytes.
 */
export default function AlbumSync({ onDone }: { onDone: () => void }) {
  const [plan, setPlan] = useState<SyncPlan | null>(null)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [results, setResults] = useState<SourceSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const canRemember = supportsFolderMemory()

  useEffect(() => {
    if (canRemember) void rememberedFolderName().then(setFolder)
  }, [canRemember])

  async function examine(files: File[]) {
    setError(null)
    setResults(null)
    setPlan(null)
    if (files.length === 0) return
    try {
      const next = await planSync(
        files,
        async (fingerprints) => (await api.knownFingerprints(fingerprints)).data.known,
        setProgress,
      )
      setPlan(next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read those files.')
    } finally {
      setProgress(null)
    }
  }

  async function importFresh() {
    if (!plan || plan.fresh.length === 0) return
    setError(null)
    setProgress({ phase: 'uploading', done: 0, total: plan.fresh.length })
    const uploaded: SourceSummary[] = []
    try {
      // One at a time: a failure part-way leaves everything before it saved.
      for (const [index, file] of plan.fresh.entries()) {
        const { data } = await api.upload([file])
        uploaded.push(...data)
        setProgress({ phase: 'uploading', done: index + 1, total: plan.fresh.length })
      }
      setResults(uploaded)
      setPlan(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That upload did not go through.')
      if (uploaded.length) setResults(uploaded)
    } finally {
      setProgress(null)
    }
  }

  const pending = results?.reduce((sum, source) => sum + source.pending_count, 0) ?? 0

  return (
    <div className="pad stack" style={{ paddingTop: 'var(--s-4)' }}>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,image/*"
        className="sr-only"
        onChange={(event) => void examine(Array.from(event.target.files ?? []))}
      />

      {!progress && !plan && !results && (
        <>
          <button className="btn btn--accent btn--block" onClick={() => inputRef.current?.click()}>
            <Crosshair size={17} strokeWidth={2.2} />
            Choose from album
          </button>
          <p className="t-sm dimmer">
            Select everything - the picker has a select-all. Anything already saved is
            recognised and skipped without being uploaded again.
          </p>

          {canRemember && (
            <>
              <hr className="divider" style={{ margin: 'var(--s-3) 0' }} />
              {folder ? (
                <>
                  <p className="t-sm dim">
                    Remembered folder: <strong>{folder}</strong>
                  </p>
                  <div className="row" style={{ gap: 'var(--s-2)' }}>
                    <button
                      className="btn grow"
                      onClick={async () => {
                        const files = await readRememberedFolder()
                        if (files) void examine(files)
                        else setError('Permission for that folder has lapsed. Pick it again.')
                      }}
                    >
                      <RefreshCw size={16} strokeWidth={2.2} />
                      Sync now
                    </button>
                    <button
                      className="btn btn--plain"
                      onClick={async () => {
                        await forgetFolder()
                        setFolder(null)
                      }}
                      aria-label="Forget this folder"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </>
              ) : (
                <button
                  className="btn btn--block"
                  onClick={async () => setFolder(await rememberFolder())}
                >
                  <FolderOpen size={16} strokeWidth={2.2} />
                  Remember a folder
                </button>
              )}
              <p className="t-sm dimmer">
                This browser can remember a folder, so a later sync needs no picking.
                Phones cannot, which is why the picker above is the main path.
              </p>
            </>
          )}
        </>
      )}

      {progress && (
        <div className="stack-2">
          <p className="row t-sm dim" style={{ gap: 6 }}>
            <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
            {progress.phase === 'reading' && 'Reading your selection…'}
            {progress.phase === 'checking' && 'Checking what is already saved…'}
            {progress.phase === 'uploading' && 'Uploading what is new…'}
          </p>
          <div className="meter">
            <span
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
          <p className="t-sm dimmer num">
            {progress.done} of {progress.total}
          </p>
        </div>
      )}

      {plan && !progress && (
        <div className="stack">
          <div>
            <p className="t-xl num">
              {plan.fresh.length}
              <span className="t-md dimmer"> new</span>
            </p>
            <p className="meta">
              <span>{plan.alreadySaved + plan.fresh.length} selected</span>
              <span>{plan.alreadySaved} already saved</span>
              {plan.unhashable > 0 && <span>{plan.unhashable} too large to check</span>}
            </p>
          </div>

          {plan.fresh.length === 0 ? (
            <>
              <Note Icon={Check}>Nothing new. Everything you picked is already in TripStash.</Note>
              <button className="btn btn--block" onClick={onDone}>
                Done
              </button>
            </>
          ) : (
            <button className="btn btn--accent btn--block" onClick={importFresh}>
              Import {plan.fresh.length} new item{plan.fresh.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}

      {error && <Note tone="danger">{error}</Note>}

      {results && !progress && (
        <div className="stack">
          <Note Icon={Check}>
            {results.length} item{results.length === 1 ? '' : 's'} imported
            {pending > 0 ? `, ${pending} waiting in Inbox.` : '.'}
          </Note>
          <button className="btn btn--accent btn--block" onClick={onDone}>
            Done
          </button>
        </div>
      )}
    </div>
  )
}
