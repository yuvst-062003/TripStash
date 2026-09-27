/**
 * A link from before the map became one screen.
 *
 * `/countries/guatemala/cities/antigua` was a real URL for months, and the
 * service worker means old bundles keep handing them out for a while yet.
 * Sending them to the right place on the map is a few lines; sending them home
 * would silently lose the city the person actually asked for.
 */
import { Navigate, useParams } from 'react-router-dom'
import { scopePath } from '../lib/scope'

export default function OldLink({ kind }: { kind: 'country' | 'city' }) {
  const { key, city } = useParams<{ key: string; city: string }>()
  const countryKey = decodeURIComponent(key ?? '')

  if (!countryKey) return <Navigate to="/map" replace />

  const to =
    kind === 'country'
      ? scopePath({ level: 'country', countryKey })
      : scopePath({
          level: 'city',
          countryKey,
          cityKey: decodeURIComponent(city ?? ''),
        })

  return <Navigate to={to} replace />
}
