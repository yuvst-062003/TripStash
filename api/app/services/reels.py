"""The saved section of a video, and which spot it belongs to.

A saved video is rarely about its whole running time. The extraction pipeline
already records *which second* a claim came from
(`SourcePlaceEvidence.media_timestamp_seconds`), so a feed can open on that
moment instead of making the traveller scrub for it. This module turns that
single timestamp into a playable window, and decides which sources are worth
putting in a video feed at all.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.capture import Source
from app.models.enums import SourceKind

# Start a little before the moment the claim was made: the name of a place is
# usually said just after it comes on screen.
LEAD_IN_SECONDS = 2.5
# Long enough to recognise the spot, short enough that swiping stays the
# natural thing to do.
CLIP_SECONDS = 15.0
# Below this, a window is not worth cutting - play the whole thing.
WHOLE_VIDEO_UNDER_SECONDS = 25.0

VIDEO_HOSTS = (
    "tiktok.com",
    "instagram.com",
    "youtube.com",
    "youtu.be",
    "facebook.com",
    "vimeo.com",
)


@dataclass(frozen=True)
class ClipWindow:
    """The section of a video that this spot was saved from."""

    start_seconds: float
    end_seconds: float | None
    # True when the window is the whole video rather than a cut section, so the
    # interface can say "whole clip" instead of implying a choice was made.
    is_whole: bool


def clip_window(timestamp: float | None, duration: float | None) -> ClipWindow:
    """Turn the evidence timestamp into a window to play.

    With no timestamp, or a video short enough to watch end to end, the window
    is the whole video. Otherwise it opens slightly before the timestamp and
    runs for `CLIP_SECONDS`, pulled back from the end rather than truncated.
    """
    if duration is not None and duration <= 0:
        duration = None
    whole = ClipWindow(start_seconds=0.0, end_seconds=duration, is_whole=True)

    if timestamp is None or timestamp < 0:
        return whole
    if duration is not None and duration <= WHOLE_VIDEO_UNDER_SECONDS:
        return whole

    start = max(0.0, timestamp - LEAD_IN_SECONDS)
    end = start + CLIP_SECONDS
    if duration is not None and end > duration:
        end = duration
        start = max(0.0, end - CLIP_SECONDS)
    return ClipWindow(start_seconds=round(start, 2), end_seconds=round(end, 2), is_whole=False)


def is_playable(source: Source) -> bool:
    """Whether the app holds the actual video bytes and can play them inline."""
    if not source.storage_key:
        return False
    media_type = (source.media_type or "").lower()
    if media_type.startswith("video/"):
        return True
    # A video saved from the album before probing finished still carries the
    # video kind; trust that rather than dropping it from the feed.
    return not media_type and str(source.kind) == SourceKind.VIDEO


def is_video_source(source: Source) -> bool:
    """Playable here, or a link to somewhere it can be watched.

    Link-only sources stay in the feed on purpose: the quote and the spot are
    the point, and the card offers to open the original. Silently dropping them
    would make the feed look emptier than the library actually is.
    """
    if is_playable(source):
        return True
    if str(source.kind) == SourceKind.VIDEO:
        return True
    url = (source.url or "").lower()
    return bool(url) and any(host in url for host in VIDEO_HOSTS)
