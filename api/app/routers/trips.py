"""Trip and flexible-route endpoints."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.deps import current_trip, current_user
from app.models.core import Destination, Trip, User
from app.schemas.api import (
    DestinationCreate,
    DestinationResponse,
    DestinationUpdate,
    TripCreate,
    TripResponse,
)

router = APIRouter(prefix="/trips", tags=["trip"])


def serialise_trip(trip: Trip) -> TripResponse:
    return TripResponse(
        id=trip.id,
        name=trip.name,
        start_date=trip.start_date,
        end_date=trip.end_date,
        base_currency=trip.base_currency,
        total_budget=trip.total_budget,
        interests=[i for i in (trip.interests or "").split(",") if i],
        phase=str(trip.phase(datetime.now(UTC).date())),
        destinations=[DestinationResponse.model_validate(d) for d in trip.destinations],
    )


@router.post("", response_model=TripResponse, status_code=status.HTTP_201_CREATED)
def create_trip(
    body: TripCreate,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
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
    return serialise_trip(trip)


@router.get("/current", response_model=TripResponse)
def get_current(trip: Trip = Depends(current_trip)) -> TripResponse:
    return serialise_trip(trip)


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
