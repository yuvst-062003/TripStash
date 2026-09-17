# TripStash

> Save places from anywhere, see them around you, and let one assistant bring
> them back when the moment is right.

A personal travel-memory and decision layer for a long, flexible trip. It turns
Reels, TikToks, downloaded videos, screenshots, messages, articles and Maps
links into a private travel memory — places *and* safety warnings, transport
advice, border notes, prices and packing tips — keeps the original source and
the reason each thing was saved, shows it on your own map, and hands the next
action to whoever already does it best.

This repository implements the Phase 1 walking skeleton from
`Personal Travel Discovery App Product Specification v1.2`: the whole primary
loop, end to end, with every external service behind a replaceable adapter.

```
capture → extract typed knowledge → confirm → personal map → resurface → verify → hand off
```

## Quick start (no accounts, no API keys)

```bash
# 1. API — SQLite + deterministic fake providers
cd api
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
python -m app.seed                      # demo trip; prints the login
uvicorn app.main:app --reload           # http://127.0.0.1:8000/docs

# 2. PWA
cd ../web
npm install
npm run dev                             # http://127.0.0.1:5173
```

Sign in with the credentials `python -m app.seed` prints
(`traveller@example.com`). The seed runs the real pipeline, so the demo data is
exactly what capture produces — including items still waiting in Inbox.

### With Postgres + PostGIS

```bash
docker compose up --build               # db + api + web
```

Or point an existing database at the API:

```bash
export TRIPSTASH_DATABASE_URL=postgresql+psycopg://tripstash:tripstash@localhost:5432/tripstash
```

Postgres is the deployment target; SQLite keeps a fresh clone runnable and the
test suite dependency-free. Spatial queries use `ST_DWithin` against a GiST
index on Postgres and a bounding-box-plus-haversine equivalent elsewhere
(`api/app/services/spatial.py`).

### Checks

```bash
cd api  && pytest && ruff check app tests
cd web  && npm run lint && npm run build
```

## What it does

| Surface | Responsibility |
| --- | --- |
| **Home** | Contextual dashboard: today, review queue, money, and knowledge brought back because it is relevant now |
| **Map** | Your own saves only, filterable, with a compact recall card on every marker |
| **Saved** | Inbox (review queue), confirmed places, typed knowledge, and every original source |
| **Trip** | Flexible route, day plan, imported bookings, manual expenses, export |
| **Ask** | One assistant, available everywhere, that inherits the current screen's context |
| **Save** | One capture action: link, upload, note, or current location |

Ask and Save are global actions rather than tabs, so the assistant and capture
never duplicate Map and Saved.

### The rules the code actually enforces

- **Nothing reaches the map unconfirmed.** Extraction produces *candidates*;
  only an explicit approve creates a place or a knowledge item.
- **Every claim carries its evidence.** Each candidate keeps the verbatim quote
  it came from, its channel (caption, transcript, OCR) and a confidence score.
- **Nothing is invented.** A video with no readable transcript fails
  *recoverably* — the source stays in Inbox with a retry and a manual path —
  rather than being completed with made-up content.
- **Only an exact provider identity merges automatically.** Weaker matches
  surface as possible duplicates for you to decide, and a merge loses no
  source, note, status or identifier.
- **Your words are yours.** Enrichment writes to `Place` and `PlaceFact`; it
  never overwrites `TripPlace.reason_saved` or your notes.
- **Changing facts show their age.** Opening hours, prices and contacts carry
  provenance, a checked-at label and a freshness state, and conflicting sources
  stay visible side by side instead of being silently resolved.
- **Border and visa advice is flagged** as requiring official verification.
- **The assistant is read-only.** Anything that would change trip state comes
  back as a proposal you confirm, and opening a handoff link is never reported
  as a completed booking.

## Layout

```
api/                     FastAPI modular monolith
  app/adapters/          AI, places, weather, FX, storage — protocols + fakes
  app/models/            SQLAlchemy models (spec §9)
  app/routers/           HTTP surface, mounted at /api/v1
  app/schemas/           Typed extraction contract + request/response bodies
  app/services/          Pipeline, dedupe, assistant, resurfacing, freshness
  app/media/             Video and image understanding: ffmpeg, OCR, speech
  app/worker/            Background processing and freshness refresh
  tests/                 63 tests, including the spec's acceptance criteria
web/                     React + TypeScript PWA (Vite, Leaflet, service worker)
  src/styles/            Design tokens and the single stylesheet
  src/components/        UI primitives, sheets, review card, icon vocabulary
docs/                    Architecture, data model, spec coverage, ADRs
infra/                   Database bootstrap SQL
```

## Providers

Every external service sits behind a protocol in `api/app/adapters/base.py`, so
swapping a fake for a real driver is configuration, not surgery.

| Adapter | Default | Replace with |
| --- | --- | --- |
| AI extraction | `fake` — deterministic rule-based extractor | `local` — free open weights via any OpenAI-compatible server ([guide](docs/local-model.md)) |
| Video and images | ffmpeg + PP-OCRv4, both offline; optional faster-whisper | — see [the media pipeline](docs/media-pipeline.md) |
| Places | `fake` — in-repo gazetteer | Any provider returning `ResolvedPlace` |
| Weather | `fake` — deterministic by (lat, lon, date) | Any forecast API |
| FX | `fake` — static mid-market table | Any rates API |
| Storage | `local` — filesystem with HMAC-signed URLs | S3/GCS with signed URLs |

The fake AI adapter is not a stand-in for a model's judgement. It exists so the
pipeline, the review screen and the tests can run with no API key, and so the
typed contract is pinned by something executable.

### Free local extraction

```bash
ollama pull qwen2.5:7b-instruct-q4_K_M
export TRIPSTASH_AI_PROVIDER=local
```

No paid API is involved anywhere in this project. A small model is kept honest
by constrained decoding against the `ExtractionResult` schema, one repair
attempt, and an evidence-grounding guard that **drops any claim whose quote is
not actually in the source**. Your approvals and corrections feed straight back
in as few-shot examples, and export as fine-tuning data once there are enough of
them. See [docs/local-model.md](docs/local-model.md).

## Deliberately not built

Per the specification's non-goals and deferred list: in-app payments, bank
connections, broad social scraping, full ride ordering, silent photo-library
scanning, background geofencing, a passport vault, and any second visible
agent. See [`docs/spec-coverage.md`](docs/spec-coverage.md) for what is
implemented, what is stubbed, and what was left out on purpose.

## Documentation

- [Architecture](docs/architecture.md)
- [Design](docs/design.md)
- [Running a free, local model](docs/local-model.md)
- [The media pipeline](docs/media-pipeline.md)
- [Data model](docs/data-model.md)
- [Specification coverage](docs/spec-coverage.md)
- [ADR 0001 — Modular monolith](docs/adr/0001-modular-monolith.md)
- [ADR 0002 — Fake providers by default](docs/adr/0002-fake-providers-by-default.md)
- [ADR 0003 — Candidates before records](docs/adr/0003-candidates-before-records.md)
