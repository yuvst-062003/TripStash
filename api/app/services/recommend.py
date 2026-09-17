"""Recommendations for a place you are looking at — from your own stash.

Spec 5.5 keeps the assistant read-only and grounded: a recommendation is
never a web result or a guess, it is what *you* saved that matters for this
place, ranked by how much it matters now. When the Claude adapter is on, the
model writes the two-sentence "why" from those same items and nothing else.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.adapters import get_ai
from app.models.capture import KnowledgeItem
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

    like = f"%{needle}%"
    places = list(
        session.execute(
            select(TripPlace)
            .join(Place)
            .where(
                TripPlace.trip_id == trip.id,
                TripPlace.status != PlaceStatus.ARCHIVED,
                or_(Place.city.ilike(like), Place.name.ilike(like), Place.country.ilike(like)),
            )
        ).scalars()
    )
    knowledge = list(
        session.execute(
            select(KnowledgeItem).where(
                KnowledgeItem.trip_id == trip.id,
                KnowledgeItem.is_archived.is_(False),
                or_(KnowledgeItem.destination_scope.ilike(like), KnowledgeItem.title.ilike(like)),
            )
        ).scalars()
    )

    # Must-visits first, then events by date, then the rest by confidence.
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

    cards: list[dict] = []
    for tp in places[:limit]:
        cards.append(_place_card(tp))
    for item in events:
        card = _knowledge_card(item)
        days = (item.happens_on - on).days if item.happens_on else None
        card["happens_on"] = item.happens_on.isoformat() if item.happens_on else None
        card["when"] = "today" if days == 0 else f"in {days} days" if days and days > 0 else None
        cards.append(card)
    for item in other:
        cards.append(_knowledge_card(item))
    cards = cards[:limit]

    summary = _plain_summary(query, places, events, other)
    grounded = True
    ai = get_ai()
    if cards and getattr(ai, "name", "fake") == "anthropic":
        written = _model_summary(ai, query, cards)
        if written:
            summary, grounded = written, False
    return Recommendation(query=query, summary=summary, cards=cards, grounded=grounded)


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


def _model_summary(ai, query: str, cards: list[dict]) -> str | None:
    """Two sentences from the model, grounded on the cards and nothing else."""
    try:
        client = ai._get_client()  # noqa: SLF001 - same package, deliberately thin adapter
        lines = [
            f"- ({c['type']}{'/' + c['knowledge_type'] if c.get('knowledge_type') else ''}) "
            f"{c['title']}"
            + (
                f" — {c.get('why_saved') or c.get('body')}"
                if c.get("why_saved") or c.get("body")
                else ""
            )
            + (f" [{c['when']}]" if c.get("when") else "")
            for c in cards
        ]
        response = client.messages.create(
            model=ai.model,
            max_tokens=400,
            output_config={"effort": "low"},
            system=(
                "You write two plain sentences telling a traveller what they themselves saved "
                "about a place, in their own terms. Only use the items given; never add places, "
                "prices or facts that are not in the list. Lead with the thing that matters "
                "most now (an event that is soon, a warning), then the rest. "
                "No preamble, no bullets."
            ),
            messages=[
                {"role": "user", "content": f"Place: {query}\nSaved items:\n" + "\n".join(lines)}
            ],
        )
        if response.stop_reason == "refusal":
            return None
        text = next((b.text for b in response.content if b.type == "text"), "").strip()
        return text or None
    except Exception:  # noqa: BLE001 - a model hiccup must never break the list
        return None
