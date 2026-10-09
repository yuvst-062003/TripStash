# User tests

Every test below is run as a traveller would run it: on a phone-sized
screen (390 × 844), against a freshly seeded demo trip (Central America +
Brazil, 20 stops, 6 alternatives), unless the test says otherwise.

Status: ✅ passes · ❌ fails (with the fix noted) · ⚠️ works but noted · ⏭ not run (why)

The scripted half lives in `scripts/user_tests_api.py` (run it from `api/`
with the virtualenv against a fresh seed). The rest is run by hand or with a
browser driver at phone size.

## Findings so far (2026-10-09, night run)

Scripted run: 81 of 87 checks passed before, 89 of 89 after. Browser sections
2–14 were run with Playwright at 390 × 844, light and dark, every screen
screenshotted. Every ❌ found was fixed on `test-diagnosis`; the three
known defects first:

1. **A stop added from the app had no coordinates and no country** — fixed.
   The name is resolved on add: Wikivoyage first (coordinates from the
   article; the country from the ISO code on them when set, else the title
   "(Guatemala)", else the opening sentence), the gazetteer as fallback.
   Cartagena lands at 10.4, −75.5 in Colombia with a pin, legs and a fly-in.
2. **Visa answers from the guide carried no official warning** — fixed, and
   Wikivoyage's "Get in" (where visa rules live) now counts as the border
   section. Its subheadings ("Visa requirements") also stay inside their
   section; before, "Get in" was cut empty.
3. **"Nothing saved about Antigua yet"** — now "Nothing saved about safety in
   Antigua yet".

Found on the way and fixed (one line each): wrong password said the session
expired · "Is Antigua safe?" read the Caribbean island · a guide card
crashed the Ask sheet and blanked the app (no error boundary) · the Ask
sheet called a web page "a source you saved" · Hebrew questions sat on the
wrong edge · adding a stop after scrolling framed the map on empty jungle ·
no way to remove a stop · double-tap added two stops · a 160-character
name pushed the page sideways · a failed route load said "No stops yet" ·
the offline note hid under the map · Profile's sources link landed on the
wrong tab · back lost the country pane and the scroll position · the city
clips rail sat beside its heading · Russia's outline drew a line across
Explore · "not a url" was stored as a failed source · the image could not
read PDFs and Retry never re-read a plan · a PDF was read to the end (now
80 pages) · Inbox said Save/Ignore under "keep or pass" · a filtered
Knowledge tab said nothing was saved · untitled notes were blank in Sources
· the place map was a daylight tile at night · small controls were under
44 px · the map flew under reduced motion · React and Leaflet were in the
main bundle · 15 placeholder tiles were fetched on every cold load · three
console warnings on every load.

Second pass, by hand: C4 with a found clip that names a place (Acatenango
Volcano through Explore → Inbox → Keep), C3 and C7 with a 40 s clip saved at
0:20, V9 with three photos through the album picker, Q6's Dismiss in the
sheet, and I5 against the live search keys. Nothing is left as ⏭ or ⚠️.

Not a defect: the demo plan holds no videos, so Clips is empty until a
clip is saved, and found clips wait in the Inbox until kept.

## 1. Sign in and first run

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| A1 | Sign in | Email + demo password → Sign in | Lands on the Trip screen | ✅ |
| A2 | Wrong password | Sign in with a wrong password | Stays on sign-in, says the password is wrong, no crash | ✅ fixed: said "Your session expired"; now the server's "Invalid email or password." |
| A3 | Empty fields | Press Sign in with both empty | Fields are required; no request fires | ✅ |
| A4 | Create account | Create an account with a new email | Lands on New trip | ✅ scripted |
| A5 | New trip | Name a trip, no dates, create | Trip screen with "No stops yet" | ✅ scripted; "No stops yet" seen in the UI |
| A6 | Expired session | Remove the token and reload | Back at sign-in, not a blank screen | ✅ |

