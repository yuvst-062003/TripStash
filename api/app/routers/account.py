"""Offline bundle, export and permanent deletion (spec 7.1, 11.3, 11.4)."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.deps import audit, current_trip, current_user
from app.models.capture import KnowledgeItem, Source, SourcePlaceEvidence
from app.models.core import Trip, User
from app.models.enums import ACTIVE_PLACE_STATUSES
from app.models.ops import Booking, Document, Expense, ItineraryItem
from app.models.places import Collection, Place, PlaceFact, TripPlace
from app.services.freshness import serialise_fact

router = APIRouter(tags=["account"])


@router.get("/offline-bundle")
def offline_bundle(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
    on: date | None = Query(default=None),
) -> dict:
    """The offline contract (spec 11.3).

    Everything here is safe to cache on the device: coordinates, notes, source
    summaries, today's plan and booking details. Live facts travel with their
    last-checked label so the client can mark them stale rather than silently
    presenting week-old opening hours as current.
    """
    today = on or datetime.now(UTC).date()

    trip_places = list(
        session.execute(
            select(TripPlace)
            .join(Place, Place.id == TripPlace.place_id)
            .where(TripPlace.trip_id == trip.id, TripPlace.status.in_(ACTIVE_PLACE_STATUSES))
        ).scalars().unique()
    )
    facts_by_place: dict[str, list[dict]] = {}
    for fact in session.execute(
        select(PlaceFact).where(PlaceFact.place_id.in_([tp.place_id for tp in trip_places] or [""]))
    ).scalars():
        facts_by_place.setdefault(fact.place_id, []).append(serialise_fact(fact))

    evidence_counts: dict[str, int] = {}
    for row in session.execute(
        select(SourcePlaceEvidence).where(SourcePlaceEvidence.trip_id == trip.id)
    ).scalars():
        evidence_counts[row.place_id] = evidence_counts.get(row.place_id, 0) + 1

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "trip": {
            "id": trip.id,
            "name": trip.name,
            "base_currency": trip.base_currency,
            "phase": str(trip.phase(today)),
            "destinations": [
                {"id": d.id, "name": d.name, "country": d.country, "lat": d.lat, "lon": d.lon}
                for d in trip.destinations
            ],
        },
        "places": [
            {
                "trip_place_id": tp.id,
                "place_id": tp.place_id,
                "name": tp.place.name,
                "category": tp.place.category,
                "lat": tp.place.lat,
                "lon": tp.place.lon,
                "address": tp.place.address,
                "status": str(tp.status),
                "is_favourite": tp.is_favourite,
                "why_saved": tp.reason_saved,
                "notes": tp.notes,
                "source_count": evidence_counts.get(tp.place_id, 0),
                "cached_facts": facts_by_place.get(tp.place_id, []),
            }
            for tp in trip_places
        ],
        "today": [
            {
                "id": item.id,
                "title": item.title,
                "start_time": item.start_time,
                "trip_place_id": item.trip_place_id,
            }
            for item in session.execute(
                select(ItineraryItem).where(
                    ItineraryItem.trip_id == trip.id, ItineraryItem.on_date == today
                )
            ).scalars()
        ],
        "bookings": [
            {
                "id": b.id,
                "title": b.title,
                "kind": b.kind,
                "confirmation_code": b.confirmation_code,
                "start_at": b.start_at.isoformat() if b.start_at else None,
                "end_at": b.end_at.isoformat() if b.end_at else None,
            }
            for b in session.execute(select(Booking).where(Booking.trip_id == trip.id)).scalars()
        ],
        "knowledge": [
            {
                "id": k.id,
                "type": k.type,
                "title": k.title,
                "body": k.body,
                "destination_scope": k.destination_scope,
                "requires_official_verification": k.requires_official_verification,
            }
            for k in session.execute(
                select(KnowledgeItem).where(
                    KnowledgeItem.trip_id == trip.id, KnowledgeItem.is_archived.is_(False)
                )
            ).scalars()
        ],
        "offline_files": [
            {"id": d.id, "title": d.title, "kind": d.kind}
            for d in session.execute(
                select(Document).where(
                    Document.trip_id == trip.id,
                    Document.available_offline.is_(True),
                    Document.is_sensitive.is_(False),
                )
            ).scalars()
        ],
        "notice": (
            "Live facts in this bundle carry the time they were last checked. "
            "Treat anything older than a few days as unconfirmed."
        ),
    }


@router.get("/export")
def export_trip(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
    user: User = Depends(current_user),
) -> Response:
    """Full export: places, sources, notes, statuses, route, bookings, expenses."""
    audit(session, user_id=user.id, action="account.export", subject=trip.id)

    def rows(model, **filters):
        stmt = select(model)
        for field, value in filters.items():
            stmt = stmt.where(getattr(model, field) == value)
        return list(session.execute(stmt).scalars())

    trip_places = rows(TripPlace, trip_id=trip.id)

    payload = {
        "format": "tripstash.export.v1",
        "exported_at": datetime.now(UTC).isoformat(),
        "user": {"email": user.email, "base_currency": user.base_currency},
        "trip": {
            "name": trip.name,
            "start_date": trip.start_date.isoformat() if trip.start_date else None,
            "end_date": trip.end_date.isoformat() if trip.end_date else None,
            "base_currency": trip.base_currency,
            "total_budget": trip.total_budget,
        },
        "destinations": [
            {
                "name": d.name,
                "country": d.country,
                "lat": d.lat,
                "lon": d.lon,
                "arrive_on": d.arrive_on.isoformat() if d.arrive_on else None,
                "depart_on": d.depart_on.isoformat() if d.depart_on else None,
                "notes": d.notes,
            }
            for d in trip.destinations
        ],
        "places": [
            {
                "name": tp.place.name,
                "category": tp.place.category,
                "lat": tp.place.lat,
                "lon": tp.place.lon,
                "address": tp.place.address,
                "city": tp.place.city,
                "country": tp.place.country,
                "provider": tp.place.provider,
                "provider_place_id": tp.place.provider_place_id,
                "status": str(tp.status),
                "why_saved": tp.reason_saved,
                "notes": tp.notes,
                "is_favourite": tp.is_favourite,
                "rating": tp.rating,
                "collections": [c.name for c in tp.collections],
                "visits": [
                    {
                        "visited_on": v.visited_on.isoformat(),
                        "rating": v.rating,
                        "notes": v.notes,
                        "actual_cost": v.actual_cost,
                        "currency": v.currency,
                    }
                    for v in tp.visits
                ],
            }
            for tp in trip_places
        ],
        "sources": [
            {
                "kind": str(s.kind),
                "url": s.url,
                "title": s.title,
                "author": s.author,
                "filename": s.filename,
                "published_on": s.published_on.isoformat() if s.published_on else None,
                "captured_at": s.created_at.isoformat(),
                "raw_text": s.raw_text,
                "transcript": s.transcript,
            }
            for s in rows(Source, trip_id=trip.id)
        ],
        "evidence": [
            {
                "source_id": e.source_id,
                "place_id": e.place_id,
                "takeaway": e.takeaway,
                "quote": e.quote,
                "confidence": e.confidence,
            }
            for e in rows(SourcePlaceEvidence, trip_id=trip.id)
        ],
        "knowledge": [
            {
                "type": k.type,
                "title": k.title,
                "body": k.body,
                "category": k.category,
                "destination_scope": k.destination_scope,
                "confidence": k.confidence,
                "provenance": k.provenance,
                "source_date": k.source_date.isoformat() if k.source_date else None,
                "evidence": json.loads(k.evidence_json or "[]"),
            }
            for k in rows(KnowledgeItem, trip_id=trip.id)
        ],
        "itinerary": [
            {
                "title": i.title,
                "on_date": i.on_date.isoformat(),
                "start_time": i.start_time,
                "notes": i.notes,
            }
            for i in rows(ItineraryItem, trip_id=trip.id)
        ],
        "bookings": [
            {
                "kind": b.kind,
                "title": b.title,
                "provider": b.provider,
                "confirmation_code": b.confirmation_code,
                "start_at": b.start_at.isoformat() if b.start_at else None,
                "amount": b.amount,
                "currency": b.currency,
            }
            for b in rows(Booking, trip_id=trip.id)
        ],
        "expenses": [
            {
                "spent_on": e.spent_on.isoformat(),
                "amount": e.amount,
                "currency": e.currency,
                "amount_base": e.amount_base,
                "category": e.category,
                "note": e.note,
            }
            for e in rows(Expense, trip_id=trip.id)
        ],
        "collections": [c.name for c in rows(Collection, trip_id=trip.id)],
    }
    return Response(
        content=json.dumps(payload, indent=2, ensure_ascii=False),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="tripstash-export.json"'},
    )


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
    confirm: str = Query(..., description="Must be the account email, to confirm."),
) -> None:
    """Permanent deletion. Cascades remove every trip-scoped record."""
    if confirm.lower() != user.email:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Confirm deletion by passing your account email in `confirm`.",
        )
    audit(session, user_id=user.id, action="account.delete", subject=user.id)
    session.delete(user)
