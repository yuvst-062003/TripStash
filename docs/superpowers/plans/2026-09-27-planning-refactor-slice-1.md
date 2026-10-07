# Planning Refactor, Slice 1 — Country Scope and Activity Picks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a country a first-class scope you can browse — "Guatemala, all 12 videos" — and let the traveller pick which activity types matter, so the shelf filters by their picks and orders by how many sources name a thing.

**Architecture:** Scope today resolves to exactly one label per place (`destination`, else `city`, else `country`), so a place attached to a destination never groups under its country. This slice adds a second, independent grouping axis over `Place.country`, aggregated in a new read-only service, plus a small `ActivityPick` table holding the traveller's selected activity slugs. No extraction changes, no new providers, no writes to `Place` or `TripPlace`.

**Tech Stack:** FastAPI, SQLAlchemy 2, Pydantic 2, pytest; React 18 + TypeScript + Vite, Leaflet, react-router 6. Playwright for browser verification.

**Spec:** The agreed design lives in the design canvas at https://claude.ai/artifact/61ina9c2JxPevKrdHzQF29 (boards `Main`, `Country`, `Place`, `Goals`) and in `docs/spec-coverage.md` §19. This slice implements the country-scope and activity-pick portions only.

## Global Constraints

- Python ≥ 3.11, `ruff` line length 100, rules `E,F,I,UP,B` must pass clean.
- Every new query filters by `trip_id`. No endpoint may return another traveller's rows.
- Archived places (`PlaceStatus.ARCHIVED`) stay excluded from every count, matching `_rows()`.
- Nothing in this slice writes to `Place`, `PlaceFact`, `TripPlace.reason_saved`, or any user-authored field.
- No new runtime dependency. No paid API.
- Activity slugs are lowercase `[a-z_]`, stable, and defined in exactly one place.
- Copy is sentence case. No all-caps labels, no `·`-joined meta strings, no `→` in link text.
- TypeScript must pass `npx tsc --noEmit` with `noUnusedLocals` on.

## Review Focus

1. **A place with `country = NULL`** — the gazetteer does not always resolve a country. It must land under a single "Country not known" group, not vanish and not crash the aggregation. (Task 2)
2. **Country names differing by case or accent** — "panama", "Panama" and "Panamá" must aggregate as one country, not three. (Task 2)
3. **Zero activity picks** — a traveller who picks nothing must see *everything*, not an empty shelf. Absence of a filter is not an empty filter. (Task 3)
4. **An archived place holding video** — must not appear in a country's count, or the number disagrees with the Saved screen. (Task 2)
5. **A second traveller's identical country** — two accounts both with Guatemala must never see each other's counts. (Task 2)

---

### Task 1: Activity vocabulary and the picks table

**Files:**
- Create: `api/app/services/activities.py`
- Create: `api/app/models/picks.py`
- Modify: `api/app/models/__init__.py`
- Test: `api/tests/test_picks.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `ACTIVITIES: tuple[Activity, ...]` where `Activity` is a frozen dataclass with `slug: str` and `label: str`; `ACTIVITY_SLUGS: frozenset[str]`; SQLAlchemy model `ActivityPick` with columns `id`, `trip_id`, `slug`, `created_at`.

- [ ] **Step 1: Write the failing test**

```python
# api/tests/test_picks.py
from app.services.activities import ACTIVITIES, ACTIVITY_SLUGS


def test_the_vocabulary_is_stable_and_lowercase():
    assert len(ACTIVITIES) == 12
    for activity in ACTIVITIES:
        assert activity.slug == activity.slug.lower()
        assert activity.slug.replace("_", "").isalpha()
        assert activity.label and activity.label[0].isupper()
    assert len(ACTIVITY_SLUGS) == len(ACTIVITIES)
    assert "hike" in ACTIVITY_SLUGS
    assert "surf" in ACTIVITY_SLUGS
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/bin/pytest tests/test_picks.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.activities'`

- [ ] **Step 3: Write the vocabulary**

