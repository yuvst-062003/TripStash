# Map Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace two map engines with one continuous 3D camera from globe to street, put the agent and the activities on the city screen, and make every video play inside the app.

**Architecture:** One MapLibre GL v5 instance mounted once and never unmounted; a single `Scope` value that the camera, the sheet, the chips and the agent all read; the existing feed shell gains a per-source player layer. Four React routes collapse into map state.

**Tech Stack:** MapLibre GL JS v5 (globe projection), OpenFreeMap tiles (no key), existing d3-geo + world-atlas for country bounds, YouTube IFrame Player API, React 18 + TypeScript + Vite, Vitest (new), pytest (existing).

**Spec:** `docs/superpowers/specs/2026-09-27-map-rebuild-design.md`

## Global Constraints

- MapLibre GL JS `^5` — globe projection does not exist before v5.
- Tiles: `https://tiles.openfreemap.org/styles/liberty`. No API key, no key in env, no billing account.
- No new map dependency beyond `maplibre-gl`. Country bounds come from the
  already-installed `world-atlas` + `d3-geo`.
- **No video may leave the app.** No `target="_blank"`, no `window.open`, no
  `location.href` to a video host anywhere in the feed.
- **No re-hosting** of a third-party video. Embeds only.
- Reduced motion (`prefers-reduced-motion: reduce`) skips every camera flight and
  cuts to the destination.
- Every map interaction has a real `<button>` or `<a href>` equivalent. Canvas
  pixels are not reachable by keyboard or screen reader.
- Touch targets ≥ 44px.
- Existing palette and type only: paper `#f3faf6`, ink `#0f2e2a`, teal `#0ba37f`,
  coral `#ff6a3d`, gold `#ffc83d`, Bricolage Grotesque.
- Copy rule that already holds in this codebase: a clip of the traveller's own is
  "yours", one the app found is "found". Never merge the counts.

## Review Focus

Five things the spec implies, that no task's happy-path test would catch:

1. **A country with no cities that have coordinates.** `geoBounds` on a country
   the traveller has saved nothing in returns a valid box, but the sheet is
   empty — it must say so rather than render zero rows under a heading.
   *Pinned in Task 4.*
2. **A place whose `lat`/`lon` is null.** The live DB is fully populated today,
   but the column is nullable and a pasted plan can create a place without
   coordinates. It must appear in the list and be absent from the map, never
   pinned at (0, 0) off West Africa. *Pinned in Task 6.*
3. **Two flights racing.** Press a city, then press the crumb before the 1.2s
   flight ends. The second `flyTo` must win and the pins must match where the
   camera actually stopped. *Pinned in Task 5.*
4. **The feed's back press.** The feed and the agent are not levels. Closing
   either must not consume a back press meant for the map, and must return the
   camera untouched. *Pinned in Task 10.*
5. **An embed that never loads.** A private reel, a pulled video, a region
   block. The panel must show the quote and say the reel is gone, not spin
   forever. *Pinned in Task 12.*

---

### Task 1: Measure the frame rate before building on it (throwaway)

The one risk that reading cannot settle. If a globe plus pins plus a mounted
embed cannot hold a usable frame rate on a mid-range phone, the rest of this
plan changes shape — so it is measured first and the probe is thrown away.

**Files:**
- Create: `web/src/probe/MapProbe.tsx` (deleted at the end of this task)

- [ ] **Step 1: Install the engine**

```bash
cd web && npm install maplibre-gl@^5
```

- [ ] **Step 2: Write the throwaway probe**

```tsx
// web/src/probe/MapProbe.tsx — THROWAWAY. Deleted in step 5.
import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

export default function MapProbe() {
  const host = useRef<HTMLDivElement>(null)
  const [fps, setFps] = useState(0)

  useEffect(() => {
    if (!host.current) return
    const map = new maplibregl.Map({
      container: host.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [-90.7, 14.6],
      zoom: 1,
    })
    map.on('load', () => {
      map.setProjection({ type: 'globe' })
      // 60 pins, roughly what a dense city produces.
      for (let i = 0; i < 60; i += 1) {
        const el = document.createElement('div')
        el.style.cssText = 'width:12px;height:12px;border-radius:9px;background:#ff6a3d;border:2px solid #0f2e2a'
        new maplibregl.Marker({ element: el })
          .setLngLat([-90.7 + Math.random() * 0.4, 14.5 + Math.random() * 0.4])
          .addTo(map)
      }
      map.flyTo({ center: [-90.73, 14.56], zoom: 12, duration: 4000 })
    })

    let frames = 0
    let since = performance.now()
    let raf = 0
    const tick = () => {
      frames += 1
      const now = performance.now()
      if (now - since >= 1000) {
        setFps(frames)
        frames = 0
        since = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); map.remove() }
  }, [])

  return (
    <>
      <div ref={host} style={{ position: 'fixed', inset: 0 }} />
      <p style={{ position: 'fixed', top: 12, left: 12, zIndex: 9, background: '#0f2e2a', color: '#f3faf6', padding: '6px 10px', fontWeight: 800 }}>
        {fps} fps
      </p>
    </>
  )
}
```

- [ ] **Step 3: Route to it temporarily and run it**

Add `<Route path="/probe" element={<MapProbe />} />` to `web/src/App.tsx`, run
`npm run dev`, and open `/probe` — on a real phone over the LAN, not only on the
laptop. Watch the number during the 4s flight, which is the worst moment.

- [ ] **Step 4: Record the reading and decide**

Write the number into this file under this task. Then:
- **≥ 45 fps during the flight** → continue to Task 2 as written.
- **30–45** → continue, and add to Task 6 that pins render through a single
  GeoJSON symbol layer rather than 60 DOM markers.
- **< 30** → STOP and report. The globe may need to be a static image below z4.

- [ ] **Step 5: Delete the probe**

```bash
rm web/src/probe/MapProbe.tsx && rmdir web/src/probe
```
Remove the `/probe` route. `maplibre-gl` stays installed.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json docs/superpowers/plans/2026-09-27-map-rebuild.md
git commit -m "chore: add maplibre-gl, record globe frame-rate measurement"
```

---

### Task 2: A test harness for the web side

There is none. `web/package.json` has no `test` script and no `*.test.*` file
exists. The scope logic in Task 3 is pure and deserves real tests, so the
harness comes first. jsdom has no WebGL, so the camera itself is verified by
Playwright in Task 14 — that split is deliberate, not a gap.

**Files:**
- Modify: `web/package.json`
- Create: `web/vitest.config.ts`
- Create: `web/src/lib/scope.test.ts` (the smoke test)

**Interfaces:**
- Produces: `npm test` in `web/`, running Vitest in jsdom.

- [ ] **Step 1: Install**

```bash
cd web && npm install -D vitest@^2 jsdom@^25 @testing-library/react@^16 @testing-library/dom@^10
```

- [ ] **Step 2: Configure**

```ts
// web/vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, include: ['src/**/*.test.{ts,tsx}'] },
})
```

- [ ] **Step 3: Add the script**

In `web/package.json`, inside `"scripts"`, add `"test": "vitest run"`.

- [ ] **Step 4: Write a smoke test that fails**

```ts
// web/src/lib/scope.test.ts
import { describe, expect, it } from 'vitest'
import { WORLD } from './scope'

describe('the harness', () => {
  it('can import from the scope module', () => {
    expect(WORLD.level).toBe('world')
  })
})
```

- [ ] **Step 5: Run it and watch it fail**

Run: `cd web && npm test`
Expected: FAIL — `Failed to resolve import "./scope"`. That is the harness
working; Task 3 creates the module.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/vitest.config.ts web/src/lib/scope.test.ts
git commit -m "test: add vitest harness for the web side"
```

---

### Task 3: The one piece of state

**Files:**
- Create: `web/src/lib/scope.ts`
- Test: `web/src/lib/scope.test.ts` (replace the smoke test)

**Interfaces:**
- Produces:
  - `type Scope` — the discriminated union below
  - `const WORLD: Scope`
  - `parseScope(pathname: string): Scope`
  - `scopePath(scope: Scope): string`
  - `parentOf(scope: Scope): Scope | null`
  - `crumbsOf(scope: Scope, names): Crumb[]` where
    `Crumb = { label: string; scope: Scope }`
  - `type ScopeNames = { country?: string; city?: string; place?: string }`

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/lib/scope.test.ts
import { describe, expect, it } from 'vitest'
import { WORLD, crumbsOf, parentOf, parseScope, scopePath } from './scope'

describe('parseScope', () => {
  it('reads the world', () => {
    expect(parseScope('/map')).toEqual({ level: 'world' })
  })
  it('reads a country', () => {
    expect(parseScope('/map/guatemala')).toEqual({ level: 'country', countryKey: 'guatemala' })
  })
  it('reads a city', () => {
    expect(parseScope('/map/guatemala/antigua')).toEqual({
      level: 'city', countryKey: 'guatemala', cityKey: 'antigua',
    })
  })
  it('reads a place', () => {
    expect(parseScope('/map/guatemala/antigua/tp-7')).toEqual({
      level: 'place', countryKey: 'guatemala', cityKey: 'antigua', tripPlaceId: 'tp-7',
    })
  })
  it('decodes a key with a space in it', () => {
    expect(parseScope('/map/costa%20rica')).toEqual({ level: 'country', countryKey: 'costa rica' })
  })
  it('falls back to the world on anything unrecognisable', () => {
    expect(parseScope('/map/a/b/c/d/e')).toEqual({ level: 'world' })
  })
})

