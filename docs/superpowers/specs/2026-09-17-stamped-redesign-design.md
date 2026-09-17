# TripStash "Stamped" redesign — design spec

**Date:** 2026-09-17 · **Branch:** `redesign` · **Scope:** `web/` only (the API is untouched)

## Brief

Replace the deliberately austere PWA skin with a bold, editorial one that has
real motion, without breaking the product's trust rules (nothing reaches the
map unconfirmed, status is icon + word, every claim shows its evidence,
reduced motion is honoured). The user chose the **Stamped** direction over a
cinematic "Reel" feed.

## Concept — every save is a stamp

A long overland trip is a passport filling with stamps. In TripStash, every
confirmed place, every status and every category is drawn as a rubber stamp:
an inked ring, a slight rotation, a word set around the arc. Approving an item
in Inbox is the one orchestrated motion moment in the app — the stamp drops
onto the card. Everything else moves only in answer to a tap.

## Tokens

### Colour

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--paper` | `#F4F7F2` | `#0B1716` | page background (pale sage / pine-black) |
| `--paper-2` | `#E9EFE8` | `#12211F` | sunk surfaces, inputs |
| `--card` | `#FFFFFF` | `#16262A` | raised surfaces |
| `--ink` | `#132A2B` | `#EEF3EE` | text, primary buttons, stamps |
| `--ink-2` | `#3F5A5B` | `#A9BDB9` | secondary text |
| `--ink-3` | `#7A9290` | `#6F8886` | tertiary text |
| `--line` | `#D6E0D8` | `#22363A` | hairlines |
| `--teal` | `#0E7C66` | `#3FCFA9` | accent: links, selected, planned |
| `--teal-soft` | `#DDEFE8` | `#12352E` | accent wash |
| `--coral` | `#FF6B3D` | `#FF8A5B` | must-visit, hot actions, the Save FAB |
| `--coral-soft` | `#FFE6DC` | `#3A1F16` | coral wash |
| `--gold` | `#FFD166` | `#FFD166` | today, weather, resurfaced |
| `--gold-soft` | `#FFF3CF` | `#3A2F10` | gold wash |
| `--warn` / `--danger` | `#9A6400` / `#B3261E` | `#F2B84B` / `#FF7B72` | unchanged semantics |

Status colours: saved = ink, must_visit = coral, planned = teal, visited =
ink-3, inbox = ink-3, archived = ink-3. Category tints (glyph tiles and
stamps): food = coral, stay = teal, nature = teal, view = gold, transport =
ink, other = ink-2.

### Type

One family: **Bricolage Grotesque** (variable: `wght` 200–800, `wdth`
75–100, `opsz` 12–96), self-hosted so the PWA keeps its type offline.

| Token | Setting | Use |
| --- | --- | --- |
| `--display` | 800 / wdth 80 / opsz 96 / 2.75rem, lh 0.95, ls −0.03em | screen headlines ("Antigua", "Day 12") |
| `--title` | 700 / wdth 90 / 1.5rem, lh 1.1 | section titles, place names |
| `--head` | 600 / 1.0625rem, lh 1.3 | row titles |
| `--body` | 400 / 0.9375rem, lh 1.5 | body |
| `--small` | 500 / 0.8125rem, lh 1.4 | metadata |
| `--stamp` | 700 / wdth 85 / 0.625rem, ls 0.12em | words inside stamps only |

Numbers use `font-variant-numeric: tabular-nums`. No mono, no all-caps
eyebrows outside the stamp ring.

### Shape and depth

Radii: `--r-sm` 10px (inputs, chips), `--r-md` 16px (cards, sheets' inner
blocks), `--r-lg` 24px (sheets, hero cards), `--r-pill`. Depth comes from
layered surfaces (`paper` → `card`) plus one soft shadow
`0 12px 32px -12px rgb(19 42 43 / .25)` on floating things only (FAB, sheet,
search bar). Stamps use a 2px ring in the tint colour, `rotate(-6deg)`, and a
subtle radial "ink" texture via CSS mask.

### Motion

`motion` (framer-motion) with springs: `{type:'spring', stiffness:420,
damping:34}` for UI, `{stiffness:260, damping:20}` for the stamp. Durations
never exceed 400ms. `useReducedMotion()` switches every spring to an instant
fade.