```python
# api/app/services/activities.py
"""The activity types a traveller can pick.

Picks filter what the planning screens show. They are never weighted: how
many independent sources name a thing is what orders it, and that is a number
the traveller can check rather than a score they guessed.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Activity:
    slug: str
    label: str


ACTIVITIES: tuple[Activity, ...] = (
    Activity("hike", "Hike and trek"),
    Activity("surf", "Surf"),
    Activity("volcano", "Volcanoes"),
    Activity("dive", "Diving"),
    Activity("spanish", "Spanish school"),
    Activity("street_food", "Street food"),
    Activity("nightlife", "Hostels and nightlife"),
    Activity("waterfall", "Waterfalls and caves"),
    Activity("ruins", "Ruins"),
    Activity("wildlife", "Wildlife"),
    Activity("coffee", "Coffee farms"),
    Activity("islands", "Islands and boats"),
)

ACTIVITY_SLUGS: frozenset[str] = frozenset(a.slug for a in ACTIVITIES)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && .venv/bin/pytest tests/test_picks.py -v`
Expected: PASS

- [ ] **Step 5: Write the failing test for the model**

```python
# append to api/tests/test_picks.py
def test_a_pick_is_stored_once_per_trip(client, auth, trip):
    first = client.put("/api/v1/activities", headers=auth, json={"slugs": ["hike", "surf"]})
    assert first.status_code == 200, first.text
    assert sorted(first.json()["picked"]) == ["hike", "surf"]

    # Putting again replaces rather than accumulating.
    second = client.put("/api/v1/activities", headers=auth, json={"slugs": ["hike"]})
    assert second.json()["picked"] == ["hike"]

    read = client.get("/api/v1/activities", headers=auth)
    assert read.json()["picked"] == ["hike"]
    assert len(read.json()["available"]) == 12


def test_an_unknown_slug_is_refused(client, auth, trip):
    response = client.put("/api/v1/activities", headers=auth, json={"slugs": ["parkour"]})
    assert response.status_code == 422
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd api && .venv/bin/pytest tests/test_picks.py -v`
Expected: FAIL — 404, the route does not exist

- [ ] **Step 7: Write the model**

```python
# api/app/models/picks.py
"""Which activity types this trip is about.

A row per picked slug. Absence of rows means no filter at all, which is not
the same as an empty filter: a traveller who has picked nothing sees
everything.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, TimestampMixin


class ActivityPick(IdMixin, TimestampMixin, Base):
    __tablename__ = "activity_pick"
    __table_args__ = (UniqueConstraint("trip_id", "slug", name="uq_activity_pick_trip_slug"),)

    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    slug: Mapped[str] = mapped_column(String(32), nullable=False)
```

- [ ] **Step 8: Export it so `create_all` sees the table**

In `api/app/models/__init__.py`, add the import next to the others and the name to `__all__`:

```python
from app.models.picks import ActivityPick
```

- [ ] **Step 9: Commit**

```bash
git add api/app/services/activities.py api/app/models/picks.py api/app/models/__init__.py api/tests/test_picks.py
git commit -m "feat(api): activity vocabulary and the picks table"
```

---

### Task 2: Country aggregation

**Files:**
- Create: `api/app/services/countries.py`
- Test: `api/tests/test_countries.py`

**Interfaces:**
- Consumes: `_rows`-shaped tuples of `(SourcePlaceEvidence, Source, TripPlace, Place)`.
- Produces: `normalise_country(value: str | None) -> str` returning a casefolded, accent-stripped key or `""`; `CountryTally` frozen dataclass with `key: str`, `name: str`, `place_count: int`, `video_count: int`, `playable_count: int`; `tally_countries(rows, *, is_video, is_playable) -> list[CountryTally]` sorted by `-video_count` then `name`.

- [ ] **Step 1: Write the failing test**

```python
# api/tests/test_countries.py
from app.services.countries import normalise_country


def test_case_and_accents_fold_to_one_country():
    assert normalise_country("Panama") == normalise_country("panama")
    assert normalise_country("Panamá") == normalise_country("Panama")
    assert normalise_country("  Guatemala  ") == normalise_country("guatemala")


def test_a_missing_country_is_its_own_empty_key():
    assert normalise_country(None) == ""
    assert normalise_country("") == ""
    assert normalise_country("   ") == ""
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && .venv/bin/pytest tests/test_countries.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write the normaliser and the tally**

```python
# api/app/services/countries.py
"""Counting a library by country.

Scope elsewhere resolves to one label per place - its destination, else its
city, else its country - so a place attached to a destination never groups
under the country it is in. This is the second axis: every place a traveller
saved, gathered by country, so "Guatemala, all 12 videos" can be answered
before any single place there has been opened.

Read-only. Nothing here writes.
"""

from __future__ import annotations

import unicodedata
from collections.abc import Callable, Iterable
from dataclasses import dataclass

# Shown when the gazetteer could not resolve a country. Named, not hidden:
# a place with no country is still a place the traveller saved.
UNKNOWN_COUNTRY = "Country not known"


