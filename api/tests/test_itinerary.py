"""The itinerary: nights are stored, dates are derived, later stops shift."""

from __future__ import annotations

from datetime import date

import pytest

from app.models.core import Destination, Trip
from app.services import itinerary


def _trip(start: date | None = date(2026, 3, 1), **stops: int | None) -> Trip:
    """A trip whose stops are given as name=nights, in order."""
    trip = Trip(id="t1", user_id="u1", name="South America", start_date=start)
    trip.destinations = [
        Destination(id=f"d{index}", trip_id="t1", name=name, position=index, nights=nights)
        for index, (name, nights) in enumerate(stops.items())
    ]
    return trip


def test_dates_derive_from_the_start_date_and_the_running_night_count():
    computed = itinerary.schedule(_trip(Rio=3, Paraty=2))

    rio, paraty = computed.stops
    assert (rio.arrive_on, rio.depart_on) == (date(2026, 3, 1), date(2026, 3, 4))
    # You leave Rio on the 4th and that is the day you reach Paraty.
    assert (paraty.arrive_on, paraty.depart_on) == (date(2026, 3, 4), date(2026, 3, 6))
    assert computed.total_nights == 5
    assert computed.end_date == date(2026, 3, 6)


def test_taking_a_night_off_one_stop_moves_every_stop_after_it():
    trip = _trip(Rio=3, Paraty=2, Paulo=4)

    after = itinerary.set_nights(trip, "d0", 2)

    rio, paraty, paulo = after.stops
    assert rio.depart_on == date(2026, 3, 3)
    assert paraty.arrive_on == date(2026, 3, 3)
    assert paulo.arrive_on == date(2026, 3, 5)
    assert after.total_nights == 8
    # The trip's own end follows the route rather than being typed.
    assert trip.end_date == date(2026, 3, 9)


def test_adding_a_night_moves_the_rest_the_other_way():
    trip = _trip(Rio=3, Paraty=2)

    after = itinerary.set_nights(trip, "d0", 4)

    assert after.stops[1].arrive_on == date(2026, 3, 5)
    assert after.end_date == date(2026, 3, 7)


def test_reschedule_writes_the_derived_dates_back_onto_the_rows():
    trip = _trip(Rio=3, Paraty=2)

    itinerary.reschedule(trip)

    assert trip.destinations[0].arrive_on == date(2026, 3, 1)
    assert trip.destinations[1].depart_on == date(2026, 3, 6)


def test_an_undecided_stop_breaks_the_chain_instead_of_guessing():
    computed = itinerary.schedule(_trip(Rio=3, Paraty=None, Paulo=4))

    rio, paraty, paulo = computed.stops
    assert rio.depart_on == date(2026, 3, 4)
    # You know when you arrive in Paraty, not when you leave.
    assert paraty.arrive_on == date(2026, 3, 4)
    assert paraty.depart_on is None
    # And nothing after it can be dated without inventing a number.
    assert paulo.arrive_on is None
    assert paulo.depart_on is None
    assert computed.end_date is None
    assert computed.has_end_date is False
    # The nights that *are* known still count.
    assert computed.total_nights == 7


def test_a_trip_with_no_start_date_keeps_its_order_and_its_nights():
    computed = itinerary.schedule(_trip(None, Rio=3, Paraty=2))

    assert [stop.destination.name for stop in computed.stops] == ["Rio", "Paraty"]
    assert all(stop.arrive_on is None for stop in computed.stops)
    assert computed.total_nights == 5
    assert computed.has_end_date is False


def test_zero_nights_is_a_stop_you_pass_through_not_an_undecided_one():
    computed = itinerary.schedule(_trip(Rio=3, Border=0, Paulo=2))

    border = computed.stops[1]
    assert border.arrive_on == border.depart_on == date(2026, 3, 4)
    assert computed.stops[2].arrive_on == date(2026, 3, 4)
    assert computed.end_date == date(2026, 3, 6)


