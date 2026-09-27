"""Looking for video the traveller has not saved.

The one platform that permits this. TikTok's Research API bars commercial use
outright, and Instagram exposes no search a traveller's own account could
drive, so a found clip is a YouTube clip - not a temporary limitation but the
shape of what the platforms allow, and worth designing around rather than
hoping it changes.

Fake by default, as every provider here is. The fake returns deterministic
results so the found tier is demonstrable and testable with no key, no quota
and no network, and swapping in the real driver is configuration.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import dataclass

# search.list costs 100 units of a 10,000/day free quota, so roughly a hundred
# searches a day. One per place per activity, cached by video id, sits well
# inside that for one traveller.
SEARCH_COST_UNITS = 100


@dataclass(frozen=True)
class FoundVideo:
    """A clip the app went looking for. Never counted as one the traveller saved."""

    video_id: str
    title: str
    description: str
    channel: str
    url: str


class FakeVideoSearch:
    """Deterministic results, so the found tier works with no key at all.

    Not a stand-in for real search: it exists so the pipeline, the marking and
    the tests can run without a quota, and so the typed contract is pinned by
    something executable.
    """

    name = "fake"

    def search(self, query: str, *, limit: int = 5) -> list[FoundVideo]:
        cleaned = " ".join(query.split())
        if not cleaned:
            return []
        # Stable ids from the query so the same search twice is the same result
        # and dedupe by fingerprint behaves as it would against real results.
        seed = abs(hash(cleaned)) % 100000
        return [
            FoundVideo(
                video_id=f"fake{seed}{index}",
                title=f"{cleaned} — what to know before you go",
                description=(
                    f"A short guide to {cleaned}. Bring layers, start early, and expect crowds "
                    "at sunrise."
                ),
                channel=f"@traveller{index}",
                url=f"https://www.youtube.com/shorts/fake{seed}{index}",
            )
            for index in range(min(limit, 3))
        ]


class YouTubeVideoSearch:
    """The real thing, behind a key. Shorts included, region-scoped."""

    name = "youtube"
    endpoint = "https://www.googleapis.com/youtube/v3/search"

    def __init__(self, api_key: str, *, region: str | None = None, timeout: float = 10.0) -> None:
        self.api_key = api_key
        self.region = region
        self.timeout = timeout

    def search(self, query: str, *, limit: int = 5) -> list[FoundVideo]:
        params = {
            "part": "snippet",
            "q": query,
            "type": "video",
            "videoDuration": "short",
            "maxResults": str(min(limit, 10)),
            "key": self.api_key,
        }
        if self.region:
            params["regionCode"] = self.region

        url = f"{self.endpoint}?{urllib.parse.urlencode(params)}"
        try:
            with urllib.request.urlopen(url, timeout=self.timeout) as response:
                payload = json.loads(response.read())
        except Exception:  # noqa: BLE001 - a failed search is an empty shelf, never a crash
            return []

        out: list[FoundVideo] = []
        for item in payload.get("items", []):
            video_id = (item.get("id") or {}).get("videoId")
            snippet = item.get("snippet") or {}
            if not video_id:
                continue
            out.append(
                FoundVideo(
                    video_id=video_id,
                    title=snippet.get("title", ""),
                    description=snippet.get("description", ""),
                    channel=snippet.get("channelTitle", ""),
                    url=f"https://www.youtube.com/watch?v={video_id}",
                )
            )
        return out