## 2. Trip (home)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| T1 | Route draws | Open Trip | 21 numbered pins, dashed line in travel order, map framed on the route | ✅ 20 pins (the seed has 20 stops), dashed line, framed |
| T2 | Labels readable | Look at the map zoomed out | No two stop names overlap; none run off screen; every pin numbered | ✅ 3 names visible zoomed out, none overlapping or off-screen |
| T3 | Press a pin | Tap a stop pin | Camera flies into that country; sheet shows the country's cities | ✅ |
| T4 | Press a country | Tap a route country's outline | Same as T3 | ✅ |
| T5 | Whole trip | Press "Whole trip" | Camera flies back out; itinerary returns | ✅ |
| T6 | City cards | Inside a country | One card per city: photo from the plan (or initial), own sentence (RTL), nights badge, places count | ✅ photo or initial, Hebrew sentence RTL, nights badge, places count |
| T7 | Card → city | Tap a city card | Opens that City screen | ✅ |
| T8 | Summary line | Top of the itinerary | Stops, nights, start, end match the data | ✅ |
| T9 | Nights + | Press + on a stop | That stop's nights +1; every later date shifts by a day; end date moves | ✅ |
| T10 | Nights − to 0 | Press − until 0 | Allowed; − disables at 0; stop keeps its position | ✅ |
| T11 | Undecided nights | A stop with "Nights?" | Dates after it read "Dates follow the nights above it"; chip says "No end date" | ✅ |
| T12 | Add stop mid-route | + between two stops → type a name → Add | New stop lands between them, numbered, dates re-derived | ✅ fixed: adding after scrolling the sheet framed the camera on empty jungle |
| T13 | Add stop at end | "Where next?" + → name → Add | Appended as last stop | ✅ |
| T14 | Add stop: empty | Press Add with empty field | Button disabled; nothing added | ✅ |
| T15 | Add stop: Escape | Open +, press Escape | Form closes, nothing added | ✅ |
| T16 | Suggestions | Open + | Cities from your library not on the route, cheapest detour first; Add adds it; X hides it; nothing added by X | ✅ seed has every library city on the route; verified with Oaxaca removed: 65 km detour, Add, Dismiss persists per device |
| T17 | Travellers say | Open + | Four groups (Gringo, Reddit, YouTube, web) with snippets + links; "not connected" for any missing key | ✅ "Not connected yet" locally; all four live (see live proofs) |
| T18 | Ask about route | Press "Ask about your route" | Ask sheet opens with the route as context | ✅ |
| T19 | Trip check | Top of itinerary | Long legs and missed events flagged; a fix button when there is one; Dismiss hides it and stays hidden after reload | ✅ |
| T20 | Trip check fix | Press "Stay N nights" | Nights change; the check disappears | ✅ "Stay 9 nights" → 9 nights, check gone |
| T21 | Ideas per stop | Press "Ideas for X" | What you stashed there, ranked; tap → Place page | ✅ |
| T22 | Set aside | "Set aside as alternative" | Stop leaves the route; appears under Alternatives; summary and dates update | ✅ |
| T23 | Put back | "Put back on the route" | Returns at its position with its nights | ✅ |
| T24 | Plan / Today | Switch to Today | Date, where you are, planned count, spent today; no crash without location | ✅ |
| T25 | Avatar → Profile | Tap the avatar | Profile opens | ✅ |
| T26 | Zoom out → Explore | Press the pill | Explore opens | ✅ |
| T27 | Offline map | Block tiles | Country outlines still drawn; note says street detail is missing | ✅ |

