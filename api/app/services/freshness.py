"""Freshness and conflict presentation for changing facts (spec 8.2).

Nothing here decides which conflicting value is true. It ranks by the source
hierarchy, labels age, and keeps disagreement visible.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.models.enums import PROVENANCE_RANK, Provenance
from app.models.places import PlaceFact

FRESH_FOR = timedelta(days=3)
STALE_AFTER = timedelta(days=30)


def age_label(checked_at: datetime) -> str:
    checked_at = checked_at if checked_at.tzinfo else checked_at.replace(tzinfo=UTC)
    delta = datetime.now(UTC) - checked_at
    if delta < timedelta(hours=1):
        return "checked just now"
    if delta < timedelta(days=1):
        return f"checked {int(delta.total_seconds() // 3600)}h ago"
    return f"checked {delta.days}d ago"


def status_for(fact: PlaceFact) -> str:
    checked_at = fact.checked_at if fact.checked_at.tzinfo else fact.checked_at.replace(tzinfo=UTC)
    delta = datetime.now(UTC) - checked_at
    if delta <= FRESH_FOR:
        return "fresh"
    if delta <= STALE_AFTER:
        return "ageing"
    return "stale"


def serialise_fact(fact: PlaceFact) -> dict:
    return {
        "id": fact.id,
        "kind": fact.kind,
        "value": fact.value,
        "provenance": fact.provenance,
        "source_label": fact.source_label,
        "source_url": fact.source_url,
        "confidence": fact.confidence,
        "checked_at": fact.checked_at.isoformat(),
        "freshness": status_for(fact),
        "age_label": age_label(fact.checked_at),
    }


def group_with_conflicts(facts: list[PlaceFact]) -> list[dict]:
    """Group by kind, best-provenance first, flagging real disagreement.

    A price level differing from an official price is a conflict worth showing;
    identical values from two sources are not.
    """
    by_kind: dict[str, list[PlaceFact]] = {}
    for fact in facts:
        by_kind.setdefault(str(fact.kind), []).append(fact)

    out: list[dict] = []
    for kind, group in sorted(by_kind.items()):
        group.sort(
            key=lambda f: (
                PROVENANCE_RANK.get(Provenance(f.provenance), 9),
                -f.confidence,
            )
        )
        distinct = {f.value.strip().lower() for f in group}
        primary, *others = group
        out.append(
            {
                "kind": kind,
                "primary": serialise_fact(primary),
                "alternatives": [serialise_fact(f) for f in others],
                "has_conflict": len(distinct) > 1,
                # Shown verbatim next to the value, so no categorical claim is made.
                "conflict_note": (
                    "Sources disagree - both values are shown, neither is treated as settled."
                    if len(distinct) > 1
                    else None
                ),
            }
        )
    return out
