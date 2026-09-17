"""End-to-end journeys and the acceptance criteria in spec 15."""

from __future__ import annotations

from datetime import UTC, datetime

from tests.conftest import REEL_TRANSCRIPT

ANTIGUA = {"lat": 14.5586, "lon": -90.7295}


def capture_reel(client, auth) -> dict:
    response = client.post(
        "/api/v1/sources",
        headers=auth,
        json={
            "url": "https://www.example-social.test/reel/abc123",
            "text": REEL_TRANSCRIPT,
            "title": "3 days in Antigua",
            "author": "@backpackerlina",
            "published_on": "2026-07-04",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def approve_all_places(client, auth) -> list[dict]:
    inbox = client.get("/api/v1/inbox", headers=auth).json()
    saved = []
    for candidate in inbox:
        if candidate["type"] not in ("place", "accommodation"):
            continue
        if not candidate["resolutions"]:
            continue  # unresolved guesses need a pin, covered separately
        result = client.post(
            f"/api/v1/candidates/{candidate['id']}/approve",
            headers=auth,
            json={"provider_place_id": candidate["resolutions"][0]["provider_place_id"]},
        )
        assert result.status_code == 200, result.text
        saved.append(result.json())
    return saved


# ------------------------------------------------- capture and resolution


def test_source_is_kept_and_produces_reviewable_candidates(client, auth, trip):
    source = capture_reel(client, auth)
    assert source["status"] == "needs_review"
    assert source["pending_count"] > 0

    inbox = client.get("/api/v1/inbox", headers=auth).json()
    types = {c["type"] for c in inbox}
    assert {"place", "accommodation", "safety", "transport", "packing"} <= types
    for candidate in inbox:
        assert candidate["evidence"], candidate["title"]


def test_reimporting_the_same_link_does_not_duplicate(client, auth, trip):
    first = capture_reel(client, auth)
    second = capture_reel(client, auth)
    assert first["id"] == second["id"]
    assert len(client.get("/api/v1/sources", headers=auth).json()) == 1


def test_nothing_reaches_the_map_before_the_user_confirms(client, auth, trip):
    capture_reel(client, auth)
    assert client.get("/api/v1/map", headers=auth).json()["features"] == []

    approve_all_places(client, auth)
    features = client.get("/api/v1/map", headers=auth).json()["features"]
    assert features
    assert {f["properties"]["name"] for f in features} >= {"Cerro de la Cruz", "Tremendo Hostel"}


def test_a_wrong_match_can_be_corrected_before_saving(client, auth, trip):
    capture_reel(client, auth)
    candidate = next(
        c
        for c in client.get("/api/v1/inbox", headers=auth).json()
        if c["title"] == "Cerro de la Cruz"
    )
    result = client.post(
        f"/api/v1/candidates/{candidate['id']}/approve",
        headers=auth,
        json={
            "override_name": "Cerro de la Cruz lookout",
            "override_lat": 14.5650,
            "override_lon": -90.7300,
            "reason_saved": "Sunset view over the city",
        },
    )
    assert result.status_code == 200, result.text
    page = client.get(f"/api/v1/places/{result.json()['trip_place_id']}", headers=auth).json()
    assert page["header"]["name"] == "Cerro de la Cruz lookout"
    assert page["overview"]["why_saved"] == "Sunset view over the city"


def test_a_second_source_adds_to_a_place_rather_than_duplicating_it(client, auth, trip):
    capture_reel(client, auth)
    approve_all_places(client, auth)
    before = len(client.get("/api/v1/places", headers=auth).json())

    client.post(
        "/api/v1/sources",
        headers=auth,
        json={
            "url": "https://www.example-blog.test/antigua",
            "text": "Cerro de la Cruz is worth it at golden hour, go with someone.",
            "kind": "article",
        },
    )
    approve_all_places(client, auth)

    places = client.get("/api/v1/places", headers=auth).json()
    assert len(places) == before
    cerro = next(p for p in places if "Cerro" in p["name"])
    assert cerro["source_count"] == 2


def test_a_duplicate_candidate_is_flagged_not_silently_added(client, auth, trip):
    capture_reel(client, auth)
    approve_all_places(client, auth)

    client.post(
        "/api/v1/sources",
        headers=auth,
        json={"url": "https://x.test/2", "text": "Check out Cerro de la Cruz for sunset."},
    )
    pending = client.get("/api/v1/inbox", headers=auth).json()
    flagged = [c for c in pending if c["duplicate_of_place_id"]]
    assert flagged, "expected the repeat mention to be flagged as a possible duplicate"
    assert flagged[0]["duplicate_reason"]


def test_failed_extraction_stays_recoverable_in_the_inbox(client, auth, trip):
    response = client.post(
        "/api/v1/sources/upload",
        headers=auth,
        files={"files": ("clip.mp4", b"\x00\x01binary-video-bytes", "video/mp4")},
    )
    assert response.status_code == 201, response.text
    source = response.json()[0]
    assert source["status"] == "failed"
    assert source["failure_reason"]

    retried = client.post(f"/api/v1/sources/{source['id']}/retry", headers=auth).json()
    assert retried["attempts"] == 2
    assert retried["id"] == source["id"]


def test_oversized_and_unsupported_uploads_are_refused_with_an_explanation(client, auth, trip):
    response = client.post(
        "/api/v1/sources/upload",
        headers=auth,
        files={"files": ("payload.exe", b"MZ", "application/x-msdownload")},
    )
    assert response.status_code == 415
    assert "not accepted" in response.json()["detail"]


# -------------------------------------------------------- map and place page


def test_place_page_keeps_sources_reason_and_freshness_visible(client, auth, trip):
    capture_reel(client, auth)
    saved = approve_all_places(client, auth)
    page = client.get(
        f"/api/v1/places/{saved[0]['trip_place_id']}",
        headers=auth,
        params=ANTIGUA,
    ).json()

    assert page["overview"]["why_saved"]
    assert page["saved_content"], "the original source must stay attached"
    assert page["saved_content"][0]["url"]

    hours = [f for f in page["live_information"]["facts"] if f["kind"] == "hours"]
    assert hours, "provider hours should be recorded"
    assert hours[0]["primary"]["freshness"] in {"fresh", "ageing", "stale"}
    assert hours[0]["primary"]["age_label"]
    assert page["header"]["distance_km"] is not None
    assert page["actions"]["primary"][0]["url"].startswith("https://www.google.com/maps/dir/")


def test_walking_estimates_are_suppressed_beyond_walking_range(client, auth, trip):
    """A minute figure for a place 100 km away is noise, not information."""
    capture_reel(client, auth)
    approve_all_places(client, auth)
    places = client.get("/api/v1/places", headers=auth, params=ANTIGUA).json()

    near = [p for p in places if p["distance_km"] is not None and p["distance_km"] <= 8]
    far = [p for p in places if p["distance_km"] is not None and p["distance_km"] > 8]

    assert near and all(p["walking_minutes"] is not None for p in near)
    assert far and all(p["walking_minutes"] is None for p in far)


def test_map_filters_by_status_and_category(client, auth, trip):
    capture_reel(client, auth)
    saved = approve_all_places(client, auth)
    client.patch(
        f"/api/v1/places/{saved[0]['trip_place_id']}",
        headers=auth,
        json={"status": "must_visit"},
    )

    must_visit = client.get("/api/v1/map", headers=auth, params={"status": "must_visit"}).json()
    assert len(must_visit["features"]) == 1

    stays = client.get(
        "/api/v1/map", headers=auth, params={"category": "accommodation"}
    ).json()
    assert {f["properties"]["name"] for f in stays["features"]} == {"Tremendo Hostel"}


def test_personal_saves_are_the_only_map_layer(client, auth, trip):
    capture_reel(client, auth)
    approve_all_places(client, auth)
    assert client.get("/api/v1/map", headers=auth).json()["layer"] == "personal_saves"


# ------------------------------------------------------------------ assistant


def test_assistant_answers_from_saved_places_and_shows_its_context(client, auth, trip):
    capture_reel(client, auth)
    approve_all_places(client, auth)

    response = client.post(
        "/api/v1/ask",
        headers=auth,
        json={"question": "What have I saved near me?", "surface": "map", **ANTIGUA},
    ).json()

    assert response["cards"]
    assert response["context"]["lat"] == ANTIGUA["lat"]
    assert all(card["walking_minutes"] is not None for card in response["cards"])
    assert response["applied_changes"] == []


def test_assistant_explains_why_a_place_was_saved_with_citations(client, auth, trip):
    capture_reel(client, auth)
    saved = approve_all_places(client, auth)

    response = client.post(
        "/api/v1/ask",
        headers=auth,
        json={
            "question": "Why did I save this?",
            "surface": "place",
            "trip_place_id": saved[0]["trip_place_id"],
        },
    ).json()

    assert response["citations"]
    assert response["citations"][0]["url"]


def test_assistant_is_read_only_until_the_user_confirms(client, auth, trip):
    capture_reel(client, auth)
    saved = approve_all_places(client, auth)
    today = datetime.now(UTC).date().isoformat()

    answer = client.post(
        "/api/v1/ask",
        headers=auth,
        json={
            "question": "Does it make sense to go now?",
            "surface": "place",
            "trip_place_id": saved[0]["trip_place_id"],
            **ANTIGUA,
        },
    ).json()

    proposal = next(a for a in answer["proposed_actions"] if a["type"] == "add_to_today")
    assert client.get("/api/v1/itinerary", headers=auth, params={"on": today}).json() == []

    applied = client.post("/api/v1/ask/confirm", headers=auth, json=proposal).json()
    assert applied["applied"] == "add_to_today"
    assert len(client.get("/api/v1/itinerary", headers=auth, params={"on": today}).json()) == 1


def test_assistant_labels_border_advice_as_needing_official_confirmation(client, auth, trip):
    client.post(
        "/api/v1/sources",
        headers=auth,
        json={"text": "You need proof of onward travel at the Guatemala border.", "kind": "note"},
    )
    candidate = next(
        c for c in client.get("/api/v1/inbox", headers=auth).json() if c["type"] == "border"
    )
    client.post(f"/api/v1/candidates/{candidate['id']}/approve", headers=auth, json={})

    answer = client.post(
        "/api/v1/ask", headers=auth, json={"question": "What do I know about the visa situation?"}
    ).json()
    assert any("official" in d.lower() for d in answer["disclaimers"])


def test_assistant_says_so_when_nothing_matches(client, auth, trip):
    answer = client.post(
        "/api/v1/ask", headers=auth, json={"question": "Where should I eat in Tokyo?"}
    ).json()
    assert "could not match" in answer["answer"]
    assert answer["cards"] == []


# ------------------------------------------------------- resurfacing and trip


def test_knowledge_resurfaces_by_context(client, auth, trip):
    capture_reel(client, auth)
    for candidate in client.get("/api/v1/inbox", headers=auth).json():
        if candidate["type"] == "safety":
            client.post(f"/api/v1/candidates/{candidate['id']}/approve", headers=auth, json={})

    items = client.get(
        "/api/v1/resurface", headers=auth, params={**ANTIGUA, "destination_scope": "Antigua"}
    ).json()["items"]
    safety = [i for i in items if i["kind"] == "knowledge"]
    assert safety and safety[0]["reason"]


def test_expenses_convert_once_and_replay_idempotently(client, auth, trip):
    payload = {
        "spent_on": "2026-08-01",
        "amount": 150,
        "currency": "GTQ",
        "category": "transport",
        "client_op_id": "offline-op-1",
    }
    first = client.post("/api/v1/expenses", headers=auth, json=payload).json()
    assert first["currency"] == "USD"
    assert first["amount_base"] == round(150 / 7.8, 2)

    second = client.post("/api/v1/expenses", headers=auth, json=payload).json()
    assert second["idempotent_replay"] is True
    assert len(client.get("/api/v1/expenses", headers=auth).json()["items"]) == 1


def test_route_stops_do_not_require_exact_dates(client, auth, trip):
    response = client.post(
        "/api/v1/trips/current/destinations",
        headers=auth,
        json={"name": "Lanquín", "country": "Guatemala"},
    )
    assert response.status_code == 201
    assert response.json()["arrive_on"] is None


def test_offline_bundle_carries_essentials_with_freshness_labels(client, auth, trip):
    capture_reel(client, auth)
    approve_all_places(client, auth)

    bundle = client.get("/api/v1/offline-bundle", headers=auth).json()
    assert bundle["places"]
    place = bundle["places"][0]
    assert place["lat"] and place["why_saved"]
    if place["cached_facts"]:
        assert place["cached_facts"][0]["age_label"]
    assert "last checked" in bundle["notice"]


def test_enrichment_never_overwrites_what_the_user_wrote(client, auth, trip):
    capture_reel(client, auth)
    saved = approve_all_places(client, auth)
    trip_place_id = saved[0]["trip_place_id"]

    client.patch(
        f"/api/v1/places/{trip_place_id}",
        headers=auth,
        json={"reason_saved": "My own words", "notes": "Meet Ana at 5"},
    )
    client.post(
        "/api/v1/sources",
        headers=auth,
        json={"url": "https://x.test/again", "text": "Cerro de la Cruz is the best viewpoint."},
    )
    approve_all_places(client, auth)

    page = client.get(f"/api/v1/places/{trip_place_id}", headers=auth).json()
    assert "My own words" in page["overview"]["why_saved"]
    assert page["overview"]["notes"] == "Meet Ana at 5"


def test_export_contains_the_whole_trip(client, auth, trip):
    capture_reel(client, auth)
    approve_all_places(client, auth)
    client.post(
        "/api/v1/expenses",
        headers=auth,
        json={"spent_on": "2026-08-01", "amount": 20, "currency": "USD", "category": "food"},
    )

    export = client.get("/api/v1/export", headers=auth).json()
    assert export["format"] == "tripstash.export.v1"
    for key in ("places", "sources", "evidence", "knowledge", "destinations", "expenses"):
        assert key in export
    assert export["places"] and export["places"][0]["why_saved"]
    assert export["sources"][0]["url"]


def test_account_deletion_requires_confirmation_and_removes_everything(client, auth, trip):
    capture_reel(client, auth)
    refused = client.delete("/api/v1/account", headers=auth, params={"confirm": "wrong"})
    assert refused.status_code == 400

    response = client.delete(
        "/api/v1/account", headers=auth, params={"confirm": "traveller@example.com"}
    )
    assert response.status_code == 204
    assert client.get("/api/v1/auth/me", headers=auth).status_code == 401


def test_ownership_is_checked_on_every_request(client, auth, trip):
    capture_reel(client, auth)
    saved = approve_all_places(client, auth)

    other = client.post(
        "/api/v1/auth/register",
        json={"email": "someone-else@example.com", "password": "another-long-password"},
    ).json()
    other_auth = {"Authorization": f"Bearer {other['access_token']}"}
    client.post("/api/v1/trips", headers=other_auth, json={"name": "Different trip"})

    response = client.get(f"/api/v1/places/{saved[0]['trip_place_id']}", headers=other_auth)
    assert response.status_code == 404


def test_advice_about_a_stay_is_knowledge_not_a_pin(client, auth, trip):
    """A hostel recommendation with no named place must not demand coordinates."""
    client.post(
        "/api/v1/sources",
        headers=auth,
        json={"text": "The hostel we booked had a great rooftop bar.", "kind": "note"},
    )
    candidate = next(
        c for c in client.get("/api/v1/inbox", headers=auth).json() if c["type"] == "accommodation"
    )
    assert candidate["is_place_candidate"] is False

    result = client.post(f"/api/v1/candidates/{candidate['id']}/approve", headers=auth, json={})
    assert result.status_code == 200, result.text
    assert result.json()["kind"] == "knowledge"
    assert client.get("/api/v1/map", headers=auth).json()["features"] == []


def test_a_named_stay_still_becomes_a_place(client, auth, trip):
    client.post(
        "/api/v1/sources",
        headers=auth,
        json={"text": "Stay at Tremendo Hostel in Antigua, the rooftop is great.", "kind": "note"},
    )
    candidate = next(
        c
        for c in client.get("/api/v1/inbox", headers=auth).json()
        if c["is_place_candidate"] and c["title"] == "Tremendo Hostel"
    )
    result = client.post(
        f"/api/v1/candidates/{candidate['id']}/approve",
        headers=auth,
        json={"provider_place_id": candidate["resolutions"][0]["provider_place_id"]},
    )
    assert result.json()["kind"] == "place"


def test_a_video_with_no_speech_still_yields_reviewable_candidates(client, auth, trip, tmp_path):
    """The whole point of the media pipeline, end to end through the API.

    A travel Reel whose audio is music: everything worth keeping is text burned
    into the frames, so a pipeline that only listens recovers nothing.
    """
    from tests.media_fixtures import build_reel, can_build

    if not can_build():
        import pytest

        pytest.skip("ffmpeg or a usable font is unavailable")

    reel = build_reel(tmp_path / "antigua.mp4")
    assert reel is not None

    response = client.post(
        "/api/v1/sources/upload",
        headers=auth,
        files={"files": ("antigua.mp4", reel.read_bytes(), "video/mp4")},
    )
    assert response.status_code == 201, response.text
    source = response.json()[0]

    # Every stage reports what it did, which is the per-item status spec 7.5 wants.
    stage_names = [stage["name"] for stage in source["stages"]]
    assert "probe" in stage_names and "on-screen text" in stage_names
    assert source["ocr_chars"] > 0
    assert source["duration_seconds"] and source["duration_seconds"] > 1
    assert source["status"] == "needs_review"

    inbox = client.get("/api/v1/inbox", headers=auth, params={"source_id": source["id"]}).json()
    titles = " ".join(candidate["title"] for candidate in inbox).lower()
    assert "cerro de la cruz" in titles

    # A quote read off the screen can cite the second it appeared.
    stamped = [
        evidence
        for candidate in inbox
        for evidence in candidate["evidence"]
        if evidence["media_timestamp_seconds"] is not None
    ]
    assert stamped, "on-screen quotes should carry the moment they appeared"


TIKTOK_CAPTION = (
    "Cerro de la Cruz at sunset is the best free view in Antigua. "
    "Careful with the taxi scam at the terminal, they quote four times the price."
)


def test_a_caption_the_client_recovered_is_saved_and_credited(client, auth, trip):
    """The share sheet and the browser can read what the server cannot.

    A datacenter IP is the first thing bot protection blocks, so the caption
    arrives from the traveller's own device instead. The API records which path
    supplied it rather than pretending it fetched anything.
    """
    response = client.post(
        "/api/v1/sources",
        headers=auth,
        json={
            "url": "https://vt.tiktok.com/ZSqsY4ykw/",
            "text": TIKTOK_CAPTION,
            "kind": "link",
            "reader": "share-target",
        },
    )
    assert response.status_code == 201, response.text
    source = response.json()

    assert source["status"] == "needs_review"
    stage = next(stage for stage in source["stages"] if stage["name"] == "link")
    assert stage["engine"] == "share sheet"
    assert stage["status"] == "ok"

    inbox = client.get("/api/v1/inbox", headers=auth, params={"source_id": source["id"]}).json()
    types = {candidate["type"] for candidate in inbox}
    assert "place" in types and "safety" in types


def test_the_server_does_not_claim_to_have_read_a_link_the_client_read(client, auth, trip):
    """No `reader`, no credit: the stage only appears when a path really ran."""
    response = client.post(
        "/api/v1/sources",
        headers=auth,
        json={"url": "https://example-blog.test/a", "text": "Go to Semuc Champey.", "kind": "link"},
    )
    assert [stage for stage in response.json()["stages"] if stage["name"] == "link"] == []