def normalise_country(value: str | None) -> str:
    """A stable key for one country, however it was spelled.

    "Panamá" and "panama" are the same country. Accents are stripped and case
    folded so two spellings cannot become two countries. An absent country
    folds to the empty key, which callers surface as UNKNOWN_COUNTRY.
    """
    if not value or not value.strip():
        return ""
    stripped = unicodedata.normalize("NFKD", value.strip())
    without_marks = "".join(ch for ch in stripped if not unicodedata.combining(ch))
    return without_marks.casefold()


@dataclass(frozen=True)
class CountryTally:
    key: str
    name: str
    place_count: int
    video_count: int
    playable_count: int


def tally_countries(
    rows: Iterable[tuple],
    *,
    is_video: Callable[[object], bool],
    is_playable: Callable[[object], bool],
) -> list[CountryTally]:
    """Gather evidence rows into one tally per country.

    `rows` are the `(evidence, source, trip_place, place)` tuples the reels
    router already builds, so archived places are excluded upstream and the
    counts agree with what Saved shows.
    """
    names: dict[str, str] = {}
    places: dict[str, set[str]] = {}
    videos: dict[str, int] = {}
    playable: dict[str, int] = {}

    for _evidence, source, _trip_place, place in rows:
        if not is_video(source):
            continue
        key = normalise_country(place.country)
        # First spelling seen wins as the display name, so the traveller sees
        # the country written the way their own data writes it.
        names.setdefault(key, place.country.strip() if place.country else UNKNOWN_COUNTRY)
        places.setdefault(key, set()).add(place.id)
        videos[key] = videos.get(key, 0) + 1
        if is_playable(source):
            playable[key] = playable.get(key, 0) + 1

    out = [
        CountryTally(
            key=key,
            name=names[key],
            place_count=len(places[key]),
            video_count=videos[key],
            playable_count=playable.get(key, 0),
        )
        for key in names
    ]
    out.sort(key=lambda c: (-c.video_count, c.name.casefold()))
    return out
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd api && .venv/bin/pytest tests/test_countries.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/app/services/countries.py api/tests/test_countries.py
git commit -m "feat(api): count a library by country, folding spellings"
```

---

### Task 3: The endpoints

**Files:**
- Modify: `api/app/schemas/api.py`
- Modify: `api/app/routers/reels.py`
- Create: `api/app/routers/activities.py`
- Modify: `api/app/main.py:19`
- Test: `api/tests/test_countries.py`, `api/tests/test_picks.py`

**Interfaces:**
- Consumes: `tally_countries`, `normalise_country`, `UNKNOWN_COUNTRY` from Task 2; `ACTIVITIES`, `ACTIVITY_SLUGS`, `ActivityPick` from Task 1.
- Produces: `GET /api/v1/reels/countries -> list[CountrySummary]`; `country` query param on `GET /api/v1/reels/spots`; `GET /api/v1/activities -> ActivityPicksResponse`; `PUT /api/v1/activities` taking `ActivityPicksRequest`.

- [ ] **Step 1: Write the failing endpoint tests**

```python
# append to api/tests/test_countries.py
def test_countries_group_every_saved_place_by_country(client, auth, trip):
    response = client.get("/api/v1/reels/countries", headers=auth)
    assert response.status_code == 200, response.text
    names = [row["name"] for row in response.json()]
    assert names, "the seeded trip should hold at least one country"
    # Sorted by how much video sits behind each, most first.
    counts = [row["video_count"] for row in response.json()]
    assert counts == sorted(counts, reverse=True)


def test_one_travellers_countries_never_include_anothers(client, auth, trip):
    other = client.post(
        "/api/v1/auth/register",
        json={"email": "other@example.com", "password": "another-long-password"},
    )
    other_auth = {"Authorization": f"Bearer {other.json()['access_token']}"}
    assert client.get("/api/v1/reels/countries", headers=other_auth).json() == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && .venv/bin/pytest tests/test_countries.py -v`
Expected: FAIL — 404 on `/api/v1/reels/countries`

- [ ] **Step 3: Add the schemas**

Append to `api/app/schemas/api.py`:

```python
class CountrySummary(ApiModel):
    """One country the traveller has saved something in."""

    key: str
    name: str
    place_count: int
    video_count: int
    playable_count: int


class ActivityOption(ApiModel):
    slug: str
    label: str


class ActivityPicksResponse(ApiModel):
    available: list[ActivityOption]
    picked: list[str]


