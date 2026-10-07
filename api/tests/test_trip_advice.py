"""The route's checks and stop suggestions: read-only, from stored data only."""

from __future__ import annotations


def _stop(client, auth, name, lat, lon, nights=None):
    body = {"name": name, "country": "Guatemala", "lat": lat, "lon": lon}
    if nights is not None:
        body["nights"] = nights
    response = client.post("/api/v1/trips/current/destinations", headers=auth, json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_a_stop_without_nights_is_flagged(client, auth, trip):
    checks = client.get("/api/v1/trips/current/checks", headers=auth).json()

    assert any(c["kind"] == "nights_missing" for c in checks)


def test_an_event_you_would_miss_offers_the_nights_that_cover_it(client, auth, trip):
    client.patch("/api/v1/trips/current", headers=auth, json={"start_date": "2027-02-01"})
    stop = client.get("/api/v1/trips/current", headers=auth).json()["destinations"][0]["id"]
    client.patch(f"/api/v1/trips/current/destinations/{stop}", headers=auth, json={"nights": 3})
    client.post(
        "/api/v1/knowledge",
        headers=auth,
        json={
            "type": "event",
            "title": "Semana Santa",
            "destination_scope": "Antigua",
            "happens_on": "2027-02-05",
            "ends_on": "2027-02-07",
        },
    )

    checks = client.get("/api/v1/trips/current/checks", headers=auth).json()
    missed = [c for c in checks if c["kind"] == "event_missed"]

    assert missed, checks
    assert missed[0]["fix"]["payload"] == {"destination_id": stop, "nights": 7}


def test_suggestions_are_cities_you_saved_and_the_route_skips(client, auth, trip):
    stop = client.get("/api/v1/trips/current", headers=auth).json()["destinations"][0]["id"]

    response = client.get(f"/api/v1/trips/current/suggestions?after={stop}", headers=auth)

    assert response.status_code == 200, response.text
    for suggestion in response.json():
        assert suggestion["place_count"] >= 1
        assert suggestion["name"] != "Antigua"


def test_suggestions_after_someone_elses_stop_is_a_404(client, auth, trip):
    response = client.get("/api/v1/trips/current/suggestions?after=nope", headers=auth)

    assert response.status_code == 404
