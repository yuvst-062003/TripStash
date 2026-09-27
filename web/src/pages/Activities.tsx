import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { ErrorNote, SkeletonRows } from '../components/ui'

/**
 * What this trip is about.
 *
 * Picks filter what the planning screens show. Nothing is weighted: how many
 * independent sources name a thing is what orders it, which is a number the
 * traveller can check rather than a score they guessed.
 */
export default function Activities() {
  const state = useAsync(() => api.activities(), [], true, 'activities')
  const [picked, setPicked] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (state.data && picked === null) setPicked(state.data.picked)
  }, [state.data, picked])

  if (state.error) return <ErrorNote message={state.error} onRetry={state.reload} />
  if (!state.data || picked === null) return <SkeletonRows />

  const options = state.data.available
  const toggle = (slug: string) =>
    setPicked((current) =>
      (current ?? []).includes(slug)
        ? (current ?? []).filter((one) => one !== slug)
        : [...(current ?? []), slug],
    )

  async function save() {
    setSaving(true)
    setFailed(null)
    try {
      await api.setActivities(picked ?? [])
      navigate('/countries')
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'That did not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="screen" data-testid="activities">
      <div className="pad pad-y">
        <h1 className="t-title">What is this trip about?</h1>
        <p className="t-small dim" style={{ marginTop: 'var(--s-2)' }}>
          Pick what pulls you. There is nothing to rank — your picks decide what shows up, and how
          many sources name a thing decides its order.
        </p>
      </div>

      <ul className="list">
        {options.map((option) => (
          <li key={option.slug}>
            <label className="item" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={picked.includes(option.slug)}
                onChange={() => toggle(option.slug)}
                data-testid={`activity-${option.slug}`}
                style={{ width: 19, height: 19, accentColor: 'var(--ink)', flex: 'none' }}
              />
              <span className="item__body">
                <span className="item__title">{option.label}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="pad pad-y">
        <p className="t-small dim" data-testid="picked-count">
          {picked.length} of {options.length} picked
        </p>
        {failed && (
          <div style={{ marginTop: 'var(--s-2)' }}>
            <ErrorNote message={failed} />
          </div>
        )}
        <button
          className="btn btn--ink btn--block"
          style={{ marginTop: 'var(--s-3)' }}
          onClick={() => void save()}
          disabled={saving}
          data-testid="save-activities"
        >
          {saving ? 'Saving' : 'Show me the countries'}
        </button>
      </div>
    </div>
  )
}
