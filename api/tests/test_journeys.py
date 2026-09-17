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


def test_marking_a_stop_as_here_now_moves_the_flag(client, auth, trip):
    """A route has one "here now"; moving it clears the previous stop's flag."""
    created = client.post(
        "/api/v1/trips/current/destinations",
        headers=auth,
        json={"name": "Lake Atitlán", "country": "Guatemala", "lat": 14.69, "lon": -91.2},
    )
    assert created.status_code == 201, created.text
    stop_id = created.json()["id"]

    moved = client.patch(
        f"/api/v1/trips/current/destinations/{stop_id}",
        headers=auth,
        json={"is_current": True, "arrive_on": "2026-09-20"},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["is_current"] is True
    assert moved.json()["arrive_on"] == "2026-09-20"

    stops = client.get("/api/v1/trips/current", headers=auth).json()["destinations"]
    current = [stop["name"] for stop in stops if stop["is_current"]]
    assert current == ["Lake Atitlán"]

    missing = client.patch(
        "/api/v1/trips/current/destinations/not-a-stop", headers=auth, json={"is_current": True}
    )
    assert missing.status_code == 404


def test_an_event_is_brought_back_as_its_date_nears(client, auth, trip):
    """A festival saved by hand shows on Home with how far away it is."""
    from datetime import date, timedelta

    soon = date.today() + timedelta(days=12)
    created = client.post(
        "/api/v1/knowledge",
        headers=auth,
        json={
            "type": "event",
            "title": "Carnaval in Salvador",
            "body": "Blocos start in Barra around 16:00.",
            "destination_scope": "Salvador",
            "happens_on": soon.isoformat(),
            "ends_on": (soon + timedelta(days=4)).isoformat(),
        },
    )
    assert created.status_code == 201, created.text

    listed = client.get("/api/v1/knowledge", headers=auth, params={"type": "event"}).json()
    assert listed[0]["happens_on"] == soon.isoformat()
    assert listed[0]["provenance"] == "user"

    home = client.get("/api/v1/home", headers=auth).json()
    events = [r for r in home["resurfaced"] if r["knowledge_type"] == "event"]
    assert events and events[0]["reason"].startswith("In 12 days")

    far = client.post(
        "/api/v1/knowledge",
        headers=auth,
        json={
            "type": "event",
            "title": "Inti Raymi",
            "happens_on": (date.today() + timedelta(days=200)).isoformat(),
        },
    )
    assert far.status_code == 201
    home = client.get("/api/v1/home", headers=auth).json()
    assert all(r["title"] != "Inti Raymi" for r in home["resurfaced"])

    backwards = client.post(
        "/api/v1/knowledge",
        headers=auth,
        json={
            "type": "event",
            "title": "Nope",
            "happens_on": "2027-03-05",
            "ends_on": "2027-03-01",
        },
    )
    assert backwards.status_code == 422


def test_recommendations_come_only_from_the_travellers_own_stash(client, auth, trip):
    """Spec 5.5: grounded, read-only; a must-visit and a soon event lead."""
    from datetime import date, timedelta

    source = capture_reel(client, auth)
    inbox = client.get("/api/v1/inbox", headers=auth).json()
    place = next(c for c in inbox if c["is_place_candidate"] and c["resolutions"])
    approved = client.post(
        f"/api/v1/candidates/{place['id']}/approve",
        headers=auth,
        json={"provider_place_id": place["resolutions"][0]["provider_place_id"]},
    )
    assert approved.status_code == 200, approved.text
    client.post(
        "/api/v1/knowledge",
        headers=auth,
        json={
            "type": "event",
            "title": "Semana Santa processions",
            "destination_scope": "Antigua",
            "happens_on": (date.today() + timedelta(days=9)).isoformat(),
        },
    )
    assert source["id"]

    out = client.get("/api/v1/recommend", headers=auth, params={"q": "Antigua"}).json()
    assert out["grounded"] is True
    kinds = [c["type"] for c in out["cards"]]
    assert "place" in kinds and "knowledge" in kinds
    event = next(c for c in out["cards"] if c.get("knowledge_type") == "event")
    assert event["when"] == "in 9 days"
    assert "Antigua" in out["summary"]

    nothing = client.get("/api/v1/recommend", headers=auth, params={"q": "Ushuaia"}).json()
    assert nothing["cards"] == [] and "Nothing stashed" in nothing["summary"]


def test_home_never_invents_a_distance_from_you_without_a_location(client, auth, trip):
    """Spec 12: honest numbers. A stand-in origin finds places but is not "from you"."""
    from datetime import date, timedelta

    source = capture_reel(client, auth)
    inbox = client.get("/api/v1/inbox", headers=auth).json()
    # A place inside Antigua (the volcano is 16 km out, beyond "nearby").
    place = next(
        c
        for c in inbox
        if c["is_place_candidate"]
        and c["resolutions"]
        and abs(c["resolutions"][0]["lat"] - ANTIGUA["lat"]) < 0.02
        and abs(c["resolutions"][0]["lon"] - ANTIGUA["lon"]) < 0.02
    )
    client.post(
        f"/api/v1/candidates/{place['id']}/approve",
        headers=auth,
        json={"provider_place_id": place["resolutions"][0]["provider_place_id"]},
    )
    client.post(
        "/api/v1/knowledge",
        headers=auth,
        json={
            "type": "event",
            "title": "Semana Santa",
            "destination_scope": "Antigua",
            "happens_on": (date.today() + timedelta(days=5)).isoformat(),
        },
    )
    assert source["id"]

    without = client.get("/api/v1/home", headers=auth).json()["resurfaced"]
    places = [r for r in without if r["kind"] == "place"]
    assert places, "the destination centre still finds nearby saves"
    assert all(r["distance_km"] is None for r in places)
    assert all("from you" not in r["reason"] for r in places)
    assert places[0]["reason"].startswith("In Antigua")

    with_location = client.get(
        "/api/v1/home", headers=auth, params={"lat": 14.5586, "lon": -90.7295}
    ).json()["resurfaced"]
    near = [r for r in with_location if r["kind"] == "place"]
    assert near and near[0]["distance_km"] is not None

    # The same event is never two cards.
    events = [r for r in with_location if r.get("knowledge_type") == "event"]
    assert len(events) == 1


# ------------------------------------------------- review card decisions


def test_source_settles_once_its_last_candidate_is_decided(client, auth, trip):
    source = capture_reel(client, auth)
    inbox = client.get("/api/v1/inbox", headers=auth, params={"source_id": source["id"]}).json()
    assert inbox
    for candidate in inbox:
        result = client.post(f"/api/v1/candidates/{candidate['id']}/ignore", headers=auth)
        assert result.status_code == 204, result.text
    sources = client.get("/api/v1/sources", headers=auth).json()
    settled = next(s for s in sources if s["id"] == source["id"])
    assert settled["pending_count"] == 0
    assert settled["status"] == "completed"


def test_an_edited_tip_is_saved_with_its_edit_and_marked_as_yours(client, auth, trip):
    capture_reel(client, auth)
    inbox = client.get("/api/v1/inbox", headers=auth).json()
    tip = next(c for c in inbox if c["type"] == "safety")
    edited = client.patch(
        f"/api/v1/candidates/{tip['id']}",
        headers=auth,
        json={
            "title": "Taxi scam at the terminal",
            "body": "Taxis at the bus terminal overcharge.",
        },
    )
    assert edited.status_code == 200, edited.text
    approved = client.post(
        f"/api/v1/candidates/{tip['id']}/approve",
        headers=auth,
        json={"reason_saved": "Dani said agree the price first."},
    )
    assert approved.status_code == 200, approved.text
    item = next(
        k for k in client.get("/api/v1/knowledge", headers=auth).json()
        if k["id"] == approved.json()["knowledge_item_id"]
    )
    assert item["title"] == "Taxi scam at the terminal"
    assert item["body"].startswith("Taxis at the bus terminal overcharge.")
    assert "Dani said agree the price first." in item["body"]
    assert item["user_edited"] is True


def test_a_duplicate_candidate_names_the_place_it_matches(client, auth, trip):
    capture_reel(client, auth)
    approve_all_places(client, auth)
    # The same reel captured again resolves to places that are already saved.
    client.post(
        "/api/v1/sources",
        headers=auth,
        json={"url": "https://www.example-social.test/reel/abc124", "text": REEL_TRANSCRIPT},
    )
    inbox = client.get("/api/v1/inbox", headers=auth).json()
    duplicates = [c for c in inbox if c["duplicate_of_place_id"]]
    assert duplicates
    for candidate in duplicates:
        assert candidate["duplicate_of_name"]


# ------------------------------------------------- the trip screen's numbers


def test_leaving_the_plan_reverts_the_promotion(client, auth, trip):
    capture_reel(client, auth)
    saved = approve_all_places(client, auth)[0]
    row = client.post(
        "/api/v1/itinerary",
        headers=auth,
        json={"trip_place_id": saved["trip_place_id"], "on_date": "2026-09-18"},
    )
    assert row.status_code == 201, row.text
    def status_of(trip_place_id: str) -> str:
        places = client.get("/api/v1/places", headers=auth).json()
        return next(p["status"] for p in places if p["trip_place_id"] == trip_place_id)

    assert status_of(saved["trip_place_id"]) == "planned"
    removed = client.delete(f"/api/v1/itinerary/{row.json()['id']}", headers=auth)
    assert removed.status_code == 204
    assert status_of(saved["trip_place_id"]) == "saved"


def test_plan_times_are_real_clock_times_and_untimed_rows_come_last(client, auth, trip):
    bad = client.post(
        "/api/v1/itinerary",
        headers=auth,
        json={"title": "Sunrise", "on_date": "2026-09-18", "start_time": "25:99"},
    )
    assert bad.status_code == 422
    client.post(
        "/api/v1/itinerary", headers=auth, json={"title": "Sometime", "on_date": "2026-09-18"}
    )
    client.post(
        "/api/v1/itinerary",
        headers=auth,
        json={"title": "Sunrise", "on_date": "2026-09-18", "start_time": "06:00"},
    )
    titles = [r["title"] for r in client.get("/api/v1/itinerary", headers=auth).json()]
    assert titles == ["Sunrise", "Sometime"]


def test_bookings_and_expenses_can_be_taken_back(client, auth, trip):
    booking = client.post("/api/v1/bookings", headers=auth, json={"title": "Hostel, 2 nights"})
    assert booking.status_code == 201
    expense = client.post(
        "/api/v1/expenses",
        headers=auth,
        json={"spent_on": "2026-09-17", "amount": 7200, "currency": "USD", "category": "other"},
    )
    assert expense.status_code == 201
    booking_url = f"/api/v1/bookings/{booking.json()['id']}"
    expense_url = f"/api/v1/expenses/{expense.json()['id']}"
    assert client.delete(booking_url, headers=auth).status_code == 204
    assert client.delete(expense_url, headers=auth).status_code == 204
    assert client.get("/api/v1/bookings", headers=auth).json() == []
    assert client.get("/api/v1/expenses", headers=auth).json()["total"] == 0
    assert client.delete(expense_url, headers=auth).status_code == 404
