"""Trip and flexible-route endpoints."""

from __future__ import annotations

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.deps import current_trip, current_user, traveller_date
from app.models.core import Destination, Trip, User
from app.schemas.api import (
    DestinationCreate,
    DestinationOrder,
    DestinationResponse,
    DestinationUpdate,
    TripCreate,
    TripResponse,
    TripUpdate,
)

router = APIRouter(prefix="/trips", tags=["trip"])


def serialise_trip(trip: Trip, today: date) -> TripResponse:
    return TripResponse(
        id=trip.id,
        name=trip.name,
        start_date=trip.start_date,
        end_date=trip.end_date,
        base_currency=trip.base_currency,
        total_budget=trip.total_budget,
        interests=[i for i in (trip.interests or "").split(",") if i],
        phase=str(trip.phase(today)),
        destinations=[DestinationResponse.model_validate(d) for d in trip.destinations],
    )


@router.post("", response_model=TripResponse, status_code=status.HTTP_201_CREATED)
def create_trip(
    body: TripCreate,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
    today_here: date = Depends(traveller_date),
) -> TripResponse:
    if body.start_date and body.end_date and body.end_date < body.start_date:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "End date precedes start date.")

    # One active trip in the MVP: creating a new one retires the previous.
    for existing in session.execute(
        select(Trip).where(Trip.user_id == user.id, Trip.is_active.is_(True))
    ).scalars():
        existing.is_active = False

    trip = Trip(
        user_id=user.id,
        name=body.name,
        start_date=body.start_date,
        end_date=body.end_date,
        base_currency=body.base_currency.upper(),
        total_budget=body.total_budget,
        interests=",".join(body.interests) or None,
    )
    session.add(trip)
    session.flush()
    return serialise_trip(trip, today_here)


@router.get("/current", response_model=TripResponse)
def get_current(
    trip: Trip = Depends(current_trip),
    today_here: date = Depends(traveller_date),
) -> TripResponse:
    return serialise_trip(trip, today_here)


@router.patch("/current", response_model=TripResponse)
def update_trip(
    body: TripUpdate,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
    today_here: date = Depends(traveller_date),
) -> TripResponse:
    """Change the trip itself: its name, its dates, its budget, its interests.

    Until now a trip's dates could only be set when it was created, which made
    a revised plan unimportable: the one thing a new version of a plan almost
    always changes is when it leaves.
    """
    changes = body.model_dump(exclude_unset=True)

    # Checked against what the trip would become, not against what was sent, so
    # moving only the start date cannot silently invert a trip.
    start = changes.get("start_date", trip.start_date)
    end = changes.get("end_date", trip.end_date)
    if start and end and end < start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "End date precedes start date.")

    if "interests" in changes:
        interests = changes.pop("interests") or []
        trip.interests = ",".join(interests) or None
    for field, value in changes.items():
        setattr(trip, field, value)
    session.flush()
    return serialise_trip(trip, today_here)


@router.put("/current/destinations/order", response_model=list[DestinationResponse])
def reorder_destinations(
    body: DestinationOrder,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> list[Destination]:
    """Put the route in the given order.

    Every stop has to be named, because a partial order is not an order: if a
    caller could send three of twenty stops, the other seventeen would have to
    be arranged by a rule nobody asked for. Naming them all also makes the
    request idempotent and its intent readable in a log.
    """
    by_id = {d.id: d for d in trip.destinations}
    wanted = body.ids

    if len(set(wanted)) != len(wanted):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A stop is listed twice.")
    if set(wanted) != set(by_id):
        missing = len(set(by_id) - set(wanted))
        unknown = len(set(wanted) - set(by_id))
        detail = (
            f"The order must list every stop on this trip exactly once: "
            f"{missing} missing, {unknown} not on this trip."
        )
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail)

    for position, destination_id in enumerate(wanted):
        by_id[destination_id].position = position
    session.flush()
    return [by_id[destination_id] for destination_id in wanted]


@router.post(
    "/current/destinations",
    response_model=DestinationResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_destination(
    body: DestinationCreate,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> Destination:
    """Route stops exist without exact dates on purpose (spec 7.1)."""
    if body.is_current:
        for other in trip.destinations:
            other.is_current = False

    destination = Destination(
        trip_id=trip.id,
        name=body.name,
        country=body.country,
        lat=body.lat,
        lon=body.lon,
        arrive_on=body.arrive_on,
        depart_on=body.depart_on,
        is_current=body.is_current,
        notes=body.notes,
        position=len(trip.destinations),
    )
    session.add(destination)
    session.flush()
    return destination


@router.patch("/current/destinations/{destination_id}", response_model=DestinationResponse)
def update_destination(
    destination_id: str,
    body: DestinationUpdate,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> Destination:
    """Marking a stop as "here now" clears the flag on every other stop."""
    destination = session.get(Destination, destination_id)
    if destination is None or destination.trip_id != trip.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Destination not found.")
    changes = body.model_dump(exclude_unset=True)
    if changes.get("is_current"):
        for other in trip.destinations:
            other.is_current = False
    for field, value in changes.items():
        setattr(destination, field, value)
    session.flush()
    return destination


@router.delete("/current/destinations/{destination_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_destination(
    destination_id: str,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> None:
    destination = session.get(Destination, destination_id)
    if destination is None or destination.trip_id != trip.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Destination not found.")
    session.delete(destination)