## 3. Explore

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| E1 | Countries list | Open Explore | 6 countries, on-route tags, place counts; map highlights them | ✅ fixed: Russia's and Fiji's outlines drew a line across the map |
| E2 | Search → ask | Type "Colombia" → Look | Two questions: how long, what for; picks pre-filled from Profile | ✅ |
| E3 | Search → read | Answer and carry on | Reads; shows a note of what it found; lists found clips marked "found"; "Ask about Colombia" | ✅ |
| E4 | Search → skip | Skip | Same as E3 without answers | ✅ |
| E5 | Search: empty | Press Look with nothing typed | Disabled | ✅ |
| E6 | Search: Hebrew | Type "קולומביה" | Works; no crash | ✅ |
| E7 | Country page | Tap Guatemala | Hero with counts, city cards (photo + sentence), search, sort chips, city rows | ✅ |
| E8 | Country: search | Type "ant" in the field | Rows filter live | ✅ no requests while typing |
| E9 | Country: sort | Switch sorts | Order changes; no reload flash | ✅ one request per sort, rows stay put |
| E10 | Country: empty | Open a country with nothing | Honest empty state, no error | ✅ Colombia with zero places |
| E11 | City page | Tap Antigua | Clips rail (yours vs found marked), map with chips, places, Good to know | ✅ fixed: the clips rail sat beside its heading |
| E12 | City chips | Mine / Food / Stay / Views | Pins and list filter; "All" restores | ✅ |
| E13 | City route mode | If present | Numbers your places in walking order | ✅ 3 stops · 16.8 km |
| E14 | Back navigation | ← on each page | Returns to the previous level, scroll kept | ✅ fixed: scroll position is now restored on back |

## 4. Clips and video sections

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| C1 | Clips list | Open Clips | Spots grouped by place; yours / found counts | ✅ empty state in the seed; grouped by city once a clip is kept |
| C2 | Open feed | Tap a spot | Full-screen feed; tab bar hidden | ✅ |
| C3 | Sections | Feed with a saved clip | Opens at the saved second; the section scrub bar shows; scrolling snaps one clip at a time | ✅ a 40 s clip saved at 0:20 opens at its section (17.5–32.5), the section bar shows, a 60 % swipe snaps to exactly one clip |
| C4 | Found in feed | A found clip | Says "Found, not yours" | ✅ a found Acatenango clip kept from the Inbox reads "Found, not yours — keep it from Saved → Inbox"; Clips counts it as 1 found, 0 yours |
| C5 | Link-only clip | A clip with no file | Shows the quote and a link out; no broken player | ✅ |
| C6 | Close feed | ← or swipe | Back to where you were | ✅ |
| C7 | Whole video | "Play whole video" | Plays from 0 | ✅ "Whole video" plays from 0 and the chip reads "Saved section" |

## 5. Saved

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| S1 | By activity | Open Saved | Waiting banner on top; chips; groups with counts across countries | ✅ |
| S2 | Chip filter | Tap a chip | Only that group; "All N" restores | ✅ |
| S3 | Inbox | Banner → Inbox | Candidates with quotes; Keep / Pass | ✅ fixed: buttons said Save/Ignore under a banner that said keep or pass |
| S4 | Keep | Keep a place candidate | Appears in Places and on the map | ✅ |
| S5 | Pass | Pass on one | Gone from Inbox; not in Places | ✅ |
| S6 | Places | Places tab | Rows with status, meta, reason | ✅ |
| S7 | Knowledge | Knowledge tab | Typed items, sources, border warning on visa items | ✅ the seed holds no Entry items; the warning line is pinned by pytest. Fixed: filtered empty state said "No saved knowledge yet" |
| S8 | Sources | Sources tab | Every source; failed ones offer Retry; Delete asks first | ✅ fixed: Retry re-reads a plan file; an untitled note is named by its excerpt |

## 6. Place

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| P1 | Open | Tap a place | Real map header with coordinates, why you saved it, sources, facts | ✅ |
| P2 | Status | Change status | Saves; reflected in Saved and map | ✅ |
| P3 | Ask here | Ask on a place | Answer scoped to it | ✅ |
| P4 | Missing place | /places/nope | 404 handled, not a blank page | ✅ "Place not found in this trip" with Retry; no back control on that screen |

