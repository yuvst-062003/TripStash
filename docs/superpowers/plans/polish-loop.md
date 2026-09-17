# Polish loop — GOAP plan and checklist

**Goal:** every screen reviewed by three specialised sub-agents (visual design,
motion & interaction, UX/copy/correctness), blocker + should findings applied,
re-captured light + dark at 390×844, committed on `redesign`; lint/build and
API tests green; screenshots refreshed; pushed and deployed.

**Current state (2026-09-17):** `redesign` at `a7b2091`, live at
https://app-production-f91d.up.railway.app. Local: API :8010, web :5176, demo DB
re-seeded with one upcoming event (Semana Santa, Antigua, in 9 days).

**Plan cost:** 12 screen tasks + 1 cross-cutting task; 3 reviewers each;
sequential fixes so the working tree stays coherent.

**Risk factors:** a fix breaks lint/build or another screen → revert, log,
replan; captures fail → restart the dev server by PID, retry once; deploy fails
→ report, don't loop.

**Fallback:** reviews sequential with the Agent tool if parallel dispatch fails.

## Checklist

| # | Screen | Status | Findings (A/B/C → applied) | Commit |
| --- | --- | --- | --- | --- |
| 0 | Cross-cutting (tokens, shared components) | done | 401 rewrite, 422 text, btn hover/press/busy, code font | a0f58b7 |
| 1 | Sign in | done | A 8 / B 8 / C 8 → 20 applied, 2 skipped (drag momentum, shared-layout wordmark) | 4036cbb |
| 2 | Home | done | A 8 / B 8 / C 8 → 22 applied, 2 skipped (skeleton shape partly; nothing else) | b05e01e |
| 3 | Map | done | A 8 / B 8 / C 8 → 22 applied, 2 skipped (sheet height→transform refactor; row/pin parity beyond select) | d40b0d7 |
| 4 | Saved (tabs) | done | A 8 / B 4 / C 8 → 18 applied, 2 skipped (API failure copy; drop Places tab) | a66c7d7 |
| 5 | Inbox review card | done | A 8 / B 4 / C 8 → 18 applied, 2 skipped (Ignore undo endpoint; stagger cap in MotionRow) | a66c7d7 |
| 6 | Place | done | A 8 / B 8 / C 8 → 23 applied, 1 skipped (a visit sheet with date + rating) | (this commit) |
| 7 | Trip | pending | | |
| 8 | Journey | pending | | |
| 9 | Ask drawer | pending | | |
| 10 | Save drawer | pending | | |
| 11 | You / profile | pending | | |
| 12 | New trip + empty states | pending | | |

## Trajectory

