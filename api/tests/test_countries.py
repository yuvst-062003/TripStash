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
