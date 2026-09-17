"""Home dashboard, day plan, bookings and money."""

from __future__ import annotations

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.adapters import get_fx, get_weather
from app.db import get_session
from app.deps import current_trip, owned_or_404
from app.models.capture import ExtractionCandidate, Source
from app.models.core import Destination, Trip
from app.models.enums import CandidateStatus, PlaceStatus, SourceStatus, TripPhase
from app.models.ops import Booking, Expense, ItineraryItem, SyncOperation
from app.models.places import TripPlace
from app.schemas.api import BookingCreate, ExpenseCreate, ItineraryCreate
from app.services.resurfacing import resurface

router = APIRouter(tags=["planner"])


@router.get("/home")
def home(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lon: float | None = Query(default=None, ge=-180, le=180),
    on: date | None = Query(default=None),
) -> dict:
    """A contextual dashboard that links elsewhere rather than duplicating it."""
    today = on or datetime.now(UTC).date()
    phase = trip.phase(today)

    current_destination = session.execute(
        select(Destination).where(Destination.trip_id == trip.id, Destination.is_current.is_(True))
    ).scalar_one_or_none()

    awaiting_review = session.execute(
        select(func.count(ExtractionCandidate.id)).where(
            ExtractionCandidate.trip_id == trip.id,
            ExtractionCandidate.status == CandidateStatus.PENDING,
        )
    ).scalar_one()
    failed_sources = session.execute(
        select(func.count(Source.id)).where(
            Source.trip_id == trip.id, Source.status == SourceStatus.FAILED
        )
    ).scalar_one()

    today_plan = list(
        session.execute(
            select(ItineraryItem)
            .where(ItineraryItem.trip_id == trip.id, ItineraryItem.on_date == today)
            .order_by(ItineraryItem.start_time.is_(None), ItineraryItem.start_time)
        ).scalars()
    )
    spent_total = session.execute(
        select(func.coalesce(func.sum(Expense.amount_base), 0.0)).where(Expense.trip_id == trip.id)
    ).scalar_one()
    spent_today = session.execute(
        select(func.coalesce(func.sum(Expense.amount_base), 0.0)).where(
            Expense.trip_id == trip.id, Expense.spent_on == today
        )
    ).scalar_one()

    upcoming_bookings = list(
        session.execute(
            select(Booking)
            .where(Booking.trip_id == trip.id)
            .order_by(Booking.start_at.is_(None), Booking.start_at)
            .limit(5)
        ).scalars()
    )

    weather = None
    origin = (
        (lat, lon)
        if lat is not None and lon is not None
        else (
            (current_destination.lat, current_destination.lon)
            if current_destination and current_destination.lat is not None
            else None
        )
    )
    if origin:
        reading = get_weather().forecast(origin[0], origin[1], today)
        weather = {
            "summary": reading.summary,
            "temperature_c": reading.temperature_c,
            "precipitation_probability": reading.precipitation_probability,
            "checked_at": reading.checked_at.isoformat(),
        }

    nearby = (
        [item.to_dict() for item in resurface(
            session,
            trip_id=trip.id,
            lat=origin[0] if origin else None,
            lon=origin[1] if origin else None,
            on=today,
            destination_scope=current_destination.name if current_destination else None,
            limit=5,
        )]
    )

    counts = dict(
        session.execute(
            select(TripPlace.status, func.count(TripPlace.id))
            .where(TripPlace.trip_id == trip.id)
            .group_by(TripPlace.status)
        ).all()
    )

    daily_budget = None
    if trip.total_budget is not None:
        remaining_budget = trip.total_budget - spent_total
        days_left = (
            max((trip.end_date - today).days + 1, 1)
            if trip.end_date and trip.end_date >= today
            else None
        )
        daily_budget = {
            "remaining": round(remaining_budget, 2),
            "per_day": round(remaining_budget / days_left, 2) if days_left else None,
            "days_left": days_left,
        }

    return {
        "phase": str(phase),
        "date": today.isoformat(),
        "trip": {"id": trip.id, "name": trip.name, "base_currency": trip.base_currency},
        "countdown_days": (
            (trip.start_date - today).days
            if trip.start_date and phase is TripPhase.BEFORE
            else None
        ),
        "current_destination": (
            {
                "id": current_destination.id,
                "name": current_destination.name,
                "country": current_destination.country,
            }
            if current_destination
            else None
        ),
        "weather": weather,
        "review_queue": {"pending_candidates": awaiting_review, "failed_sources": failed_sources},
        "place_counts": {str(k): v for k, v in counts.items()},
        "today_plan": [
            {
                "id": item.id,
                "title": item.title,
                "start_time": item.start_time,
                "trip_place_id": item.trip_place_id,
                "is_done": item.is_done,
            }
            for item in today_plan
        ],
        "money": {
            "currency": trip.base_currency,
            "spent_total": round(spent_total, 2),
            "spent_today": round(spent_today, 2),
            "budget": trip.total_budget,
            "daily": daily_budget,
        },
        "bookings": [
            {
                "id": b.id,
                "title": b.title,
                "kind": b.kind,
                "start_at": b.start_at.isoformat() if b.start_at else None,
                "cancellation_deadline": (
                    b.cancellation_deadline.isoformat() if b.cancellation_deadline else None
                ),
            }
            for b in upcoming_bookings
        ],
        "resurfaced": nearby,
        # Drives the empty states in spec 5.1 rather than leaving the client to guess.
        "empty_state": _empty_state(counts, awaiting_review, origin is not None),
    }


