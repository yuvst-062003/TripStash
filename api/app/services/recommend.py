"""Recommendations for a place you are looking at — from your own stash.

Spec 5.5 keeps the assistant read-only and grounded: a recommendation is
never a web result or a guess, it is what *you* saved that matters for this
place, ranked by how much it matters now. When the Claude adapter is on, the
model writes the two-sentence "why" from those same items and nothing else.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.capture import KnowledgeItem, Source, SourcePlaceEvidence
from app.models.core import Trip
from app.models.enums import KnowledgeType, PlaceStatus
from app.models.places import Place, TripPlace
from app.services.assistant import _knowledge_card, _place_card
from app.services.text import normalize_name


@dataclass(slots=True)
class Recommendation:
    query: str
    summary: str
    cards: list[dict] = field(default_factory=list)
    grounded: bool = True  # False only if a model wrote the summary

    def to_dict(self) -> dict:
        return {
            "query": self.query,
            "summary": self.summary,
            "cards": self.cards,
            "grounded": self.grounded,
        }


def recommend(
    session: Session, *, trip: Trip, query: str, on: date, limit: int = 8
) -> Recommendation:
    needle = normalize_name(query)
    if not needle:
        return Recommendation(
            query=query, summary="Type a city or a place to see what you stashed for it."
        )

    # Both sides are normalised: "Lake Atitlán" and "lake atitlan" are one stop.
    def mentions(*values: str | None) -> bool:
        return any(needle in normalize_name(value) for value in values if value)

    places = [
        tp
        for tp in session.execute(
            select(TripPlace)
            .join(Place)
            .where(TripPlace.trip_id == trip.id, TripPlace.status != PlaceStatus.ARCHIVED)
        ).scalars()
        if mentions(tp.place.city, tp.place.name, tp.place.country)
    ]
    knowledge = [
        k
        for k in session.execute(
            select(KnowledgeItem).where(
                KnowledgeItem.trip_id == trip.id, KnowledgeItem.is_archived.is_(False)
            )
        ).scalars()
        if mentions(k.destination_scope, k.title)
    ]

    # Must-visits first among places; the rest by confidence.
    places.sort(
        key=lambda tp: (tp.status != PlaceStatus.MUST_VISIT, tp.status == PlaceStatus.VISITED)
    )
    events = sorted(
        (
            k
            for k in knowledge
            if k.type == KnowledgeType.EVENT and k.happens_on and k.happens_on >= on
        ),
        key=lambda k: k.happens_on or on,
    )
    other = sorted(
        (k for k in knowledge if k not in events),
        key=lambda k: (k.type not in (KnowledgeType.SAFETY, KnowledgeType.BORDER), -k.confidence),
    )

    # What matters first: warnings, the next event, then must-visits and the
    # rest of the places, then everything else you noted.
    warnings = [k for k in other if k.type in (KnowledgeType.SAFETY, KnowledgeType.BORDER)]
    notes = [k for k in other if k not in warnings]
    cards: list[dict] = []
    for item in warnings:
        cards.append(_knowledge_card(item))
    for item in events:
        card = _knowledge_card(item)
        days = (item.happens_on - on).days if item.happens_on else None
        card["happens_on"] = item.happens_on.isoformat() if item.happens_on else None
        card["when"] = "today" if days == 0 else f"in {days} days" if days and days > 0 else None
        cards.append(card)
    for tp in places:
        cards.append(_place_card(tp))
    for item in notes:
        cards.append(_knowledge_card(item))
    cards = cards[:limit]

    mark_sourcing(session, trip.id, cards)
    summary = _plain_summary(query, places, events, other)
    return Recommendation(query=query, summary=summary, cards=cards, grounded=True)


def _plain_summary(
    query: str, places: list[TripPlace], events: list[KnowledgeItem], other: list[KnowledgeItem]
) -> str:
    if not places and not events and not other:
        return (
            f"Nothing stashed for {query} yet. "
            "Save a Reel, a note or a place and it will show here."
        )
    bits = []
    if places:
        must = [tp for tp in places if tp.status == PlaceStatus.MUST_VISIT]
        bits.append(
            f"{len(places)} saved place{'s' if len(places) != 1 else ''}"
            + (f", {len(must)} must-visit" if must else "")
        )
    if events:
        first = events[0]
        bits.append(
            f"{first.title} on {first.happens_on:%-d %B}" if first.happens_on else first.title
        )
    warnings = [k for k in other if k.type in (KnowledgeType.SAFETY, KnowledgeType.BORDER)]
    if warnings:
        bits.append(f"{len(warnings)} warning{'s' if len(warnings) != 1 else ''} to read first")
    return f"For {query}: " + "; ".join(bits) + "."



def mark_sourcing(session: Session, trip_id: str, cards: list[dict]) -> None:
    """Say, per card, whether the traveller saved it or the app found it.

    Blended but never blurred. A place is theirs the moment one source behind
    it is one they saved; only a place standing entirely on clips the app went
    looking for is marked found. The benefit of the doubt runs that way round
    on purpose - calling something found when they actually saved it would
    understate their own library, which is the one thing this app is for.
    """
    yours: set[str] = {
        place_id
        for (place_id,) in session.execute(
            select(SourcePlaceEvidence.place_id)
            .join(Source, Source.id == SourcePlaceEvidence.source_id)
            .where(
                SourcePlaceEvidence.trip_id == trip_id,
                Source.found.is_(False),
            )
            .distinct()
        ).all()
    }
    for card in cards:
        place_id = card.get("place_id")
        card["sourcing"] = "yours" if (place_id is None or place_id in yours) else "found"