## 7. Save

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| V1 | Link | Paste a link + caption → Save | Source created; goes to Inbox | ✅ |
| V2 | Link: invalid | "not a url" | Clear error | ✅ browser says "Please enter a URL"; fixed: the server now refuses too instead of storing a failed source |
| V3 | Upload plan .docx | Upload a Word plan | Candidates appear in Inbox with their line | ✅ |
| V4 | Upload plan .pdf | Upload a PDF | Same | ✅ fixed: the image lacked the PDF reader, and Retry never re-read the file |
| V5 | Upload page .html | Upload a saved page | Same; never served back as HTML | ✅ served as text/plain, nosniff |
| V6 | Upload: wrong type | A .exe | Refused with a reason | ✅ |
| V7 | Note | Write a note | Knowledge item created | ✅ |
| V8 | Place by name | Add a place by name | Resolved or left for review | ✅ left for review when there is no location |
| V9 | Album sync | Select photos | Only new ones uploaded | ✅ 2 photos → 2 uploads; the same 2 plus 1 new → "2 already saved · 1 new", 1 upload |

## 8. Ask (the assistant)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| Q1 | Saved answer | "Is Antigua safe?" | Answers from your notes with citations | ✅ fixed twice: read the Caribbean Antigua, and said "Nothing saved about Antigua" |
| Q2 | Short name | "Is Rio safe?" | Finds Rio de Janeiro notes | ✅ |
| Q3 | Nothing saved | "What about Bogotá?" | Reads Wikivoyage / web; says so; cites | ✅ Wikivoyage, says so, cites |
| Q4 | Proposal | A question that yields "add to today" | One card with Add / Dismiss; nothing changes until Add | ✅ scripted with a practical question about a place |
| Q5 | Add | Press Add | Itinerary item created; second press is not a duplicate | ✅ scripted; second Add is the same item |
| Q6 | Dismiss | Press Dismiss | Nothing recorded | ✅ Dismiss removed the card; the itinerary stayed at 0 items |
| Q7 | Visa question | "Do I need a visa for Brazil?" | Official-verification warning | ✅ fixed |
| Q8 | Empty | Send nothing | Disabled | ✅ |
| Q9 | Hebrew | Ask in Hebrew | Answers; RTL renders | ✅ fixed: the question box and answer now read right to left |

## 9. Profile

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| R1 | Picks | Toggle picks | Saved; Explore pre-fills them | ✅ |
| R2 | Sources link | Tap | Goes to Saved → Sources | ✅ fixed: landed on the first tab |
| R3 | Sign out | Press | Back at sign-in; token cleared | ✅ |

## 10. Adding a country

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| N1 | Add a stop in a new country | + at end → "Cartagena" | Stop added; country resolved | ✅ fixed: resolved to 10.4, −75.5, Colombia |
| N2 | Map | Trip map | New country outlined as on-route; pin placed; line extends | ✅ |
| N3 | Explore | Open Explore | New country listed (if it has a place) or not — honest either way | ✅ not listed with zero places, honestly |
| N4 | Country page | /explore/Colombia | Opens; no error with zero places | ✅ |
| N5 | Fly in | Tap the new pin | Flies to it; sheet shows it | ✅ |
| N6 | Trip check | Back on Trip | Long leg flagged; nights missing flagged | ✅ "5,126 km to Cartagena" and "Cartagena has no nights yet" |
| N7 | Remove it | Delete the stop | Route and dates return to before | ✅ fixed: there was no way to remove a stop in the app |
| N8 | Unknown name | Add "Xyzzyville" | Added with no coordinates; map and legs cope (no crash) | ✅ added unplaced; "Distance unknown" |

