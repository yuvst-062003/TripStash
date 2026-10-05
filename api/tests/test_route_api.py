"""The route endpoints: nights go in, derived dates come back out."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def route_trip(client: TestClient, auth: dict[str, str]) -> list[str]:
    """A dated trip with three stops, so shifting is observable."""
    created = client.post(
        "/api/v1/trips",
        headers=auth,
        json={"name": "Brazil", "start_date": "2026-03-01", "base_currency": "BRL"},
    )
    assert created.status_code == 201, created.text

    ids = []
    for name, lat, lon, nights in (
        ("Rio de Janeiro", -22.9068, -43.1729, 3),
        ("Paraty", -23.2186, -44.7158, 2),
        ("São Paulo", -23.5505, -46.6333, 4),
    ):
        response = client.post(
            "/api/v1/trips/current/destinations",
            headers=auth,
            json={"name": name, "country": "Brazil", "lat": lat, "lon": lon, "nights": nights},
        )
        assert response.status_code == 201, response.text
        ids.append(response.json()["id"])
    return ids


def test_the_route_reports_derived_dates_and_a_night_total(client, auth, route_trip):
    route = client.get("/api/v1/trips/current/route", headers=auth).json()

    assert route["start_date"] == "2026-03-01"
    assert route["end_date"] == "2026-03-10"
    assert route["has_end_date"] is True
    assert route["total_nights"] == 9
    assert [stop["destination"]["name"] for stop in route["stops"]] == [
        "Rio de Janeiro",
        "Paraty",
        "São Paulo",
    ]
    assert route["stops"][1]["arrive_on"] == "2026-03-04"


def test_changing_one_stops_nights_shifts_every_stop_after_it(client, auth, route_trip):
    response = client.patch(
        f"/api/v1/trips/current/destinations/{route_trip[0]}",
        headers=auth,
        json={"nights": 5},
    )

    assert response.status_code == 200, response.text
    route = response.json()
    assert route["stops"][0]["depart_on"] == "2026-03-06"
    assert route["stops"][1]["arrive_on"] == "2026-03-06"
    assert route["stops"][2]["arrive_on"] == "2026-03-08"
    assert route["total_nights"] == 11
    # Re-reading agrees: the shift was stored, not just returned.
    reread = client.get("/api/v1/trips/current/route", headers=auth).json()
    assert reread["end_date"] == "2026-03-12"


def test_a_leg_carries_an_estimate_between_consecutive_stops(client, auth, route_trip):
    stops = client.get("/api/v1/trips/current/route", headers=auth).json()["stops"]

    assert stops[0]["leg_in"] is None
    leg = stops[1]["leg_in"]
    assert leg["from_destination_id"] == route_trip[0]
    assert leg["to_destination_id"] == route_trip[1]
    assert 150 < leg["distance_km"] < 180
    assert leg["duration_minutes"] > 0


def test_clearing_the_nights_leaves_the_rest_of_the_route_undated(client, auth, route_trip):
    route = client.patch(
        f"/api/v1/trips/current/destinations/{route_trip[1]}",
        headers=auth,
        json={"nights": None},
    ).json()

    assert route["stops"][1]["arrive_on"] == "2026-03-04"
    assert route["stops"][1]["depart_on"] is None
    assert route["stops"][2]["arrive_on"] is None
    assert route["end_date"] is None
    # This is what the "No end date" chip is reading.
    assert route["has_end_date"] is False


def test_a_stop_inserts_between_two_others_without_reordering_them(client, auth, route_trip):
    created = client.post(
        "/api/v1/trips/current/destinations",
        headers=auth,
        json={"name": "Ilha Grande", "country": "Brazil", "nights": 2, "after_position": 0},
    )
    assert created.status_code == 201, created.text

    route = client.get("/api/v1/trips/current/route", headers=auth).json()
    assert [stop["destination"]["name"] for stop in route["stops"]] == [
        "Rio de Janeiro",
        "Ilha Grande",
        "Paraty",
        "São Paulo",
    ]
    assert [stop["destination"]["position"] for stop in route["stops"]] == [0, 1, 2, 3]
    # The inserted nights push the stops after it along.
    assert route["stops"][2]["arrive_on"] == "2026-03-06"
    assert route["total_nights"] == 11


def test_a_stop_with_no_anchor_is_appended(client, auth, route_trip):
    client.post(
        "/api/v1/trips/current/destinations",
        headers=auth,
        json={"name": "Curitiba", "country": "Brazil", "nights": 1},
    )

    route = client.get("/api/v1/trips/current/route", headers=auth).json()
    assert route["stops"][-1]["destination"]["name"] == "Curitiba"
    assert route["stops"][-1]["arrive_on"] == "2026-03-10"


def test_removing_a_stop_closes_the_gap_and_re_dates_the_rest(client, auth, route_trip):
    removed = client.delete(f"/api/v1/trips/current/destinations/{route_trip[0]}", headers=auth)
    assert removed.status_code == 204

    route = client.get("/api/v1/trips/current/route", headers=auth).json()
    assert [stop["destination"]["position"] for stop in route["stops"]] == [0, 1]
    assert route["stops"][0]["destination"]["name"] == "Paraty"
    assert route["stops"][0]["arrive_on"] == "2026-03-01"
    assert route["total_nights"] == 6


def test_a_name_change_does_not_disturb_the_dates(client, auth, route_trip):
    route = client.patch(
        f"/api/v1/trips/current/destinations/{route_trip[1]}",
        headers=auth,
        json={"name": "Paraty, RJ"},
    ).json()

    assert route["stops"][1]["destination"]["name"] == "Paraty, RJ"
    assert route["stops"][1]["nights"] == 2
    assert route["end_date"] == "2026-03-10"


def test_an_impossible_night_count_is_refused(client, auth, route_trip):
    response = client.patch(
        f"/api/v1/trips/current/destinations/{route_trip[0]}",
        headers=auth,
        json={"nights": -2},
    )

    assert response.status_code == 422
    unchanged = client.get("/api/v1/trips/current/route", headers=auth).json()
    assert unchanged["stops"][0]["nights"] == 3


def test_a_stop_that_is_not_on_this_trip_is_not_found(client, auth, route_trip):
    response = client.patch(
        "/api/v1/trips/current/destinations/not-a-real-stop",
        headers=auth,
        json={"nights": 2},
    )

    assert response.status_code == 404


def test_the_route_needs_authentication(client, auth, route_trip):
    assert client.get("/api/v1/trips/current/route").status_code == 401


def test_a_trip_with_no_start_date_still_has_an_ordered_route(client, auth):
    client.post("/api/v1/trips", headers=auth, json={"name": "Someday", "base_currency": "USD"})
    client.post(
        "/api/v1/trips/current/destinations",
        headers=auth,
        json={"name": "Patagonia", "nights": 5},
    )

    route = client.get("/api/v1/trips/current/route", headers=auth).json()
    assert route["start_date"] is None
    assert route["stops"][0]["arrive_on"] is None
    assert route["stops"][0]["nights"] == 5
    assert route["total_nights"] == 5
    assert route["has_end_date"] is False
