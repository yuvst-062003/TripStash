"""Deriving a route's dates from its night counts.

The stored truth is `Destination.nights`. Dates are computed, never typed: a
stop's arrival is the trip's start date plus every night booked before it, so
taking a night off one stop moves every stop after it. That shift is the whole
point of the planner, and it belongs here rather than in a column or in the
browser.

`arrive_on` / `depart_on` stay on the row as a projection of this computation,
because the account export and the older trip screen already read them.
`reschedule` is the only writer.

A stop whose nights are undecided is honest about it: it has an arrival but no
departure, and every stop after it is undated until a number is chosen. Spec
7.1 forbids making exact dates mandatory, so "I don't know yet" has to be a
representable state rather than a zero.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from app.models.core import Destination, Trip
from app.services.spatial import haversine_km

# A long-distance bus or train average, stops included. One documented number,
# used for every leg, so the figure is reproducible rather than a feeling.
GROUND_SPEED_KMH = 55.0

# Past this, a ground duration is fiction, and guessing "flight" from a
# distance is inventing an itinerary the traveller never described. Beyond the
# limit the leg reports its distance and no duration.
GROUND_ESTIMATE_LIMIT_KM = 1200.0

MAX_NIGHTS = 365


@dataclass(frozen=True)
class TransportLeg:
    """The gap between two consecutive stops. Always labelled an estimate."""

    from_destination_id: str
    to_destination_id: str
    distance_km: float | None
    duration_minutes: int | None


@dataclass(frozen=True)
class ScheduledStop:
    destination: Destination
    arrive_on: date | None
    depart_on: date | None
    nights: int | None
    # How you reach this stop from the previous one; None for the first stop.
    leg_in: TransportLeg | None


@dataclass(frozen=True)
class Schedule:
    stops: list[ScheduledStop]
    total_nights: int
    start_date: date | None
    end_date: date | None

    @property
    def has_end_date(self) -> bool:
        """False while any stop's nights are undecided, or there is no start."""
        return self.end_date is not None


def _ordered(trip: Trip) -> list[Destination]:
    # `position` is the ordering; the id only breaks a tie between duplicate
    # positions. Timestamps are deliberately not part of the key: SQLite hands
    # them back naive and an unsaved stop has none at all, so either would
    # make the comparison throw rather than sort.
    return sorted(trip.destinations, key=lambda d: (d.position, d.id or ""))


def _leg_between(previous: Destination, current: Destination) -> TransportLeg:
    distance = None
    duration = None
    if None not in (previous.lat, previous.lon, current.lat, current.lon):
        distance = round(
            haversine_km(previous.lat, previous.lon, current.lat, current.lon),  # type: ignore[arg-type]
            1,
        )
        if distance <= GROUND_ESTIMATE_LIMIT_KM:
            duration = max(1, round(distance / GROUND_SPEED_KMH * 60))
    return TransportLeg(
        from_destination_id=previous.id,
        to_destination_id=current.id,
        distance_km=distance,
        duration_minutes=duration,
    )


def schedule(trip: Trip) -> Schedule:
    """Compute the route's dates. Pure: nothing is written."""
    stops: list[ScheduledStop] = []
    cursor = trip.start_date
    total = 0
    previous: Destination | None = None

    for destination in _ordered(trip):
        nights = destination.nights
        arrive = cursor
        if nights is None:
            depart = None
            # The chain breaks here on purpose: without a number, no later
            # date can be derived, and showing one would be a guess.
            cursor = None
        else:
            total += nights
            depart = arrive + timedelta(days=nights) if arrive is not None else None
            cursor = depart

        stops.append(
            ScheduledStop(
                destination=destination,
                arrive_on=arrive,
                depart_on=depart,
                nights=nights,
                leg_in=_leg_between(previous, destination) if previous is not None else None,
            )
        )
        previous = destination

    return Schedule(
        stops=stops,
        total_nights=total,
        start_date=trip.start_date,
        end_date=stops[-1].depart_on if stops else None,
    )


def reschedule(trip: Trip) -> Schedule:
    """Compute, then write the derived dates back onto the rows."""
    computed = schedule(trip)
    for stop in computed.stops:
        stop.destination.arrive_on = stop.arrive_on
        stop.destination.depart_on = stop.depart_on
    # The trip's own end follows the route; its start is the traveller's.
    trip.end_date = computed.end_date
    return computed


def set_nights(trip: Trip, destination_id: str, nights: int | None) -> Schedule:
    """Set one stop's nights and shift everything after it.

    Raises `LookupError` when the stop is not on this trip and `ValueError`
    when the count is not a number of nights anyone could stay.
    """
    if nights is not None and not 0 <= nights <= MAX_NIGHTS:
        raise ValueError(f"Nights must be between 0 and {MAX_NIGHTS}.")

    target = next((d for d in trip.destinations if d.id == destination_id), None)
    if target is None:
        raise LookupError(destination_id)

    target.nights = nights
    return reschedule(trip)


def renumber(trip: Trip) -> None:
    """Close gaps in `position` so inserting stays predictable."""
    for index, destination in enumerate(_ordered(trip)):
        destination.position = index


def position_for_insert(trip: Trip, after_position: int | None) -> int:
    """Where a new stop lands, and shuffle the rest down to make room.

    `None` appends. Otherwise the stop goes directly after the given position,
    which is what the `+` between two stops means.
    """
    existing = _ordered(trip)
    if after_position is None:
        return len(existing)

    index = max(0, min(after_position + 1, len(existing)))
    for destination in existing[index:]:
        destination.position += 1
    return index
