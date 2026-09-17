# Specification coverage

Against *Personal Travel Discovery App Product Specification v1.2*. This is a
Phase 1 walking skeleton: the whole primary loop works end to end, and the
parts that are stubbed say so.

## Implemented

| Spec | What exists |
| --- | --- |
| §4 Navigation | Four tabs (Home, Map, Saved, Trip); Ask and Save as global actions |
| §5.1 Home | Phase-aware dashboard, review queue, today, money, resurfaced items, empty states |
| §5.2 Map | Personal saves only, status and category filters, clear-filters, list toggle, compact marker sheet, empty and no-result states |
| §5.3 Saved | Inbox review queue grouped by type, confirmed places, typed knowledge, sources with retry and delete |
| §5.4 Trip | Flexible route without dates, day plan, booking import, manual expenses with conversion, export |
| §5.5 Ask | One assistant, automatic screen context shown and removable, deterministic calculations, cards + citations, read-only with confirmable proposals, `AgentRun` logging |
| §5.6 Save | Link, text/caption, batch upload, note, current location; share-target declared in the manifest |
| §5.7 Place page | Header, why-saved, saved content, live information with provenance and freshness, related knowledge, plan, personal record, primary and secondary handoffs, suggested questions |
| §6.1–6.4 | All four journeys are exercised by tests in `api/tests/test_journeys.py` |
| §7.1–7.5 | Auth, one active trip, place lifecycle, capture rules, handoffs, upload validation and per-item batch status |
| §8.1–8.3 | Source hierarchy ranking, freshness labels and expiry, conflict display, official-verification flag, no fabricated bookings or tickets |
| §9 | Every entity, with the `Source`↔`Place` many-to-many and the `Place`/`TripPlace` split |
| §10.1–10.3 | Modular monolith, nine-step pipeline, deduplication in the mandated order with a lossless merge |
| §11.3–11.4 | Offline bundle with freshness labels, cached-data banner, idempotent offline writes, ownership checks, signed URLs, audit log, export and deletion |
| §12 | Error states for private links, ambiguous locations, no place detected, unsupported or oversized media, offline and denied permissions; accessibility rules below |
| §15 | Acceptance criteria covered by tests |
| §19 | Typed knowledge model, evidence requirements, contextual resurfacing with a stated reason, grouped review of mixed output |

### Accessibility (§12.1)

Status meaning never depends on colour alone — every marker and chip carries a
glyph and a text label. Tap targets are 48 px, every control is keyboard
reachable with a visible focus ring, the map has a full list alternative, both
colour schemes are supported, and `prefers-reduced-motion` is honoured.

## Stubbed, behind a real interface

| Area | Status |
| --- | --- |
| LLM extraction | Deterministic rule-based `FakeAIAdapter`. `AnthropicAIAdapter` is scaffolded and raises rather than pretending. The typed contract (`ExtractionResult`) is what a real model must fill in |
| Speech-to-text / OCR | Not implemented. Text-bearing uploads are decoded; binary media returns no transcript and the source fails *recoverably* rather than being invented |
| Places provider | In-repo gazetteer with the same `ResolvedPlace` shape a real provider returns |
| Weather, FX | Deterministic fakes |
| Object storage | Local filesystem with HMAC-signed URLs; malware scanning is a call site with an EICAR check, not a real scanner |
| Background worker | FastAPI background tasks; the queue seam is `app/worker/jobs.py` |
| Migrations | `create_all` bootstrap; Alembic is the documented follow-up |

## Deliberately not built

Straight from §3.3 and §14's deferred list:

- In-app payments, hotel/flight booking, bank or card connections
- Broad social scraping or account-level access to saved posts
- Full ride ordering (deep links only)
- Silent full-library photo scanning; only explicitly selected files upload
- Background geolocation or geofencing — a PWA cannot promise it (§11.2)
- A passport vault; `Document` stores metadata and a reference only
- A generic worldwide recommendation feed, or any social layer
- More than one visible agent

## Known gaps to close next

1. **Alembic migrations** before the schema is deployed anywhere shared.
2. **Real extraction**: implement `AnthropicAIAdapter.extract` against the
   existing schema, plus a transcription provider, then re-run §17's validation
   with 30–50 real sources.
3. **A queue** (RQ, Celery or similar) for video processing, so a long
   transcription does not occupy a request worker.
4. **Marker clustering** at low zoom (§5.2) — currently every pin is drawn.
5. **Write-side offline queue** in the client; the read path and the
   server-side idempotency key are in place, the client-side replay is not.
6. **Rate limiting and refresh tokens** on the auth surface.
