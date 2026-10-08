/**
 * Who you are, and how the app should behave for you.
 *
 * It exists for the picks, not for account settings: what you want out of a
 * trip orders every recommendation and is the first thing Explore asks about.
 * Reached from the avatar on the trip, since it is not a place you go to plan.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp, useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import TopBar from '../components/TopBar'
import { ErrorNote, SkeletonRows } from '../components/ui'
import { AlertTriangle, ArrowLeft, ChevronRight } from '../components/icons'

export default function Profile() {
  useScreenContext({ surface: 'profile' })
  const { signOut, trip } = useApp()
  const picks = useAsync(() => api.activities(), [])
  const sources = useAsync(() => api.sources(), [])
  const [saving, setSaving] = useState(false)
  const [failedSave, setFailedSave] = useState<string | null>(null)

  const picked = new Set(picks.data?.picked ?? [])
  const all = sources.data ?? []
  const failed = all.filter((s) => s.status === 'failed').length

  async function toggle(slug: string) {
    if (!picks.data) return
    const next = picked.has(slug)
      ? picks.data.picked.filter((s) => s !== slug)
      : [...picks.data.picked, slug]
    setSaving(true)
    setFailedSave(null)
    try {
      await api.setActivities(next)
      picks.reload()
    } catch (error) {
      setFailedSave(error instanceof Error ? error.message : 'That did not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="screen">
      <TopBar
        title="You"
        ask={false}
        leading={
          <Link className="iconbtn" to="/" aria-label="Back to your trip">
            <ArrowLeft size={19} />
          </Link>
        }
      />

      <section className="card profile__card">
        <h2 className="t-md">What you want out of a trip</h2>
        <p className="t-sm dim">
          {picked.size === 0
            ? 'Nothing picked, so everything ranks the same. Pick a few and recommendations follow them.'
            : `${picked.size} picked. Every recommendation is ordered by these, and Explore asks about them before it answers.`}
        </p>
        {picks.loading && !picks.data && <SkeletonRows rows={2} />}
        {picks.error && <ErrorNote message={picks.error} onRetry={picks.reload} />}
        <div className="chiprow" role="group" aria-label="What you want out of a trip">
          {(picks.data?.available ?? []).map((a) => (
            <button
              key={a.slug}
              className="chip-toggle"
              aria-pressed={picked.has(a.slug)}
              disabled={saving}
              onClick={() => toggle(a.slug)}
            >
              {a.label}
            </button>
          ))}
        </div>
        {failedSave && <ErrorNote message={failedSave} />}
      </section>

      <Link to="/saved" className="card profile__card profile__link">
        <span className="item__body">
          <span className="t-md">Your sources</span>
          <span className="t-sm dim">
            {all.length} saved{failed > 0 && `, ${failed} failed to download`} · Saved → Sources
          </span>
        </span>
        {failed > 0 && (
          <span className="cliptag cliptag--warn">
            <AlertTriangle size={12} /> {failed}
          </span>
        )}
        <ChevronRight size={18} className="dimmer" />
      </Link>

      <section className="card profile__card">
        <h2 className="t-md">Account</h2>
        <p className="t-sm dim">Trip: {trip?.name ?? '—'}</p>
        <button className="btn btn--block" onClick={signOut}>
          Sign out
        </button>
      </section>
    </div>
  )
}
