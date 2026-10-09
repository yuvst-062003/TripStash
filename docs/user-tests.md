# User tests

Every test below is run as a traveller would run it: on a phone-sized
screen (390 × 844), against a freshly seeded demo trip (Central America +
Brazil, 20 stops, 6 alternatives), unless the test says otherwise.

Status: ✅ passes · ❌ fails (with the fix noted) · ⚠️ works but noted · ⏭ not run (why)

The scripted half lives in `scripts/user_tests_api.py` (run it from `api/`
with the virtualenv against a fresh seed). The rest is run by hand or with a
browser driver at phone size.

## Findings so far (2026-10-09, first run)

Scripted run: 80 of 87 checks pass. Three failures were the script's own
mistakes and are fixed in it. The real defects, none fixed yet:

1. **A stop added from the app has no coordinates and no country.**
   `POST /trips/current/destinations` stores whatever lat/lon it is sent, and
   the trip screen's `+` sends only a name. So the new stop gets no pin, no
   legs ("Distance unknown"), cannot be flown into, and never reaches a country
   page. Fix: when lat/lon are missing, resolve the name — Wikivoyage already
   returns coordinates (`prop=coordinates`; add `coprop=country` for the ISO
   country code), with the gazetteer as a fallback — and store lat, lon and
   country. (Tests N1, N2, N5, N6.)
2. **A visa or border question answered from the guide carries no
   official-verification warning.** `_answer_knowledge_type` hands the border
   intent to `_answer_from_the_web`, which never adds `OFFICIAL_NOTE`. Also
   Wikivoyage keeps visa rules under "Get in", which maps to TRANSPORT, so the
   guide says it "has nothing on border". Fix: add `OFFICIAL_NOTE` for the
   border intent whatever the source, and let "get in" count as the border
   section. (Test Q7.)
3. **"Nothing saved about Antigua yet"** is said when the trip has plenty saved
   about Antigua but nothing on the topic asked (safety). It should say
   "Nothing saved about safety in Antigua yet". (Tests Q1, Q2; wording in
   `_answer_from_the_web`.)

Not a defect: the demo plan holds no videos, so Clips is empty (C3) until a
clip is saved, and found clips wait in the Inbox until kept — `tests/test_finding.py`
pins that. Check the empty states say so (C1, D9).

Browser-run sections (2–7, 12) have not been run yet.

## 1. Sign in and first run

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| A1 | Sign in | Email + demo password → Sign in | Lands on the Trip screen | |
| A2 | Wrong password | Sign in with a wrong password | Stays on sign-in, says the password is wrong, no crash | |
| A3 | Empty fields | Press Sign in with both empty | Fields are required; no request fires | |
| A4 | Create account | Create an account with a new email | Lands on New trip | |
| A5 | New trip | Name a trip, no dates, create | Trip screen with "No stops yet" | |
| A6 | Expired session | Remove the token and reload | Back at sign-in, not a blank screen | |

## 2. Trip (home)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| T1 | Route draws | Open Trip | 21 numbered pins, dashed line in travel order, map framed on the route | |
| T2 | Labels readable | Look at the map zoomed out | No two stop names overlap; none run off screen; every pin numbered | |
| T3 | Press a pin | Tap a stop pin | Camera flies into that country; sheet shows the country's cities | |
| T4 | Press a country | Tap a route country's outline | Same as T3 | |
| T5 | Whole trip | Press "Whole trip" | Camera flies back out; itinerary returns | |
| T6 | City cards | Inside a country | One card per city: photo from the plan (or initial), own sentence (RTL), nights badge, places count | |
| T7 | Card → city | Tap a city card | Opens that City screen | |
| T8 | Summary line | Top of the itinerary | Stops, nights, start, end match the data | |
| T9 | Nights + | Press + on a stop | That stop's nights +1; every later date shifts by a day; end date moves | |
| T10 | Nights − to 0 | Press − until 0 | Allowed; − disables at 0; stop keeps its position | |
| T11 | Undecided nights | A stop with "Nights?" | Dates after it read "Dates follow the nights above it"; chip says "No end date" | |
| T12 | Add stop mid-route | + between two stops → type a name → Add | New stop lands between them, numbered, dates re-derived | |
| T13 | Add stop at end | "Where next?" + → name → Add | Appended as last stop | |
| T14 | Add stop: empty | Press Add with empty field | Button disabled; nothing added | |
| T15 | Add stop: Escape | Open +, press Escape | Form closes, nothing added | |
| T16 | Suggestions | Open + | Cities from your library not on the route, cheapest detour first; Add adds it; X hides it; nothing added by X | |
| T17 | Travellers say | Open + | Four groups (Gringo, Reddit, YouTube, web) with snippets + links; "not connected" for any missing key | |
| T18 | Ask about route | Press "Ask about your route" | Ask sheet opens with the route as context | |
| T19 | Trip check | Top of itinerary | Long legs and missed events flagged; a fix button when there is one; Dismiss hides it and stays hidden after reload | |
| T20 | Trip check fix | Press "Stay N nights" | Nights change; the check disappears | |
| T21 | Ideas per stop | Press "Ideas for X" | What you stashed there, ranked; tap → Place page | |
| T22 | Set aside | "Set aside as alternative" | Stop leaves the route; appears under Alternatives; summary and dates update | |
| T23 | Put back | "Put back on the route" | Returns at its position with its nights | |
| T24 | Plan / Today | Switch to Today | Date, where you are, planned count, spent today; no crash without location | |
| T25 | Avatar → Profile | Tap the avatar | Profile opens | |
| T26 | Zoom out → Explore | Press the pill | Explore opens | |
| T27 | Offline map | Block tiles | Country outlines still drawn; note says street detail is missing | |

