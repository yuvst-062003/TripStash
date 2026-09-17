# Design — "Stamped"

TripStash is opened one-handed on a bus, but it is also the record of a
trip someone will remember for years. The interface is built on one idea
that holds both: **every save is a stamp**. A long overland trip is a passport
filling up, and here every confirmed place, every status and every category
is drawn as a rubber stamp — an inked ring, a slight tilt, a word set inside
it. Approving something in Inbox is the one choreographed moment in the app:
the stamp drops onto the card, with a haptic tick where the platform allows.

The trust rules the product is built on are unchanged: nothing reaches the
map unconfirmed, every claim carries its evidence, status is always an icon
and a word before it is a colour, and the assistant only proposes.

## Rules

**One typeface, pushed to its extremes.** Bricolage Grotesque, self-hosted
(131 KB, latin, three variable axes) so the PWA keeps its type offline. It is
set poster-wide and heavy for the one line that matters on a screen — the
place you are, the trip you are on — and compact and quiet in every row.
No second family, no monospace, no all-caps labels outside the stamp ring.

**The map is the imagery.** The traveller rarely supplies a photo, and
generated cover art is decoration pretending to be content. The place page
header is the real map of the coordinates, tinted into the palette; the
sign-in page and the trip's journey card carry the Earth itself — NASA's Blue
Marble on a three.js sphere, lit by one sun, with the traveller's own pins and
the route drawn as a raised ribbon between stops. Nothing is invented.

**Colour is a bright map's colour.** Mint-white paper, deep pine ink, a
saturated teal for everything you can press, sky blue for getting around.
One hot coral is reserved for what must not be missed — the *must visit*
status, the Save button, the current stop on the globe. Stamp-pad gold marks
what is happening today: weather, resurfaced items, the evidence quote.
Category tiles are tinted so food, stays, nature and views read before the
icon does. The two places that show the Earth are the only dark surfaces:
a planet needs a night sky.

**Motion answers a tap.** Springs, never durations longer than 400 ms. Route
changes cross-fade and rise; the tab pill slides; sheets are real drawers
with drag physics and snap points; money rolls digit by digit; the assistant's
answer arrives a word at a time. Lists stagger in once and then stay put.
Under `prefers-reduced-motion` every spring collapses to an instant change and
the globe holds still.

**Stamps mean one thing.** A stamp is a status, a category, a moment of
confirmation, or the mark. Nothing else may look like one. Filters and
toggles are chips; a stamp is never a button except in the status picker,
where pressing one is exactly "stamping" the place.

**Exception reporting.** A fact checked five minutes ago is the expected
case, so it is quiet grey text; only an ageing or stale value gets an amber
stamp. A confidence score is a slim bar, not a badge.

## The mark

A folded paper map whose first panel is a video frame with a play button. A
dashed route runs from that play button across the map to a coral pin: what
you watched, turned into a place on your own map — from content to plan. On
sign-in it animates in that order: the map unfolds, the play button appears,
the route is drawn, the pin drops in with the stamp spring.

## Structure

| Screen | Pattern |
| --- | --- |
| Sign in | Night sky. A small Earth turns alone in the middle of the page, then swells into place beneath the wordmark as the glass form rises over its lower half |
| Home | Editorial hero: the destination as the headline, day and weather beneath. Then the review-queue card, a timeline for today, a rail of tall cards for what has been brought back, the money card with a budget arc |
| Map | Full-bleed tinted tiles, glass search bar, stamp pins tinted by status, a draggable sheet that peeks, halves and fills — sized to content when one place is selected |
| Saved | Segmented control over Inbox, Places, Knowledge, Sources. Inbox cards carry the type stamp, the evidence quote in gold, a confidence bar, and the stamp-approve action |
| Place | Real map header tinted into the paper with the place name overlapping its edge and the status stamp at the corner; a compact bar fades in as the title scrolls away |
| Trip | The trip name as the headline, then the journey card — the route on the Earth with where you are now or the days to go — a numbered stepper for the route, a timeline for the day plan, money mirrored from Home |
| Journey | The Earth full screen. Adding a city sends a small plane along the new leg while the globe turns to follow it; tapping a stop opens what you stashed for it — must-visits, the next event, warnings first — and "I'm here now" |
| Ask | Drawer: input first, context chips, the answer revealed word by word, typed result rows |
| Save | Drawer, segmented by what you are capturing — link, media, note, event, here; success shows the *Stashed* stamp landing. An event carries its dates and comes back to Home as they near |

Ask lives in each screen's header rather than on a floating button, so the
assistant sits next to the context it inherits. Save is the one floating
action, in coral, because capture is the highest-frequency thing the product
does.

## Borrowed from GitHub

- [`motion`](https://github.com/motiondivision/motion) — springs, layout animation, presence
- [`vaul`](https://github.com/emilkowalski/vaul) — the drawers
- [`three`](https://github.com/mrdoob/three.js) — the Earth on sign-in and the journey card, with NASA's Blue Marble texture via [`three-globe`](https://github.com/vasturiano/three-globe); loaded lazily
- [`d3-geo`](https://github.com/d3/d3-geo) + [`world-atlas`](https://github.com/topojson/world-atlas) — the vector globe that stands in while the Earth loads
- [`@number-flow/react`](https://github.com/barvian/number-flow) — the rolling money figures
- [`pqoqubbw/icons`](https://github.com/pqoqubbw/icons) — animated Lucide icons (tab bar, Ask, Save, approve), copied under MIT into `web/src/components/motion/`

## Numbers that must stay honest

Walking estimates are suppressed beyond 8 km and replaced by a distance
(`app/services/spatial.py`). "1814 min walk" is not information.

A title that is only a truncation of the sentence beneath it is collapsed into
one line (`pairText` in `web/src/components/ui.tsx`), so a card never says the
same thing three times.

## Accessibility

Minimum 44 px targets, visible focus rings on every control, a full list
alternative to the map, `prefers-reduced-motion` honoured everywhere including
the globe, both colour schemes supported, and status meaning never dependent
on hue.
