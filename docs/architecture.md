# Architecture

## Shape

A modular monolith. One deployable, with hard internal seams:

```
                    ┌──────────────────────────────────────┐
  React PWA  ──────▶ │  routers/      HTTP, auth, ownership │
  service worker     ├──────────────────────────────────────┤
  IndexedDB/cache    │  services/     pipeline, dedupe,     │
                     │                assistant, freshness, │
                     │                resurfacing, spatial  │
                     ├──────────────────────────────────────┤
                     │  adapters/     AI · places · weather │
                     │                FX · storage          │
                     ├──────────────────────────────────────┤
                     │  models/       SQLAlchemy            │
                     └──────────────┬───────────────────────┘
                                    │
                    PostgreSQL + PostGIS   ·   private object storage
```

Routers do HTTP and ownership. Services hold the domain rules. Adapters are the
only code that knows an external service exists. A router never calls a
provider SDK; a service never imports FastAPI.

## Request path for a capture

1. `POST /api/v1/sources` — the `Source` row is written **before** anything can
   fail, with a content hash so a retried import is not a second copy.
2. The extraction job runs (inline in the MVP, a queue later — the call site in
   `app/worker/jobs.py` does not change).
3. The AI adapter returns an `ExtractionResult`: typed candidates, each with
   evidence, a channel and a confidence.
4. Place-like candidates are resolved through the places provider and checked
   against existing places in the order spec §10.3 mandates.
5. Candidates land in `extraction_candidate` with status `pending`. Nothing is
   on the map yet.
6. The traveller approves, edits, merges or ignores each one. Approval is the
   only path to `TripPlace` or `KnowledgeItem`.
7. Provider facts are written to `PlaceFact` with provenance and an expiry.

## Spatial queries

`app/services/spatial.py` picks a strategy from the dialect:

- **Postgres** — `ST_DWithin` on `ST_MakePoint(lon, lat)::geography`, backed by
  a GiST index created in `init_db()`.
- **Anything else** — a bounding-box prefilter (generous by construction)
  followed by an exact haversine filter in Python.

Both return the same ordering, so tests on SQLite are meaningful. Distances and
walking times are computed deterministically; the assistant never estimates
them with a model.

## The assistant

`app/services/assistant.py` is one entry point with several internal handlers,
never several visible agents. It:

- classifies the question into an intent,
- retrieves the trip's own records for that intent,
- computes numbers deterministically (haversine, FX, budget sums),
- returns typed cards, citations, disclaimers and *proposed* actions,
- records an `AgentRun` with the context, tools and citations used.

State changes never happen inside `/ask`. They happen in `/ask/confirm`, after
the traveller accepts a specific proposal.

Swapping the rule-based handlers for a model means giving the model the same
retrieval functions as tools and keeping the same response shape. The contract
the UI depends on is the shape, not the implementation.

## Offline

The service worker caches the app shell and a small allowlist of GET endpoints.
Cached API responses come back with `x-tripstash-offline: true`, which the
client turns into a visible "cached, may be out of date" banner — so week-old
opening hours are never presented as current. Expense writes carry a
`client_op_id` that makes a replayed offline queue idempotent.

## Security

- Ownership is re-checked on every trip-scoped request (`deps.owned_or_404`);
  an ID from the client is never trusted.
- Passwords use `scrypt` with per-password salts.
- Uploads are MIME- and size-checked and pass a scan hook before storage.
- Files are served only through short-lived HMAC-signed URLs; the storage root
  is never on a public path.
- Sensitive access is recorded in `audit_event`, without document contents.
