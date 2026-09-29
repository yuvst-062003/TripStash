"""What day it is where the traveller is.

Every countdown in the app - "69 days to go", "in 9 days", today's plan - was
computed from the UTC date. For a traveller in Israel that is wrong between
midnight and 3am: the app says one day has passed when it has not. For someone
in Auckland it is wrong for half of every evening, and in the other direction.

Nobody is ever in UTC. They are somewhere, and somewhere has a date.
"""

from datetime import UTC, date, datetime

from app.services.clock import traveller_today, zone_or_utc


def test_a_zone_east_of_utc_can_already_be_tomorrow():
    """The bug, pinned.

    21:40 UTC is 00:40 the next day in Jerusalem. A countdown computed in UTC
    is a day long for everyone there, every night.
    """
    at = datetime(2026, 9, 27, 21, 40, tzinfo=UTC)
    assert traveller_today("Asia/Jerusalem", now=at) == date(2026, 9, 28)
    assert traveller_today("UTC", now=at) == date(2026, 9, 27)


def test_a_zone_west_of_utc_can_still_be_yesterday():
    at = datetime(2026, 9, 28, 3, 15, tzinfo=UTC)
    assert traveller_today("America/Guatemala", now=at) == date(2026, 9, 27)


def test_the_far_side_of_the_world_is_a_whole_day_ahead():
    at = datetime(2026, 9, 27, 12, 0, tzinfo=UTC)
    assert traveller_today("Pacific/Auckland", now=at) == date(2026, 9, 28)


def test_no_zone_falls_back_to_utc_rather_than_failing():
    """A client that sends nothing must still get an answer.

    UTC is the wrong date for somebody, but it is the same wrong date the app
    had before, so nothing regresses for a client that has not been updated.
    """
    at = datetime(2026, 9, 27, 21, 40, tzinfo=UTC)
    assert traveller_today(None, now=at) == date(2026, 9, 27)
    assert traveller_today("", now=at) == date(2026, 9, 27)


def test_a_zone_that_does_not_exist_is_ignored_rather_than_trusted():
    """The header comes from a client and a client can send anything."""
    at = datetime(2026, 9, 27, 21, 40, tzinfo=UTC)
    assert traveller_today("Mars/Olympus_Mons", now=at) == date(2026, 9, 27)
    assert traveller_today("../../etc/passwd", now=at) == date(2026, 9, 27)
    assert traveller_today("A" * 500, now=at) == date(2026, 9, 27)


def test_daylight_saving_is_handled_because_the_zone_knows_about_it():
    """An offset would get this wrong; a named zone does not.

    Israel is UTC+3 in September and UTC+2 in December, so the same UTC clock
    time falls on different local dates depending on the month.
    """
    september = datetime(2026, 9, 27, 21, 30, tzinfo=UTC)
    december = datetime(2026, 12, 27, 21, 30, tzinfo=UTC)
    assert traveller_today("Asia/Jerusalem", now=september) == date(2026, 9, 28)
    assert traveller_today("Asia/Jerusalem", now=december) == date(2026, 12, 27)


def test_zone_or_utc_returns_something_usable_whatever_it_is_given():
    assert zone_or_utc("Asia/Jerusalem") is not None
    assert zone_or_utc("nonsense") is not None
    assert zone_or_utc(None) is not None


# ---------------------------------------------------------------------------
# Through the API
#
# The unit above proves the arithmetic. These prove the header actually reaches
# the endpoints that count days, which is where the traveller sees it.
# ---------------------------------------------------------------------------


def test_the_date_the_app_works_from_follows_the_traveller(client, auth, trip):
    """The bug as the traveller met it: the app on the wrong day at night.

    Kiritimati and Niue are 25 hours apart, so at every instant they are on
    different dates. An endpoint that ignored the header would return the same
    date for both, which is exactly what it used to do.
    """
    ahead = client.get(
        "/api/v1/home", headers={**auth, "X-TripStash-Timezone": "Pacific/Kiritimati"}
    ).json()
    behind = client.get(
        "/api/v1/home", headers={**auth, "X-TripStash-Timezone": "Pacific/Niue"}
    ).json()

    assert ahead["date"] != behind["date"], "the header was accepted but not used"
    assert ahead["date"] > behind["date"]


def test_an_unknown_zone_does_not_break_a_request(client, auth, trip):
    hostile = {**auth, "X-TripStash-Timezone": "../../etc/passwd"}
    assert client.get("/api/v1/trips/current", headers=hostile).status_code == 200


def test_no_header_still_works(client, auth, trip):
    assert client.get("/api/v1/trips/current", headers=auth).status_code == 200
