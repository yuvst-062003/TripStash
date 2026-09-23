/**
 * Where the clip feed starts: every spot with video behind it, under the city
 * or country it belongs to. Tapping a heading plays that whole place in one
 * run; tapping a spot plays just that spot.
 */
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import type { ReelSpot } from '../lib/types'
import TopBar from '../components/TopBar'
import {
  CacheNote,
  Empty,
  ErrorNote,
  Glyph,
  Meta,
  SectionLabel,
  SkeletonRows,
} from '../components/ui'
import { CATEGORY_ICON, ChevronRight, Film, MapPin, Play } from '../components/icons'

export default function Clips() {
  const spots = useAsync(() => api.reelSpots(), [])
  useScreenContext({ surface: 'saved' })

  const grouped = (spots.data ?? []).reduce<Record<string, ReelSpot[]>>((acc, spot) => {
    ;(acc[spot.scope_label] ??= []).push(spot)
    return acc
  }, {})
  const scopes = Object.keys(grouped)

  return (
    <div className="screen">
      <TopBar title="Clips" subtitle="The videos you saved, by where they are" />
      <CacheNote visible={spots.fromCache} />

      {spots.loading && !spots.data && <SkeletonRows rows={5} />}
      {spots.error && <ErrorNote message={spots.error} onRetry={spots.reload} />}

      {spots.data && scopes.length === 0 && (
        <Empty
          title="Nothing to scroll yet"
          body="Save a video, approve a place from it, and its clips collect here under that city."
        />
      )}

      {scopes.map((scope) => {
        const spotsHere = grouped[scope]
        const clips = spotsHere.reduce((sum, spot) => sum + spot.clip_count, 0)
        return (
          <section key={scope}>
            <SectionLabel
              action={
                <Link className="btn btn--sm" to={`/clips/feed?scope=${encodeURIComponent(scope)}`}>
                  <Play size={14} /> Play {clips}
                </Link>
              }
            >
              {scope}
            </SectionLabel>
            <ul className="list">
              {spotsHere.map((spot) => (
                <li key={spot.trip_place_id}>
                  <Link className="item" to={`/clips/feed?spot=${spot.trip_place_id}`}>
                    <Glyph Icon={CATEGORY_ICON[spot.category] ?? MapPin} />
                    <div className="item__body">
                      <p className="item__title clamp-1">{spot.name}</p>
                      <Meta
                        parts={[
                          `${spot.clip_count} ${spot.clip_count === 1 ? 'clip' : 'clips'}`,
                          spot.playable_count < spot.clip_count
                            ? `${spot.clip_count - spot.playable_count} link only`
                            : null,
                          spot.city && spot.city !== scope ? spot.city : null,
                        ]}
                      />
                    </div>
                    <ChevronRight size={18} className="dimmer" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      {scopes.length > 1 && (
        <div className="pad" style={{ paddingBlock: 'var(--s-5)' }}>
          <Link className="btn btn--block" to="/clips/feed">
            <Film size={16} /> Play everything you saved
          </Link>
        </div>
      )}
    </div>
  )
}
