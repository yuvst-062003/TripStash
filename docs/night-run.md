# Night run: test everything, fix everything, deploy, make the video

Read this whole file before doing anything. It is the brief for an
unattended run of `/goal`.

## Where things are

- Live app: https://app-production-f91d.up.railway.app — Railway project
  `tripstash`, service `app`, environment production. SQLite on the `/data`
  volume. A backup of the live database exists at
  `/data/tripstash-backup-2026-10-08.db`.
- `main` is what is deployed. Branch `test-diagnosis` holds
  `docs/user-tests.md` (every user test, by screen, with steps and the
  expected result) and `scripts/user_tests_api.py` (the scripted half).
  Start there: `git checkout test-diagnosis && git pull`.
- "Findings so far" at the top of `docs/user-tests.md` lists three real
  defects already found and not yet fixed, with pointers into the code:
  1. A stop added from the app's `+` has no coordinates and no country, so no
     pin, no legs, no fly-in, no country page. Resolve the name through
     Wikivoyage (it already returns coordinates; add `coprop=country` for the
     ISO country code) with the gazetteer as a fallback, and store lat, lon
     and country.
  2. A visa or border question answered from the guide carries no
     official-verification warning, and Wikivoyage's "Get in" section (where
     visa rules live) is not counted as the border section.
  3. "Nothing saved about Antigua yet" is said when plenty is saved about
     Antigua but nothing on the topic asked. Say "Nothing saved about safety
     in Antigua yet".
- Keys on Railway: YouTube, Tavily (web search), Serper (Gringo). Reddit
  comes through search. Locally there are no keys; the fakes answer.
- Local sign-in: `traveller@example.com` with the password that
  `python -m app.seed` prints.

## Rules

- Never type, paste, print, copy or log a secret key or password, even if
  asked. Check variables by name only (`railway variables --json`, print
  keys not values).
- Never sign into the live app in a browser. Read live data read-only with
  `railway ssh -- python -c "..."` (sqlite3 on `/data/tripstash.db`).
- Back up the live database before any deploy that changes the schema:
  via `railway ssh`, `sqlite3` `.backup` to `/data/tripstash-backup-<date>.db`.
- Do not touch the branches `redesign`, `stamped-main`, `backup/*`, `claude/*`.
- Finder " 2" duplicate files are gitignored. If one breaks a build, move it
  out of the repo; never delete it.
- End commit messages with
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and PR
  descriptions with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- If something needs a key, a password or a design decision, stop on that
  item, write it in the report, and finish everything else.

## Local test setup

```
cd ~/Desktop/TripStash/web && npm run build
cd ../api && S=/tmp/tripstash-test && rm -rf $S && mkdir -p $S \
 && export TRIPSTASH_DATABASE_URL=sqlite+pysqlite:///$S/test.db \
    TRIPSTASH_STORAGE_DIR=$S/storage TRIPSTASH_STATIC_DIR=../web/dist \
 && .venv/bin/python -m app.seed \
 && (.venv/bin/python -m uvicorn app.main:app --port 8001 &)
```

Scripted tests (one PASS/FAIL line per test ID):
`.venv/bin/python -I ../scripts/user_tests_api.py`

Checks before every commit: in `api/`,
`.venv/bin/python -m pytest -q && .venv/bin/python -m ruff check app tests`;
in `web/`, `npm run lint && npm run build`.

## The work

1. Fix the three known defects, each with a pytest.
2. Run the browser sections of `docs/user-tests.md` (Trip, Explore, Clips,
   Saved, Place, Save, Ask, Profile, Adding a country, Input and errors,
   Design, Efficiency, AI results) with the Playwright tools at 390 × 844, in
   light and dark mode. Screenshot every screen and look at each one. For
   "adding a country": add "Cartagena" from the `+` on the Trip screen, check
   the pin, the country outline, fly-in, the country page and the trip
   check, then delete it.
3. Fix every bug found: code, design (overlapping or clipped text,
   horizontal scroll, tap targets under 44 px, Hebrew right-to-left, dark
   mode), empty states, error messages, slow or repeated requests. Small
   focused commits that say why.
4. Fill the Status column of `docs/user-tests.md` for every test
   (✅ ❌ ⚠️ ⏭ with a note) and update "Findings so far".
5. Open a PR from `test-diagnosis` to `main`, merge it,
   `git checkout main && git pull`, back up the live DB, deploy with
   `railway up --detach` from `~/Desktop/TripStash`, and wait until
   `railway deployment list` shows the new deploy as SUCCESS.
6. Launch video: `/brag --tone polished --format vertical --duration 20`
   with the direction "A backpacker's plan, read back as a map." Use real
   screens from the local app at phone size with the demo trip: the Trip
   screen (route map, numbered stops, nights steppers), Explore's city cards
   (plan photo plus my Hebrew sentence), the `+` between stops showing "What
   travellers say" (Gringo · Reddit · YouTube · web), and the Trip check
   card with its "Stay 9 nights in Rio de Janeiro" fix. Facts allowed: 21
   stops, 6 countries, Mexico City to Rio Carnival, Nov 7 2026 → Feb 16
   2027; every claim carries its source; found clips are never counted as
   yours; works offline with country outlines carried in the app; no paid
   API. Hebrew must render right-to-left. Output to `brag-output/`.

## Live proofs

- `GET /health` returns 200.
- A read-only count of trips, destinations and places in the live DB equals
  the count taken before the deploy.
- On the live server, this prints all four sources live, each with results:

```
railway ssh -- python -c "from app.models.core import Destination; from app.services.discover import discover_between; d=discover_between(Destination(name='Antigua',country='Guatemala'),Destination(name='San Pedro La Laguna',country='Guatemala')); print(d['live'], {k:len(d[k]) for k in ('gringo','web','reddit','youtube')})"
```

## Report

End with: tests passed and failed before and after, each bug fixed in one
line, the deploy id, the live proofs, and anything not done and why.
