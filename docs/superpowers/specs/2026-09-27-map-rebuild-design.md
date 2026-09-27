# Map Rebuild — Design

**Date:** 2026-09-27
**Canvas:** https://claude.ai/artifact/61ina9c2JxPevKrdHzQF29 (section "The map, rebuilt")
**Status:** awaiting approval

## What is wrong

Four complaints, each with a cause in the code:

1. **"There is no zoom, it feels like different tabs."** True literally. The globe
   is hand-drawn SVG (`web/src/components/Globe.tsx`, d3-geo orthographic onto a
   canvas). The city map is Leaflet. Two engines cannot fly between each other,
   so `/globe` → `/countries/:key` → `.../cities/:city` is three React route
   changes, each unmounting one component and mounting another.
2. **"Pressing a country does not show its cities properly."** `CountryView` has
   no map on it. It is a list of city names. Nothing is drawn on the country.
3. **"I cannot ask the agent of that country."** `openAsk` is wired on
   `CityView` and `Place`. There is no ask button on the country screen.
4. **"Videos should not redirect to another app or Google."** `ClipFeed` plays an
   uploaded file in a `<video>` with scroll-snap, muted, seeked to the second the
   place was named — that part is right. A clip saved as a *link* renders
   "Saved as a link" plus an `Original` chip with `target="_blank"`, which hands
   the traveller to YouTube or TikTok.

## What must be true when this is done

- **One camera.** MapLibre GL JS v5 with `projection: 'globe'`, one instance,
  mounted once, never unmounted. Every level change is `map.flyTo` on that
  instance. Continuous z0 (globe) → z12+ (street); the adaptive projection eases
  spherical → Mercator across z4–6 with no reload and no swap.
- **The city is the screen.** Activities are pins on the city map. A list toggle
  holds the same set under the same filters.
- **The agent at every level.** World, country, city, place. It inherits the
  camera's scope and its answers may move the camera.
- **Every video plays in-app.** One vertical scroll-snap feed. No app switch, no
  browser tab, no search page.
- **Three ways back, one behaviour.** Breadcrumb (skips levels), edge-swipe
  gesture (one level), button over the map (one level, keyboard-reachable). All
  three write the same state.

## Architecture

### One piece of state

```ts
type Scope =
  | { level: 'world' }
  | { level: 'country'; countryKey: string }
  | { level: 'city'; countryKey: string; cityKey: string }
  | { level: 'place'; countryKey: string; cityKey: string; tripPlaceId: string }
```

The camera reads it, the sheet reads it, the chips read it, the agent inherits
it. Three controls write it — a map press, a list press, an agent answer — and
they cannot disagree because there is one value. `/map/*` routes mirror it so a
link still works and the browser's back button still means something, but the
route no longer drives what is mounted.

### The layer stack (bottom to top)

| Layer | Unmounts? | Holds |
|---|---|---|
| The map | never | camera, country fills, city and activity pins |
| Pins/clusters | no, they fade | the current scope's markers |
| The sheet | no, it resizes | cities / activities / a place's clips |
| The agent | yes, on close | the conversation, inheriting scope |
| The feed | yes, on close | full-screen video panels |

### Data

No new endpoints. `GET /api/v1/countries` already returns `lat`/`lon` per
country; `/countries/:key/cities` returns `lat`/`lon` per city;
`.../cities/:city/places` returns `lat`/`lon` per place. Coverage in the live
database is **52 of 52 places and 20 of 20 destinations** — nothing to backfill.
`surface` on `POST /api/v1/ask` is a free-form string passed through as context,
so `surface: "country"` needs no backend change.

One thing the API does not give: a country's **bounding box**. Derive it on the
client from the `world-atlas` topology already in `package.json`, via
`d3-geo`'s `geoBounds` — no new dependency and no request.

### The player layer

The feed shell stays. `<ClipPanel>` gains a player chosen by source:

| Source | Plays in feed | Seek to second | Note |
|---|---|---|---|
| own upload | yes | yes | `<video>`, as today |
| YouTube | yes | yes | IFrame Player API, `mute=1`, `start=<s>` |
| TikTok | yes, their embed | **no** | quote printed above with its timestamp |
| Instagram | public reels only | no | private/deleted → quote + "the reel is gone" |

Re-hosting a creator's video would give full control and would also be theft:
not proposed. Embedding is the sanctioned route and keeps the credit on the clip.

## Scope

**In:** the map engine swap, the country screen gaining a map and an agent, the
city screen as pins + list, the scope state, the three return paths, the feed's
player layer.

**Out:** trip composition (solo / girlfriend / friends) — still deferred.
Anything during the trip. 3D extruded buildings and terrain — the *zoom* is 3D;
rooftops would cost phone frames and prove nothing.

**Deletes:** `web/src/components/Globe.tsx`, the Leaflet map and its dependency,
and the routes `/globe`, `/countries`, `/countries/:key`,
`/countries/:key/cities/:city`. Fewer moving parts at the end than at the start.

## Risks, honestly

1. **Frame rate is the real risk and cannot be settled by reading.** A globe plus
   clustered pins plus a mounted video embed on a mid-range Android is the
   question. Task 1 measures it on a real device before anything is built on top.
2. **Reduced motion** must skip every flight and cut to the destination, or this
   becomes unusable for the people who set it.
3. **No WebGL** means no map. The list is the fallback, and it stays the real
   control throughout anyway.
4. **Embeds fail** — private reels, pulled videos, region blocks. Each panel needs
   a real failed state that still shows the quote, because the quote is the point.
5. **Two embeds cannot be restyled.** TikTok's and Instagram's frames arrive with
   their own chrome. Those panels will never look quite like ours. Better than a lie.

## How we will know it worked

1. Globe → a hostel's street in four presses, no page reload. Recorded as video.
2. Pressing Guatemala shows its cities drawn on Guatemala, with an ask button.
3. "And the lake?" from Antigua moves the camera to Atitlán, no page change.
4. Four clips scroll in one feed; asserted: no new tab, no host redirect.
5. Crumb, gesture and button all land on the same screen from the same start,
   and the filter set survives all three.
