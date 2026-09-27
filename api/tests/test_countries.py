"""Counting a library by country.

Scope elsewhere resolves to one label per place, so a place attached to a
destination never groups under the country it is in. These tests pin the second
axis: every place gathered by country, with the spellings folded and the
absences named rather than dropped.
"""

from app.services.countries import UNKNOWN_COUNTRY, normalise_country, tally_countries
from tests.conftest import REEL_TRANSCRIPT


def test_case_and_accents_fold_to_one_country():
    assert normalise_country("Panama") == normalise_country("panama")
    assert normalise_country("Panamá") == normalise_country("Panama")
    assert normalise_country("  Guatemala  ") == normalise_country("guatemala")


def test_a_missing_country_is_its_own_empty_key():
    assert normalise_country(None) == ""
    assert normalise_country("") == ""
    assert normalise_country("   ") == ""


class _Source:
    def __init__(self, video: bool, playable: bool) -> None:
        self.video = video
        self.playable = playable


class _Place:
    def __init__(self, pid: str, country: str | None) -> None:
        self.id = pid
        self.country = country


def _row(pid: str, country: str | None, *, video: bool = True, playable: bool = True):
    return (None, _Source(video, playable), None, _Place(pid, country))


def _tally(rows):
    return tally_countries(
        rows,
        is_video=lambda s: s.video,
        is_playable=lambda s: s.playable,
    )


def test_two_spellings_of_a_country_are_one_row():
    out = _tally([_row("a", "Panama"), _row("b", "Panamá"), _row("c", "panama")])
    assert len(out) == 1
    assert out[0].video_count == 3
    assert out[0].place_count == 3
    # The first spelling seen is what the traveller is shown.
    assert out[0].name == "Panama"


def test_a_place_with_no_country_is_named_not_dropped():
    out = _tally([_row("a", None), _row("b", "Guatemala")])
    names = {c.name for c in out}
    assert UNKNOWN_COUNTRY in names
    assert sum(c.video_count for c in out) == 2


def test_one_place_with_several_videos_counts_as_one_place():
    out = _tally([_row("a", "Guatemala"), _row("a", "Guatemala"), _row("a", "Guatemala")])
    assert out[0].place_count == 1
    assert out[0].video_count == 3


def test_a_link_only_source_counts_as_video_but_not_playable():
    out = _tally([_row("a", "Guatemala", playable=False), _row("b", "Guatemala")])
    assert out[0].video_count == 2
    assert out[0].playable_count == 1


def test_a_non_video_source_is_not_counted_at_all():
    out = _tally([_row("a", "Guatemala", video=False)])
    assert out == []


def test_countries_sort_by_how_much_video_backs_them():
    out = _tally(
        [
            _row("a", "Belize"),
            _row("b", "Guatemala"),
            _row("c", "Guatemala"),
            _row("d", "Guatemala"),
        ]
    )
    assert [c.name for c in out] == ["Guatemala", "Belize"]


# ------------------------------------------------------ a corpus to count

def _capture_and_approve(client, auth) -> int:
    """A TikTok link plus its approved places.

    A link on a video host counts as a video source without needing bytes, so
    this builds a countable corpus without ffmpeg.
    """
    captured = client.post(
        "/api/v1/sources",
        headers=auth,
        json={
            "url": "https://www.tiktok.com/@backpackerlina/video/7123456789",
            "text": REEL_TRANSCRIPT,
            "title": "3 days in Antigua",
        },
    )
    assert captured.status_code in (200, 201), captured.text

    approved = 0
    for candidate in client.get("/api/v1/inbox", headers=auth).json():
        if candidate["type"] not in ("place", "accommodation"):
            continue
        if not candidate["resolutions"]:
            continue
        result = client.post(
            f"/api/v1/candidates/{candidate['id']}/approve",
            headers=auth,
            json={"provider_place_id": candidate["resolutions"][0]["provider_place_id"]},
        )
        assert result.status_code == 200, result.text
        approved += 1
    assert approved, "the reel should yield at least one resolvable place"
    return approved


def test_countries_group_every_saved_place_by_country(client, auth, trip):
    _capture_and_approve(client, auth)
    response = client.get("/api/v1/reels/countries", headers=auth)
    assert response.status_code == 200, response.text
    rows = response.json()
    assert rows, "the seeded trip should hold at least one country"
    counts = [row["video_count"] for row in rows]
    assert counts == sorted(counts, reverse=True)
    for row in rows:
        assert row["place_count"] >= 1
        assert row["playable_count"] <= row["video_count"]


def test_one_travellers_countries_never_include_anothers(client, auth, trip):
    other = client.post(
        "/api/v1/auth/register",
        json={"email": "countries-other@example.com", "password": "another-long-password"},
    )
    other_auth = {"Authorization": f"Bearer {other.json()['access_token']}"}
    client.post("/api/v1/trips", headers=other_auth, json={"name": "Another trip"})
    assert client.get("/api/v1/reels/countries", headers=other_auth).json() == []


