"""Adapting to one traveller from their own review decisions."""

from __future__ import annotations

from app.services.adaptation import (
    build_hints,
    export_training_examples,
    training_readiness,
)
from tests.conftest import REEL_TRANSCRIPT
from tests.test_journeys import approve_all_places, capture_reel


def test_hints_carry_the_route_before_anything_is_approved(client, auth, trip, session):
    hints = build_hints(session, trip["id"])
    assert "Antigua" in hints.destinations
    assert hints.examples == []


def test_approved_items_become_few_shot_examples(client, auth, trip, session):
    capture_reel(client, auth)
    approve_all_places(client, auth)

    hints = build_hints(session, trip["id"])

    assert hints.examples, "the traveller's own approvals should steer the next extraction"
    example = hints.examples[0]
    assert example["quote"]
    assert example["item"]["type"]
    assert example["item"]["title"]
    # The quote really came from the source, not from the model's paraphrase.
    assert example["quote"][:24].lower() in REEL_TRANSCRIPT.lower()


def test_decisions_export_as_training_data_with_honest_readiness(client, auth, trip, session):
    capture_reel(client, auth)
    inbox = client.get("/api/v1/inbox", headers=auth).json()

    approved = [c for c in inbox if c["type"] == "safety"]
    ignored = [c for c in inbox if c["type"] == "packing"]
    for candidate in approved:
        client.post(f"/api/v1/candidates/{candidate['id']}/approve", headers=auth, json={})
    for candidate in ignored:
        client.post(f"/api/v1/candidates/{candidate['id']}/ignore", headers=auth)

    records = export_training_examples(session, trip["id"])

    assert len(records) == 1
    record = records[0]
    assert record["input"]
    # What the traveller kept is the target; what they rejected is counted, and
    # teaches restraint by its absence.
    kept_types = {item["type"] for item in record["output"]["candidates"]}
    assert "safety" in kept_types
    assert "packing" not in kept_types
    assert record["rejected"] == len(ignored)

    readiness = training_readiness(records)
    assert readiness["ready"] is False
    assert str(readiness["threshold"]) in readiness["advice"]


def test_nothing_is_exported_before_anything_is_reviewed(client, auth, trip, session):
    capture_reel(client, auth)
    assert export_training_examples(session, trip["id"]) == []
