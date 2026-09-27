/**
 * Which screen a path belongs to, for the purpose of remounting.
 *
 * The route tree is keyed so that moving between screens animates. Keying it on
 * the full pathname means every URL change tears the screen down and builds a
 * new one - which is exactly what made the old map feel like changing tabs, and
 * what silently destroyed and rebuilt the map instance on every press.
 *
 * The map's four levels are one screen at four URLs, so they share one key.
 */
export function sectionKey(pathname: string): string {
  return pathname.startsWith('/map') ? '/map' : pathname
}
