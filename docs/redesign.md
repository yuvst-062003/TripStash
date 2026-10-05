# The iOS redesign

Interactive canvas: <https://claude.ai/artifact/8g4hZWUyGrBksVuGVWxzwc>
(private — shareable from the page's Share menu)

Nine phone screens, linked, with the filters, route, search, ticks and the
agent's Add/Dismiss actually working. Grounded in the Human Interface
Guidelines via the vendored skill at `.claude/skills/apple-design/`.

## Why it changed

The shipped design is deliberately flat — hairline lists, no cards, one accent
— and [design.md](design.md) argues for it. The traveller then put a set of
real apps in front of it (Polarsteps, Rhyme) and chose, explicitly, to go the
other way: image-forward, bottom sheets, a floating tab bar, colour chips.

This supersedes the visual rules in design.md. What it does **not** supersede
is the honesty rules — no invented imagery standing in for real content, no
decoration pretending to be data, metadata that stays legible in sunlight.
Every image on the canvas is a drawn placeholder, and says so.

## Navigation

The globe is the home screen. Home's "what's next today" moves into Trip.

```
Explore (globe)
  └─ Country ── cities, searchable, ranked
       └─ City ── map + your clips + places
            ├─ Place ── sources, clips, facts
            │    └─ Clips ── the saved section
            ├─ Good to know ── cited knowledge
            ├─ Add a place ── search, or the agent
            └─ Ask ── propose and confirm
```

**Tab bar**: Explore · Clips · Saved · Trip, as a floating pill. Save is a
*separate* circle beside it, not a fifth tab — the HIG is explicit that a tab
bar navigates between top-level areas and is not where actions live. Both
reference apps do the same thing.

## Screens

| Screen | Carries |
| --- | --- |
| `Main` | Dark globe, country flag pills, Discover/Saved segmented, For-you cards |
| `Country` | Hero, **cities** ranked by place count, live search, two sort chips |
| `City` | Map with filter chips and route mode, clips rail, places, Good to know |
| `Know` | Knowledge with sources, conflicts side by side, border warning |
| `Place` | Why you saved it, Ask, clips, **sources · 2**, facts, actions |
| `Clips` | Full-bleed feed, opens at the saved second, section scrub bar |
| `AddPlace` | Search → Add to map, add by name, or ask for suggestions |
| `Agent` | Answer, what it looked at, one proposal with Add / Dismiss |
| `Import` | Paste a link → what it read → tick what to keep |

## The map

**Two kinds of pin, distinguished by fill and shape, not colour alone** — the
accessibility rule, and it also survives a sunlit screen:

- Solid green, white ring: yours.
- Hollow, dashed grey: well known here, not saved.

**Filter chips** over the map: All · Mine · Food · Stay · Views. Necessary once
a city holds 142 places.

**Route mode** hides everything that is not yours, numbers what remains in
walking order, draws the line, and offers to keep it as a day. This is the
bridge from a map of saved pins to an itinerary.

## The city layer

A country lists **cities**, never individual spots — a café should not be
ranked against a city. Each row carries both counts, the public one and yours:
`142 places · 6 of yours · 8 clips`.

Sorting is `Most places` or `Most saved by you`. Search filters live.

> **Open:** "popularity" needs a real basis. Ranking by place count is honest.
> "Saved by many travellers" on an individual spot currently has nothing behind
> it and must either come from a provider or be removed.

## The clips rail

On the city screen, above everything else: your saved videos as small vertical
cards with the timestamp you saved at. Tap one and the feed opens at that
second. This is the row no guidebook can show, so it leads.

## The agent

Answers, says what it looked at, then proposes **one** concrete thing as a card
with Add and Dismiss. Nothing moves until Add is pressed. Full rules, including
citation and the border warning, in [sources.md](sources.md).

## Tokens

| | |
| --- | --- |
| Typeface | Plus Jakarta Sans, 400–800, self-hosted |
| Night | `#050A14` ground, `#0A1C35` globe, `#0C1426` panels |
| Surface | `#FFFFFF`, grouped `#F4F5F8`, hairline `#E4E7EC` |
| Ink | `#0B1220` / `#5A6475` / `#737C8C` (all ≥ 4.5:1 on white) |
| Accent | `#0E7C5A` |
| Radii | 44 phone · 28 sheet · 20 card · 16 field · pill controls |
| Spacing | 4-based; 16 px screen gutter, 20 px inside sheets |
| Tap targets | 44 px floor everywhere, including the globe's flag pills, which keep a 36 px visual pill inside a 46 px hit area |

## What this costs to build

`web/src/styles/app.css` is largely rewritten, and most screens with it. The
API barely moves: the city layer needs list and detail endpoints, the map needs
a category filter, and route ordering is a new service. Clips, sources,
evidence timestamps and the review queue already exist and are what the new
screens are built to show.
