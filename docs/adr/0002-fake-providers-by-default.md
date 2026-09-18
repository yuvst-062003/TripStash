# 2. Fake providers by default

**Status:** accepted · 2026-09-17

## Context

The product depends on an LLM, a places provider, weather, exchange rates and
object storage. Requiring five accounts before anything runs would make the
project hard to evaluate, hard to test and expensive to iterate on — against
§20's premise that a personal build should cost very little to run.

## Decision

Every provider is a protocol with a deterministic in-repo implementation, live
by default. Real drivers are selected by environment variable.

The fakes are deterministic, not random: the same input produces the same
extraction, the same forecast and the same rate, so a test that asserts "rain
expected" keeps passing.

## Consequences

`git clone && pytest` works. The typed contract between the pipeline and the AI
provider is pinned by executable code rather than prose.

The important constraint: **a fake must never invent what a real provider would
have to fetch.** `FakeAIAdapter.transcribe` returns nothing for a binary video
rather than a plausible-sounding transcript, so the recoverable-failure path
(§12) is what the demo actually exercises. A fake that lies would make the
product look like it works when it does not.
