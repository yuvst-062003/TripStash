/**
 * The map's own look: a lit globe against stars, that becomes a street map.
 *
 * Two basemaps, because no single free one is right at both ends of the zoom.
 *
 * NASA's Blue Marble carries the globe. It is shaded relief with bathymetry -
 * the green-and-brown land and the deep ocean of the reference - and it is a
 * work of the US Government, so it is public domain: no key, no account, no
 * terms to read. Its ceiling is zoom 8, which is not a limitation so much as
 * the right seam: nobody needs satellite imagery of a street.
 *
 * Below that, OpenFreeMap's vector tiles take over with actual roads and
 * names. The handover happens inside one camera, so descending from the globe
 * into Antigua changes what the map is made of without ever changing screens.
 *
 * Both are free and keyless, which is the constraint this whole design was
 * built under rather than a compromise inside it.
 */
import type { StyleSpecification } from 'maplibre-gl'

/** Public domain, US Government work. Shaded relief with bathymetry. */
const BLUE_MARBLE =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry' +
  '/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg'

/** Where the imagery runs out and the street map has to take over. */
export const SATELLITE_MAX_ZOOM = 8

const VECTOR_TILES = 'https://tiles.openfreemap.org/planet'

export const COLOURS = {
  /** Deep space behind the globe. */
  space: '#040d1a',
  /** The atmosphere seen edge-on. */
  horizon: '#1d5b87',
  ocean: '#0b2f4a',
  /** Borders. Pink reads on both land and sea, which few colours do. */
  border: '#ff7a9c',
  /** The route. One colour, used for nothing else. */
  route: '#2ee6f0',
  label: '#ffffff',
  labelHalo: 'rgba(4, 13, 26, 0.85)',
} as const

/**
 * The whole style, built rather than fetched.
 *
 * A URL would be one line, but it would also be somebody else's decisions
 * about colour, label density and which layers exist - and this map has to
 * carry a route, country fills and a starfield that no published style knows
 * about.
 */
export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    // Needed by the vector layers for their icons and text.
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      satellite: {
        type: 'raster',
        tiles: [BLUE_MARBLE],
        tileSize: 256,
        maxzoom: SATELLITE_MAX_ZOOM,
        attribution: 'Imagery: NASA EOSDIS GIBS (public domain)',
      },
      streets: {
        type: 'vector',
        url: VECTOR_TILES,
        attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors',
      },
    },
    layers: [
      // Space, which is also what shows through where imagery has not loaded.
      { id: 'space', type: 'background', paint: { 'background-color': COLOURS.space } },

      {
        id: 'satellite',
        type: 'raster',
        source: 'satellite',
        // Fades out as the street map fades in, so the handover is a dissolve
        // rather than a switch.
        paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 6, 1, 9, 0] },
      },

      // The street map, from where the imagery gives up.
      {
        id: 'land',
        type: 'fill',
        source: 'streets',
        'source-layer': 'landcover',
        minzoom: 7,
        paint: {
          'fill-color': '#12301f',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0, 9, 0.9],
        },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'streets',
        'source-layer': 'water',
        minzoom: 6,
        paint: {
          'fill-color': COLOURS.ocean,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 8, 1],
        },
      },
      {
        id: 'roads',
        type: 'line',
        source: 'streets',
        'source-layer': 'transportation',
        minzoom: 8,
        paint: {
          'line-color': '#9fb4c7',
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 10, 0.55],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 16, 4],
        },
      },
      {
        id: 'place-labels',
        type: 'symbol',
        source: 'streets',
        'source-layer': 'place',
        minzoom: 3,
        layout: {
          'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 10, 15],
          'text-max-width': 8,
        },
        paint: {
          'text-color': COLOURS.label,
          'text-halo-color': COLOURS.labelHalo,
          'text-halo-width': 1.4,
        },
      },
    ],
  }
}

/**
 * The sky: atmosphere at the limb, stars behind it.
 *
 * Only meaningful under the globe projection, where there is an edge to the
 * world for the atmosphere to sit on. The stars fade as you descend, because
 * from inside a city there is nothing above you but sky.
 */
export const SKY = {
  'sky-color': COLOURS.horizon,
  'sky-horizon-blend': 0.6,
  'horizon-color': COLOURS.horizon,
  'horizon-fog-blend': 0.7,
  'fog-color': COLOURS.space,
  'fog-ground-blend': 0.05,
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 0.4, 9, 0],
} as const

/**
 * Stars are NOT a MapLibre sky property - that is Mapbox, and passing it here
 * throws. They are drawn behind the canvas in CSS instead, which costs nothing
 * and fades with the same zoom rule.
 */
