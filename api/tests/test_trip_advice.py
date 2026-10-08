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


def test_discover_labels_every_voice_and_keeps_gringo_apart(client, auth, trip):
    stop = client.get("/api/v1/trips/current", headers=auth).json()["destinations"][0]["id"]

    response = client.get(f"/api/v1/trips/current/discover?after={stop}", headers=auth)

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"gringo", "web", "reddit", "youtube", "live"}
    assert body["live"] == {"gringo": False, "web": False, "reddit": False, "youtube": False}
    for source, voices in body.items():
        if source == "live":
            continue
        for voice in voices:
            assert voice["source"] == source
            assert voice["url"].startswith("http")
    assert all(not v["by"].endswith("gringo.co.il") for v in body["web"])


def test_gringo_is_never_fetched_directly():
    """Its robots.txt turns away every bot but the search engines."""
    from app.adapters.content import FakeContentSource

    assert not FakeContentSource().may_fetch("https://gringo.co.il/guatemala").allowed


def test_a_broken_source_does_not_take_the_others_with_it(client, auth, trip, monkeypatch):
    from app.services import discover

    def broken():
        raise ValueError("Reddit needs an app")

    monkeypatch.setattr(discover, "get_reddit", broken)
    stop = client.get("/api/v1/trips/current", headers=auth).json()["destinations"][0]["id"]

    response = client.get(f"/api/v1/trips/current/discover?after={stop}", headers=auth)

    assert response.status_code == 200, response.text
    assert response.json()["reddit"] == []
    assert response.json()["youtube"]


def test_a_short_place_name_still_finds_your_notes():
    from types import SimpleNamespace

    from app.services.assistant import _note_mentions

    note = SimpleNamespace(
        destination_scope="Rio de Janeiro", title="Safety", body="Avoid Lapa late"
    )
    assert _note_mentions(note, "Rio")
    assert not _note_mentions(note, "Ica")


def test_the_stand_in_video_search_is_stable_across_restarts():
    import subprocess
    import sys

    code = (
        "from app.adapters.video_search import FakeVideoSearch;"
        "print(FakeVideoSearch().search('Antigua')[0].url)"
    )
    runs = {
        subprocess.run([sys.executable, "-c", code], capture_output=True, text=True).stdout
        for _ in range(2)
    }
    assert len(runs) == 1 and next(iter(runs)).startswith("https://")
