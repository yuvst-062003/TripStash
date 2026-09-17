# Polish loop — GOAP plan and checklist

**Goal:** every screen reviewed by three specialised sub-agents (visual design,
motion & interaction, UX/copy/correctness), blocker + should findings applied,
re-captured light + dark at 390×844, committed on `redesign`; lint/build and
API tests green; screenshots refreshed; pushed and deployed.

**Current state (2026-09-17):** `redesign` at `a7b2091`, live at
https://app-production-f91d.up.railway.app. Local: API :8010, web :5176, demo DB
re-seeded with one upcoming event (Semana Santa, Antigua, in 9 days).

**Plan cost:** 12 screen tasks + 1 cross-cutting task; 3 reviewers each;
sequential fixes so the working tree stays coherent.

**Risk factors:** a fix breaks lint/build or another screen → revert, log,
replan; captures fail → restart the dev server by PID, retry once; deploy fails
→ report, don't loop.

**Fallback:** reviews sequential with the Agent tool if parallel dispatch fails.

## Checklist

| # | Screen | Status | Findings (A/B/C → applied) | Commit |
| --- | --- | --- | --- | --- |
| 0 | Cross-cutting (tokens, shared components) | done | 401 rewrite, 422 text, btn hover/press/busy, code font | a0f58b7 |
| 1 | Sign in | done | A 8 / B 8 / C 8 → 20 applied, 4 skipped (drag momentum, shared-layout wordmark, header 3px ✓trivial, Logo off — kept compressed) | (this commit) |
| 2 | Home | pending | | |
| 3 | Map | pending | | |
| 4 | Saved (tabs) | pending | | |
| 5 | Inbox review card | pending | | |
| 6 | Place | pending | | |
| 7 | Trip | pending | | |
| 8 | Journey | pending | | |
| 9 | Ask drawer | pending | | |
| 10 | Save drawer | pending | | |
| 11 | You / profile | pending | | |
| 12 | New trip + empty states | pending | | |

## Trajectory

- Step 0: plan written; servers up; demo DB re-seeded.
- Step 1 (cross-cutting): reviewers proved a 401 rewrite bug on sign-in (any 401 → "session expired"); fixed in api.ts with a test-by-hand (wrong password now reads "Wrong email or password."). Commit a0f58b7.
- Step 2 (sign in): scene no longer rebuilds at landing (spin via ref); no drop-shadow/backdrop-blur over the live canvas; pixel ratio capped 1.5; intro 1.1 s, skipped for returning users, tap to skip; CTA dark-on-teal (AA); space palette now overrides danger/warn; error slot reserved with role=alert and aria-invalid; busy button breathes; dev-only demo hint; email remembered; logo compressed to 0.85 s and starts after the form lands; drag works under reduced motion. Verified: one canvas, intro skipped on return, error text correct in both schemes.
