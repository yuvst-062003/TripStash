"""Going looking, and keeping what is found apart from what was saved.

The property these pin: a found clip can never inflate a count of the
traveller's own. Everything else here is convenience; that one is the product.
"""

from __future__ import annotations

from app.adapters.video_search import FakeVideoSearch, FoundVideo
from app.services.finding import find_videos, search_query
from tests.conftest import REEL_TRANSCRIPT


class _Empty:
    name = "empty"

    def search(self, query: str, *, limit: int = 5) -> list[FoundVideo]:
        return []


def test_a_query_is_short_and_says_what_it_is_for():
    assert search_query(place="Antigua") == "Antigua"
    assert search_query(place="Antigua", activity="hike") == "Antigua hike"
    assert search_query(place="Antigua", activity="street_food") == "Antigua street food"


def test_the_fake_is_deterministic():
    provider = FakeVideoSearch()
    first = provider.search("Antigua hike")
    second = provider.search("Antigua hike")
    assert first == second
    assert first, "the fake has to return something or the found tier cannot be seen"


def test_the_fake_returns_nothing_for_nothing():
    assert FakeVideoSearch().search("   ") == []


def test_found_sources_are_marked_at_creation(client, auth, trip, session):
    outcome = find_videos(
        session,
        trip_id=_trip_id(session),
        provider=FakeVideoSearch(),
        place="Antigua",
        activity="hike",
    )
    assert outcome.created, "the fake should have produced something"
    for source in outcome.created:
        assert source.found is True
        assert source.provenance == "inference"


def test_searching_twice_does_not_duplicate(client, auth, trip, session):
    trip_id = _trip_id(session)
    first = find_videos(session, trip_id=trip_id, provider=FakeVideoSearch(), place="Antigua")
    session.commit()
    second = find_videos(session, trip_id=trip_id, provider=FakeVideoSearch(), place="Antigua")

    assert first.created
    assert second.created == []
    assert second.already_had == len(first.created)


def test_finding_nothing_explains_itself_instead_of_going_quiet(client, auth, trip, session):
    outcome = find_videos(session, trip_id=_trip_id(session), provider=_Empty(), place="Belize")

    assert outcome.created == []
    assert outcome.searched is True
    assert outcome.nothing_reason
    assert "Belize" in outcome.nothing_reason
    # Never a dead end: it offers the next move.
    assert "Ask" in outcome.nothing_reason or "save" in outcome.nothing_reason


def _trip_id(session) -> str:
    from sqlalchemy import select

    from app.models.core import Trip

    return session.execute(select(Trip.id)).scalars().first()


def test_a_found_clip_never_counts_as_one_of_yours(client, auth, trip):
    """The property the whole tier exists to protect."""
    client.post(
        "/api/v1/sources",
        headers=auth,
        json={
            "url": "https://www.tiktok.com/@backpackerlina/video/7301",
            "text": REEL_TRANSCRIPT,
        },
    )
    for candidate in client.get("/api/v1/inbox", headers=auth).json():
        if candidate["type"] not in ("place", "accommodation") or not candidate["resolutions"]:
            continue
        client.post(
            f"/api/v1/candidates/{candidate['id']}/approve",
            headers=auth,
            json={"provider_place_id": candidate["resolutions"][0]["provider_place_id"]},
        )

    before = client.get("/api/v1/countries/guatemala/cities/antigua/places", headers=auth).json()
    yours_before = sum(p["video_count"] - p["found_count"] for p in before)

    found = client.post(
        "/api/v1/find",
        headers=auth,
        json={"place": "Antigua", "activity": "hike"},
    )
    assert found.status_code == 200, found.text

    after = client.get("/api/v1/countries/guatemala/cities/antigua/places", headers=auth).json()
    yours_after = sum(p["video_count"] - p["found_count"] for p in after)
    assert yours_after == yours_before, "finding must never change the count of your own"