## 3. Explore

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| E1 | Countries list | Open Explore | 6 countries, on-route tags, place counts; map highlights them | |
| E2 | Search → ask | Type "Colombia" → Look | Two questions: how long, what for; picks pre-filled from Profile | |
| E3 | Search → read | Answer and carry on | Reads; shows a note of what it found; lists found clips marked "found"; "Ask about Colombia" | |
| E4 | Search → skip | Skip | Same as E3 without answers | |
| E5 | Search: empty | Press Look with nothing typed | Disabled | |
| E6 | Search: Hebrew | Type "קולומביה" | Works; no crash | |
| E7 | Country page | Tap Guatemala | Hero with counts, city cards (photo + sentence), search, sort chips, city rows | |
| E8 | Country: search | Type "ant" in the field | Rows filter live | |
| E9 | Country: sort | Switch sorts | Order changes; no reload flash | |
| E10 | Country: empty | Open a country with nothing | Honest empty state, no error | |
| E11 | City page | Tap Antigua | Clips rail (yours vs found marked), map with chips, places, Good to know | |
| E12 | City chips | Mine / Food / Stay / Views | Pins and list filter; "All" restores | |
| E13 | City route mode | If present | Numbers your places in walking order | |
| E14 | Back navigation | ← on each page | Returns to the previous level, scroll kept | |

## 4. Clips and video sections

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| C1 | Clips list | Open Clips | Spots grouped by place; yours / found counts | |
| C2 | Open feed | Tap a spot | Full-screen feed; tab bar hidden | |
| C3 | Sections | Feed with a saved clip | Opens at the saved second; the section scrub bar shows; scrolling snaps one clip at a time | |
| C4 | Found in feed | A found clip | Says "Found, not yours" | |
| C5 | Link-only clip | A clip with no file | Shows the quote and a link out; no broken player | |
| C6 | Close feed | ← or swipe | Back to where you were | |
| C7 | Whole video | "Play whole video" | Plays from 0 | |

## 5. Saved

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| S1 | By activity | Open Saved | Waiting banner on top; chips; groups with counts across countries | |
| S2 | Chip filter | Tap a chip | Only that group; "All N" restores | |
| S3 | Inbox | Banner → Inbox | Candidates with quotes; Keep / Pass | |
| S4 | Keep | Keep a place candidate | Appears in Places and on the map | |
| S5 | Pass | Pass on one | Gone from Inbox; not in Places | |
| S6 | Places | Places tab | Rows with status, meta, reason | |
| S7 | Knowledge | Knowledge tab | Typed items, sources, border warning on visa items | |
| S8 | Sources | Sources tab | Every source; failed ones offer Retry; Delete asks first | |

## 6. Place

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| P1 | Open | Tap a place | Real map header with coordinates, why you saved it, sources, facts | |
| P2 | Status | Change status | Saves; reflected in Saved and map | |
| P3 | Ask here | Ask on a place | Answer scoped to it | |
| P4 | Missing place | /places/nope | 404 handled, not a blank page | |

## 7. Save

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| V1 | Link | Paste a link + caption → Save | Source created; goes to Inbox | |
| V2 | Link: invalid | "not a url" | Clear error | |
| V3 | Upload plan .docx | Upload a Word plan | Candidates appear in Inbox with their line | |
| V4 | Upload plan .pdf | Upload a PDF | Same | |
| V5 | Upload page .html | Upload a saved page | Same; never served back as HTML | |
| V6 | Upload: wrong type | A .exe | Refused with a reason | |
| V7 | Note | Write a note | Knowledge item created | |
| V8 | Place by name | Add a place by name | Resolved or left for review | |
| V9 | Album sync | Select photos | Only new ones uploaded | |

