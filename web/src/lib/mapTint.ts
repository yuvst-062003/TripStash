import L from 'leaflet'

/**
 * A tint pane pulls raw OSM tiles into the palette — multiply in light,
 * lighten in dark (see `.leaflet-tint-pane` in app.css) — below the markers.
 * Every map in the app gets it, so a place page and the map screen match.
 */
export function addTintPane(map: L.Map): void {
  const tint = map.createPane('tint')
  tint.style.zIndex = '250'
  tint.style.pointerEvents = 'none'
  L.rectangle(
    [
      [-85, -180],
      [85, 180],
    ],
    { pane: 'tint', stroke: false, fillOpacity: 1, interactive: false, className: 'map-tint' },
  ).addTo(map)
}