def _empty_state(counts: dict, pending: int, has_location: bool) -> str | None:
    if not counts:
        return "new_trip"
    if pending:
        return "review_waiting"
    if not has_location:
        return "location_unavailable"
    return None


# ------------------------------------------------------------------- plan


@router.get("/itinerary")
def list_itinerary(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
    on: date | None = Query(default=None),
) -> list[dict]:
    stmt = select(ItineraryItem).where(ItineraryItem.trip_id == trip.id)
    if on:
        stmt = stmt.where(ItineraryItem.on_date == on)
    rows = session.execute(stmt.order_by(ItineraryItem.on_date, ItineraryItem.start_time)).scalars()
    return [
        {
            "id": item.id,
            "title": item.title,
            "on_date": item.on_date.isoformat(),
            "start_time": item.start_time,
            "end_time": item.end_time,
            "trip_place_id": item.trip_place_id,
            "notes": item.notes,
            "is_done": item.is_done,
        }
        for item in rows
    ]


@router.post("/itinerary", status_code=status.HTTP_201_CREATED)
def add_to_plan(
    body: ItineraryCreate,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> dict:
    title = body.title
    trip_place = None
    if body.trip_place_id:
        trip_place = owned_or_404(
            session.get(TripPlace, body.trip_place_id), trip, "Place not found in this trip."
        )
        title = title or trip_place.place.name
        if trip_place.status in (PlaceStatus.INBOX, PlaceStatus.SAVED):
            trip_place.status = PlaceStatus.PLANNED
    if not title:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A plan entry needs a title.")

    item = ItineraryItem(
        trip_id=trip.id,
        trip_place_id=body.trip_place_id,
        destination_id=body.destination_id,
        title=title,
        on_date=body.on_date,
        start_time=body.start_time,
        end_time=body.end_time,
        notes=body.notes,
    )
    session.add(item)
    session.flush()
    return {"id": item.id, "title": item.title, "on_date": item.on_date.isoformat()}


@router.delete("/itinerary/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_from_plan(
    item_id: str,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> None:
    item = owned_or_404(session.get(ItineraryItem, item_id), trip, "Plan entry not found.")
    session.delete(item)


# --------------------------------------------------------------- bookings


@router.get("/bookings")
def list_bookings(
    session: Session = Depends(get_session), trip: Trip = Depends(current_trip)
) -> list[dict]:
    rows = session.execute(
        select(Booking).where(Booking.trip_id == trip.id).order_by(Booking.start_at)
    ).scalars()
    return [
        {
            "id": b.id,
            "kind": b.kind,
            "title": b.title,
            "provider": b.provider,
            "confirmation_code": b.confirmation_code,
            "place_id": b.place_id,
            "start_at": b.start_at.isoformat() if b.start_at else None,
            "end_at": b.end_at.isoformat() if b.end_at else None,
            "cancellation_deadline": (
                b.cancellation_deadline.isoformat() if b.cancellation_deadline else None
            ),
            "amount": b.amount,
            "currency": b.currency,
        }
        for b in rows
    ]


@router.post("/bookings", status_code=status.HTTP_201_CREATED)
def import_booking(
    body: BookingCreate,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> dict:
    """Import a confirmation the provider already issued.

    TripStash never books anything itself, so a booking only ever exists here
    because the traveller brought the confirmation back (spec 6.4).
    """
    booking = Booking(
        trip_id=trip.id,
        destination_id=body.destination_id,
        place_id=body.place_id,
        kind=body.kind,
        title=body.title,
        provider=body.provider,
        confirmation_code=body.confirmation_code,
        start_at=body.start_at,
        end_at=body.end_at,
        cancellation_deadline=body.cancellation_deadline,
        amount=body.amount,
        currency=(body.currency or trip.base_currency).upper(),
        notes=body.notes,
    )
    session.add(booking)
    session.flush()
    return {"id": booking.id, "title": booking.title}


# ------------------------------------------------------------------ money


@router.get("/expenses")
def list_expenses(
    session: Session = Depends(get_session), trip: Trip = Depends(current_trip)
) -> dict:
    rows = list(
        session.execute(
            select(Expense).where(Expense.trip_id == trip.id).order_by(Expense.spent_on.desc())
        ).scalars()
    )
    by_category: dict[str, float] = {}
    for expense in rows:
        by_category[expense.category] = by_category.get(expense.category, 0.0) + expense.amount_base

    return {
        "currency": trip.base_currency,
        "total": round(sum(e.amount_base for e in rows), 2),
        "by_category": {k: round(v, 2) for k, v in sorted(by_category.items())},
        "items": [
            {
                "id": e.id,
                "spent_on": e.spent_on.isoformat(),
                "amount": e.amount,
                "currency": e.currency,
                "amount_base": round(e.amount_base, 2),
                "category": e.category,
                "place_id": e.place_id,
                "note": e.note,
            }
            for e in rows
        ],
    }


@router.post("/expenses", status_code=status.HTTP_201_CREATED)
def add_expense(
    body: ExpenseCreate,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> dict:
    """Manual entry, converted at capture time and safe to replay offline."""
    if body.client_op_id:
        existing = session.execute(
            select(SyncOperation).where(SyncOperation.client_op_id == body.client_op_id)
        ).scalar_one_or_none()
        if existing is not None:
            return {"id": existing.payload_json, "idempotent_replay": True}

    try:
        rate = get_fx().rate(body.currency.upper(), trip.base_currency)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    expense = Expense(
        trip_id=trip.id,
        destination_id=body.destination_id,
        place_id=body.place_id,
        spent_on=body.spent_on,
        amount=body.amount,
        currency=body.currency.upper(),
        amount_base=round(body.amount * rate, 2),
        category=body.category,
        country=body.country,
        note=body.note,
    )
    session.add(expense)
    session.flush()

    if body.client_op_id:
        session.add(
            SyncOperation(
                trip_id=trip.id,
                client_op_id=body.client_op_id,
                operation="expense.create",
                payload_json=expense.id,
                applied_at=datetime.now(UTC),
            )
        )
    return {
        "id": expense.id,
        "amount_base": expense.amount_base,
        "rate_used": round(rate, 6),
        "currency": trip.base_currency,
    }