## 8. Ask (the assistant)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| Q1 | Saved answer | "Is Antigua safe?" | Answers from your notes with citations | |
| Q2 | Short name | "Is Rio safe?" | Finds Rio de Janeiro notes | |
| Q3 | Nothing saved | "What about Bogotá?" | Reads Wikivoyage / web; says so; cites | |
| Q4 | Proposal | A question that yields "add to today" | One card with Add / Dismiss; nothing changes until Add | |
| Q5 | Add | Press Add | Itinerary item created; second press is not a duplicate | |
| Q6 | Dismiss | Press Dismiss | Nothing recorded | |
| Q7 | Visa question | "Do I need a visa for Brazil?" | Official-verification warning | |
| Q8 | Empty | Send nothing | Disabled | |
| Q9 | Hebrew | Ask in Hebrew | Answers; RTL renders | |

## 9. Profile

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| R1 | Picks | Toggle picks | Saved; Explore pre-fills them | |
| R2 | Sources link | Tap | Goes to Saved → Sources | |
| R3 | Sign out | Press | Back at sign-in; token cleared | |

## 10. Adding a country

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| N1 | Add a stop in a new country | + at end → "Cartagena" | Stop added; country resolved | |
| N2 | Map | Trip map | New country outlined as on-route; pin placed; line extends | |
| N3 | Explore | Open Explore | New country listed (if it has a place) or not — honest either way | |
| N4 | Country page | /explore/Colombia | Opens; no error with zero places | |
| N5 | Fly in | Tap the new pin | Flies to it; sheet shows it | |
| N6 | Trip check | Back on Trip | Long leg flagged; nights missing flagged | |
| N7 | Remove it | Delete the stop | Route and dates return to before | |
| N8 | Unknown name | Add "Xyzzyville" | Added with no coordinates; map and legs cope (no crash) | |

## 11. Input, errors and edge cases

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| X1 | 500 from API | Simulate | Error note with Retry, not a blank page | |
| X2 | Offline | Go offline | Banner; cached screens still show | |
| X3 | Long names | 160-char stop name | Clamped, no layout break | |
| X4 | Hebrew everywhere | Hebrew stop name and note | RTL correct in list, card, map label | |
| X5 | 401 mid-session | Token removed | Redirect to sign-in | |
| X6 | Other user's data | Another account's place id | 404, not data | |
| X7 | Double submit | Double-tap Add | One stop | |
| X8 | Nights > 365 | Press + past 365 | Refused with a message | |

## 12. Design (phone)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| D1 | No horizontal scroll | Every screen | Page never scrolls sideways | |
| D2 | Tab bar | Every screen | Pill + Save circle never cover content you need; content has bottom padding | |
| D3 | Tap targets | Buttons, chips | ≥ 44 px | |
| D4 | Text clipping | Cards, buttons, labels | Nothing cut off | |
| D5 | Dark mode | prefers-color-scheme: dark | Every screen readable; tokens applied | |
| D6 | RTL | Hebrew content | Direction right, punctuation right | |
| D7 | Images | Broken photo URL | Falls back to initial, no broken icon | |
| D8 | Reduced motion | prefers-reduced-motion | No flights/animations that hurt | |
| D9 | Empty states | Fresh account | Every screen has a sentence, not a blank | |
| D10 | Loading | Slow network | Skeletons, not jumps | |

## 13. Efficiency

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| F1 | Bundle | Build | Main bundle size noted; big libs split | |
| F2 | First load | Cold load of / | Under ~3 s on local | |
| F3 | API latency | /route, /explore/countries, /home, /places | Each under 300 ms locally | |
| F4 | Discover | /discover with all sources | Under the slowest source (parallel), not the sum | |
| F5 | Requests per screen | Trip screen | No repeated calls on every render | |
| F6 | Map tiles | Trip | Tiles cached; no refetch on sheet change | |
| F7 | Service worker | Deploy a new build | Old clients get the new shell on next load | |

## 14. AI results quality

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| I1 | Grounded | Any answer | Every claim has a source; no invented place | |
| I2 | Found vs yours | Any count | Found never counted as yours | |
| I3 | Trip check | Demo trip | Carnival flagged correctly; fix is right | |
| I4 | Suggestions | + after Antigua | Sensible, nearest first | |
| I5 | Voices relevant | + between Antigua and San Pedro | Results are about that stretch | |
| I6 | Explore read | "Colombia", hiking | Found clips are about Colombia hiking | |