| Moment | Motion |
| --- | --- |
| Route change | `AnimatePresence` cross-fade + 12px rise, 240ms |
| Tab bar | active pill slides with `layoutId="tab"`; icons animate on tap (pqoqubbw/icons) |
| Lists | rows stagger in once (40ms apart, max 8), never on re-render |
| Approve (Inbox) | stamp drops: scale 1.8→1, rotate −18→−6°, opacity 0→1, spring; card then collapses |
| Ignore | card slides right and collapses |
| Sheets (Ask, Save, map list) | `vaul` drawer with real drag and snap points 0.28 / 0.55 / 0.92 |
| Money | `@number-flow/react` rolling digits; budget arc draws to value on mount |
| Map markers | stamp pin; selected pin scales up with a spring and a coral ring pulse |
| Save FAB | spring scale on press; morphs into the Save sheet header |
| Login | drifting SVG contour lines behind the wordmark (slow, 40s, reduced-motion = static) |

## Screens

### Login
Full-bleed paper with animated topographic contours. Wordmark "TripStash" in
display type stacked over two lines, tagline below, form in a raised card
anchored to the bottom. Demo hint stays.

### Home
Header is the editorial hero: the big line is the current destination
("Antigua"), the second line is phase + day count + weather in `--small`
with a gold weather chip. Trip name sits in the tab bar title area, not above.
Then, in order:
1. **Review queue** — one coral-tinted stamp card ("5 to review") only when non-empty.
2. **Today** — vertical timeline with a teal route line; each stop a row with time.
3. **Brought back** — horizontal snap rail of tall cards (the only place cards
   are used for content), each with a category stamp, the reason line and distance.
4. **Money** — big rolling number, budget arc, per-day line.
5. Bookings list, then the place-count summary line.

### Map
Full-bleed CartoDB Voyager tiles (light) / Dark Matter (dark) — free, no key,
attribution kept. Floating glass search bar; filter chips slide in under it.
Markers are stamp pins tinted by status. The list sheet is a `vaul` drawer
with snap points; selecting a marker shows the recall card sized to content.

### Saved
Animated segmented control (shared-layout pill) for Inbox / Places / Knowledge
/ Sources. Inbox cards carry the evidence quote in a highlighted block,
confidence as a slim bar, and the stamp-approve action. Places rows get the
status stamp on the right.

### Place
Hero: the real map at 240px with a pine duotone overlay fading into paper;
the place name overlaps the bottom edge in display type; the status stamp sits
rotated at the top-right. Sticky compact title bar appears after scrolling past
the hero. Sections keep their order; "Live information" facts get freshness
as an exception-only amber stamp.

### Trip
Header shows the trip name in display type with the date range. Route becomes
a numbered stepper (it *is* a sequence) with a teal line and the current stop
filled. Money mirrors Home's counter. Forms unchanged in behaviour, restyled.

### Ask / Save
Both become `vaul` drawers. Ask: input first, context chips, answer rendered
with a short word-by-word reveal (max 400ms total), cards below. Save: the
four modes are a segmented control; success state shows a stamped "Saved"
card with the pending count.

## Files

| Path | Change |
| --- | --- |
| `web/package.json` | add `motion`, `vaul`, `@number-flow/react`, `clsx` |
| `web/public/fonts/BricolageGrotesque-var.woff2` | new (replaces Jakarta) |
| `web/public/lottie/*.json` | not used — Lottie dropped in favour of SVG stamps (see below) |
| `web/src/styles/theme.css` | rewrite tokens |
| `web/src/styles/app.css` | rewrite |
| `web/src/components/motion/*.tsx` | animated icons copied from pqoqubbw/icons (MIT), `cn` helper |
| `web/src/components/Stamp.tsx` | new: stamp ring primitive + `StampDrop` animation |
| `web/src/components/Drawer.tsx` | new: `vaul` wrapper replacing `Sheet` |
| `web/src/components/Segmented.tsx` | new: shared-layout segmented control replacing `Tabs` |
| `web/src/components/Money.tsx` | new: number-flow counter + budget arc |
| `web/src/components/*.tsx`, `web/src/pages/*.tsx`, `web/src/App.tsx` | restyle |
| `docs/design.md` | rewrite to describe the new system |
| `docs/screenshots/*.png` | light + dark of every screen |

Lottie was in the original proposal; after reviewing the free repositories
the useful ones are generic (loaders, tab bounces) and would read as clip
art next to the stamp system, so the app draws its own SVG stamps instead.
The animated icons from `pqoqubbw/icons` are kept — they are Lucide with
motion, so they match the existing icon vocabulary.

## Not changing

API, routes, data flow, offline queue, service worker, accessibility floor
(44px targets, focus rings, list alternative to the map, status never colour-only).

## Testing

`npm run lint && npm run build` must pass. Manual pass on every screen at
390×844 in light and dark, with and without `prefers-reduced-motion`, captured
to `docs/screenshots/`.