def test_a_country_filter_narrows_the_spots(client, auth, trip):
    _capture_and_approve(client, auth)
    countries = client.get("/api/v1/reels/countries", headers=auth).json()
    assert countries, "need a country to filter by"
    name = countries[0]["name"]
    expected = countries[0]["video_count"]

    spots = client.get("/api/v1/reels/spots", headers=auth, params={"country": name}).json()
    assert spots, f"{name} should have spots"
    assert sum(spot["clip_count"] for spot in spots) == expected

    unfiltered = client.get("/api/v1/reels/spots", headers=auth).json()
    assert len(spots) <= len(unfiltered)


# ------------------------------------- the globe's index: route plus evidence


def test_the_globe_lists_every_route_country_even_with_no_video(client, auth, trip):
    """A country you planned but never saved a reel about still has to appear.

    The globe is how a country gets pressed, so a country missing from it is a
    country the traveller cannot reach.
    """
    _capture_and_approve(client, auth)
    rows = client.get("/api/v1/countries", headers=auth).json()
    names = {row["name"] for row in rows}

    # The fixture's destination is in Guatemala; it must be listed whether or
    # not any video names it.
    assert "Guatemala" in names
    listed = next(row for row in rows if row["name"] == "Guatemala")
    assert listed["in_route"] is True
    assert listed["stop_count"] >= 1


def test_a_country_with_video_but_no_stop_is_still_listed(client, auth, trip):
    """The fixture's only stop is in Guatemala, so Mexico arrives by reel alone."""
    _capture_and_approve(client, auth)
    client.post(
        "/api/v1/sources",
        headers=auth,
        json={
            "url": "https://www.instagram.com/reel/Cx2mexico",
            "text": (
                "Oaxaca is the best food city in Mexico. Mercado 20 de Noviembre for "
                "tlayudas. Puerto Escondido after for surfing at Zicatela."
            ),
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

    rows = client.get("/api/v1/countries", headers=auth).json()
    mexico = [row for row in rows if row["name"] == "Mexico"]
    assert mexico, "a country named only by a reel must still appear"
    assert mexico[0]["in_route"] is False
    assert mexico[0]["video_count"] >= 1


def test_every_listed_country_can_be_placed_on_a_globe(client, auth, trip):
    _capture_and_approve(client, auth)
    for row in client.get("/api/v1/countries", headers=auth).json():
        assert row["lat"] is not None and row["lon"] is not None, row["name"]
        assert -90 <= row["lat"] <= 90
        assert -180 <= row["lon"] <= 180


def test_route_countries_sort_before_ones_only_a_reel_named(client, auth, trip):
    _capture_and_approve(client, auth)
    rows = client.get("/api/v1/countries", headers=auth).json()
    in_route = [index for index, row in enumerate(rows) if row["in_route"]]
    off_route = [index for index, row in enumerate(rows) if not row["in_route"]]
    if in_route and off_route:
        assert max(in_route) < min(off_route)


# ---------------------------------------------------------------------------
# The found tier, carried up to the country
#
# A clip the app found counts for nothing until the traveller stamps it, and the
# map draws that difference as an inked mark against a dry one. For the marks to
# be drawable at country level the tally has to carry the split, not just the
# total - otherwise every country reads as entirely the traveller's own.
# ---------------------------------------------------------------------------


class _FoundSource:
    def __init__(self, video: bool, playable: bool, found: bool) -> None:
        self.video = video
        self.playable = playable
        self.found = found


def _found_row(pid: str, country: str | None, *, found: bool = False):
    return (None, _FoundSource(True, True, found), None, _Place(pid, country))


def _found_tally(rows):
    return tally_countries(
        rows,
        is_video=lambda s: s.video,
        is_playable=lambda s: s.playable,
        is_found=lambda s: s.found,
    )


def test_a_country_counts_what_was_found_separately_from_what_is_yours():
    rows = [
        _found_row("p1", "Guatemala"),
        _found_row("p2", "Guatemala", found=True),
        _found_row("p3", "Guatemala", found=True),
    ]
    (tally,) = _found_tally(rows)
    assert tally.video_count == 3
    assert tally.found_count == 2


def test_a_country_with_nothing_found_reports_zero_rather_than_nothing():
    (tally,) = _found_tally([_found_row("p1", "Belize")])
    assert tally.found_count == 0


def test_found_is_optional_so_existing_callers_keep_working():
    # Callers that have no notion of a found tier must not have to invent one.
    (tally,) = _tally([_row("p1", "Guatemala")])
    assert tally.found_count == 0
