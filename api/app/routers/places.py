"""Saved library, the personal map, and the smart place page."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.adapters import get_places, get_weather
from app.db import get_session
from app.deps import current_trip, owned_or_404
from app.models.capture import KnowledgeItem, Source, SourcePlaceEvidence
from app.models.core import Trip
from app.models.enums import ACTIVE_PLACE_STATUSES, PlaceStatus
from app.models.ops import ItineraryItem
from app.models.places import Collection, Place, PlaceFact, TripPlace, Visit
from app.schemas.api import (
    CollectionCreate,
    PlaceSummary,
    PlaceUpdate,
    VisitCreate,
)
from app.services import handoff
from app.services.freshness import group_with_conflicts
from app.services.spatial import haversine_km, walking_minutes_if_walkable

router = APIRouter(tags=["places"])


def _source_counts(session: Session, trip_id: str) -> dict[str, int]:
    rows = session.execute(
        select(SourcePlaceEvidence.place_id, func.count(SourcePlaceEvidence.id))
        .where(SourcePlaceEvidence.trip_id == trip_id)
        .group_by(SourcePlaceEvidence.place_id)
    ).all()
    return {place_id: count for place_id, count in rows}


def _summary(
    trip_place: TripPlace, source_count: int, distance_km: float | None = None
) -> PlaceSummary:
    place = trip_place.place
    return PlaceSummary(
        trip_place_id=trip_place.id,
        place_id=place.id,
        name=place.name,
        category=place.category,
        city=place.city,
        country=place.country,
        lat=place.lat,
        lon=place.lon,
        status=str(trip_place.status),
        is_favourite=trip_place.is_favourite,
        needs_review=trip_place.needs_review,
        reason_saved=trip_place.reason_saved,
        source_count=source_count,
        distance_km=round(distance_km, 2) if distance_km is not None else None,
        walking_minutes=walking_minutes_if_walkable(distance_km),
    )


@router.get("/places", response_model=list[PlaceSummary])
def list_places(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
    status_filter: list[str] | None = Query(default=None, alias="status"),
    category: list[str] | None = Query(default=None),
    collection_id: str | None = Query(default=None),
    favourite: bool | None = Query(default=None),
    q: str | None = Query(default=None),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lon: float | None = Query(default=None, ge=-180, le=180),
    max_km: float | None = Query(default=None, gt=0, le=20000),
) -> list[PlaceSummary]:
    stmt = (
        select(TripPlace)
        .join(Place, Place.id == TripPlace.place_id)
        .where(TripPlace.trip_id == trip.id)
    )
    if status_filter:
        stmt = stmt.where(TripPlace.status.in_(status_filter))
    else:
        stmt = stmt.where(TripPlace.status != PlaceStatus.ARCHIVED)
    if category:
        stmt = stmt.where(Place.category.in_(category))
    if favourite is not None:
        stmt = stmt.where(TripPlace.is_favourite.is_(favourite))
    if q:
        stmt = stmt.where(Place.name.ilike(f"%{q}%"))
    if collection_id:
        stmt = stmt.where(TripPlace.collections.any(Collection.id == collection_id))

    counts = _source_counts(session, trip.id)
    rows = list(session.execute(stmt).scalars().unique())

    out: list[PlaceSummary] = []
    for trip_place in rows:
        distance = (
            haversine_km(lat, lon, trip_place.place.lat, trip_place.place.lon)
            if lat is not None and lon is not None
            else None
        )
        if max_km is not None and (distance is None or distance > max_km):
            continue
        out.append(_summary(trip_place, counts.get(trip_place.place_id, 0), distance))

    out.sort(key=lambda s: (s.distance_km if s.distance_km is not None else 1e9, s.name))
    return out


@router.get("/map")
def map_view(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
    min_lat: float | None = Query(default=None, ge=-90, le=90),
    min_lon: float | None = Query(default=None, ge=-180, le=180),
    max_lat: float | None = Query(default=None, ge=-90, le=90),
    max_lon: float | None = Query(default=None, ge=-180, le=180),
    status_filter: list[str] | None = Query(default=None, alias="status"),
    category: list[str] | None = Query(default=None),
) -> dict:
    """GeoJSON of personal saves only.

    Generic suggestions are a separate, opt-in layer by design (spec 5.2), so
    this endpoint never mixes them into the traveller's own pins.
    """
    stmt = (
        select(TripPlace)
        .join(Place, Place.id == TripPlace.place_id)
        .where(TripPlace.trip_id == trip.id)
    )
    if status_filter:
        stmt = stmt.where(TripPlace.status.in_(status_filter))
    else:
        stmt = stmt.where(TripPlace.status.in_(ACTIVE_PLACE_STATUSES))
    if category:
        stmt = stmt.where(Place.category.in_(category))
    if None not in (min_lat, min_lon, max_lat, max_lon):
        stmt = stmt.where(
            Place.lat.between(min_lat, max_lat), Place.lon.between(min_lon, max_lon)
        )

    counts = _source_counts(session, trip.id)
    features = []
    for trip_place in session.execute(stmt).scalars().unique():
        place = trip_place.place
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [place.lon, place.lat]},
                "properties": {
                    "trip_place_id": trip_place.id,
                    "place_id": place.id,
                    "name": place.name,
                    "category": place.category,
                    "status": str(trip_place.status),
                    "is_favourite": trip_place.is_favourite,
                    "needs_review": trip_place.needs_review,
                    "reason_saved": trip_place.reason_saved,
                    "source_count": counts.get(place.id, 0),
                },
            }
        )
    return {"type": "FeatureCollection", "features": features, "layer": "personal_saves"}


@router.get("/places/{trip_place_id}")
def place_page(
    trip_place_id: str,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lon: float | None = Query(default=None, ge=-180, le=180),
) -> dict:
    """The smart place page (spec 5.7): saved evidence and live facts, separated."""
    trip_place = owned_or_404(
        session.get(TripPlace, trip_place_id), trip, "Place not found in this trip."
    )
    place = trip_place.place
    today = datetime.now(UTC).date()

    evidence_rows = list(
        session.execute(
            select(SourcePlaceEvidence).where(
                SourcePlaceEvidence.trip_id == trip.id,
                SourcePlaceEvidence.place_id == place.id,
            )
        ).scalars()
    )
    saved_content = []
    for row in evidence_rows:
        source = session.get(Source, row.source_id)
        if source is None:
            continue
        saved_content.append(
            {
                "source_id": source.id,
                "kind": str(source.kind),
                "title": source.title or source.filename or source.url,
                "url": source.url,
                "author": source.author,
                "published_on": source.published_on.isoformat() if source.published_on else None,
                "captured_at": source.created_at.isoformat(),
                "provenance": str(source.provenance),
                "takeaway": row.takeaway,
                "quote": row.quote,
                "media_timestamp_seconds": row.media_timestamp_seconds,
            }
        )

    facts = list(
        session.execute(select(PlaceFact).where(PlaceFact.place_id == place.id)).scalars()
    )
    knowledge = list(
        session.execute(
            select(KnowledgeItem).where(
                KnowledgeItem.trip_id == trip.id,
                KnowledgeItem.place_id == place.id,
                KnowledgeItem.is_archived.is_(False),
            )
        ).scalars()
    )
    planned = list(
        session.execute(
            select(ItineraryItem).where(
                ItineraryItem.trip_id == trip.id, ItineraryItem.trip_place_id == trip_place.id
            )
        ).scalars()
    )
    distance = (
        haversine_km(lat, lon, place.lat, place.lon)
        if lat is not None and lon is not None
        else None
    )
    weather = get_weather().forecast(place.lat, place.lon, today)

    return {
        "header": {
            "trip_place_id": trip_place.id,
            "place_id": place.id,
            "name": place.name,
            "category": place.category,
            "city": place.city,
            "country": place.country,
            "address": place.address,
            "status": str(trip_place.status),
            "is_favourite": trip_place.is_favourite,
            "needs_review": trip_place.needs_review,
            "coordinates": {"lat": place.lat, "lon": place.lon},
            "distance_km": round(distance, 2) if distance is not None else None,
            "walking_minutes": walking_minutes_if_walkable(distance),
        },
        "overview": {
            "why_saved": trip_place.reason_saved,
            "notes": trip_place.notes,
            "expected_cost": trip_place.expected_cost,
            "expected_duration_minutes": trip_place.expected_duration_minutes,
            "best_time": trip_place.best_time,
            "collections": [{"id": c.id, "name": c.name} for c in trip_place.collections],
        },
        "saved_content": saved_content,
        # Kept apart from `saved_content` on purpose: a creator's opinion and a
        # provider's opening hours are different kinds of claim (spec 2.2).
        "live_information": {
            "facts": group_with_conflicts(facts),
            "weather": {
                "summary": weather.summary,
                "temperature_c": weather.temperature_c,
                "precipitation_probability": weather.precipitation_probability,
                "for_date": weather.for_date.isoformat(),
                "checked_at": weather.checked_at.isoformat(),
            },
        },
        "knowledge": [
            {
                "id": item.id,
                "type": item.type,
                "title": item.title,
                "body": item.body,
                "confidence": item.confidence,
                "requires_official_verification": item.requires_official_verification,
            }
            for item in knowledge
        ],
        "plan": [
            {
                "id": item.id,
                "on_date": item.on_date.isoformat(),
                "start_time": item.start_time,
                "title": item.title,
            }
            for item in planned
        ],
        "personal_record": {
            "rating": trip_place.rating,
            "visits": [
                {
                    "id": v.id,
                    "visited_on": v.visited_on.isoformat(),
                    "rating": v.rating,
                    "notes": v.notes,
                    "actual_cost": v.actual_cost,
                    "currency": v.currency,
                }
                for v in trip_place.visits
            ],
        },
        "actions": {
            "primary": handoff.serialise(
                [handoff.navigate(place, mode=handoff.travel_mode(distance))]
            ),
            "secondary": handoff.serialise(handoff.for_place(place)[1:]),
        },
        "suggested_questions": _suggested_questions(place.category),
    }


def _suggested_questions(category: str) -> list[str]:
    common = ["Why did I save this?", "Does visiting today make sense?"]
    by_category = {
        "restaurant": ["What did the source say to order?", "Is it open this evening?"],
        "cafe": ["Is it a good place to work from?"],
        "nature": ["What should I bring?", "How long does it take?"],
        "viewpoint": ["What is the best time of day for this?"],
        "accommodation": ["What did people warn about?", "What did I expect to pay?"],
        "attraction": ["Do I need to book ahead?", "How do I get there?"],
    }
    return common + by_category.get(category, [])


@router.patch("/places/{trip_place_id}", response_model=PlaceSummary)
def update_place(
    trip_place_id: str,
    body: PlaceUpdate,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> PlaceSummary:
    trip_place = owned_or_404(
        session.get(TripPlace, trip_place_id), trip, "Place not found in this trip."
    )
    data = body.model_dump(exclude_unset=True)
    collection_ids = data.pop("collection_ids", None)
    for field, value in data.items():
        setattr(trip_place, field, value)
    if body.status is not None:
        trip_place.status = str(body.status)
    if collection_ids is not None:
        trip_place.collections = list(
            session.execute(
                select(Collection).where(
                    Collection.trip_id == trip.id, Collection.id.in_(collection_ids)
                )
            ).scalars()
        )
    session.flush()
    counts = _source_counts(session, trip.id)
    return _summary(trip_place, counts.get(trip_place.place_id, 0))


@router.post("/places/{trip_place_id}/visits", status_code=status.HTTP_201_CREATED)
def record_visit(
    trip_place_id: str,
    body: VisitCreate,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> dict:
    trip_place = owned_or_404(
        session.get(TripPlace, trip_place_id), trip, "Place not found in this trip."
    )
    visit = Visit(
        trip_place_id=trip_place.id,
        visited_on=body.visited_on,
        rating=body.rating,
        notes=body.notes,
        actual_cost=body.actual_cost,
        currency=(body.currency or trip.base_currency).upper(),
    )
    session.add(visit)
    trip_place.status = PlaceStatus.VISITED
    if body.rating is not None:
        trip_place.rating = body.rating
    session.flush()
    return {"id": visit.id, "status": str(trip_place.status)}


@router.get("/collections")
def list_collections(
    session: Session = Depends(get_session), trip: Trip = Depends(current_trip)
) -> list[dict]:
    rows = session.execute(
        select(Collection).where(Collection.trip_id == trip.id).order_by(Collection.name)
    ).scalars()
    return [{"id": c.id, "name": c.name, "colour": c.colour} for c in rows]


@router.post("/collections", status_code=status.HTTP_201_CREATED)
def create_collection(
    body: CollectionCreate,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> dict:
    existing = session.execute(
        select(Collection).where(Collection.trip_id == trip.id, Collection.name == body.name)
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "That collection already exists.")
    collection = Collection(trip_id=trip.id, name=body.name, colour=body.colour)
    session.add(collection)
    session.flush()
    return {"id": collection.id, "name": collection.name, "colour": collection.colour}


@router.get("/places/search/provider")
def search_provider(
    q: str = Query(min_length=2),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lon: float | None = Query(default=None, ge=-180, le=180),
    trip: Trip = Depends(current_trip),
) -> list[dict]:
    """Manual place search, for when extraction got it wrong (spec 7.3)."""
    _ = trip
    return [
        {
            "provider": r.provider,
            "provider_place_id": r.provider_place_id,
            "name": r.name,
            "lat": r.lat,
            "lon": r.lon,
            "category": r.category,
            "address": r.address,
            "city": r.city,
            "country": r.country,
            "match_confidence": r.match_confidence,
        }
        for r in get_places().resolve(q, near_lat=lat, near_lon=lon)
    ]
