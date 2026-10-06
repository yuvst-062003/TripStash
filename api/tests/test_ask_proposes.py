"""The assistant proposes; the traveller decides.

`/ask` is read-only. The only path from a suggestion into the library is
`/ask/confirm`, and it runs when the traveller presses Add.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models.core import Trip
from app.models.enums import PlaceStatus
from app.models.ops import ItineraryItem
from app.models.places import Place, TripPlace


@pytest.fixture
def saved_place(client: TestClient, auth: dict[str, str]) -> str:
    client.post(
        "/api/v1/trips",
        headers=auth,
        json={"name": "Guatemala", "start_date": "2026-03-01", "base_currency": "USD"},
    )
    session = SessionLocal()
    trip = session.query(Trip).filter(Trip.is_active.is_(True)).one()
    place = Place(
        name="Cerro de la Cruz",
        normalized_name="cerro de la cruz",
        category="viewpoint",
        lat=14.5661,
        lon=-90.7295,
        city="Antigua",
        country="Guatemala",
    )
    session.add(place)
    session.flush()
    trip_place = TripPlace(
        trip_id=trip.id,
        place_id=place.id,
        status=PlaceStatus.SAVED,
        reason_saved="The view over the volcano at sunset",
    )
    session.add(trip_place)
    session.commit()
    identifier = trip_place.id
    session.close()
    return identifier


def _itinerary_count() -> int:
    session = SessionLocal()
    try:
        return session.query(ItineraryItem).count()
    finally:
        session.close()


def test_asking_changes_nothing(client, auth, saved_place):
    before = _itinerary_count()

    response = client.post(
        "/api/v1/ask",
        headers=auth,
        json={"question": "What should I do today?", "surface": "home"},
    )

    assert response.status_code == 200
    # Whatever it suggested, nothing was written to the traveller's plan.
    assert _itinerary_count() == before


def test_a_proposal_is_returned_rather_than_applied(client, auth, saved_place):
    answer = client.post(
        "/api/v1/ask",
        headers=auth,
        json={
            "question": "What is near me?",
            "surface": "place",
            "trip_place_id": saved_place,
            "lat": 14.5586,
            "lon": -90.7295,
        },
    ).json()

    assert "proposed_actions" in answer
    for action in answer["proposed_actions"]:
        assert action["type"]
        # A proposal has to be previewable, or "Add" is a blind press.
        assert action["label"]
    assert _itinerary_count() == 0


def test_confirming_is_what_writes(client, auth, saved_place):
    applied = client.post(
        "/api/v1/ask/confirm",
        headers=auth,
        json={
            "type": "add_to_today",
            "payload": {"trip_place_id": saved_place, "on_date": "2026-03-02"},
        },
    )

    assert applied.status_code == 200
    assert applied.json()["applied"] == "add_to_today"
    assert _itinerary_count() == 1


def test_an_action_nobody_offered_is_refused_and_changes_nothing(client, auth, saved_place):
    response = client.post(
        "/api/v1/ask/confirm",
        headers=auth,
        json={"type": "delete_everything", "payload": {"trip_place_id": saved_place}},
    )

    assert response.status_code == 400
    assert "Nothing was changed" in response.json()["detail"]
    assert _itinerary_count() == 0


def test_confirming_against_someone_elses_place_is_not_found(client, auth, saved_place):
    response = client.post(
        "/api/v1/ask/confirm",
        headers=auth,
        json={
            "type": "add_to_today",
            "payload": {"trip_place_id": "not-a-place-of-yours", "on_date": "2026-03-02"},
        },
    )

    assert response.status_code == 404
    assert _itinerary_count() == 0


def test_an_answer_says_what_it_looked_at(client, auth, saved_place):
    answer = client.post(
        "/api/v1/ask",
        headers=auth,
        json={
            "question": "Why did I save Cerro de la Cruz?",
            "surface": "place",
            "trip_place_id": saved_place,
        },
    ).json()

    # Citations may be empty when nothing was cited, but the field is part of
    # the contract the sheet reads, and each one has to name its source.
    assert isinstance(answer["citations"], list)
    for citation in answer["citations"]:
        assert citation["label"]
        assert citation["provenance"]
