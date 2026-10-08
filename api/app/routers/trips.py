"""Trip and flexible-route endpoints."""

from __future__ import annotations

from datetime import date

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
    RouteResponse,
    RouteStopResponse,
    TransportLegResponse,
    TripCreate,
    TripResponse,
    TripUpdate,
)
from app.services import itinerary
from app.services.discover import discover_between
from app.services.trip_advice import route_checks, stop_suggestions

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
        alternatives=[
            DestinationResponse.model_validate(d)
            for d in sorted(trip.destinations, key=lambda d: (d.position, d.id or ""))
            if d.on_route is False
        ],
    )


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
    # These columns cannot be empty. Sending null for one is a mistake to
    # name, not a database error to surface as a 500.
    for required in ("name", "base_currency"):
        if required in changes and changes[required] is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, f"A trip's {required} cannot be empty."
            )

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
    if trip.destinations and changes.keys() & {"start_date", "end_date"}:
        # Once there is a route, its stops' dates hang off the start and the
        # trip's end follows their nights; a typed end would contradict it.
        itinerary.reschedule(trip)
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
    # Dates come from the order as much as from the nights.
    session.refresh(trip)
    itinerary.reschedule(trip)
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
    if body.is_current:
        # Marking a stop as "here now" clears the flag on every other stop.
        for other in trip.destinations:
            other.is_current = False
        destination.is_current = True
    elif "is_current" in sent and body.is_current is False:
        destination.is_current = False
    if "name" in sent and body.name is not None:
        destination.name = body.name
    if "notes" in sent:
        destination.notes = body.notes

    if "on_route" in sent and body.on_route is not None:
        # Setting a stop aside keeps its nights, so putting it back restores
        # the stay it had; it just stops counting while it is an alternative.
        destination.on_route = body.on_route
        if not body.on_route:
            destination.is_current = False

    if "nights" in sent:
        try:
            computed = itinerary.set_nights(trip, destination_id, body.nights)
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    else:
        computed = itinerary.reschedule(trip)

    session.flush()
    return serialise_route(trip, computed)


@router.get("/current/checks")
def get_checks(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> list[dict]:
    """What the assistant notices about the route. Read-only; a fix is a proposal."""
    return [check.to_dict() for check in route_checks(session, trip)]


@router.get("/current/suggestions")
def get_stop_suggestions(
    after: str | None = None,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> list[dict]:
    """Cities from your own library that the route skips, cheapest detour first."""
    anchor = next((d for d in trip.destinations if d.id == after), None) if after else None
    if after and anchor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Destination not found.")
    return [s.to_dict() for s in stop_suggestions(session, trip, anchor)]


@router.get("/current/discover")
def get_discover(
    after: str | None = None,
    trip: Trip = Depends(current_trip),
) -> dict:
    """What travellers say about the stretch after a stop: Gringo, the web,
    Reddit and YouTube, each labelled, snippet and link only."""
    ordered = sorted(trip.destinations, key=lambda d: (d.position, d.id or ""))
    anchor = next((d for d in ordered if d.id == after), None) if after else None
    if after and anchor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Destination not found.")
    later = [d for d in ordered if anchor is not None and d.position > anchor.position]
    return discover_between(anchor, later[0] if later else None)