## 11. Input, errors and edge cases

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| X1 | 500 from API | Simulate | Error note with Retry, not a blank page | ✅ fixed: a failed route load said "No stops yet"; a rendering crash blanked the app (now an error boundary) |
| X2 | Offline | Go offline | Banner; cached screens still show | ✅ fixed: the banner sat under the trip's map |
| X3 | Long names | 160-char stop name | Clamped, no layout break | ✅ fixed: wrapped to 14 lines and pushed the page sideways |
| X4 | Hebrew everywhere | Hebrew stop name and note | RTL correct in list, card, map label | ✅ fixed: names and pin labels follow their own direction |
| X5 | 401 mid-session | Token removed | Redirect to sign-in | ✅ |
| X6 | Other user's data | Another account's place id | 404, not data | ✅ scripted |
| X7 | Double submit | Double-tap Add | One stop | ✅ fixed: two taps added two stops |
| X8 | Nights > 365 | Press + past 365 | Refused with a message | ✅ scripted: 422 with the limit |

## 12. Design (phone)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| D1 | No horizontal scroll | Every screen | Page never scrolls sideways | ✅ every screen, after the X3 fix |
| D2 | Tab bar | Every screen | Pill + Save circle never cover content you need; content has bottom padding | ✅ |
| D3 | Tap targets | Buttons, chips | ≥ 44 px | ✅ fixed: small controls grow a 44 px hit area |
| D4 | Text clipping | Cards, buttons, labels | Nothing cut off | ✅ after the long-name fix |
| D5 | Dark mode | prefers-color-scheme: dark | Every screen readable; tokens applied | ✅ fixed: the place header map was a daylight tile at night |
| D6 | RTL | Hebrew content | Direction right, punctuation right | ✅ after the direction fixes |
| D7 | Images | Broken photo URL | Falls back to initial, no broken icon | ✅ |
| D8 | Reduced motion | prefers-reduced-motion | No flights/animations that hurt | ✅ fixed: the map cuts instead of flying |
| D9 | Empty states | Fresh account | Every screen has a sentence, not a blank | ✅ |
| D10 | Loading | Slow network | Skeletons, not jumps | ✅ |

## 13. Efficiency

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| F1 | Bundle | Build | Main bundle size noted; big libs split | ✅ fixed: React and Leaflet split out; main 249 kB (73 kB gzip) |
| F2 | First load | Cold load of / | Under ~3 s on local | ✅ load event at 46 ms locally |
| F3 | API latency | /route, /explore/countries, /home, /places | Each under 300 ms locally | ✅ scripted, all under 10 ms |
| F4 | Discover | /discover with all sources | Under the slowest source (parallel), not the sum | ✅ parallel by design; 1 ms with fakes |
| F5 | Requests per screen | Trip screen | No repeated calls on every render | ✅ 2–4 calls per screen, none repeated |
| F6 | Map tiles | Trip | Tiles cached; no refetch on sheet change | ✅ fixed: 15 placeholder tiles fetched before the route framed |
| F7 | Service worker | Deploy a new build | Old clients get the new shell on next load | ✅ network-first shell |

## 14. AI results quality

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| I1 | Grounded | Any answer | Every claim has a source; no invented place | ✅ fixed: a stop is looked up with its country |
| I2 | Found vs yours | Any count | Found never counted as yours | ✅ fixed: the Ask sheet called a web page "a source you saved" |
| I3 | Trip check | Demo trip | Carnival flagged correctly; fix is right | ✅ |
| I4 | Suggestions | + after Antigua | Sensible, nearest first | ✅ Oaxaca, 65 km |
| I5 | Voices relevant | + between Antigua and San Pedro | Results are about that stretch | ✅ with the live keys: Gringo tips on Antigua, Reddit "Travel from Antigua to San Pedro La Laguna", YouTube on Lake Atitlán, web minivan tickets Antigua ↔ San Pedro |
| I6 | Explore read | "Colombia", hiking | Found clips are about Colombia hiking | ✅ with fakes |
