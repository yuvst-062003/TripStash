# Hyperframes Composition Brief: TripStash

## Objective
Create a short launch-style brag video for TripStash: "A backpacker's plan, read back as a map."

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: vertical — 1080x1920
- Duration: 20 seconds

## Source Material
- Project root: `~/Desktop/TripStash` (web/ is the PWA, api/ the FastAPI service)
- Primary files read: `web/src/pages/TripHome.tsx`, `web/src/components/CityCards.tsx`, `web/src/components/TripAdvice.tsx`, `web/src/styles/theme.css`, `README.md`, `docs/night-run.md`
- Product name: TripStash
- Tagline / strongest claim: a backpacker's plan, read back as a map; every claim carries its source; works offline; no paid API
- Key UI or visual moment to recreate: the real screens, captured at 3x from the local app with the demo trip, in `composition/assets/screens/`:
  - `trip-map.png` — the Trip screen: 20 numbered pins, dashed route, "Zoom out to Explore"
  - `trip-stops.png` — the itinerary: numbered stops, dates, nights steppers
  - `citycard-0.png`, `citycard-1.png`, `citycard-2.png` — Antigua, San Pedro La Laguna, Lanquín cards with photo, Hebrew sentence (RTL), nights badge, places count
  - `voices-group-0..3.png` — GRINGO, REDDIT TRAVELLERS, YOUTUBE TRAVELLERS, AROUND THE WEB, real results for the Antigua → San Pedro stretch
  - `check-card.png` — the Carnival trip check with "Stay 9 nights in Rio de Janeiro"
  - `../icon.svg` — the app icon
- Copy that must appear verbatim:
  - A backpacker's plan, / read back as a map.
  - 21 stops. 6 countries.
  - Mexico City to Rio Carnival. / Nov 7 2026 → Feb 16 2027
  - Every city carries your own sentence.
  - What travellers say about this stretch / Every claim with its source.
  - Notices you'd miss Carnival. Fixes it.
  - TripStash / Works offline. No paid API. / Found clips are never counted as yours.

## Creative Direction
- Tone preset: polished
- Creative direction: "A backpacker's plan, read back as a map."
- Interpretation: six quiet scenes, one line of copy at a time, soft crossfades, real phone screens; motion is the plan unfolding, never decoration.
- Angle: the plan becomes a route in front of you: whole trip, then stops with nights, then cities with the traveller's own sentence, then four named sources on one stretch, then the check that saves Carnival.
- Hook: the two-line headline, then the phone rising with the route map.
- Outro / punchline: TripStash. Works offline. No paid API. Found clips are never counted as yours.
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign
  - Any number not in the brief's allowed facts

## Visual Identity
- Background: #060e1c
- Text: #ffffff; secondary #b8c2d1
- Accent: #5fe3b1 (mint on night; the app's accent #0e7c5a is for white surfaces)
- Display font: Plus Jakarta Sans, local `assets/fonts/PlusJakartaSans-var.woff2`
- Body font: the same
- Visual references from the project: the night ground, green numbered pins, dashed route, rounded cards, pill buttons

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. Hook — 4.2s — two headline lines; the phone rises with the route map
2. The itinerary — 4.2s — screen swaps to the stops on the strong cue; slow pan; "21 stops. 6 countries." then "Mexico City to Rio Carnival." with the dates
3. Your own sentence — 3.2s — three city cards one by one on the beat grid
4. What travellers say — 3.7s — four source groups one by one; "Every claim with its source."
5. The trip check — 2.1s — the Carnival card; the fix button highlighted; "Notices you'd miss Carnival. Fixes it."
6. Outro — 2.6s — icon, TripStash, the two closing lines; music fades

## Audio
- Audio role: warm bed, sparse accents
- Audio arc: quiet bed from the first frame; accents land only with what moves; one bell on the name; fade to silence
- Music: `assets/music/bed.mp3` (vol-9, trimmed to 21s)
- Music treatment: volume ~0.5, fade to 0 over 18.5–20.0
- Music cue guidance: bundled preset for vol-9 (114.8 BPM). Strong cues used: 4.23 (screen swap), 6.34 (second caption), 12.65 (first source group). Beat grid: 8.44/8.96/9.50 (city cards), 12.65/13.18/13.70/14.22 (source groups), 15.28 (check card), 17.38 (wordmark)
- Audio-reactive treatment: subtle; the mint ground glow breathes with bass (`assets/music/audio-data.js`, extracted with the hyperframes-creative helper at 30 fps, 16 bands)
- Audio-coupled moments:
  - phone rise — drop
  - screen swap — select click
  - city cards — drop ×3 on the beat grid
  - source groups — drop ×4 on the beat grid
  - check card — soft impact
  - wordmark — bell
- SFX selection guidance: low high-frequency risk only (drops, select, impactSoft, impactBell); never on every beat
- SFX analysis guidance: `~/.claude/plugins/cache/brag/brag/0.2.2/skills/brag/assets/sfx/sfx-analysis.md`
- Exact SFX choice: `assets/sfx/interface/drop_001.ogg`, `drop_002.ogg`, `select_008.ogg`; `assets/sfx/impact/impactSoft_medium_000.ogg`, `impactBell_heavy_000.ogg`
- Audio files: copied into `brag-output/composition/assets/`

## Hyperframes Instructions
Standalone composition, one paused GSAP timeline registered as `window.__timelines["brag"]`, root `data-duration="20"`, `data-fps="30"`. Phone and card images are `<img>` assets; the phone and the card row are marked `data-layout-allow-overflow` because they deliberately run past the frame. Hebrew text is inside the captured screens, so direction is already right. Run `npx hyperframes check` before render.
