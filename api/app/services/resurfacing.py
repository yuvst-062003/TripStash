"""Contextual resurfacing (spec 19.2).

Knowledge is brought back by context, not filed in a destination folder and
forgotten. Each rule states, in plain words, why the item is being shown now -
that sentence is part of the output, not a debugging aid.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.capture import KnowledgeItem
from app.models.enums import KnowledgeType, PlaceStatus
from app.models.places import Place
from app.services.spatial import haversine_km, nearby_trip_places, walking_minutes

# Distance at which a saved place counts as "around me" on foot.
NEARBY_RADIUS_KM = 2.5
AIRPORT_RADIUS_KM = 8.0


@dataclass(slots=True)
class Resurfaced:
    kind: str
    title: str
    body: str | None
    reason: str
    confidence: float
    knowledge_item_id: str | None = None
    trip_place_id: str | None = None
    place_id: str | None = None
    # Lets the client show the right category art instead of a generic pin.
    category: str | None = None
    knowledge_type: str | None = None
    distance_km: float | None = None

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "title": self.title,
            "body": self.body,
            "reason": self.reason,
            "confidence": round(self.confidence, 2),
            "knowledge_item_id": self.knowledge_item_id,
            "trip_place_id": self.trip_place_id,
            "place_id": self.place_id,
            "category": self.category,
            "knowledge_type": self.knowledge_type,
            "distance_km": round(self.distance_km, 2) if self.distance_km is not None else None,
        }


def resurface(
    session: Session,
    *,
    trip_id: str,
    lat: float | None,
    lon: float | None,
    on: date,
    destination_scope: str | None = None,
    from_user: bool = True,
    limit: int = 8,
) -> list[Resurfaced]:
    """What matters now.

    `from_user` says whether lat/lon is the traveller's own position or a
    stand-in (the current destination's centre). A stand-in still finds the
    right places, but it must never be described as a distance "from you".
    """
    out: list[Resurfaced] = []

    if lat is not None and lon is not None:
        out.extend(_nearby_saves(session, trip_id, lat, lon, from_user, destination_scope))
        if from_user:
            out.extend(_airport_knowledge(session, trip_id, lat, lon))

    out.extend(_scoped_knowledge(session, trip_id, destination_scope))
    out.extend(_upcoming_events(session, trip_id, on))
    out.sort(key=lambda item: (-item.confidence, item.distance_km or 0.0))
    return _dedupe(out)[:limit]


def _dedupe(items: list[Resurfaced]) -> list[Resurfaced]:
    """One card per thing; the first (highest-ranked) reason wins."""
    seen: set[str] = set()
    kept: list[Resurfaced] = []
    for item in items:
        key = item.knowledge_item_id or item.trip_place_id or item.title
        if key in seen:
            continue
        seen.add(key)
        kept.append(item)
    return kept


EVENT_HORIZON_DAYS = 45


def _upcoming_events(session: Session, trip_id: str, on: date) -> list[Resurfaced]:
    """Events within the horizon, nearest first; the sooner, the stronger the pull."""
    stmt = select(KnowledgeItem).where(
        KnowledgeItem.trip_id == trip_id,
        KnowledgeItem.is_archived.is_(False),
        KnowledgeItem.type == KnowledgeType.EVENT,
        KnowledgeItem.happens_on.is_not(None),
    )
    out: list[Resurfaced] = []
    for item in session.execute(stmt).scalars():
        start = item.happens_on
        end = item.ends_on or start
        assert start is not None
        if end < on or (start - on).days > EVENT_HORIZON_DAYS:
            continue
        days = (start - on).days
        if days <= 0:
            reason = (
                "Happening today." if end == start or end == on else f"On now, until {end:%-d %B}."
            )
            confidence = 0.95
        elif days == 1:
            reason = "Tomorrow."
            confidence = 0.92
        else:
            when = f"{start:%-d %B}" + (f" – {end:%-d %B}" if end != start else "")
            reason = f"In {days} days, {when}."
            confidence = max(0.5, 0.9 - days * 0.008)
        out.append(
            Resurfaced(
                kind="knowledge",
                title=item.title,
                body=item.body,
                reason=reason,
                confidence=confidence,
                knowledge_item_id=item.id,
                knowledge_type=str(item.type),
                category="event",
            )
        )
    return out


def _nearby_saves(
    session: Session,
    trip_id: str,
    lat: float,
    lon: float,
    from_user: bool,
    scope: str | None,
) -> list[Resurfaced]:
    out: list[Resurfaced] = []
    for trip_place, distance in nearby_trip_places(
        session, trip_id, lat, lon, NEARBY_RADIUS_KM, limit=10
    ):
        if trip_place.status in (PlaceStatus.ARCHIVED, PlaceStatus.VISITED):
            continue
        if not from_user:
            where = f"In {scope}" if scope else "Nearby"
            reason = f"{where}, still unvisited."
        elif distance < 0.1:
            reason = "You're here, and it is still unvisited."
        else:
            reason = f"About {walking_minutes(distance)} min walk from you and still unvisited."
        out.append(
            Resurfaced(
                kind="place",
                title=trip_place.place.name,
                body=trip_place.reason_saved,
                reason=reason,
                confidence=0.9 if trip_place.status == PlaceStatus.MUST_VISIT else 0.75,
                trip_place_id=trip_place.id,
                place_id=trip_place.place_id,
                category=trip_place.place.category,
                # A distance from a stand-in point is not a distance from you.
                distance_km=distance if from_user else None,
            )
        )
    return out


def _airport_knowledge(
    session: Session, trip_id: str, lat: float, lon: float
) -> list[Resurfaced]:
    """Approaching an airport: show the saved taxi warning and ride advice."""
    airports = session.execute(
        select(Place).where(Place.category == "transport")
    ).scalars()
    near_airport = any(
        haversine_km(lat, lon, place.lat, place.lon) <= AIRPORT_RADIUS_KM
        and "airport" in place.name.lower()
        for place in airports
    )
    if not near_airport:
        return []

    items = session.execute(
        select(KnowledgeItem).where(
            KnowledgeItem.trip_id == trip_id,
            KnowledgeItem.is_archived.is_(False),
            KnowledgeItem.type.in_([KnowledgeType.SAFETY, KnowledgeType.TRANSPORT]),
        )
    ).scalars()
    return [
        Resurfaced(
            kind="knowledge",
            title=item.title,
            body=item.body,
            reason="You are close to an airport and saved this about arrivals and rides.",
            confidence=0.85,
            knowledge_item_id=item.id,
            knowledge_type=str(item.type),
        )
        for item in items
    ]


def _scoped_knowledge(
    session: Session, trip_id: str, destination_scope: str | None
) -> list[Resurfaced]:
    stmt = select(KnowledgeItem).where(
        KnowledgeItem.trip_id == trip_id, KnowledgeItem.is_archived.is_(False)
    )
    if destination_scope:
        stmt = stmt.where(KnowledgeItem.destination_scope == destination_scope)
    items = list(session.execute(stmt).scalars())

    out: list[Resurfaced] = []
    for item in items:
        knowledge_type = KnowledgeType(item.type)
        if knowledge_type is KnowledgeType.BORDER:
            reason = (
                "Saved entry advice for this route - verify against official rules "
                "before you travel."
            )
            confidence = 0.8
        elif knowledge_type is KnowledgeType.SAFETY:
            reason = "A safety note you saved for this destination."
            confidence = 0.8
        elif knowledge_type is KnowledgeType.PRICE:
            reason = "A price expectation you captured, to compare against actual spending."
            confidence = 0.6
        elif knowledge_type is KnowledgeType.PACKING:
            reason = "Equipment advice you saved for this activity."
            confidence = 0.55
        elif knowledge_type is KnowledgeType.TRANSPORT:
            reason = "Transport advice you saved for this leg."
            confidence = 0.7
        else:
            reason = "Saved for this destination."
            confidence = 0.5
        out.append(
            Resurfaced(
                kind="knowledge",
                title=item.title,
                body=item.body,
                reason=reason,
                confidence=confidence * max(item.confidence, 0.4),
                knowledge_item_id=item.id,
                knowledge_type=str(item.type),
            )
        )
    return out
