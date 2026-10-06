/**
 * Distances, computed rather than guessed.
 *
 * The API already does this for transport legs between stops; route mode on
 * the city map needs the same arithmetic in the browser because the ordering
 * changes as you toggle filters and a round trip per toggle would be absurd.
 * Same formula, same walking speed, so the two never disagree.
 */

const EARTH_RADIUS_KM = 6371.0088

/** Walking pace used for every estimate, matching services/spatial.py. */
export const WALKING_SPEED_KMH = 4.5

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const phi1 = toRad(lat1)
  const phi2 = toRad(lat2)
  const dPhi = phi2 - phi1
  const dLambda = toRad(lon2 - lon1)
  const a =
    Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a))
}

/**
 * Beyond this, walking is not a real option and a minute figure is noise:
 * "233 min walk" tells the traveller nothing that "17 km" does not, and it
 * dresses an impossible plan up as a schedule. Matches services/spatial.py.
 */
export const WALKABLE_KM = 8.0

/** Flat-ground estimate. Always shown labelled as one. */
export function walkingMinutes(distanceKm: number): number {
  return Math.max(1, Math.round((distanceKm / WALKING_SPEED_KMH) * 60))
}

/** The estimate, or null when the distance is not a walk. */
export function walkingMinutesIfWalkable(distanceKm: number): number | null {
  return distanceKm > WALKABLE_KM ? null : walkingMinutes(distanceKm)
}
