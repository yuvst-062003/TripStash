"""The video feed: the saved section of each clip, scoped to a spot.

The end-to-end test uses the same real MP4 the media pipeline tests use, so
the timestamps in the feed are the ones OCR actually produced rather than
numbers a fixture invented.
"""

from __future__ import annotations

import pytest

from app.services.reels import (
    CLIP_SECONDS,
    LEAD_IN_SECONDS,
    WHOLE_VIDEO_UNDER_SECONDS,
    clip_window,
)
from tests.media_fixtures import build_reel, can_build

# ------------------------------------------------------- the clip window


def test_a_clip_opens_just_before_the_moment_it_was_saved_from():
    window = clip_window(timestamp=40.0, duration=120.0)

    assert window.start_seconds == pytest.approx(40.0 - LEAD_IN_SECONDS)
    assert window.end_seconds == pytest.approx(window.start_seconds + CLIP_SECONDS)
    assert not window.is_whole


def test_a_short_video_is_played_whole_rather_than_cut():
    window = clip_window(timestamp=4.0, duration=WHOLE_VIDEO_UNDER_SECONDS - 1)

    assert window.is_whole
    assert window.start_seconds == 0.0


def test_a_video_with_no_saved_moment_plays_from_the_start():
    window = clip_window(timestamp=None, duration=180.0)

    assert window.is_whole
    assert (window.start_seconds, window.end_seconds) == (0.0, 180.0)


def test_a_moment_near_the_end_is_pulled_back_instead_of_truncated():
    """The window keeps its length; it does not shrink to a two-second stub."""
    window = clip_window(timestamp=118.0, duration=120.0)

    assert window.end_seconds == pytest.approx(120.0)
    assert window.end_seconds - window.start_seconds == pytest.approx(CLIP_SECONDS)


def test_an_unknown_duration_still_produces_a_window():
    window = clip_window(timestamp=30.0, duration=None)

    assert not window.is_whole
    assert window.start_seconds == pytest.approx(30.0 - LEAD_IN_SECONDS)


# --------------------------------------------------------- the feed itself


def upload_reel(client, auth, tmp_path):
    reel = build_reel(tmp_path / "antigua.mp4")
    assert reel is not None
    response = client.post(
        "/api/v1/sources/upload",
        headers=auth,
        files={"files": ("antigua.mp4", reel.read_bytes(), "video/mp4")},
    )
    assert response.status_code == 201, response.text
    return response.json()[0]


def approve_places(client, auth, source_id):
    inbox = client.get("/api/v1/inbox", headers=auth, params={"source_id": source_id}).json()
    approved = []
    for candidate in inbox:
        if not candidate["is_place_candidate"] or not candidate["resolutions"]:
            continue
        result = client.post(
            f"/api/v1/candidates/{candidate['id']}/approve",
            headers=auth,
            json={"provider_place_id": candidate["resolutions"][0]["provider_place_id"]},
        )
        assert result.status_code == 200, result.text
        approved.append(result.json())
    return approved


@pytest.mark.skipif(not can_build(), reason="ffmpeg or a usable font is unavailable")
def test_a_saved_video_becomes_a_clip_for_the_spot_it_named(client, auth, trip, tmp_path):
    source = upload_reel(client, auth, tmp_path)
    approved = approve_places(client, auth, source["id"])
    assert approved, "the video should have produced at least one approvable place"

    clips = client.get("/api/v1/reels", headers=auth).json()
    assert clips, "an approved place from a video should appear in the feed"

    clip = clips[0]
    assert clip["source_id"] == source["id"]
    assert clip["file_url"], "the app holds these bytes, so it should offer to play them"
    assert clip["place_name"]
    # Scope falls back to the place's city when no destination was chosen.
    assert clip["scope_label"]
    # The quote is why this spot is in the feed at all.
    assert clip["quote"] or clip["takeaway"]


