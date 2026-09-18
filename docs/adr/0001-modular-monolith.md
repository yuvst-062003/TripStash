# 1. Modular monolith over services

**Status:** accepted · 2026-09-17

## Context

The specification (§10.1) recommends a modular monolith and warns that
microservices would add operational cost without helping a first version aimed
at one traveller. The system does have genuinely separable concerns — capture,
extraction, place identity, the assistant, trip operations — and video
processing is bursty and slow.

## Decision

One FastAPI application, one database, with enforced internal seams:

- `routers/` does HTTP, authentication and ownership, nothing else.
- `services/` holds domain rules and never imports FastAPI.
- `adapters/` is the only code that knows an external service exists, and every
  one sits behind a protocol in `adapters/base.py`.
- `worker/` owns asynchronous work behind a function call, so the queue can be
  swapped without touching a router.

## Consequences

A fresh clone runs with one process and no broker. The seams are where a
service boundary would go if one is ever needed: extraction is already a
function that takes a `Source` id and commits its own transaction.

The cost is that nothing *forces* the layering — a determined import can cross
it. Code review and the import direction in the tests are the guard, not the
runtime.