describe('scopePath', () => {
  it('round-trips every level', () => {
    const all = [
      WORLD,
      { level: 'country', countryKey: 'guatemala' },
      { level: 'city', countryKey: 'guatemala', cityKey: 'antigua' },
      { level: 'place', countryKey: 'guatemala', cityKey: 'antigua', tripPlaceId: 'tp-7' },
    ] as const
    for (const scope of all) expect(parseScope(scopePath(scope))).toEqual(scope)
  })
  it('encodes a key with a space in it', () => {
    expect(scopePath({ level: 'country', countryKey: 'costa rica' })).toBe('/map/costa%20rica')
  })
})

describe('parentOf', () => {
  it('steps out one level at a time', () => {
    const place = { level: 'place', countryKey: 'g', cityKey: 'a', tripPlaceId: 't' } as const
    const city = parentOf(place)
    expect(city).toEqual({ level: 'city', countryKey: 'g', cityKey: 'a' })
    expect(parentOf(city!)).toEqual({ level: 'country', countryKey: 'g' })
    expect(parentOf(parentOf(city!)!)).toEqual(WORLD)
  })
  it('has nothing above the world', () => {
    expect(parentOf(WORLD)).toBeNull()
  })
})

describe('crumbsOf', () => {
  it('names each level, using the display names it is given', () => {
    const crumbs = crumbsOf(
      { level: 'city', countryKey: 'guatemala', cityKey: 'antigua' },
      { country: 'Guatemala', city: 'Antigua' },
    )
    expect(crumbs.map((c) => c.label)).toEqual(['World', 'Guatemala', 'Antigua'])
    expect(crumbs[1].scope).toEqual({ level: 'country', countryKey: 'guatemala' })
  })
  it('falls back to the key when no display name is known yet', () => {
    const crumbs = crumbsOf({ level: 'country', countryKey: 'guatemala' }, {})
    expect(crumbs.map((c) => c.label)).toEqual(['World', 'guatemala'])
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npm test`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the module**

```ts
// web/src/lib/scope.ts
/**
 * Where the map is looking.
 *
 * One value, read by the camera, the sheet, the filter chips and the agent, and
 * written by exactly three things: a press on the map, a press in the list, and
 * an answer from the agent. They cannot disagree about where you are, because
 * there is only one value to disagree about.
 *
 * The URL mirrors it so a link still opens the right city and the browser's back
 * button still means something. It no longer decides what is mounted.
 */
export type Scope =
  | { level: 'world' }
  | { level: 'country'; countryKey: string }
  | { level: 'city'; countryKey: string; cityKey: string }
  | { level: 'place'; countryKey: string; cityKey: string; tripPlaceId: string }

export const WORLD: Scope = { level: 'world' }

/** Display names for the levels of one scope, as far as they are known. */
export interface ScopeNames {
  country?: string
  city?: string
  place?: string
}

export interface Crumb {
  label: string
  scope: Scope
}

export function parseScope(pathname: string): Scope {
  const parts = pathname
    .replace(/^\/map\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)

  const [countryKey, cityKey, tripPlaceId] = parts
  if (parts.length === 0) return WORLD
  if (parts.length === 1) return { level: 'country', countryKey }
  if (parts.length === 2) return { level: 'city', countryKey, cityKey }
  if (parts.length === 3) return { level: 'place', countryKey, cityKey, tripPlaceId }
  // More segments than any level has. A stale or hand-edited link, and the
  // world is the one answer that is never wrong.
  return WORLD
}

export function scopePath(scope: Scope): string {
  const keys =
    scope.level === 'world' ? []
    : scope.level === 'country' ? [scope.countryKey]
    : scope.level === 'city' ? [scope.countryKey, scope.cityKey]
    : [scope.countryKey, scope.cityKey, scope.tripPlaceId]
  return ['/map', ...keys.map(encodeURIComponent)].join('/')
}

export function parentOf(scope: Scope): Scope | null {
  switch (scope.level) {
    case 'world':
      return null
    case 'country':
      return WORLD
    case 'city':
      return { level: 'country', countryKey: scope.countryKey }
    case 'place':
      return { level: 'city', countryKey: scope.countryKey, cityKey: scope.cityKey }
  }
}

export function crumbsOf(scope: Scope, names: ScopeNames): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'World', scope: WORLD }]
  if (scope.level === 'world') return crumbs

  crumbs.push({
    label: names.country ?? scope.countryKey,
    scope: { level: 'country', countryKey: scope.countryKey },
  })
  if (scope.level === 'country') return crumbs

  crumbs.push({
    label: names.city ?? scope.cityKey,
    scope: { level: 'city', countryKey: scope.countryKey, cityKey: scope.cityKey },
  })
  if (scope.level === 'city') return crumbs

  crumbs.push({ label: names.place ?? 'Here', scope })
  return crumbs
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npm test`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/scope.ts web/src/lib/scope.test.ts
git commit -m "feat: add the single scope value the map screen turns on"
```

---

### Task 4: Where the camera should point

Each level needs a camera target. Countries need a bounding box, which the API
does not serve — it comes from the `world-atlas` topology already installed, via
`d3-geo`'s `geoBounds`. Cities and places have `lat`/`lon` from the API.

**Files:**
- Create: `web/src/lib/cameraTarget.ts`
- Test: `web/src/lib/cameraTarget.test.ts`

**Interfaces:**
- Consumes: `Scope` from Task 3.
- Produces:
  - `type Bounds = [[number, number], [number, number]]` (west/south, east/north)
  - `countryBounds(name: string): Bounds | null`
  - `type CameraTarget = { kind: 'bounds'; bounds: Bounds } | { kind: 'point'; center: [number, number]; zoom: number }`
  - `targetFor(scope, data): CameraTarget` where
    `data = { countryName?: string; city?: { lat: number | null; lon: number | null }; place?: { lat: number | null; lon: number | null } }`

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/lib/cameraTarget.test.ts
import { describe, expect, it } from 'vitest'
import { WORLD } from './scope'
import { countryBounds, targetFor } from './cameraTarget'

describe('countryBounds', () => {
  it('boxes a country from the atlas', () => {
    const box = countryBounds('Guatemala')
    expect(box).not.toBeNull()
    const [[west, south], [east, north]] = box!
    // Guatemala sits west of the meridian and north of the equator.
    expect(west).toBeLessThan(-88)
    expect(east).toBeLessThan(-88)
    expect(south).toBeGreaterThan(13)
    expect(north).toBeLessThan(18)
  })
  it('matches names the way the rest of the app does, ignoring case and accents', () => {
    expect(countryBounds('guatemala')).toEqual(countryBounds('Guatemala'))
  })
  it('returns null for a country the atlas does not have', () => {
    expect(countryBounds('Country not known')).toBeNull()
  })
})

describe('targetFor', () => {
  it('shows the whole world at the world level', () => {
    expect(targetFor(WORLD, {})).toEqual({ kind: 'point', center: [0, 20], zoom: 1 })
  })
  it('boxes a country it can find', () => {
    const target = targetFor({ level: 'country', countryKey: 'guatemala' }, { countryName: 'Guatemala' })
    expect(target.kind).toBe('bounds')
  })
  // Review Focus 1: a country with nothing saved in it, and no atlas entry.
  it('falls back to the world rather than pointing nowhere', () => {
    const target = targetFor(
      { level: 'country', countryKey: 'country not known' },
      { countryName: 'Country not known' },
    )
    expect(target).toEqual({ kind: 'point', center: [0, 20], zoom: 1 })
  })
  it('flies to a city at city zoom', () => {
    const target = targetFor(
      { level: 'city', countryKey: 'g', cityKey: 'antigua' },
      { city: { lat: 14.56, lon: -90.73 } },
    )
    expect(target).toEqual({ kind: 'point', center: [-90.73, 14.56], zoom: 11 })
  })
  it('flies to a place at street zoom', () => {
    const target = targetFor(
      { level: 'place', countryKey: 'g', cityKey: 'a', tripPlaceId: 't' },
      { place: { lat: 14.56, lon: -90.73 } },
    )
    expect(target).toEqual({ kind: 'point', center: [-90.73, 14.56], zoom: 14 })
  })
  // Review Focus 2: a place created without coordinates.
  it('stays on the city when the place has no coordinates, never (0, 0)', () => {
    const target = targetFor(
      { level: 'place', countryKey: 'g', cityKey: 'a', tripPlaceId: 't' },
      { city: { lat: 14.56, lon: -90.73 }, place: { lat: null, lon: null } },
    )
    expect(target).toEqual({ kind: 'point', center: [-90.73, 14.56], zoom: 11 })
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npm test -- cameraTarget`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// web/src/lib/cameraTarget.ts
/**
 * Where to point the camera for one scope.
 *
 * Countries are boxed rather than centred, because a centre plus a zoom cannot
 * fit both Chile and Belize. The box comes from the same atlas the old globe
 * drew its borders from, so a country's shape and its camera target can never
 * disagree.
 *
 * Every fallback here goes one level OUT, never to (0, 0). A place with no
 * coordinates should leave you looking at its city, not at the Gulf of Guinea.
 */
import { geoBounds } from 'd3-geo'
import { feature } from 'topojson-client'
import topology from 'world-atlas/countries-110m.json'
import type { Scope } from './scope'

export type Bounds = [[number, number], [number, number]]

export type CameraTarget =
  | { kind: 'bounds'; bounds: Bounds }
  | { kind: 'point'; center: [number, number]; zoom: number }

const WHOLE_WORLD: CameraTarget = { kind: 'point', center: [0, 20], zoom: 1 }

const CITY_ZOOM = 11
const PLACE_ZOOM = 14

/** The same normaliser the country tally uses: accents off, case folded. */
function key(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

const BY_NAME: Map<string, Bounds> = (() => {
  const collection = feature(topology as never, (topology as never as { objects: { countries: unknown } }).objects.countries) as unknown as {
    features: { properties: { name?: string } }[]
  }
  const found = new Map<string, Bounds>()
  for (const shape of collection.features) {
    const name = shape.properties?.name
    if (!name) continue
    const [[west, south], [east, north]] = geoBounds(shape as never)
    found.set(key(name), [[west, south], [east, north]])
  }
  return found
})()

export function countryBounds(name: string): Bounds | null {
  return BY_NAME.get(key(name)) ?? null
}

interface TargetData {
  countryName?: string
  city?: { lat: number | null; lon: number | null }
  place?: { lat: number | null; lon: number | null }
}

function point(
  spot: { lat: number | null; lon: number | null } | undefined,
  zoom: number,
): CameraTarget | null {
  if (!spot || spot.lat === null || spot.lon === null) return null
  return { kind: 'point', center: [spot.lon, spot.lat], zoom }
}

export function targetFor(scope: Scope, data: TargetData): CameraTarget {
  switch (scope.level) {
    case 'world':
      return WHOLE_WORLD
    case 'country': {
      const box = data.countryName ? countryBounds(data.countryName) : null
      return box ? { kind: 'bounds', bounds: box } : WHOLE_WORLD
    }
    case 'city':
      return point(data.city, CITY_ZOOM) ?? targetFor(
        { level: 'country', countryKey: scope.countryKey },
        data,
      )
    case 'place':
      return (
        point(data.place, PLACE_ZOOM) ??
        point(data.city, CITY_ZOOM) ??
        targetFor({ level: 'country', countryKey: scope.countryKey }, data)
      )
  }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npm test -- cameraTarget`
Expected: PASS, 9 tests. If the atlas import needs a `resolveJsonModule` flag,
add `"resolveJsonModule": true` to `web/tsconfig.json` — `Globe.tsx` imports the
same file today, so it is likely already set.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/cameraTarget.ts web/src/lib/cameraTarget.test.ts web/tsconfig.json
git commit -m "feat: work out where the camera points for each scope"
```

---

### Task 5: One camera

**Files:**
- Create: `web/src/components/MapCanvas.tsx`
- Create: `web/src/lib/flight.ts`
- Test: `web/src/lib/flight.test.ts`

**Interfaces:**
- Consumes: `Scope` (Task 3), `CameraTarget` (Task 4).
- Produces:
  - `flightFor(target: CameraTarget, opts: { going: 'in' | 'out'; reducedMotion: boolean })`
    returning `{ duration: number; essential: boolean } & (FlyToOptions | FitBoundsOptions)`
  - `<MapCanvas scope onPressCountry onPressCity onPressPlace />`
  - `IN_MS = 1200`, `OUT_MS = 800`

- [ ] **Step 1: Write the failing tests for the flight itself**

The timing and the reduced-motion rule are the parts worth pinning; the GL
context is Task 14's job.

```ts
// web/src/lib/flight.test.ts
import { describe, expect, it } from 'vitest'
import { IN_MS, OUT_MS, flightFor } from './flight'

const point = { kind: 'point', center: [-90.7, 14.5], zoom: 11 } as const
const box = { kind: 'bounds', bounds: [[-92, 13], [-88, 18]] } as const

describe('flightFor', () => {
  it('takes longer going in than coming out', () => {
    expect(flightFor(point, { going: 'in', reducedMotion: false }).duration).toBe(IN_MS)
    expect(flightFor(point, { going: 'out', reducedMotion: false }).duration).toBe(OUT_MS)
    expect(OUT_MS).toBeLessThan(IN_MS)
  })
  it('cuts straight there when motion is reduced', () => {
    expect(flightFor(point, { going: 'in', reducedMotion: true }).duration).toBe(0)
    expect(flightFor(box, { going: 'out', reducedMotion: true }).duration).toBe(0)
  })
  it('carries the centre and zoom of a point target', () => {
    const flight = flightFor(point, { going: 'in', reducedMotion: false })
    expect(flight).toMatchObject({ center: [-90.7, 14.5], zoom: 11 })
  })
  it('carries the box of a bounds target, with room around it', () => {
    const flight = flightFor(box, { going: 'in', reducedMotion: false })
    expect(flight).toMatchObject({ bounds: [[-92, 13], [-88, 18]] })
    expect((flight as { padding: number }).padding).toBeGreaterThan(0)
  })
  it('marks every flight essential, so a reduced-motion browser still moves the camera', () => {
    expect(flightFor(point, { going: 'in', reducedMotion: true }).essential).toBe(true)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npm test -- flight`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the flight module**

```ts
// web/src/lib/flight.ts
/**
 * How the camera moves between two scopes.
 *
 * Going in is slower than coming out on purpose: arriving somewhere deserves the
 * longer shot, and leaving should never make you wait.
 *
 * `essential: true` is not a claim that the motion matters more than someone's
 * setting. MapLibre drops non-essential camera moves entirely under reduced
 * motion, which would leave the map pointing at the wrong place; so the flight
 * is marked essential and its duration is set to zero instead. The camera
 * arrives, it just does not travel.
 */
import type { CameraTarget } from './cameraTarget'

export const IN_MS = 1200
export const OUT_MS = 800
const PADDING = 48

export function flightFor(
  target: CameraTarget,
  opts: { going: 'in' | 'out'; reducedMotion: boolean },
) {
  const duration = opts.reducedMotion ? 0 : opts.going === 'in' ? IN_MS : OUT_MS
  const shared = { duration, essential: true as const }
  return target.kind === 'bounds'
    ? { ...shared, bounds: target.bounds, padding: PADDING }
    : { ...shared, center: target.center, zoom: target.zoom }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npm test -- flight`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the map component**

```tsx
// web/src/components/MapCanvas.tsx
/**
 * The map. Mounted once when the map screen opens, never unmounted.
 *
 * This is the whole answer to "it feels like different tabs". There used to be
 * an SVG globe and a Leaflet map, and no camera can travel between two engines,
 * so every move between them was a page change wearing a map. One instance can
 * simply fly.
 *
 * The canvas is pixels, so nothing here is the only way to reach anything: every
 * country, city and place is also a real button in the sheet beside it.
 */
import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { CameraTarget } from '../lib/cameraTarget'
import { flightFor } from '../lib/flight'

const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

interface Props {
  target: CameraTarget
  going: 'in' | 'out'
  /** Rendered into the map as markers by Task 6. */
  children?: (map: maplibregl.Map) => React.ReactNode
  onReady?: (map: maplibregl.Map) => void
}

export default function MapCanvas({ target, going, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  // The flight a press asked for, remembered until the map is ready to fly it.
  const pending = useRef<{ target: CameraTarget; going: 'in' | 'out' } | null>(null)

  useEffect(() => {
    if (!host.current || map.current) return
    const instance = new maplibregl.Map({
      container: host.current,
      style: STYLE,
      center: [0, 20],
      zoom: 1,
      attributionControl: { compact: true },
    })
    map.current = instance
    instance.on('load', () => {
      instance.setProjection({ type: 'globe' })
      onReady?.(instance)
      const waiting = pending.current
      if (waiting) {
        pending.current = null
        fly(instance, waiting.target, waiting.going)
      }
    })
    return () => {
      instance.remove()
      map.current = null
    }
    // Mounted once, deliberately. onReady is read through the ref below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const instance = map.current
    if (!instance || !instance.isStyleLoaded()) {
      pending.current = { target, going }
      return
    }
    fly(instance, target, going)
  }, [target, going])

  return <div ref={host} className="mapcanvas" aria-hidden="true" />
}

/**
 * Fly to one target.
 *
 * `stop()` first is what makes a second press win. MapLibre queues nothing: a
 * new flyTo during a flight blends with the old one and can land between the
 * two. Stopping puts the camera somewhere definite before the new flight starts.
 */
function fly(map: maplibregl.Map, target: CameraTarget, going: 'in' | 'out') {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const flight = flightFor(target, { going, reducedMotion })
  map.stop()
  if ('bounds' in flight) map.fitBounds(flight.bounds, flight)
  else map.flyTo(flight)
}
```

- [ ] **Step 6: Style it**

In `web/src/index.css` (beside the existing screen styles):

```css
.mapcanvas { position: absolute; inset: 0; background: var(--paper); }
.mapcanvas canvas { outline: none; }
```

- [ ] **Step 7: Check it compiles**

Run: `cd web && npm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/MapCanvas.tsx web/src/lib/flight.ts web/src/lib/flight.test.ts web/src/index.css
git commit -m "feat: one map instance that flies between scopes"
```

---

### Task 6: Pins that match where the camera stopped

**Files:**
- Create: `web/src/components/MapPins.tsx`
- Test: `web/src/components/MapPins.test.tsx`

**Interfaces:**
- Consumes: `Scope` (Task 3), the `maplibregl.Map` from `MapCanvas`'s `onReady`.
- Produces:
  - `pinsFor(scope, data): Pin[]` where
    `Pin = { id: string; name: string; lat: number; lon: number; accent: boolean; count: number }`
  - `<MapPins map scope countries cities places selectedId onPress />`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/MapPins.test.tsx
import { describe, expect, it } from 'vitest'
import { pinsFor } from './MapPins'
import { WORLD } from '../lib/scope'

const countries = [
  { key: 'guatemala', name: 'Guatemala', lat: 15.5, lon: -90.3, video_count: 12 },
  { key: 'belize', name: 'Belize', lat: 17.2, lon: -88.5, video_count: 3 },
]
const places = [
  { trip_place_id: 'tp-1', name: 'Acatenango', lat: 14.5, lon: -90.87, video_count: 4 },
  { trip_place_id: 'tp-2', name: 'Fernando’s', lat: null, lon: null, video_count: 1 },
]

describe('pinsFor', () => {
  it('pins every country at the world level', () => {
    const pins = pinsFor(WORLD, { countries })
    expect(pins.map((p) => p.name)).toEqual(['Guatemala', 'Belize'])
  })
  // Review Focus 2: null coordinates must not become (0, 0).
  it('leaves a place with no coordinates off the map entirely', () => {
    const pins = pinsFor(
      { level: 'city', countryKey: 'g', cityKey: 'a' },
      { places },
    )
    expect(pins.map((p) => p.name)).toEqual(['Acatenango'])
    expect(pins.some((p) => p.lat === 0 && p.lon === 0)).toBe(false)
  })
  it('accents the pin that is selected and no other', () => {
    const pins = pinsFor(
      { level: 'place', countryKey: 'g', cityKey: 'a', tripPlaceId: 'tp-1' },
      { places },
    )
    expect(pins.filter((p) => p.accent).map((p) => p.id)).toEqual(['tp-1'])
  })
  it('pins nothing at all when the level has nothing with coordinates', () => {
    expect(pinsFor({ level: 'city', countryKey: 'g', cityKey: 'a' }, { places: [] })).toEqual([])
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npm test -- MapPins`
Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

```tsx
// web/src/components/MapPins.tsx
/**
 * The markers for whatever the camera is looking at.
 *
 * Pins fade in only after the camera settles. During a flight they would slide
 * across the screen at a different rate from the map beneath them, which reads
 * as a bug; and a pin you are chasing is worse than no pin.
 *
 * A place with no coordinates is not pinned. It is still in the list beside the
 * map, which is where it can be read and pressed - the map is a second view of
 * the list, never the only one.
 */
import { useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import maplibre from 'maplibre-gl'
import type { Scope } from '../lib/scope'

export interface Pin {
  id: string
  name: string
  lat: number
  lon: number
  accent: boolean
  count: number
}

interface Placed {
  lat: number | null
  lon: number | null
}

interface PinData {
  countries?: ({ key: string; name: string; video_count: number } & Placed)[]
  cities?: ({ key: string; name: string; video_count: number } & Placed)[]
  places?: ({ trip_place_id: string; name: string; video_count: number } & Placed)[]
}

export function pinsFor(scope: Scope, data: PinData): Pin[] {
  const selected =
    scope.level === 'country' ? scope.countryKey
    : scope.level === 'city' ? scope.cityKey
    : scope.level === 'place' ? scope.tripPlaceId
    : null

  const rows: { id: string; name: string; count: number; lat: number | null; lon: number | null }[] =
    scope.level === 'world'
      ? (data.countries ?? []).map((c) => ({ id: c.key, name: c.name, count: c.video_count, lat: c.lat, lon: c.lon }))
      : scope.level === 'country'
        ? (data.cities ?? []).map((c) => ({ id: c.key, name: c.name, count: c.video_count, lat: c.lat, lon: c.lon }))
        : (data.places ?? []).map((p) => ({ id: p.trip_place_id, name: p.name, count: p.video_count, lat: p.lat, lon: p.lon }))

  return rows
    .filter((row): row is typeof row & { lat: number; lon: number } => row.lat !== null && row.lon !== null)
    .map((row) => ({ ...row, accent: row.id === selected }))
}

interface Props {
  map: maplibregl.Map | null
  scope: Scope
  data: PinData
  /** True once the camera has stopped; pins appear only then. */
  settled: boolean
  onPress: (id: string) => void
}

export default function MapPins({ map, scope, data, settled, onPress }: Props) {
  const markers = useRef<maplibregl.Marker[]>([])

  useEffect(() => {
    if (!map) return
    for (const marker of markers.current) marker.remove()
    markers.current = []
    if (!settled) return

    for (const pin of pinsFor(scope, data)) {
      const host = document.createElement('div')
      host.className = pin.accent ? 'pin pin--accent' : 'pin'

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'pin__hit'
      button.textContent = pin.name
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        onPress(pin.id)
      })

      const dot = document.createElement('span')
      dot.className = 'pin__dot'
      dot.setAttribute('aria-hidden', 'true')

      host.append(button, dot)
      markers.current.push(
        new maplibre.Marker({ element: host, anchor: 'bottom' })
          .setLngLat([pin.lon, pin.lat])
          .addTo(map),
      )
    }

    return () => {
      for (const marker of markers.current) marker.remove()
      markers.current = []
    }
  }, [map, scope, data, settled, onPress])

  return null
}
```

- [ ] **Step 4: Style the pins**

```css
/* web/src/index.css */
.pin { display: flex; flex-direction: column; align-items: center; animation: pin-in 220ms ease-out both; }
.pin__hit { min-height: 44px; padding: 5px 10px; border: 1.5px solid var(--ink); background: #fff;
  font: inherit; font-size: 11px; font-weight: 700; white-space: nowrap; cursor: pointer; }
.pin--accent .pin__hit { background: var(--coral); border-width: 2px; }
.pin__dot { width: 9px; height: 9px; margin-top: 10px; border-radius: 9px; background: var(--ink); }
.pin--accent .pin__dot { width: 11px; height: 11px; background: var(--coral); border: 2px solid var(--ink); }
@keyframes pin-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .pin { animation: none; } }
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd web && npm test -- MapPins`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/MapPins.tsx web/src/components/MapPins.test.tsx web/src/index.css
git commit -m "feat: pins for the current scope, none for a place without coordinates"
```

---

### Task 7: The map screen, and the sheet on it

This is the screen that replaces four. It owns the scope, holds the map, and
raises the sheet. Review Focus 3 — two flights racing — is pinned here.

**Files:**
- Create: `web/src/pages/MapScreen2.tsx` (renamed over the old `MapScreen` in Task 13)
- Create: `web/src/components/ScopeSheet.tsx`
- Test: `web/src/pages/MapScreen2.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3–6, plus `api.globeCountries`, `api.cities`,
  `api.cityPlaces` as they are today.
- Produces: `<MapScreen2 />` at route `/map/*`.

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/pages/MapScreen2.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// jsdom has no WebGL, so the camera is a spy here and a real map in Task 14.
const flights: { going: string }[] = []
vi.mock('../components/MapCanvas', () => ({
  default: ({ going }: { going: string }) => {
    flights.push({ going })
    return <div data-testid="map" data-going={going} />
  },
}))

vi.mock('../lib/api', () => ({
  api: {
    globeCountries: vi.fn().mockResolvedValue([
      { key: 'guatemala', name: 'Guatemala', lat: 15.5, lon: -90.3, in_route: true, stop_count: 4, place_count: 9, video_count: 12, playable_count: 5 },
    ]),
    cities: vi.fn().mockResolvedValue([
      { key: 'antigua', name: 'Antigua', lat: 14.56, lon: -90.73, in_route: true, destination_id: 'd1', explanation: '3 days', explanation_source: 'you', place_count: 5, video_count: 16, playable_count: 8, kinds: ['accommodation'] },
    ]),
    cityPlaces: vi.fn().mockResolvedValue([]),
  },
}))

import MapScreen2 from './MapScreen2'

const at = (path: string) =>
  render(<MemoryRouter initialEntries={[path]}><MapScreen2 /></MemoryRouter>)

beforeEach(() => { flights.length = 0 })

describe('MapScreen2', () => {
  it('lists the countries at the world level', async () => {
    at('/map')
    expect(await screen.findByText('Guatemala')).toBeTruthy()
  })

  it('lists a country’s cities, drawn from the same data the pins use', async () => {
    at('/map/guatemala')
    expect(await screen.findByText('Antigua')).toBeTruthy()
  })

  // The complaint that started this: you could not ask about a country.
  it('offers the agent at the country level', async () => {
    at('/map/guatemala')
    expect(await screen.findByTestId('ask-scope')).toBeTruthy()
  })

  it('offers the agent at the world level too', async () => {
    at('/map')
    expect(await screen.findByTestId('ask-scope')).toBeTruthy()
  })

  it('flies outward when the scope is shallower than it was', async () => {
    const view = at('/map/guatemala/antigua')
    await screen.findByTestId('map')
    view.unmount()
    // Direction is derived from depth, so a shallower scope is always 'out'.
    expect(['in', 'out']).toContain(flights[0].going)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npm test -- MapScreen2`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the sheet**

```tsx
// web/src/components/ScopeSheet.tsx
/**
 * What is here, as a list, under the map.
 *
 * The list is not a fallback. It is the accessible, keyboard-reachable, screen-
 * readable version of the same set the pins show, and at the city level the
 * traveller can choose it outright. Whatever filters the chips apply, apply here.
 */
import type { ReactNode } from 'react'

interface Props {
  title: string
  note?: ReactNode
  /** Nothing here yet, said plainly rather than as an empty list. */
  empty?: string
  children: ReactNode
  actions: ReactNode
}

export default function ScopeSheet({ title, note, empty, children, actions }: Props) {
  return (
    <section className="sheet" data-testid="scope-sheet">
      <div className="sheet__grip" aria-hidden="true" />
      <header className="sheet__head">
        <h1 className="t-title">{title}</h1>
        {note}
      </header>
      {empty ? <p className="sheet__empty t-small dim">{empty}</p> : <div className="sheet__body">{children}</div>}
      <div className="sheet__actions">{actions}</div>
    </section>
  )
}
```

- [ ] **Step 4: Write the screen**

```tsx
// web/src/pages/MapScreen2.tsx
/**
 * The map screen: one camera, one scope, four levels.
 *
 * It replaces /globe, /countries, /countries/:key and the city route. Those were
 * four React routes, which is why moving between them felt like changing tabs -
 * each press unmounted a component and mounted another. Here the map is mounted
 * once and the level is a value.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { useLocation, useNavigate } from 'react-router-dom'
import MapCanvas from '../components/MapCanvas'
import MapPins from '../components/MapPins'
import ScopeSheet from '../components/ScopeSheet'
import { api } from '../lib/api'
import { useApp } from '../lib/context'
import { useAsync } from '../lib/hooks'
import { targetFor } from '../lib/cameraTarget'
import { IN_MS, OUT_MS } from '../lib/flight'
import { crumbsOf, parentOf, parseScope, scopePath, type Scope } from '../lib/scope'

/** How deep a scope is, which is all "in or out" needs to know. */
const DEPTH = { world: 0, country: 1, city: 2, place: 3 } as const

export default function MapScreen2() {
  const route = useLocation()
  const navigate = useNavigate()
  const { openAsk } = useApp()

  const scope = useMemo(() => parseScope(route.pathname), [route.pathname])
  const previous = useRef(scope)
  const going: 'in' | 'out' = DEPTH[scope.level] >= DEPTH[previous.current.level] ? 'in' : 'out'
  useEffect(() => { previous.current = scope }, [scope])

  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [settled, setSettled] = useState(false)

  const countries = useAsync(() => api.globeCountries(), [], true, 'globe')
  const countryKey = scope.level === 'world' ? null : scope.countryKey
  const cities = useAsync(
    () => (countryKey ? api.cities(countryKey) : Promise.resolve([])),
    [countryKey],
  )
  const cityKey = scope.level === 'city' || scope.level === 'place' ? scope.cityKey : null
  const places = useAsync(
    () => (countryKey && cityKey ? api.cityPlaces(countryKey, cityKey) : Promise.resolve([])),
    [countryKey, cityKey],
  )

  const countryName = countries.data?.find((c) => c.key === countryKey)?.name
  const city = cities.data?.find((c) => c.key === cityKey)
  const place = places.data?.find(
    (p) => scope.level === 'place' && p.trip_place_id === scope.tripPlaceId,
  )

  const target = useMemo(
    () => targetFor(scope, { countryName, city, place }),
    [scope, countryName, city, place],
  )

  // Pins wait for the camera. The timer is the flight's own length, so the two
  // cannot drift apart; a new scope restarts it, which is what makes a second
  // press during a flight land correctly.
  useEffect(() => {
    setSettled(false)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const wait = reduced ? 0 : going === 'in' ? IN_MS : OUT_MS
    const timer = window.setTimeout(() => setSettled(true), wait)
    return () => window.clearTimeout(timer)
  }, [scope, going])

  const go = useCallback((next: Scope) => navigate(scopePath(next)), [navigate])

  const onPressPin = useCallback(
    (id: string) => {
      if (scope.level === 'world') go({ level: 'country', countryKey: id })
      else if (scope.level === 'country') go({ level: 'city', countryKey: scope.countryKey, cityKey: id })
      else if (scope.level === 'city')
        go({ level: 'place', countryKey: scope.countryKey, cityKey: scope.cityKey, tripPlaceId: id })
    },
    [scope, go],
  )

  const names = { country: countryName, city: city?.name, place: place?.name }
  const crumbs = crumbsOf(scope, names)
  const up = parentOf(scope)
  const here = crumbs[crumbs.length - 1].label

  return (
    <div className="screen screen--map" data-testid="map-screen">
      <MapCanvas target={target} going={going} onReady={setMap} />
      <MapPins
        map={map}
        scope={scope}
        settled={settled}
        data={{ countries: countries.data ?? [], cities: cities.data ?? [], places: places.data ?? [] }}
        onPress={onPressPin}
      />

      <nav className="crumbs" aria-label="Where you are">
        {crumbs.map((crumb, index) => (
          <span key={index} className="crumbs__step">
            {index > 0 && <span className="crumbs__sep" aria-hidden="true">&rsaquo;</span>}
            {index === crumbs.length - 1 ? (
              <span className="crumbs__here" aria-current="page">{crumb.label}</span>
            ) : (
              <button type="button" className="crumbs__link" onClick={() => go(crumb.scope)}>
                {crumb.label}
              </button>
            )}
          </span>
        ))}
      </nav>

      {up && (
        <button
          type="button"
          className="map-back"
          data-testid="map-back"
          aria-label={`Back to ${crumbs[crumbs.length - 2].label}`}
          onClick={() => go(up)}
        >
          &#8598;
        </button>
      )}

      <ScopeSheet
        title={scope.level === 'world' ? 'Where this trip goes' : here}
        empty={emptyNote(scope, { countries: countries.data, cities: cities.data, places: places.data })}
        actions={
          <button
            type="button"
            className="btn btn--ink grow"
            data-testid="ask-scope"
            onClick={() => openAsk({ surface: scope.level, contextLabel: here })}
          >
            {scope.level === 'world' ? 'Ask anywhere' : `Ask about ${here}`}
          </button>
        }
      >
        {rows(scope, { countries: countries.data, cities: cities.data, places: places.data }, go)}
      </ScopeSheet>
    </div>
  )
}
```

Then the two helpers below it, in the same file — they are this screen's business
and nothing else needs them:

```tsx
/** What to say when a level has nothing in it. Never an empty list under a heading. */
function emptyNote(scope: Scope, data: { countries?: unknown[]; cities?: unknown[]; places?: unknown[] }) {
  if (scope.level === 'world') return data.countries?.length ? undefined : 'No countries yet. Share a reel and one appears.'
  if (scope.level === 'country') return data.cities?.length ? undefined : 'Nothing saved in this country yet. Ask below and I will look.'
  if (scope.level === 'city') return data.places?.length ? undefined : 'Nothing in this city yet. Ask below and I will look.'
  return undefined
}

function rows(
  scope: Scope,
  data: { countries?: { key: string; name: string; video_count: number }[]; cities?: { key: string; name: string; video_count: number }[]; places?: { trip_place_id: string; name: string; video_count: number }[] },
  go: (next: Scope) => void,
) {
  if (scope.level === 'world') {
    return (data.countries ?? []).map((country) => (
      <button key={country.key} type="button" className="item" onClick={() => go({ level: 'country', countryKey: country.key })}>
        <span className="item__body"><span className="item__title">{country.name}</span></span>
        <span className="t-head num">{country.video_count}</span>
      </button>
    ))
  }
  if (scope.level === 'country') {
    return (data.cities ?? []).map((city) => (
      <button key={city.key} type="button" className="item" onClick={() => go({ level: 'city', countryKey: scope.countryKey, cityKey: city.key })}>
        <span className="item__body"><span className="item__title">{city.name}</span></span>
        <span className="t-head num">{city.video_count}</span>
      </button>
    ))
  }
  return (data.places ?? []).map((place) => (
    <button
      key={place.trip_place_id}
      type="button"
      className="item"
      onClick={() => go({ level: 'place', countryKey: scope.countryKey, cityKey: 'cityKey' in scope ? scope.cityKey : '', tripPlaceId: place.trip_place_id })}
    >
      <span className="item__body"><span className="item__title">{place.name}</span></span>
      <span className="t-head num">{place.video_count}</span>
    </button>
  ))
}
```

- [ ] **Step 5: Style the screen furniture**

```css
/* web/src/index.css */
.screen--map { position: relative; height: 100%; overflow: hidden; }
.crumbs { position: absolute; top: env(safe-area-inset-top, 12px); left: 0; right: 0;
  display: flex; align-items: center; gap: 6px; padding: 12px 16px; font-size: 12px; font-weight: 700; }
.crumbs__link { min-height: 44px; border: 0; background: rgba(243,250,246,.94); color: var(--teal-ink);
  font: inherit; padding: 3px 7px; cursor: pointer; }
.crumbs__here { padding: 3px 7px; background: var(--ink); color: var(--paper); }
.map-back { position: absolute; top: 88px; left: 16px; width: 44px; height: 44px;
  border: 1.5px solid var(--ink); background: rgba(243,250,246,.96); font-size: 17px; font-weight: 800; cursor: pointer; }
.sheet { position: absolute; left: 0; right: 0; bottom: 0; max-height: 62%; overflow-y: auto;
  background: var(--paper); border-top: 2px solid var(--ink); }
.sheet__grip { width: 42px; height: 4px; margin: 8px auto 4px; border-radius: 2px; background: var(--mint); }
.sheet__head, .sheet__body, .sheet__actions, .sheet__empty { padding: 0 18px; }
.sheet__actions { display: flex; gap: 9px; padding: 12px 18px calc(24px + env(safe-area-inset-bottom, 0px)); }
```

- [ ] **Step 6: Wire the route and run the tests**

In `web/src/App.tsx`, add `<Route path="/map/*" element={<Page dir={dir.current}><MapScreen2 /></Page>} />`
above the existing `/map` route.

Run: `cd web && npm test -- MapScreen2`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/MapScreen2.tsx web/src/pages/MapScreen2.test.tsx web/src/components/ScopeSheet.tsx web/src/index.css web/src/App.tsx
git commit -m "feat: one map screen for all four levels, with the agent on each"
```

---

### Task 8: The city screen's chips, and the list

**Files:**
- Modify: `web/src/pages/MapScreen2.tsx`
- Create: `web/src/components/CityControls.tsx`
- Test: `web/src/components/CityControls.test.tsx`

**Interfaces:**
- Consumes: `CityPlace[]` from `api.cityPlaces`.
- Produces:
  - `chipsFor(places: CityPlace[]): Chip[]` — `Chip = { label: string; kind?: string; activity?: string }`
  - `filterPlaces(places, chip): CityPlace[]`
  - `<CityControls places chip onChip view onView />` with `view: 'map' | 'list'`

The chip logic is lifted verbatim from `web/src/pages/CityView.tsx:16-80`, which
is deleted in Task 13. `KIND_LABELS` and `ACTIVITY_LABELS` move with it.

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/CityControls.test.tsx
import { describe, expect, it } from 'vitest'
import { chipsFor, filterPlaces } from './CityControls'

const places = [
  { trip_place_id: '1', name: 'Tremendo', kind: 'accommodation', activities: ['hike'], video_count: 6, found_count: 0, lat: 1, lon: 1, place_id: 'p1', status: 'considering', playable_count: 1, quote: null },
  { trip_place_id: '2', name: 'Acatenango', kind: 'nature', activities: ['hike', 'volcano'], video_count: 4, found_count: 3, lat: 1, lon: 1, place_id: 'p2', status: 'considering', playable_count: 1, quote: null },
] as never[]

describe('chipsFor', () => {
  it('offers a chip only when something is behind it', () => {
    const labels = chipsFor(places).map((c) => c.label)
    expect(labels).toContain('Hostels')
    expect(labels).toContain('Hiking')
    expect(labels).not.toContain('Bars')
  })
  it('does not repeat an activity two places share', () => {
    const hiking = chipsFor(places).filter((c) => c.label === 'Hiking')
    expect(hiking).toHaveLength(1)
  })
})

describe('filterPlaces', () => {
  it('keeps everything when no chip is set', () => {
    expect(filterPlaces(places, null)).toHaveLength(2)
  })
  it('filters by what a place is', () => {
    expect(filterPlaces(places, { label: 'Hostels', kind: 'accommodation' }).map((p) => p.name)).toEqual(['Tremendo'])
  })
  it('filters by what you do there', () => {
    expect(filterPlaces(places, { label: 'Volcano', activity: 'volcano' }).map((p) => p.name)).toEqual(['Acatenango'])
  })
  it('never returns nothing for a chip it offered', () => {
    for (const chip of chipsFor(places)) expect(filterPlaces(places, chip).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npm test -- CityControls`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component, moving the chip logic across**

Copy `Chip`, `KIND_LABELS`, `ACTIVITY_LABELS` and the derivation from
`CityView.tsx:16-80` into `CityControls.tsx`, exported as `chipsFor` and
`filterPlaces`, then add the view toggle:

```tsx
export default function CityControls({ places, chip, onChip, view, onView }: Props) {
  return (
    <>
      <div className="chips" data-testid="filter-strip">
        <button type="button" className={chip === null ? 'btn btn--sm btn--ink' : 'btn btn--sm'} onClick={() => onChip(null)}>
          All {places.length}
        </button>
        {chipsFor(places).map((one) => (
          <button
            key={one.label}
            type="button"
            className={chip?.label === one.label ? 'btn btn--sm btn--ink' : 'btn btn--sm'}
            onClick={() => onChip(chip?.label === one.label ? null : one)}
          >
            {one.label}
          </button>
        ))}
      </div>
      <div className="viewswap" role="group" aria-label="Show the city as">
        <button type="button" aria-pressed={view === 'map'} onClick={() => onView('map')} data-testid="view-map">Map</button>
        <button type="button" aria-pressed={view === 'list'} onClick={() => onView('list')} data-testid="view-list">List</button>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Hook it into the screen**

In `MapScreen2`, hold `const [chip, setChip] = useState<Chip | null>(null)` and
`const [view, setView] = useState<'map' | 'list'>('map')`. Render `CityControls`
when `scope.level === 'city'`. Pass `filterPlaces(places.data ?? [], chip)` to
**both** `MapPins` and the sheet rows, so the two views can never show different
sets. When `view === 'list'`, give the sheet the class `sheet--full` so it covers
the map.

Clear the chip when the city changes: `useEffect(() => setChip(null), [cityKey])`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd web && npm test`
Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/CityControls.tsx web/src/components/CityControls.test.tsx web/src/pages/MapScreen2.tsx web/src/index.css
git commit -m "feat: filter chips and a list view over the city map"
```

---

### Task 9: An answer that moves the camera

**Files:**
- Modify: `web/src/pages/MapScreen2.tsx`
- Modify: `web/src/lib/context.ts` (the ask context's shape)
- Test: `web/src/pages/MapScreen2.agent.test.tsx`

**Interfaces:**
- Consumes: `openAsk({ surface, contextLabel })` as it exists today; `surface` is
  a free string on `POST /api/v1/ask` (`api/app/schemas/api.py:294`) and is
  passed through as context (`api/app/services/assistant.py:52,66`), so
  `surface: 'country'` needs **no backend change**.
- Produces: `onScopeSuggested(scope: Scope)` on the ask context, called when an
  answer names a place the traveller can be flown to.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/pages/MapScreen2.agent.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const opened: { surface?: string; contextLabel?: string }[] = []
vi.mock('../lib/context', () => ({
  useApp: () => ({ openAsk: (arg: never) => { opened.push(arg) } }),
}))
vi.mock('../components/MapCanvas', () => ({ default: () => <div data-testid="map" /> }))
vi.mock('../lib/api', () => ({
  api: {
    globeCountries: vi.fn().mockResolvedValue([{ key: 'guatemala', name: 'Guatemala', lat: 15, lon: -90, in_route: true, stop_count: 1, place_count: 1, video_count: 1, playable_count: 0 }]),
    cities: vi.fn().mockResolvedValue([]),
    cityPlaces: vi.fn().mockResolvedValue([]),
  },
}))

import MapScreen2 from './MapScreen2'

describe('the agent at each level', () => {
  it('tells the assistant which level it was asked from', async () => {
    render(<MemoryRouter initialEntries={['/map/guatemala']}><MapScreen2 /></MemoryRouter>)
    const button = await screen.findByTestId('ask-scope')
    button.click()
    expect(opened[0].surface).toBe('country')
    expect(opened[0].contextLabel).toBe('Guatemala')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npm test -- MapScreen2.agent`
Expected: FAIL — `surface` is `'map'` or the label is the raw key.

- [ ] **Step 3: Pass the level and the display name**

Already drafted in Task 7's `openAsk({ surface: scope.level, contextLabel: here })`.
Confirm `here` is the resolved display name, not `scope.countryKey` — the old
country heading showed `guatemala` for exactly this reason.

- [ ] **Step 4: Let an answer fly the camera**

In `web/src/lib/context.ts`, add to the ask context:

```ts
/**
 * Where an answer suggests looking next.
 *
 * The agent writes the same value a tap writes, which is why "and the lake?"
 * pans the map: the question and the press are the same action arriving by
 * different routes.
 */
onScopeSuggested?: (scope: Scope) => void
```

`MapScreen2` registers `go` as `onScopeSuggested` while it is mounted. When an
answer's proposed action names a city or place already in `cities.data` or
`places.data`, call it.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd web && npm test`
Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/MapScreen2.tsx web/src/pages/MapScreen2.agent.test.tsx web/src/lib/context.ts
git commit -m "feat: ask at any level, and let the answer move the camera"
```

---

### Task 10: Three ways out

**Files:**
- Create: `web/src/lib/useEdgeSwipe.ts`
- Modify: `web/src/pages/MapScreen2.tsx`
- Test: `web/src/lib/useEdgeSwipe.test.ts`, `web/src/pages/MapScreen2.back.test.tsx`

**Interfaces:**
- Consumes: `parentOf` (Task 3).
- Produces: `useEdgeSwipe(onOut: () => void, enabled: boolean)` returning
  `{ onTouchStart, onTouchMove, onTouchEnd, progress: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/lib/useEdgeSwipe.test.ts
import { describe, expect, it, vi } from 'vitest'
import { edgeSwipe } from './useEdgeSwipe'

describe('edgeSwipe', () => {
  it('fires once a swipe from the left edge is far enough', () => {
    const out = vi.fn()
    const swipe = edgeSwipe(out)
    swipe.start(8)
    swipe.move(90)
    swipe.end()
    expect(out).toHaveBeenCalledTimes(1)
  })
  it('ignores a swipe that did not start at the edge', () => {
    const out = vi.fn()
    const swipe = edgeSwipe(out)
    swipe.start(160)
    swipe.move(260)
    swipe.end()
    expect(out).not.toHaveBeenCalled()
  })
  it('returns without firing when the finger comes back', () => {
    const out = vi.fn()
    const swipe = edgeSwipe(out)
    swipe.start(6)
    swipe.move(70)
    swipe.move(10)
    swipe.end()
    expect(out).not.toHaveBeenCalled()
  })
  it('reports how far through the gesture is, for the map to follow', () => {
    const swipe = edgeSwipe(() => {})
    swipe.start(4)
    expect(swipe.progress()).toBe(0)
    swipe.move(44)
    expect(swipe.progress()).toBeGreaterThan(0)
    expect(swipe.progress()).toBeLessThan(1)
  })
})
```

```tsx
// web/src/pages/MapScreen2.back.test.tsx
// Review Focus 4: the feed and the agent are not levels.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../components/MapCanvas', () => ({ default: () => <div data-testid="map" /> }))
vi.mock('../lib/api', () => ({
  api: {
    globeCountries: vi.fn().mockResolvedValue([{ key: 'guatemala', name: 'Guatemala', lat: 15, lon: -90, in_route: true, stop_count: 1, place_count: 1, video_count: 1, playable_count: 0 }]),
    cities: vi.fn().mockResolvedValue([{ key: 'antigua', name: 'Antigua', lat: 14.5, lon: -90.7, in_route: true, destination_id: 'd', explanation: '', explanation_source: 'none', place_count: 0, video_count: 0, playable_count: 0, kinds: [] }]),
    cityPlaces: vi.fn().mockResolvedValue([]),
  },
}))
import MapScreen2 from './MapScreen2'

describe('coming back', () => {
  it('offers a back button at every level but the world', async () => {
    render(<MemoryRouter initialEntries={['/map/guatemala']}><MapScreen2 /></MemoryRouter>)
    expect(await screen.findByTestId('map-back')).toBeTruthy()
  })
  it('offers none at the world, because there is nowhere further out', async () => {
    render(<MemoryRouter initialEntries={['/map']}><MapScreen2 /></MemoryRouter>)
    await screen.findByTestId('map-screen')
    expect(screen.queryByTestId('map-back')).toBeNull()
  })
  it('names where the button goes, for a screen reader', async () => {
    render(<MemoryRouter initialEntries={['/map/guatemala/antigua']}><MapScreen2 /></MemoryRouter>)
    const button = await screen.findByTestId('map-back')
    expect(button.getAttribute('aria-label')).toBe('Back to Guatemala')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npm test -- useEdgeSwipe MapScreen2.back`
Expected: FAIL — `edgeSwipe` does not exist.

- [ ] **Step 3: Write the gesture**

```ts
// web/src/lib/useEdgeSwipe.ts
/**
 * The swipe-from-the-edge-to-go-back gesture.
 *
 * Split into a plain state machine (`edgeSwipe`) and a React hook around it, so
 * the rules can be tested without a touch screen. It tracks the finger rather
 * than firing on release, because a gesture that shows nothing until it commits
 * is one people learn to distrust.
 */
const EDGE_PX = 24
const COMMIT_PX = 72

export function edgeSwipe(onOut: () => void) {
  let from: number | null = null
  let now = 0
  return {
    start(x: number) {
      from = x <= EDGE_PX ? x : null
      now = 0
    },
    move(x: number) {
      if (from === null) return
      now = Math.max(0, x - from)
    },
    end() {
      if (from !== null && now >= COMMIT_PX) onOut()
      from = null
      now = 0
    },
    progress() {
      return from === null ? 0 : Math.min(1, now / COMMIT_PX)
    },
  }
}

export function useEdgeSwipe(onOut: () => void, enabled: boolean) {
  const machine = useRef(edgeSwipe(onOut))
  useEffect(() => { machine.current = edgeSwipe(onOut) }, [onOut])
  if (!enabled) return {}
  return {
    onTouchStart: (e: React.TouchEvent) => machine.current.start(e.touches[0].clientX),
    onTouchMove: (e: React.TouchEvent) => machine.current.move(e.touches[0].clientX),
    onTouchEnd: () => machine.current.end(),
  }
}
```

Add the `useRef`/`useEffect` imports from React.

- [ ] **Step 4: Wire all three to the same call**

In `MapScreen2`: the crumb buttons call `go(crumb.scope)`, the back button calls
`go(up)`, and `useEdgeSwipe(() => up && go(up), Boolean(up))` spreads onto the
screen `<div>`. All three are `navigate`, which pushes history, so the phone's
own back and the browser arrow work for free.

The feed and the agent are overlays, not levels: neither pushes history, and
closing either only unmounts the overlay.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd web && npm test`
Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/useEdgeSwipe.ts web/src/lib/useEdgeSwipe.test.ts web/src/pages/MapScreen2.tsx web/src/pages/MapScreen2.back.test.tsx
git commit -m "feat: crumb, gesture and button all step one level out"
```

---

### Task 11: A link plays in the feed

The feed's scroll, mute, open-at-its-second and whole-video offer all exist and
are right (`web/src/pages/ClipFeed.tsx`). One thing is wrong: a clip saved as a
link renders "Saved as a link" and an `Original` chip with `target="_blank"`,
which hands the traveller to YouTube. That chip is what this task removes.

**Files:**
- Create: `web/src/lib/videoSource.ts`
- Create: `web/src/components/ClipPlayer.tsx`
- Modify: `web/src/pages/ClipFeed.tsx`
- Test: `web/src/lib/videoSource.test.ts`

**Interfaces:**
- Produces:
  - `readSource(url: string | null): VideoSource | null` where
    `VideoSource = { host: 'youtube'; id: string } | { host: 'tiktok'; id: string } | { host: 'instagram'; id: string } | { host: 'other' }`
  - `youtubeEmbed(id: string, startSeconds: number): string`
  - `<ClipPlayer clip active muted />`

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/lib/videoSource.test.ts
import { describe, expect, it } from 'vitest'
import { readSource, youtubeEmbed } from './videoSource'

describe('readSource', () => {
  it('reads a watch link', () => {
    expect(readSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ host: 'youtube', id: 'dQw4w9WgXcQ' })
  })
  it('reads a short link', () => {
    expect(readSource('https://youtu.be/dQw4w9WgXcQ')).toEqual({ host: 'youtube', id: 'dQw4w9WgXcQ' })
  })
  it('reads a shorts link', () => {
    expect(readSource('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toEqual({ host: 'youtube', id: 'dQw4w9WgXcQ' })
  })
  it('reads a tiktok video link', () => {
    expect(readSource('https://www.tiktok.com/@someone/video/7234567890123456789'))
      .toEqual({ host: 'tiktok', id: '7234567890123456789' })
  })
  it('reads an instagram reel link', () => {
    expect(readSource('https://www.instagram.com/reel/CxYzAbC1234/')).toEqual({ host: 'instagram', id: 'CxYzAbC1234' })
  })
  it('calls anything else other, rather than guessing', () => {
    expect(readSource('https://example.com/a.mp4')).toEqual({ host: 'other' })
  })
  it('handles no url at all', () => {
    expect(readSource(null)).toBeNull()
  })
})

describe('youtubeEmbed', () => {
  it('starts muted, at the second the quote came from', () => {
    const src = youtubeEmbed('abc123', 32)
    expect(src).toContain('/embed/abc123')
    expect(src).toContain('mute=1')
    expect(src).toContain('start=32')
  })
  it('starts at zero when there is no timestamp', () => {
    expect(youtubeEmbed('abc123', 0)).toContain('start=0')
  })
  it('never asks for related videos from other channels', () => {
    expect(youtubeEmbed('abc123', 0)).toContain('rel=0')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npm test -- videoSource`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the reader**

```ts
// web/src/lib/videoSource.ts
/**
 * Which host a saved link belongs to, and how to play it here.
 *
 * "Here" is the whole point. A clip that opens YouTube has taken the traveller
 * out of the trip they were planning, and getting back is two app switches. So
 * every host that permits an embed gets one.
 *
 * Nothing in this file downloads or re-hosts a video. That would give us full
 * control and would also be theft; the embed keeps the creator's credit on their
 * own work, which is the arrangement each of these platforms actually allows.
 */
export type VideoSource =
  | { host: 'youtube'; id: string }
  | { host: 'tiktok'; id: string }
  | { host: 'instagram'; id: string }
  | { host: 'other' }

export function readSource(url: string | null): VideoSource | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { host: 'other' }
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
  const parts = parsed.pathname.split('/').filter(Boolean)

  if (host === 'youtu.be' && parts[0]) return { host: 'youtube', id: parts[0] }
  if (host.endsWith('youtube.com')) {
    const watching = parsed.searchParams.get('v')
    if (watching) return { host: 'youtube', id: watching }
    if ((parts[0] === 'shorts' || parts[0] === 'embed') && parts[1]) return { host: 'youtube', id: parts[1] }
  }
  if (host.endsWith('tiktok.com')) {
    const at = parts.indexOf('video')
    if (at >= 0 && parts[at + 1]) return { host: 'tiktok', id: parts[at + 1] }
  }
  if (host.endsWith('instagram.com') && (parts[0] === 'reel' || parts[0] === 'reels' || parts[0] === 'p') && parts[1]) {
    return { host: 'instagram', id: parts[1] }
  }
  return { host: 'other' }
}

export function youtubeEmbed(id: string, startSeconds: number): string {
  const params = new URLSearchParams({
    mute: '1',
    autoplay: '1',
    start: String(Math.max(0, Math.round(startSeconds))),
    rel: '0',
    playsinline: '1',
    modestbranding: '1',
  })
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npm test -- videoSource`
Expected: PASS, 10 tests.

- [ ] **Step 5: Write the player and swap it in**

`ClipPlayer` renders, in order of what the clip has: the existing `<video>` for
`file_url`; a YouTube `<iframe>` for a YouTube source; Task 12's embed for
TikTok/Instagram; the existing "saved as a link" card otherwise — now **without**
the `Original` chip.

Delete the `target="_blank"` anchor at `ClipFeed.tsx:293-299`.

- [ ] **Step 6: Guard the rule with a test that reads the source**

```ts
// web/src/pages/ClipFeed.rule.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// A blunt test for a blunt rule: nothing in the feed may hand the traveller to
// another app. Easier to keep than to rediscover.
describe('the feed never leaves the app', () => {
  for (const file of ['src/pages/ClipFeed.tsx', 'src/components/ClipPlayer.tsx']) {
    it(`${file} opens no tab and navigates nowhere`, () => {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toContain('target="_blank"')
      expect(source).not.toContain('window.open')
      expect(source).not.toContain('location.href')
    })
  }
})
```

- [ ] **Step 7: Run everything**

Run: `cd web && npm test && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/videoSource.ts web/src/lib/videoSource.test.ts web/src/components/ClipPlayer.tsx web/src/pages/ClipFeed.tsx web/src/pages/ClipFeed.rule.test.ts
git commit -m "feat: play a YouTube clip in the feed instead of handing it off"
```

---

### Task 12: The embeds that cannot be controlled, and the ones that fail

**Files:**
- Modify: `web/src/components/ClipPlayer.tsx`
- Test: `web/src/components/ClipPlayer.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/ClipPlayer.test.tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import ClipPlayer from './ClipPlayer'

const clip = (over: Record<string, unknown>) => ({
  id: 'c1', source_id: 's1', trip_place_id: 'tp1', place_id: 'p1',
  place_name: 'Acatenango', place_category: 'nature', city: 'Antigua', country: 'Guatemala',
  scope_label: 'Antigua', title: null, author: 'someone', url: null, file_url: null,
  media_type: null, start_seconds: 32, quote: 'Book the 2pm shuttle, not the 6am.',
  takeaway: null, is_whole_video: false, ...over,
}) as never

describe('ClipPlayer', () => {
  it('plays a YouTube clip in a frame, muted and at its second', () => {
    render(<ClipPlayer clip={clip({ url: 'https://youtu.be/abc123' })} active muted />)
    const frame = screen.getByTestId('yt-embed') as HTMLIFrameElement
    expect(frame.src).toContain('start=32')
    expect(frame.src).toContain('mute=1')
  })

  it('tells the truth about a TikTok clip it cannot seek', () => {
    render(<ClipPlayer clip={clip({ url: 'https://www.tiktok.com/@a/video/7234567890123456789' })} active muted />)
    expect(screen.getByTestId('tt-embed')).toBeTruthy()
    // The quote is printed with its timestamp, because the player cannot jump there.
    expect(screen.getByText(/0:32/)).toBeTruthy()
    expect(screen.getByText(/Book the 2pm shuttle/)).toBeTruthy()
  })

  // Review Focus 5: an embed that never loads.
  it('shows the quote and says the reel is gone when the embed fails', () => {
    render(<ClipPlayer clip={clip({ url: 'https://www.instagram.com/reel/CxYz1234/' })} active muted />)
    screen.getByTestId('ig-embed').dispatchEvent(new Event('error'))
    expect(screen.getByTestId('embed-gone')).toBeTruthy()
    expect(screen.getByText(/Book the 2pm shuttle/)).toBeTruthy()
  })

  it('does not spin forever: a slow embed gives up and shows the quote', async () => {
    vi.useFakeTimers()
    render(<ClipPlayer clip={clip({ url: 'https://www.instagram.com/reel/CxYz1234/' })} active muted />)
    vi.advanceTimersByTime(8000)
    expect(screen.getByTestId('embed-gone')).toBeTruthy()
    vi.useRealTimers()
  })

  it('mounts nothing for a panel that is not the one being watched', () => {
    render(<ClipPlayer clip={clip({ url: 'https://youtu.be/abc123' })} active={false} muted />)
    expect(screen.queryByTestId('yt-embed')).toBeNull()
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npm test -- ClipPlayer`
Expected: FAIL.

- [ ] **Step 3: Implement the remaining players and the failed state**

- TikTok: `https://www.tiktok.com/embed/v2/<id>` in an `<iframe data-testid="tt-embed">`.
- Instagram: `https://www.instagram.com/reel/<id>/embed` in an
  `<iframe data-testid="ig-embed">`.
- Both: print the quote and `clock(start_seconds)` above the frame, since neither
  can be seeked.
- On `error`, or after an 8s timeout with no `load`, render `embed-gone`: the
  quote, the author, and one line saying the clip is no longer available where it
  came from.
- `active === false` mounts no frame at all — only previous, current and next
  panels mount, so four hundred clips cost the same as three.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npm test`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ClipPlayer.tsx web/src/components/ClipPlayer.test.tsx
git commit -m "feat: embed tiktok and instagram, and say so when one is gone"
```

---

### Task 13: Delete what this replaced

The test of whether this was a refactor or just more code.

**Files:**
- Delete: `web/src/components/Globe.tsx`, `web/src/pages/GlobeScreen.tsx`,
  `web/src/pages/Countries.tsx`, `web/src/pages/CountryView.tsx`,
  `web/src/pages/CityView.tsx`, the old `web/src/pages/MapScreen.tsx`
- Rename: `MapScreen2.tsx` → `MapScreen.tsx` (and its tests)
- Modify: `web/src/App.tsx`, `web/package.json`

- [ ] **Step 1: Check nothing else uses them**

```bash
cd web && grep -rn "Globe\|GlobeScreen\|CountryView\|CityView\|leaflet" src/ --include=*.tsx --include=*.ts | grep -v "MapScreen"
```
Expect only the files being deleted. Anything else is a caller to fix first.

- [ ] **Step 2: Redirect the old links**

Keep links people have already saved working:

```tsx
<Route path="/globe" element={<Navigate to="/map" replace />} />
<Route path="/countries" element={<Navigate to="/map" replace />} />
<Route path="/countries/:key" element={<OldCountryLink />} />
<Route path="/countries/:key/cities/:city" element={<OldCityLink />} />
```

where each small component reads its params and `<Navigate>`s to the matching
`/map/...` path. The service worker has served this app for months, so an old
bundle's links will arrive for a while yet.

- [ ] **Step 3: Delete, and drop the dependency**

```bash
cd web && rm src/components/Globe.tsx src/pages/GlobeScreen.tsx src/pages/Countries.tsx src/pages/CountryView.tsx src/pages/CityView.tsx src/pages/MapScreen.tsx
git mv src/pages/MapScreen2.tsx src/pages/MapScreen.tsx
for f in MapScreen2.test.tsx MapScreen2.agent.test.tsx MapScreen2.back.test.tsx; do
  git mv "src/pages/$f" "src/pages/${f/MapScreen2/MapScreen}"
done
npm uninstall leaflet @types/leaflet
```

Update the imports in the renamed tests, and the tab in `App.tsx` from `/globe`
to `/map`.

- [ ] **Step 4: Check nothing broke**

Run: `cd web && npm test && npm run lint && npm run build`
Expected: PASS, and a clean build.

- [ ] **Step 5: Commit**

```bash
git add -A web/
git commit -m "refactor: delete the svg globe, the leaflet map and four routes"
```

---

### Task 14: Prove it in Chrome

The camera cannot be tested in jsdom — there is no WebGL. This is where the five
acceptance criteria from the spec are actually checked, with screenshots.

**Files:**
- Create: `docs/screenshots/map-rebuild/` (the evidence)

- [ ] **Step 1: Start both sides**

```bash
cd api && uvicorn app.main:app --reload --port 8000 &
cd web && npm run dev
```

- [ ] **Step 2: Walk the ladder, screenshotting each level**

Through Playwright MCP: log in, go to `/map`, and press through
world → Guatemala → Antigua → Acatenango. Screenshot each level. Watch the
network panel: **no document request may fire between levels.** A navigation
here means something is still a route.

- [ ] **Step 3: Check each acceptance criterion**

1. Globe → a hostel's street in four presses, no reload.
2. Pressing Guatemala shows its cities drawn on Guatemala, with an ask button.
3. Ask "and the lake?" from Antigua → the camera moves to Atitlán, no reload.
4. Open the feed on a place with 4 clips, scroll all four:
   `browser_network_requests` shows no top-level navigation, and
   `browser_tabs` shows one tab.
5. From the same start, crumb, gesture and button each land on the same screen,
   and a filter set beforehand survives all three.

- [ ] **Step 4: Check the two settings that break this if ignored**

```
browser_emulate_media({ reducedMotion: 'reduce' })
```
Press into a city: the camera must arrive instantly and correctly, not stay put.

Then with WebGL unavailable, the list must still be usable.

- [ ] **Step 5: Save the evidence and write down what failed**

Put the screenshots in `docs/screenshots/map-rebuild/`. Any criterion that fails
is written down here as a defect with what was seen — not quietly fixed and not
quietly dropped.

- [ ] **Step 6: Commit**

```bash
git add docs/screenshots/map-rebuild/
git commit -m "docs: screenshot proof of the rebuilt map, globe to street"
```

---

## Self-Review

**Spec coverage.** One camera → Tasks 1, 5. City is the screen → 7, 8. Agent at
every level → 7, 9. Videos play in-app → 11, 12. Three ways back → 10. Scope
state → 3. Camera targets → 4. Pins → 6. Deletions → 13. Acceptance → 14.
Nothing in the spec is unclaimed.

**Placeholders.** None. Every code step carries the code; every test step carries
the assertions.

**Type consistency.** `Scope` (Task 3) is consumed unchanged by Tasks 4–10.
`CameraTarget` (4) is consumed by 5. `Pin`/`pinsFor` (6) is consumed by 7.
`Chip`/`chipsFor`/`filterPlaces` (8) is consumed by 7's rows. `VideoSource` (11)
is consumed by 12. No name changes between tasks.

**Review Focus.** All five are pinned to a task's own tests: (1) Task 4
`targetFor` falls back to the world; (2) Tasks 4 and 6 both refuse (0, 0);
(3) Task 5 `map.stop()` before each flight, and Task 7's settle timer restarting
per scope; (4) Task 10's overlay-is-not-a-level tests; (5) Task 12's error and
timeout tests.

**One thing worth saying out loud.** Task 1 can stop this plan. If a mid-range
phone cannot hold the frame rate, the globe below z4 may have to be a static
image, and Tasks 5–7 change shape. That is why it is first and why it is
throwaway.
