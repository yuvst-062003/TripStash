/**
 * Who you are, and how the app should behave for you.
 *
 * This tab exists for the picks, not for the account settings. What you want
 * out of a trip orders every recommendation in the app and is the first thing
 * Explore asks about - that is product, not preferences. A tab holding only a
 * sign-out button would not have earned its 78 pixels.
 *
 * The download console lives here too, at the bottom, because retrying a failed
 * video is real work that somebody occasionally has to do and nobody should
 * trip over on the way to planning a trip.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { labelFor } from '../lib/activityLabels'
import { ErrorNote, SkeletonRows } from '../components/ui'

/**
 * The daily ceiling on video search.
 *
 * YouTube gives 10,000 quota units a day and a search costs 100, so a hundred
 * reads is the real budget. Explore says what it spent rather than burning it
 * quietly, which is the only honest way to hand someone a metered feature.
 */
const SEARCHES_PER_DAY = 100

export default function Profile() {
  const picks = useAsync(() => api.activities(), [], true, 'profile:picks')
  const sources = useAsync(() => api.sources(), [], true, 'profile:sources')
  const [saving, setSaving] = useState(false)

  if (picks.error) return <ErrorNote message={picks.error} onRetry={picks.reload} />
  if (!picks.data) return <SkeletonRows />

  const picked = new Set(picks.data.picked)
  const failed = (sources.data ?? []).filter((s) => s.status === 'failed').length

  async function toggle(slug: string) {
    if (!picks.data) return
    const next = picked.has(slug)
      ? picks.data.picked.filter((s) => s !== slug)
      : [...picks.data.picked, slug]
    setSaving(true)
    try {
      await api.setActivities(next)
      picks.reload()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="screen" data-testid="profile">
      <header className="pad pad-y datapage__head">
        <span className="datapage__photo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="12" cy="9" r="4" />
            <path d="M4 21c1.6-4 4.4-6 8-6s6.4 2 8 6" />
          </svg>
        </span>
        <div className="datapage__fields">
          <h1 className="t-name t-name--lg">You</h1>
          <p className="doc-meta t-field">
            <span>
              {picks.data.picked.length} {picks.data.picked.length === 1 ? 'pick' : 'picks'}
            </span>
            <span>
              {(sources.data ?? []).length}{' '}
              {(sources.data ?? []).length === 1 ? 'source' : 'sources'}
            </span>
          </p>
        </div>
      </header>

      <section className="panel" data-testid="profile-picks">
        <h2 className="t-name t-name--md">What you want out of a trip</h2>
        <p className="panel__note">
          {picks.data.picked.length === 0
            ? 'Nothing picked, so nothing is filtered — everything ranks the same. Pick a few and recommendations follow them.'
            : `${picks.data.picked.length} picked. Every recommendation is ordered by these, and Explore asks about them before it answers.`}
        </p>
        <div className="chips chips--wrap">
          {picks.data.available.map((a) => {
            const on = picked.has(a.slug)
            return (
              <button
                key={a.slug}
                type="button"
                aria-pressed={on}
                disabled={saving}
                className={on ? 'btn btn--sm btn--teal' : 'btn btn--sm'}
                onClick={() => toggle(a.slug)}
                data-testid="profile-pick"
              >
                <span className="tickbox" aria-hidden="true" data-on={on} />
                {labelFor(a.slug)}
              </button>
            )
          })}
        </div>
      </section>

      <section className="panel" data-testid="profile-cost">
        <div className="panel__split">
          <h2 className="t-name t-name--md">What the reading costs</h2>
          <span className="t-name t-name--sm">0 of {SEARCHES_PER_DAY}</span>
        </div>
        <div className="meter" role="img" aria-label={`0 of ${SEARCHES_PER_DAY} searches used today`}>
          <span className="meter__fill" style={{ width: '0%' }} />
        </div>
        <p className="panel__note">
          A hundred searches a day, and each one is a real cost. Explore says how many it used
          rather than spending them quietly.
        </p>
      </section>

      <Link to="/profile/sources" className="panel panel--link" data-testid="profile-sources">
        <span className="panel__split">
          <span>
            <span className="t-name t-name--md">Your sources</span>
            <span className="panel__note">
              {(sources.data ?? []).length} saved
              {failed > 0 && `, ${failed} failed to download`}
            </span>
          </span>
          {failed > 0 && <span className="t-field panel__alarm">{failed} failed</span>}
        </span>
      </Link>
    </div>
  )
}