def test_nights_outside_a_plausible_stay_are_refused():
    trip = _trip(Rio=3)

    with pytest.raises(ValueError):
        itinerary.set_nights(trip, "d0", -1)
    with pytest.raises(ValueError):
        itinerary.set_nights(trip, "d0", itinerary.MAX_NIGHTS + 1)
    assert trip.destinations[0].nights == 3


def test_a_stop_from_another_trip_is_not_reachable():
    with pytest.raises(LookupError):
        itinerary.set_nights(_trip(Rio=3), "someone-elses-stop", 2)


def test_clearing_the_nights_undates_the_rest_of_the_route():
    trip = _trip(Rio=3, Paraty=2)

    after = itinerary.set_nights(trip, "d0", None)

    assert after.stops[0].depart_on is None
    assert after.stops[1].arrive_on is None
    assert trip.end_date is None


def test_a_leg_carries_a_distance_and_a_ground_duration():
    trip = _trip(Rio=3, Paraty=2)
    trip.destinations[0].lat, trip.destinations[0].lon = -22.9068, -43.1729
    trip.destinations[1].lat, trip.destinations[1].lon = -23.2186, -44.7158

    leg = itinerary.schedule(trip).stops[1].leg_in

    assert leg is not None
    assert leg.from_destination_id == "d0"
    assert 150 < leg.distance_km < 180
    assert leg.duration_minutes == round(leg.distance_km / itinerary.GROUND_SPEED_KMH * 60)


def test_a_leg_too_long_to_drive_reports_distance_without_a_duration():
    trip = _trip(Rio=3, Bogota=2)
    trip.destinations[0].lat, trip.destinations[0].lon = -22.9068, -43.1729
    trip.destinations[1].lat, trip.destinations[1].lon = 4.7110, -74.0721

    leg = itinerary.schedule(trip).stops[1].leg_in

    assert leg is not None
    assert leg.distance_km > itinerary.GROUND_ESTIMATE_LIMIT_KM
    # Guessing "flight, 6h" would be inventing an itinerary nobody described.
    assert leg.duration_minutes is None


def test_a_leg_to_a_stop_with_no_coordinates_claims_nothing():
    leg = itinerary.schedule(_trip(Rio=3, Somewhere=2)).stops[1].leg_in

    assert leg is not None
    assert leg.distance_km is None
    assert leg.duration_minutes is None


def test_the_first_stop_has_no_incoming_leg():
    assert itinerary.schedule(_trip(Rio=3)).stops[0].leg_in is None


def test_inserting_after_a_stop_shuffles_the_later_ones_down():
    trip = _trip(Rio=3, Paraty=2, Paulo=4)

    index = itinerary.position_for_insert(trip, after_position=0)

    assert index == 1
    assert [(d.name, d.position) for d in trip.destinations] == [
        ("Rio", 0),
        ("Paraty", 2),
        ("Paulo", 3),
    ]


def test_inserting_with_no_anchor_appends():
    trip = _trip(Rio=3, Paraty=2)

    assert itinerary.position_for_insert(trip, after_position=None) == 2
    assert [d.position for d in trip.destinations] == [0, 1]


def test_renumber_closes_the_gap_an_insert_or_a_delete_leaves():
    trip = _trip(Rio=3, Paraty=2, Paulo=4)
    trip.destinations[1].position = 7

    itinerary.renumber(trip)

    # Moving Paraty to position 7 moved it to the end of the route, and
    # renumbering closes the gap without changing that order.
    in_order = sorted(trip.destinations, key=lambda d: d.position)
    assert [(d.name, d.position) for d in in_order] == [
        ("Rio", 0),
        ("Paulo", 1),
        ("Paraty", 2),
    ]


def test_an_empty_route_schedules_to_nothing():
    computed = itinerary.schedule(_trip())

    assert computed.stops == []
    assert computed.total_nights == 0
    assert computed.end_date is None
