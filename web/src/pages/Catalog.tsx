/**
 * Everything you have gathered, filed by what you DO rather than where it is.
 *
 * This is the one question the map cannot answer. "Every hike I have saved"
 * spans four countries, so no single map view holds them - but one heading
 * here does. The map organises by place; this organises by activity, and the
 * two are different questions rather than two skins on the same list.
 *
 * It replaces Saved, which was four things wearing one name: a task queue, a
 * library, loose quotes and a download console. The queue moved to the top of
 * this screen as a banner, the quotes moved onto the places they describe, and
 * the console moved to Profile, where nobody has to trip over it.
 */
import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Evidence from '../components/Evidence'
import { api } from '../lib/api'
import { useApp } from '../lib/context'
import { useAsync } from '../lib/hooks'
import { ACTIVITY_LABELS } from '../lib/activityLabels'
import type { PlaceSummary } from '../lib/types'
import { Empty, ErrorNote, SkeletonRows } from '../components/ui'

interface Group {
  slug: string
  label: string
  places: PlaceSummary[]
  countries: number
}

/**
 * Gather places under the activities they answer to.
 *
 * A place can sit under more than one heading, and should: Acatenango is a
 * hike and a volcano, and hiding it from one of those lists to keep the
 * counts tidy would be arranging the data for the screen's benefit.
 */
export function groupByActivity(
  places: PlaceSummary[],
  activityOf: (p: PlaceSummary) => string[],
): Group[] {
  const by = new Map<string, PlaceSummary[]>()
  for (const place of places) {
    for (const slug of activityOf(place)) {
      const list = by.get(slug) ?? []
      list.push(place)
      by.set(slug, list)
    }
  }

  return [...by.entries()]
    .map(([slug, list]) => ({
      slug,
      label: ACTIVITY_LABELS[slug] ?? slug,
      places: list,
      countries: new Set(list.map((p) => p.country ?? '')).size,
    }))
    .sort((a, b) => b.places.length - a.places.length || a.label.localeCompare(b.label))
}

export default function Catalog() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { openAsk } = useApp()
  const chip = params.get('doing')

  const places = useAsync(() => api.places({}), [], true, 'catalog')
  const inbox = useAsync(() => api.inbox(), [], true, 'catalog:inbox')

  const groups = useMemo(
    () =>
      groupByActivity(places.data ?? [], (p) =>
        // Until the API carries activity tags on a place summary, the category
        // is the honest stand-in: it is what the place IS, which is the nearest
        // thing to what you do there that the row actually knows.
        p.category ? [p.category] : [],
      ),
    [places.data],
  )

  if (places.error) return <ErrorNote message={places.error} onRetry={places.reload} />
  if (!places.data) return <SkeletonRows />

  const shown = chip ? groups.filter((g) => g.slug === chip) : groups
  const total = places.data.length
  const waiting = inbox.data?.length ?? 0

  return (
    <div className="screen" data-testid="catalog">
      <header className="pad pad-y">
        <h1 className="t-name t-name--lg">Catalog</h1>
        <p className="doc-meta t-field">
          <span>
            {total} {total === 1 ? 'thing' : 'things'}
          </span>
          <span>{groups.length} kinds</span>
        </p>
      </header>

      {waiting > 0 && (
        <Link to="/catalog/inbox" className="waiting" data-testid="waiting-banner">
          <Evidence yours={0} found={Math.min(waiting, 4)} />
          <span className="waiting__body">
            <span className="t-name t-name--sm">
              {waiting} waiting for a stamp
            </span>
            <span className="waiting__note">
              Found for you. They count for nothing until you keep them.
            </span>
          </span>
        </Link>
      )}

      {groups.length > 0 && (
        <div className="chips pad" data-testid="catalog-chips">
          <button
            type="button"
            className={chip === null ? 'btn btn--sm btn--ink' : 'btn btn--sm'}
            onClick={() => setParams({})}
          >
            All {total}
          </button>
          {groups.map((g) => (
            <button
              key={g.slug}
              type="button"
              className={chip === g.slug ? 'btn btn--sm btn--ink' : 'btn btn--sm'}
              onClick={() => setParams(chip === g.slug ? {} : { doing: g.slug })}
              data-testid="catalog-chip"
            >
              {g.label}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <Empty
          title="Nothing filed yet"
          body="Share a reel, paste a plan, or look somewhere up in Explore. What you keep lands here."
        />
      ) : (
        shown.map((group) => (
          <section key={group.slug} className="filegroup" data-testid="catalog-group">
            <div className="filegroup__head">
              <h2 className="t-name t-name--md">{group.label}</h2>
              <span className="t-field filegroup__span">
                {group.places.length} across{' '}
                {group.countries === 1 ? '1 country' : `${group.countries} countries`}
              </span>
            </div>
            {group.places.map((p) => (
              <button
                key={`${group.slug}-${p.trip_place_id}`}
                type="button"
                className="filerow"
                data-testid="catalog-place"
                onClick={() => navigate(`/places/${p.trip_place_id}`)}
              >
                <span className="filerow__body">
                  <span className="t-name t-name--sm">{p.name}</span>
                  <span className="t-field filerow__where">
                    {[p.city, p.country].filter(Boolean).join(', ') || 'Somewhere unplaced'}
                  </span>
                </span>
                <Evidence yours={p.source_count} found={0} size="sm" />
              </button>
            ))}
          </section>
        ))
      )}

      <div className="pad pad-y">
        <button
          type="button"
          className="btn btn--doc grow"
          data-testid="ask-catalog"
          onClick={() =>
            openAsk({
              surface: 'catalog',
              contextLabel: chip ? (ACTIVITY_LABELS[chip] ?? chip) : 'everything you have',
            })
          }
        >
          {chip ? `Ask about your ${(ACTIVITY_LABELS[chip] ?? chip).toLowerCase()}` : 'Ask about your catalog'}
        </button>
      </div>
    </div>
  )
}