@pytest.mark.skipif(not can_build(), reason="ffmpeg or a usable font is unavailable")
def test_the_feed_can_be_narrowed_to_one_spot(client, auth, trip, tmp_path):
    source = upload_reel(client, auth, tmp_path)
    approved = approve_places(client, auth, source["id"])
    wanted = approved[0]["trip_place_id"]

    clips = client.get(
        "/api/v1/reels", headers=auth, params={"trip_place_id": wanted}
    ).json()

    assert clips
    assert {clip["trip_place_id"] for clip in clips} == {wanted}


@pytest.mark.skipif(not can_build(), reason="ffmpeg or a usable font is unavailable")
def test_the_index_counts_what_each_spot_actually_holds(client, auth, trip, tmp_path):
    source = upload_reel(client, auth, tmp_path)
    approve_places(client, auth, source["id"])

    spots = client.get("/api/v1/reels/spots", headers=auth).json()

    assert spots
    for spot in spots:
        assert spot["clip_count"] >= 1
        assert spot["playable_count"] == spot["clip_count"]
        assert spot["scope_label"]

    detail = client.get(
        f"/api/v1/reels/spots/{spots[0]['trip_place_id']}", headers=auth
    ).json()
    assert detail["name"] == spots[0]["name"]


@pytest.mark.skipif(not can_build(), reason="ffmpeg or a usable font is unavailable")
def test_a_clip_can_be_seeked_into_without_downloading_the_whole_video(
    client, auth, trip, tmp_path
):
    """A feed that opens on a timestamp needs range requests to be honoured."""
    source = upload_reel(client, auth, tmp_path)
    approve_places(client, auth, source["id"])
    clip = client.get("/api/v1/reels", headers=auth).json()[0]

    whole = client.get(clip["file_url"], headers=auth)
    assert whole.status_code == 200
    assert whole.headers["content-type"] == "video/mp4"
    assert whole.headers["accept-ranges"] == "bytes"

    ranged = client.get(clip["file_url"], headers={**auth, "Range": "bytes=10-49"})
    assert ranged.status_code == 206
    assert ranged.headers["content-range"] == f"bytes 10-49/{len(whole.content)}"
    assert ranged.content == whole.content[10:50]


def test_a_link_only_video_still_gets_a_card_but_nothing_to_play(client, auth, trip):
    """The library is honest about what it can and cannot play."""
    from tests.conftest import REEL_TRANSCRIPT

    source = client.post(
        "/api/v1/sources",
        headers=auth,
        json={
            "url": "https://www.tiktok.com/@lina/video/123",
            "text": REEL_TRANSCRIPT,
            "title": "3 days in Antigua",
        },
    ).json()
    approved = approve_places(client, auth, source["id"])
    assert approved

    clips = client.get("/api/v1/reels", headers=auth).json()
    assert clips
    assert all(clip["file_url"] is None for clip in clips)
    assert all(clip["url"] for clip in clips)

    playable = client.get("/api/v1/reels", headers=auth, params={"playable_only": True}).json()
    assert playable == []


def test_a_text_note_never_reaches_the_video_feed(client, auth, trip):
    from tests.conftest import REEL_TRANSCRIPT

    source = client.post(
        "/api/v1/sources",
        headers=auth,
        json={"text": REEL_TRANSCRIPT, "kind": "note", "title": "notes from a friend"},
    ).json()
    approve_places(client, auth, source["id"])

    assert client.get("/api/v1/reels", headers=auth).json() == []
    assert client.get("/api/v1/reels/spots", headers=auth).json() == []


def test_one_travellers_clips_never_appear_in_anothers_feed(client, auth, trip):
    from tests.conftest import REEL_TRANSCRIPT

    source = client.post(
        "/api/v1/sources",
        headers=auth,
        json={"url": "https://www.tiktok.com/@lina/video/123", "text": REEL_TRANSCRIPT},
    ).json()
    approve_places(client, auth, source["id"])
    assert client.get("/api/v1/reels", headers=auth).json()

    other = client.post(
        "/api/v1/auth/register",
        json={"email": "stranger@example.com", "password": "another-long-password"},
    ).json()
    other_auth = {"Authorization": f"Bearer {other['access_token']}"}
    client.post("/api/v1/trips", headers=other_auth, json={"name": "Different trip"})

    assert client.get("/api/v1/reels", headers=other_auth).json() == []
