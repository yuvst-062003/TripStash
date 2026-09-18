# 3. Candidates are a staging table, not a shortcut

**Status:** accepted · 2026-09-17

## Context

§7.3 requires confirmation for ambiguous matches and forbids silent AI
additions; §10.2 puts "request user confirmation for uncertainty" before "save
approved places". The obvious shortcut is to write places straight from
extraction and let the user clean up afterwards.

## Decision

Extraction writes to `extraction_candidate`, never to `place`, `trip_place` or
`knowledge_item`. `approve_candidate()` is the single function that promotes a
candidate, and it is reachable only from an explicit user action.

A candidate carries everything the decision needs: the verbatim evidence, the
confidence, the resolved provider options in rank order, and any possible
duplicate with the rule that flagged it.

## Consequences

The map contains only what the traveller confirmed, which is the property that
makes it trustworthy enough to act on. A wrong extraction is a discarded row,
not a cleanup job.

It also gives deduplication somewhere honest to put uncertainty: only an exact
provider identity merges on its own, and everything weaker becomes a visible
"possible duplicate — attach to the existing place?" on the review card.

The cost is a second table and a second write for everything captured, and a
review step the traveller cannot skip. Both are the point.