- Step 0: plan written; servers up; demo DB re-seeded.
- Step 1 (cross-cutting): reviewers proved a 401 rewrite bug on sign-in (any 401 → "session expired"); fixed in api.ts with a test-by-hand (wrong password now reads "Wrong email or password."). Commit a0f58b7.
- Step 3 (home): API — a stand-in origin (destination centre) no longer produces "from you" distances; resurfaced cards deduped; test added. Web — cold-load entrance vs tab-switch slide was inverted by `initial={false}` on AnimatePresence (Motion memoises presence context): fixed with a module-level cold flag; back-navigation now slides the right way (custom variants); `on` sent as the local date; deep links to Trip sections; queue card quiet (plain card, title-size numeral, muted/warn stamp); hero washes removed; money card on teal-deep with AA text; gold glyph readable in dark; `--ink-3`/`--tint-view` darkened for AA; rail cards equal height, foot only when it has content; section rhythm fixed; press feedback on card links; skeleton held 150 ms and cached payload on return; FAB lifts by transform; rain in the weather chip; chip is a full tap target; footer is a sentence that links to Saved. Side note: a reviewer's itinerary test flipped one demo place to "planned" (planner only promotes) — demo DB will be re-seeded before final captures; the non-reverting promotion goes to the Trip review.
- Step 4 (map): blocker from all three — the sheet's inline height was never released after a pin tap, clipping the recall card and hiding Navigate under the tab bar. Rewrote MapScreen: one MotionValue drives both list and content-sized card (measured by ResizeObserver, capped at 60vh); markers kept by id (no re-mount on tap/filter/keystroke; drop-in only on first draw); 44px hit areas; status badge icons and a solid coral must-visit disc; favourite ring readable on light tiles; overlapping pins cluster into a count pin that zooms; locate button flies to you and shows a note when denied; honest titles/empty states for search vs filters vs loading; markers and the close button accessible; row tap opens the card like the pin. API: navigation handoff no longer forces walking mode for places beyond walking range. CSS: FAB/locate/attribution follow the sheet via `translate` (motion's whileTap owns `transform`), no transition while the sheet is live; tint pane pulls tiles into the palette (multiply light / lighten dark); ring pulse plays twice; reduced motion also zeroes animation delays.
- Step 2 (sign in): scene no longer rebuilds at landing (spin via ref); no drop-shadow/backdrop-blur over the live canvas; pixel ratio capped 1.5; intro 1.1 s, skipped for returning users, tap to skip; CTA dark-on-teal (AA); space palette now overrides danger/warn; error slot reserved with role=alert and aria-invalid; busy button breathes; dev-only demo hint; email remembered; logo compressed to 0.85 s and starts after the form lands; drag works under reduced motion. Verified: one canvas, intro skipped on return, error text correct in both schemes.
- Step 5 (saved + inbox, one commit): API — three bugs proven live by reviewer C, each now under test: a source never settled to "completed" (the decided candidate was not flushed before the pending check); an edit on a tip changed only the shortened title, and an edited place name was discarded (card now edits what is shown, sends `override_name`, and the candidate remembers `user_edited`); a note typed on a tip was silently dropped (now appended under the claim, item marked yours); duplicates now name the place they match. Web — review card: the creator's sentence *is* the headline (gold lead quote with "— from the article / your note / caption at 1:24"), edit and note are toggles beside the stamp, one decision row (Stamp / Ignore), stamp lands "Pinned" for a place and "Saved" for a tip, in-place editor with the headline's metrics, note opens by grid track; exit keys unified so the card actually fades before the list reloads, tick lands with the stamp (170 ms), hold 700 ms, exits ease-in; groups by source (headers are the video/article, the stamp says the type), section and card exits animate with popLayout, ignore no longer widens the page. Saved shell: panes slide along the segmented axis with tweens (no 240 ms blank), each view staggers once then is cached (`useAsync` cacheKey), Inbox tab carries the queue count, real tabs (roving tabindex, arrows, tabpanel), `?tab=` and `?source=` deep links. Places: "saved" stamp gone (only exceptions get one), meta = city · walk · sources>1, search debounced with clear button and an honest "Nothing named …" state. Knowledge: stamp-then-headline rows, provenance and dates in words, "Stay" filter added, events in date order with past ones dimmed, archive with 5 s Undo and an "Archived" chip to get things back. Sources: unexpected states only (Failed / Processing / "N to review" → Inbox filtered by that source), never-blank names, honest delete confirm built from the row, Retry for failed and empty captures, quiet text-only Delete. Tokens: AA gradient/teal/coral inks in light, dark toggle gets `--gold`, stamp-sm 10px, confidence track visible, reduced motion keeps a 150 ms fade and haptics. Skipped: API failure-reason copy (not proven live; next pass), Ignore-undo needs a restore endpoint, dropping the Places tab, an 8-row stagger cap inside MotionRow.
- Step 6 (place): cross-cutting motion bugs proven by reviewer B — the entering page never slid (`custom` on AnimatePresence reaches only the exit; the page now carries its own) and the browser restored scroll under the page still leaving (restoration is manual now; App scrolls after the exit, to 0 on push and to the remembered offset on pop). Place: a fixed bar whose glass and title fade in while the big title fades out, with a Back that is always live (deep links go to Saved → Places instead of out of the app; a 404 gets its own "Gone" state); the status picker is the screen's one moment — local state answers the tap, the corner stamp lands with the tick, only the pressed stamp is busy, five stamps in two rows; failed writes no longer lock the page (try/finally, optimistic revert, honest note); "Add to today" is a named toggle ("In today's plan") that uses the local date, tells you where it went and reverts the promotion when the last row leaves; "Visited" records a visit so the record agrees with the stamp; the reason is said once with its author instead of twice in gold; live facts have labels, pressable website/phone, "$$ · mid-range", provenance in words, the adapter name gone, fresh in the grey line and only ageing stamped; weather is the gold line; naive UTC timestamps parsed as UTC ("checked 30 min ago", not "3 h"); category, address and dates in words, coordinates moved to a copy row; the hero map is tinted like the big map (shared helper); favourite is glass, optimistic, no transform fight; parallax and bar slide off under reduced motion; skeleton shaped like the page and held 150 ms; filled stamp text white in light. Skipped: a "When did you go?" sheet with rating (Trip/visits pass).
