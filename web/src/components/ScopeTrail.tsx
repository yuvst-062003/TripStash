/**
 * Where you are, and the first of three ways back.
 *
 * The trail skips levels: pressing World from a street is one flight, not
 * three. Every step is a real button at the tap minimum, because this is the
 * route out that a keyboard and a screen reader can both use.
 */
import type { Crumb, Scope } from '../lib/scope'

interface Props {
  crumbs: Crumb[]
  /** A short code for the corner - a country code, a zoom, a note. */
  code?: string
  onGo: (scope: Scope) => void
}

export default function ScopeTrail({ crumbs, code, onGo }: Props) {
  return (
    <nav className="trail" aria-label="Where you are" data-testid="trail">
      {crumbs.map((crumb, i) => (
        <span className="trail__step" key={i}>
          {i > 0 && (
            <span className="trail__sep" aria-hidden="true">
              /
            </span>
          )}
          {crumb.here ? (
            <span className="trail__here t-field" aria-current="page">
              {crumb.label}
            </span>
          ) : (
            <button
              type="button"
              className="trail__link t-field"
              onClick={() => onGo(crumb.scope)}
              data-testid="trail-link"
            >
              {crumb.label}
            </button>
          )}
        </span>
      ))}
      {code && (
        <span className="trail__code t-field" aria-hidden="true">
          {code}
        </span>
      )}
    </nav>
  )
}
