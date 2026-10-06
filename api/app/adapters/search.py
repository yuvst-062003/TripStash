"""The assistant's web search.

Two rules on top of everything in docs/sources.md: an answer drawn from the web
names its sources inline, and the assistant may propose but never act. Searching
does not promote it to an editor, which is why this returns results and has no
method that writes anything.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.adapters.base import SearchResult


@dataclass
class FakeSearchProvider:
    """A fixed result set, so the stack runs with no accounts and no network.

    Results are deliberately few and obviously local: a fake that returned
    plausible-looking live results would let a bug ship as a feature, because
    nobody would notice the assistant was citing fiction.
    """

    name: str = "fake"
    results: dict[str, list[SearchResult]] = field(default_factory=dict)

    def search(self, query: str, *, limit: int = 5) -> list[SearchResult]:
        needle = query.strip().lower()
        if not needle:
            return []
        for key, rows in self.results.items():
            if key.lower() in needle or needle in key.lower():
                return rows[:limit]
        return []
