# Design

TripStash is a tool someone opens one-handed on a bus, not a brochure. The
interface follows the conventions people already read fluently in map and
transit apps, and the design decisions below are mostly about what was left
out.

## Rules

**No invented imagery.** The traveller rarely supplies a photo, and generated
gradient "cover art" is decoration pretending to be content — it makes a tool
look unreliable. Where an image genuinely helps, the honest one is the map: the
place page header is a real, non-interactive map of the coordinates, captioned
with them so it degrades to something useful when tiles cannot load.

**One typeface.** Plus Jakarta Sans, self-hosted (27 KB, latin subset) so the
PWA keeps its typography offline. A display serif would be decoration; map apps
use a single grotesque because it is legible at a glance in sunlight.

**Metadata is text, not chips.** `viewpoint · Antigua · 9 min walk · 1 source`
reads faster and takes a third of the space of four pills. Pills mean one
thing here: a filter or a selection you can toggle.

**Lists, not floating cards.** Content is edge-to-edge rows separated by
hairlines. A card is reserved for something that really is a discrete object —
one extraction awaiting a decision.

**One accent.** A single green appears on primary buttons, the selected state,
and verified signals. Everything else is ink, grey and a hairline. Status
colours are muted on purpose and never carry meaning alone: every status has an
icon and a word (specification 12.1).

**Exception reporting.** A fact checked five minutes ago is the expected case,
so it is quiet grey text; only an ageing or stale value is called out in
amber. A column of identical green "fresh" badges hides the one row that
actually needs attention.

**Icons from a real set.** Lucide, inherited colour and stroke weight. Emoji
render differently on every platform, cannot inherit colour, and read as
placeholder art.

## Structure

| Screen | Pattern |
| --- | --- |
| Home | Title bar, then a stack of lists: review queue, today, resurfaced items, money |
| Map | Full-bleed map, floating search, a draggable sheet that peeks, halves and fills — sized to content when one place is selected |
| Saved | Underline tabs over four lists: Inbox, Places, Knowledge, Sources |
| Place | Real map header, title and metadata, then sectioned lists |
| Ask | Bottom sheet: input first, context pills under it, answer and typed result rows |
| Save | Bottom sheet, tabbed by what you are capturing |

Ask lives in each screen's title bar rather than on a floating button, so the
assistant sits next to the context it inherits. Save is the one floating
action, because capture is the highest-frequency thing the product does.

## Numbers that must stay honest

Walking estimates are suppressed beyond 8 km and replaced by a distance
(`app/services/spatial.py`). "1814 min walk" is not information.

A title that is only a truncation of the sentence beneath it is collapsed into
one line (`pairText` in `web/src/components/ui.tsx`), so a card never says the
same thing three times.

## Accessibility

Minimum 44 px targets, visible focus rings on every control, a full list
alternative to the map, `prefers-reduced-motion` honoured, both colour schemes
supported, and status meaning never dependent on hue.
