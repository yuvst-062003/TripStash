"""Changing a trip's dates, and the order of its stops.

Both exist because a plan gets revised. A second version of a plan almost
always moves the departure and re-orders what comes after it, and until these
two endpoints a trip could only be built forwards: stops appended, dates set
once at creation, no way back.
"""

from __future__ import annotations


def _add(client, auth, name: str, country: str) -> str:
    response = client.post(
        "/api/v1/trips/current/destinations",
        headers=auth,
        json={"name": name, "country": country},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _route(client, auth) -> list[str]:
    trip = client.get("/api/v1/trips/current", headers=auth).json()
    stops = sorted(trip["destinations"], key=lambda d: d["position"])
    return [d["name"] for d in stops]


# ------------------------------------------------------------------ trip dates


def test_a_trip_can_move_its_departure(client, auth, trip):
    """Moving the start carries every stop with it, and the end follows the
    nights rather than whatever end was sent."""
    antigua = client.get("/api/v1/trips/current", headers=auth).json()["destinations"][0]["id"]
    client.patch(f"/api/v1/trips/current/destinations/{antigua}", headers=auth, json={"nights": 5})

    response = client.patch(
        "/api/v1/trips/current",
        headers=auth,
        json={"start_date": "2026-11-07", "end_date": "2027-02-16"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["start_date"] == "2026-11-07"
    assert body["end_date"] == "2026-11-12"
    assert body["destinations"][0]["arrive_on"] == "2026-11-07"


def test_moving_only_the_start_cannot_invert_a_trip(client, auth, trip):
    """Checked against what the trip would become, not against what was sent.
    Only a trip with no route yet has a typed end to invert."""
    antigua = client.get("/api/v1/trips/current", headers=auth).json()["destinations"][0]["id"]
    client.delete(f"/api/v1/trips/current/destinations/{antigua}", headers=auth)
    client.patch(
        "/api/v1/trips/current",
        headers=auth,
        json={"start_date": "2026-11-07", "end_date": "2027-02-16"},
    )

    response = client.patch(
        "/api/v1/trips/current", headers=auth, json={"start_date": "2027-03-01"}
    )

    assert response.status_code == 422
    assert "precedes" in response.json()["detail"]
    # And the trip is untouched.
    assert client.get("/api/v1/trips/current", headers=auth).json()["start_date"] == "2026-11-07"


def test_a_trip_can_be_renamed_and_re_interested(client, auth, trip):
    response = client.patch(
        "/api/v1/trips/current",
        headers=auth,
        json={"name": "Central America + Colombia + Brazil", "interests": ["surf", "carnival"]},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "Central America + Colombia + Brazil"
    assert body["interests"] == ["surf", "carnival"]
    # Untouched fields stay as they were.
    assert body["base_currency"] == "USD"


def test_a_field_left_out_is_left_alone(client, auth, trip):
    client.patch("/api/v1/trips/current", headers=auth, json={"start_date": "2026-11-07"})

    response = client.patch("/api/v1/trips/current", headers=auth, json={"name": "Renamed"})

    assert response.json()["start_date"] == "2026-11-07"


# ---------------------------------------------------------------- route order


def test_the_route_can_be_put_in_travelling_order(client, auth, trip):
    """The stop added last belongs third: a plan is not written in order."""
    antigua = client.get("/api/v1/trips/current", headers=auth).json()["destinations"][0]["id"]
    rio = _add(client, auth, "Rio de Janeiro", "Brazil")
    san_cristobal = _add(client, auth, "San Cristóbal de las Casas", "Mexico")

    response = client.put(
        "/api/v1/trips/current/destinations/order",
        headers=auth,
        json={"ids": [san_cristobal, antigua, rio]},
    )

    assert response.status_code == 200, response.text
    assert [d["position"] for d in response.json()] == [0, 1, 2]
    assert _route(client, auth) == ["San Cristóbal de las Casas", "Antigua", "Rio de Janeiro"]


def test_a_partial_order_is_refused(client, auth, trip):
    """Naming three of twenty stops would leave seventeen arranged by a rule
    nobody asked for."""
    _add(client, auth, "Rio de Janeiro", "Brazil")
    antigua = client.get("/api/v1/trips/current", headers=auth).json()["destinations"][0]["id"]

    response = client.put(
        "/api/v1/trips/current/destinations/order", headers=auth, json={"ids": [antigua]}
    )

    assert response.status_code == 422
    assert "every stop" in response.json()["detail"]
    assert "1 missing" in response.json()["detail"]
    # Nothing moved.
    assert _route(client, auth) == ["Antigua", "Rio de Janeiro"]


def test_a_stop_listed_twice_is_refused(client, auth, trip):
    antigua = client.get("/api/v1/trips/current", headers=auth).json()["destinations"][0]["id"]

    response = client.put(
        "/api/v1/trips/current/destinations/order",
        headers=auth,
        json={"ids": [antigua, antigua]},
    )

    assert response.status_code == 422
    assert "twice" in response.json()["detail"]


def test_another_trips_stop_cannot_be_ordered_into_this_one(client, auth, trip):
    antigua = client.get("/api/v1/trips/current", headers=auth).json()["destinations"][0]["id"]

    response = client.put(
        "/api/v1/trips/current/destinations/order",
        headers=auth,
        json={"ids": [antigua, "not-a-real-id"]},
    )

    assert response.status_code == 422
    assert "not on this trip" in response.json()["detail"]


def test_a_stop_can_hold_no_nights_without_being_deleted(client, auth, trip):
    """An alternative: still in the app, still holding its saved places, but
    not holding any days. Dates are derived from nights, so zero is how a stop
    stops taking up the calendar."""
    oaxaca = _add(client, auth, "Oaxaca", "Mexico")
    client.patch(f"/api/v1/trips/current/destinations/{oaxaca}", headers=auth, json={"nights": 4})

    response = client.patch(
        f"/api/v1/trips/current/destinations/{oaxaca}",
        headers=auth,
        json={"nights": 0, "notes": "Alternative · cut from the route"},
    )

    assert response.status_code == 200, response.text
    stop = next(s for s in response.json()["stops"] if s["destination"]["id"] == oaxaca)
    assert stop["nights"] == 0
    assert stop["arrive_on"] == stop["depart_on"]
    assert stop["destination"]["notes"].startswith("Alternative")
    # Still on the trip.
    assert "Oaxaca" in _route(client, auth)
