"""What travellers say on Reddit, through Reddit's own API.

Only the official Data API, with an app registered at reddit.com/prefs/apps
and an application-only OAuth token. Reddit's terms rule out reading the site
any other way, and they ask for an honest User-Agent naming the app. The free
tier is for non-commercial use and is rate limited, which a personal travel
app sits well inside.

What comes back is a thread's title, a short excerpt and a link. The thread
itself stays on Reddit, one tap away - the same rule as every other source:
facts and a short quote, never the article.
"""

from __future__ import annotations

import base64
import json
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass

from app.adapters._http import get_json, verified_context

# Where backpackers actually ask "is it worth stopping in X".
SUBREDDITS = ("backpacking", "travel", "solotravel", "centralamerica", "southamerica")
USER_AGENT = "web:TripStash:0.1 (personal travel planner; github.com/yuvst-062003/TripStash)"
EXCERPT_CHARS = 280


@dataclass(frozen=True)
class RedditThread:
    title: str
    excerpt: str
    url: str
    subreddit: str
    score: int


class FakeReddit:
    """Deterministic threads, so the stack runs with no Reddit app."""

    name = "fake"

    def search(self, query: str, *, limit: int = 5) -> list[RedditThread]:
        subject = query.strip()
        if not subject:
            return []
        slug = urllib.parse.quote(subject.lower().replace(" ", "_"))
        return [
            RedditThread(
                title=f"Is {subject} worth a stop?",
                excerpt=f"We spent two nights around {subject} and would do it again.",
                url=f"https://www.reddit.com/r/backpacking/comments/fake_{slug}/",
                subreddit="backpacking",
                score=42,
            )
        ][:limit]


class RedditSearch:
    """The real one. Needs a registered app's client id and secret."""

    name = "reddit"
    token_url = "https://www.reddit.com/api/v1/access_token"

    def __init__(self, client_id: str, client_secret: str, *, timeout: float = 8.0) -> None:
        if not client_id or not client_secret:
            raise ValueError(
                "Reddit needs an app: set TRIPSTASH_REDDIT_CLIENT_ID and _SECRET"
            )
        self._id = client_id
        self._secret = client_secret
        self._timeout = timeout
        self._token: str | None = None
        self._expires = 0.0

    def _bearer(self) -> str | None:
        if self._token and time.time() < self._expires - 60:
            return self._token
        basic = base64.b64encode(f"{self._id}:{self._secret}".encode()).decode()
        request = urllib.request.Request(
            self.token_url,
            data=b"grant_type=client_credentials",
            headers={"Authorization": f"Basic {basic}", "User-Agent": USER_AGENT},
            method="POST",
        )
        try:
            with urllib.request.urlopen(
                request, timeout=self._timeout, context=verified_context()
            ) as response:
                body = json.loads(response.read())
        except Exception:
            return None
        self._token = body.get("access_token")
        self._expires = time.time() + float(body.get("expires_in", 3600))
        return self._token

    def search(self, query: str, *, limit: int = 5) -> list[RedditThread]:
        subject = query.strip()
        token = self._bearer() if subject else None
        if not token:
            return []
        params = urllib.parse.urlencode(
            {"q": subject, "restrict_sr": 1, "sort": "relevance", "t": "all", "limit": limit}
        )
        url = f"https://oauth.reddit.com/r/{'+'.join(SUBREDDITS)}/search?{params}"
        payload = get_json(
            url,
            headers={"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT},
            timeout=self._timeout,
        )
        out: list[RedditThread] = []
        for child in (payload.get("data") or {}).get("children") or []:
            post = child.get("data") or {}
            permalink = post.get("permalink")
            if not permalink:
                continue
            text = " ".join((post.get("selftext") or "").split())
            out.append(
                RedditThread(
                    title=(post.get("title") or "").strip(),
                    excerpt=text[:EXCERPT_CHARS] + ("…" if len(text) > EXCERPT_CHARS else ""),
                    url=f"https://www.reddit.com{permalink}",
                    subreddit=post.get("subreddit") or "",
                    score=int(post.get("score") or 0),
                )
            )
        return out
