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
    RouteResponse,
    RouteStopResponse,
    TransportLegResponse,
    TripCreate,
    TripResponse,
)
from app.services import itinerary

router = APIRouter(prefix="/trips", tags=["trip"])


def serialise_route(trip: Trip, computed: itinerary.Schedule) -> RouteResponse:
    """The schedule as the planner reads it. All arithmetic happened in the service."""
    return RouteResponse(
        trip_id=trip.id,
        start_date=computed.start_date,
        end_date=computed.end_date,
        has_end_date=computed.has_end_date,
        total_nights=computed.total_nights,
        stops=[
            RouteStopResponse(
                destination=DestinationResponse.model_validate(stop.destination),
                arrive_on=stop.arrive_on,
                depart_on=stop.depart_on,
                nights=stop.nights,
                leg_in=(
                    TransportLegResponse(
                        from_destination_id=stop.leg_in.from_destination_id,
                        to_destination_id=stop.leg_in.to_destination_id,
                        distance_km=stop.leg_in.distance_km,
                        duration_minutes=stop.leg_in.duration_minutes,
                    )
                    if stop.leg_in
                    else None
                ),
            )
            for stop in computed.stops
        ],
    )


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
        nights=body.nights,
        is_current=body.is_current,
        notes=body.notes,
        position=itinerary.position_for_insert(trip, body.after_position),
    )
    session.add(destination)
    session.flush()
    # Dates are derived, so inserting a stop re-dates the ones after it.
    itinerary.reschedule(trip)
    session.flush()
    return destination


@router.delete("/current/destinations/{destination_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_destination(
    destination_id: str,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> None:
    destination = next((d for d in trip.destinations if d.id == destination_id), None)
    if destination is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Destination not found.")
    # delete-orphan does the DB delete; taking it out of the collection first
    # lets renumber and reschedule see the route the traveller will see.
    trip.destinations.remove(destination)
    itinerary.renumber(trip)
    itinerary.reschedule(trip)
    session.flush()


@router.get("/current/route", response_model=RouteResponse)
def get_route(trip: Trip = Depends(current_trip)) -> RouteResponse:
    """The itinerary: stored nights, derived dates, estimated legs."""
    return serialise_route(trip, itinerary.schedule(trip))


@router.patch("/current/destinations/{destination_id}", response_model=RouteResponse)
def update_destination(
    destination_id: str,
    body: DestinationUpdate,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> RouteResponse:
    """Change a stop. Returns the whole route, because one stop moves the rest."""
    destination = next((d for d in trip.destinations if d.id == destination_id), None)
    if destination is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Destination not found.")

    sent = body.model_fields_set
    if "name" in sent and body.name is not None:
        destination.name = body.name
    if "notes" in sent:
        destination.notes = body.notes

    if "nights" in sent:
        try:
            computed = itinerary.set_nights(trip, destination_id, body.nights)
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    else:
        computed = itinerary.schedule(trip)

    session.flush()
    return serialise_route(trip, computed)
