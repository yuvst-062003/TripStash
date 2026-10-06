# The iOS redesign

Interactive canvas: <https://claude.ai/artifact/8g4hZWUyGrBksVuGVWxzwc>
(private — shareable from the page's Share menu)

Ten phone screens, linked, with the nights steppers, filters, route, search,
ticks and the agent's Add/Dismiss actually working. Grounded in the Human
Interface Guidelines via the vendored skill at `.claude/skills/apple-design/`.

## Why it changed

The shipped design is deliberately flat — hairline lists, no cards, one accent
— and [design.md](design.md) argues for it. The traveller then put a set of
real apps in front of it (Polarsteps, Rhyme) and chose, explicitly, to go the
other way: image-forward, bottom sheets, a floating tab bar, colour chips.

This supersedes the visual rules in design.md. What it does **not** supersede
is the honesty rules — no invented imagery standing in for real content, no
decoration pretending to be data, metadata that stays legible in sunlight.
Every image on the canvas is a drawn placeholder, and says so.

## Home is the trip

> Corrected after a first pass put the globe on the home screen. The traveller
> was explicit: **home is the trip**, and Explore is a different aspect of it.

Opening the app lands on the route — a dark map carrying the numbered stops
joined by a dashed line, and a sheet under it holding the itinerary. Not a
globe, not a feed.

**One continuous map.** Zoom out far enough and the stops become countries:
Explore is the same map, further away. That is what makes discovery read as a
continuation of planning rather than a separate place. Pinch is the real
gesture; a `Zoom out to Explore` pill on the map is its discoverable twin.

Explore is *also* a tab, because it has to work when nothing is planned yet.
The countries already on the route carry a green ring and an "on your route"
marker, so the two readings of one map stay visibly joined.

```
Trip (home) ──zoom out──▶ Explore ──▶ Country ──▶ City ──▶ Place ──▶ Clips
   │                                                 │          │
   │                                                 ├─ Good to know
   │                                                 ├─ Add a place
   └──────────── Save a link ────────────────────────┴─ Ask
```

**Tab bar**: Trip · Clips · Saved · Explore, as a floating pill. Save is a
*separate* circle beside it, not a fifth tab — the HIG is explicit that a tab
bar navigates between top-level areas and is not where actions live.

## The itinerary

Taken from the Polarsteps planner, which the traveller supplied as the target.

| Element | Behaviour |
| --- | --- |
| Nights stepper (− n +) | Live. Change a stop's nights and every date after it shifts; the summary re-counts. This is what makes the screen a planning tool rather than a picture of one |
| Dates | Derived from the start date plus the running night count. Never typed |
| **No end date** chip | The flexible-dates affordance spec §7.1 requires. Order is mandatory; an end is not |
| Transport legs | Distance and time between stops, labelled `estimate` — a routing figure presented as a guess, not a timetable |
| `+` between every pair | Insert a stop mid-route without reordering. Also where Explore enters, when you are adding rather than browsing |

### Plan / Today

A segmented control at the top of the sheet. Polarsteps puts `Plan | Track`
there; **Track is GPS breadcrumbing, which TripStash does not do** — adopting
the label would promise background location it has no code for. The second
mode answers the question the app can answer: what is near you now, what you
planned for today, what the weather is doing. `GET /api/v1/home` already
returns it.

### Two deviations from the reference, made deliberately

1. **No separate floating `+`.** Polarsteps floats an add button above its tab
   bar, where TripStash already floats Save. Two round buttons side by side is
   noise, so Save stays the global action and the inline `+` between stops
   handles the route.
2. **Plan/Today sits inside the sheet.** In the screenshot `Plan|Track` floats
   exactly where our tab bar goes. Stacking two floating pills does not work,
   and a segmented control belongs with the content it filters — which is also
   what the HIG says.

## Screens

| Screen | Carries |
| --- | --- |
| `Main` | **Home.** Route map, numbered stops, itinerary with live steppers, Plan/Today |
| `Explore` | The map zoomed out: globe, country pills, on-route markers, Discover/Saved |
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

On the trip map, stops carry their **number** instead, because order is the
information there.

**Filter chips** over the city map: All · Mine · Food · Stay · Views.
Necessary once a city holds 142 places.

**Route mode** hides everything that is not yours, numbers what remains in
walking order, draws the line, and offers to keep it as a day. This is the
bridge from a map of saved pins to an itinerary.

## The city layer

A country lists **cities**, never individual spots — a café should not be
ranked against a city. Each row carries both counts, the public one and yours:
`142 places · 6 of yours · 8 clips`.

Sorting is `Most places` or `Most saved by you`. Search filters live.

> **Resolved, and not the way this section assumed.** TripStash holds one
> traveller's library. There is no corpus of what anyone else saved, so a
> public count has nothing behind it and `142 places` would be inventing an
> audience. Every figure Explore and the country list show is counted from
> this install, the rows read `6 of yours`, and the list carries a line saying
> so outright. The inbox is excluded, because a queue is not a library.
> A public count still needs a provider; until there is one, this is the only
> number that is true.

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
| Night | `#060E1C` trip ground, `#06182B` map water, `#0A1C35` globe, `#0C1426` panels |
| Surface | `#FFFFFF`, grouped `#F4F5F8`, hairline `#E4E7EC` |
| Ink | `#0B1220` / `#5A6475` / `#737C8C` (all ≥ 4.5:1 on white) |
| Accent | `#0E7C5A`; transport legs `#E8663C` |
| Radii | 44 phone · 28 sheet · 20 card · 18 stop card · 16 field · pill controls |
| Spacing | 4-based; 16 px screen gutter, 20 px inside sheets |
| Tap targets | 44 px floor everywhere. The steppers are 36 px visually inside a 44 px row; the globe's flag pills keep a 36 px pill inside a 46 px hit area |

## What this costs to build

`web/src/styles/app.css` is largely rewritten, and most screens with it.

The API moves more than the first pass suggested, because the itinerary is now
the home screen:

- **Stops need nights.** `Destination` has `arrive_on` / `depart_on` but no
  night count and no derive-from-order rule. Changing one stop must shift the
  rest, which is a service, not a column.
- **Transport legs** need distance and duration between consecutive stops —
  a geographic estimate first, labelled as one.
- The city layer needs list and detail endpoints, and the map needs a category
  filter.

Clips, sources, evidence timestamps, the review queue and the home payload
already exist and are what the new screens are built to show.