class ActivityPicksRequest(ApiModel):
    slugs: list[str] = Field(default_factory=list, max_length=40)
```

- [ ] **Step 4: Add the countries endpoint**

In `api/app/routers/reels.py`, add the import and the route:

```python
from app.schemas.api import CountrySummary, ReelClip, ReelSpot
from app.services.countries import UNKNOWN_COUNTRY, normalise_country, tally_countries


@router.get("/reels/countries", response_model=list[CountrySummary])
def list_countries(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> list[CountrySummary]:
    """Every country this trip has video in, most-evidenced first."""
    tallies = tally_countries(
        _rows(session, trip), is_video=is_video_source, is_playable=is_playable
    )
    return [
        CountrySummary(
            key=t.key,
            name=t.name,
            place_count=t.place_count,
            video_count=t.video_count,
            playable_count=t.playable_count,
        )
        for t in tallies
    ]
```

- [ ] **Step 5: Add the `country` filter to `list_spots`**

In `list_spots`, add the parameter and the filter. Insert `country: str | None = Query(default=None),` after the `scope` parameter, and inside the row loop, directly after the `label` assignment:

```python
        if country is not None:
            wanted = normalise_country(country)
            if wanted == normalise_country(UNKNOWN_COUNTRY):
                wanted = ""
            if normalise_country(place.country) != wanted:
                continue
```

- [ ] **Step 6: Run to verify the country tests pass**

Run: `cd api && .venv/bin/pytest tests/test_countries.py -v`
Expected: PASS

- [ ] **Step 7: Write the activities router**

```python
# api/app/routers/activities.py
"""Which activity types this trip is about.

Picks filter; they never score. An empty set of picks means no filter, so a
traveller who has picked nothing still sees everything.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.deps import current_trip
from app.models.core import Trip
from app.models.picks import ActivityPick
from app.schemas.api import ActivityOption, ActivityPicksRequest, ActivityPicksResponse
from app.services.activities import ACTIVITIES, ACTIVITY_SLUGS

router = APIRouter(tags=["activities"])


def _options() -> list[ActivityOption]:
    return [ActivityOption(slug=a.slug, label=a.label) for a in ACTIVITIES]


def _picked(session: Session, trip: Trip) -> list[str]:
    rows = session.execute(
        select(ActivityPick.slug).where(ActivityPick.trip_id == trip.id)
    ).scalars()
    return sorted(rows)


@router.get("/activities", response_model=ActivityPicksResponse)
def read_activities(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> ActivityPicksResponse:
    return ActivityPicksResponse(available=_options(), picked=_picked(session, trip))


@router.put("/activities", response_model=ActivityPicksResponse)
def set_activities(
    body: ActivityPicksRequest,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> ActivityPicksResponse:
    """Replace the whole set. Putting the same slug twice picks it once."""
    wanted = {slug.strip().lower() for slug in body.slugs if slug.strip()}
    unknown = sorted(wanted - ACTIVITY_SLUGS)
    if unknown:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Not an activity this app knows: {', '.join(unknown)}",
        )

    session.execute(delete(ActivityPick).where(ActivityPick.trip_id == trip.id))
    for slug in sorted(wanted):
        session.add(ActivityPick(trip_id=trip.id, slug=slug))
    session.flush()
    return ActivityPicksResponse(available=_options(), picked=sorted(wanted))
```

- [ ] **Step 8: Mount it**

In `api/app/main.py:19`, add `activities` to the router import list and it will be mounted by the existing loop:

```python
from app.routers import account, activities, assistant, auth, capture, places, planner, reels, trips
```

Then add `activities` to the tuple of routers that loop iterates over.

- [ ] **Step 9: Run every picks test**

Run: `cd api && .venv/bin/pytest tests/test_picks.py -v`
Expected: PASS, including `test_an_unknown_slug_is_refused`

- [ ] **Step 10: Run the whole suite and lint**

Run: `cd api && .venv/bin/pytest -q && .venv/bin/ruff check .`
Expected: all pass, ruff clean

- [ ] **Step 11: Commit**

```bash
git add api/app/schemas/api.py api/app/routers/reels.py api/app/routers/activities.py api/app/main.py api/tests
git commit -m "feat(api): country scope endpoint and activity picks"
```

---

### Task 4: Web types and client

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/api.ts`

**Interfaces:**
- Consumes: the three endpoints from Task 3.
- Produces: `CountrySummary`, `ActivityOption`, `ActivityPicks` types; `api.countries()`, `api.activities()`, `api.setActivities(slugs)`.

- [ ] **Step 1: Add the types**

Append to `web/src/lib/types.ts`:

```ts
export interface CountrySummary {
  key: string
  name: string
  place_count: number
  video_count: number
  playable_count: number
}

export interface ActivityOption {
  slug: string
  label: string
}

export interface ActivityPicks {
  available: ActivityOption[]
  picked: string[]
}
```

- [ ] **Step 2: Add the client methods**

Add `ActivityPicks` and `CountrySummary` to the type import block in `web/src/lib/api.ts`, then add to the `api` object, following the shape of the existing `reels` methods:

```ts
  countries: () => get<CountrySummary[]>('/reels/countries'),
  activities: () => get<ActivityPicks>('/activities'),
  setActivities: (slugs: string[]) =>
    send<ActivityPicks>('PUT', '/activities', { slugs }),
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: clean. If `send` is named differently in this file, use the existing helper for a body-carrying request rather than adding one.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/types.ts web/src/lib/api.ts
git commit -m "feat(web): country and activity types on the client"
```

---

### Task 5: The activity pick screen

**Files:**
- Create: `web/src/pages/Activities.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `api.activities()`, `api.setActivities()`.
- Produces: route `/activities`.

- [ ] **Step 1: Write the screen**

```tsx
// web/src/pages/Activities.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { ErrorNote, SkeletonRows } from '../components/ui'

/**
 * What this trip is about.
 *
 * Picks filter what the planning screens show. Nothing is weighted: how many
 * sources name a thing is what orders it.
 */
export default function Activities() {
  const state = useAsync(() => api.activities(), [])
  const [picked, setPicked] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (state.data && picked === null) setPicked(state.data.picked)
  }, [state.data, picked])

  if (state.error) return <ErrorNote>{state.error.message}</ErrorNote>
  if (!state.data || picked === null) return <SkeletonRows />

  const toggle = (slug: string) =>
    setPicked((current) =>
      current!.includes(slug) ? current!.filter((s) => s !== slug) : [...current!, slug],
    )

  async function save() {
    setSaving(true)
    try {
      await api.setActivities(picked!)
      navigate('/countries')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="screen pad" data-testid="activities">
      <h1 className="t-title">What is this trip about?</h1>
      <p className="t-small dim">
        Pick what pulls you. There is nothing to rank — your picks decide what shows up, and how
        many sources name a thing decides its order.
      </p>
      <ul className="list" style={{ marginTop: 'var(--s-4)' }}>
        {state.data.available.map((option) => (
          <li key={option.slug}>
            <label className="item" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={picked.includes(option.slug)}
                onChange={() => toggle(option.slug)}
                style={{ width: 19, height: 19, accentColor: 'var(--ink)' }}
              />
              <span className="item__body">
                <span className="item__title">{option.label}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="t-small dim" style={{ marginTop: 'var(--s-3)' }} data-testid="picked-count">
        {picked.length} of {state.data.available.length} picked
      </p>
      <button
        className="btn btn--ink btn--block"
        style={{ marginTop: 'var(--s-3)' }}
        onClick={() => void save()}
        disabled={saving}
      >
        {saving ? 'Saving' : 'Show me the countries'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Add the route**

In `web/src/App.tsx`, import it beside the other pages and add inside `<Routes>`:

```tsx
<Route path="/activities" element={<Page dir={dir.current}><Activities /></Page>} />
```

- [ ] **Step 3: Typecheck and build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: both clean

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Activities.tsx web/src/App.tsx
git commit -m "feat(web): pick the activities this trip is about"
```

---

### Task 6: The countries screen

**Files:**
- Create: `web/src/pages/Countries.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `api.countries()`.
- Produces: route `/countries`, linking each country to `/countries/:key`.

- [ ] **Step 1: Write the screen**

```tsx
// web/src/pages/Countries.tsx
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { Empty, ErrorNote, SkeletonRows } from '../components/ui'

/**
 * Where a library clusters, before any one place is opened.
 *
 * Scope elsewhere resolves to a destination, else a city, else a country, so
 * nothing until now could answer "Guatemala, all 12 videos".
 */
export default function Countries() {
  const state = useAsync(() => api.countries(), [])

  if (state.error) return <ErrorNote>{state.error.message}</ErrorNote>
  if (!state.data) return <SkeletonRows />
  if (state.data.length === 0) {
    return (
      <div className="screen pad" data-testid="countries">
        <h1 className="t-title">Nothing saved yet</h1>
        <Empty>Share a reel or import what you already saved, and it will show up here.</Empty>
      </div>
    )
  }

  return (
    <div className="screen pad" data-testid="countries">
      <h1 className="t-title">Where your saves are</h1>
      <ul className="list" style={{ marginTop: 'var(--s-4)' }}>
        {state.data.map((country) => (
          <li key={country.key || 'unknown'}>
            <Link
              to={`/countries/${encodeURIComponent(country.key || 'unknown')}`}
              className="item"
              data-testid="country-row"
            >
              <span className="item__body">
                <span className="item__title">{country.name}</span>
                <span className="t-small dim">
                  {country.place_count} {country.place_count === 1 ? 'place' : 'places'}
                </span>
              </span>
              <span className="t-head num">{country.video_count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Add the route**

```tsx
<Route path="/countries" element={<Page dir={dir.current}><Countries /></Page>} />
```

- [ ] **Step 3: Typecheck and build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: both clean

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Countries.tsx web/src/App.tsx
git commit -m "feat(web): the countries a library clusters in"
```

---

### Task 7: One country, its places and videos

**Files:**
- Create: `web/src/pages/CountryView.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `api.countries()`, and `api.reelSpots({ country })` — extend the existing spots client method with an optional `country` param in Task 4 if it is not already generic.
- Produces: route `/countries/:key`.

- [ ] **Step 1: Write the screen**

```tsx
// web/src/pages/CountryView.tsx
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { Empty, ErrorNote, SkeletonRows } from '../components/ui'

/** One country: every place in it that has video, most-evidenced first. */
export default function CountryView() {
  const { key } = useParams<{ key: string }>()
  const name = key === 'unknown' ? 'Country not known' : decodeURIComponent(key ?? '')
  const state = useAsync(() => api.reelSpots({ country: name }), [name])

  if (state.error) return <ErrorNote>{state.error.message}</ErrorNote>
  if (!state.data) return <SkeletonRows />

  const videos = state.data.reduce((sum, spot) => sum + spot.clip_count, 0)

  return (
    <div className="screen pad" data-testid="country-view">
      <Link to="/countries" className="t-small dim">
        Back to your countries
      </Link>
      <h1 className="t-title" style={{ marginTop: 'var(--s-2)' }}>
        {name}
      </h1>
      <p className="t-small dim" data-testid="country-totals">
        {state.data.length} {state.data.length === 1 ? 'place' : 'places'}, {videos}{' '}
        {videos === 1 ? 'video' : 'videos'}
      </p>
      {state.data.length === 0 ? (
        <Empty>No video saved here yet.</Empty>
      ) : (
        <ul className="list" style={{ marginTop: 'var(--s-4)' }}>
          {state.data.map((spot) => (
            <li key={spot.trip_place_id}>
              <Link
                to={`/places/${spot.trip_place_id}`}
                className="item"
                data-testid="country-place"
              >
                <span className="item__body">
                  <span className="item__title">{spot.name}</span>
                  <span className="t-small dim">{spot.scope_label}</span>
                </span>
                <span className="t-head num">{spot.clip_count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add the route**

```tsx
<Route path="/countries/:key" element={<Page dir={dir.current}><CountryView /></Page>} />
```

- [ ] **Step 3: Typecheck and build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: both clean

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/CountryView.tsx web/src/App.tsx
git commit -m "feat(web): one country, its places and their video"
```

---

### Task 8: Verify in Chrome and capture proof

**Files:**
- Create: `docs/screenshots/countries-light.png`
- Create: `docs/screenshots/country-view-light.png`
- Create: `docs/screenshots/activities-light.png`

- [ ] **Step 1: Start the API and the web dev server**

```bash
cd api && .venv/bin/python -m app.seed && .venv/bin/uvicorn app.main:app --port 8000 &
cd web && npm run dev &
```

- [ ] **Step 2: Sign in and reach each screen in Chrome via Playwright**

Navigate to `http://127.0.0.1:5173`, sign in with the credentials `python -m app.seed` prints, then visit `/activities`, `/countries` and the first country row.

- [ ] **Step 3: Assert the numbers agree with the API**

Compare the `country-totals` text against `GET /api/v1/reels/countries` for that country. The video count on the countries list must equal the sum of `clip_count` on the country view.

- [ ] **Step 4: Save the three screenshots into `docs/screenshots/`**

- [ ] **Step 5: Commit**

```bash
git add docs/screenshots
git commit -m "docs: screenshots of country scope and activity picks"
```
