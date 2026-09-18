"""Reading what a link publishes about itself.

Specification 10.2 step 3 says to extract *permitted public text*. That word
matters: this module reads what a platform chooses to publish - its oEmbed
response, its Open Graph tags - and nothing else. It does not download videos,
does not log in, and does not scrape restricted content, which are non-goals in
specification 3.3 and would breach the platforms' terms besides.

When a platform declines, the honest outcome is to keep the URL and ask the
traveller for the caption or a screenshot. That is specification 12's first row,
and it is a designed path rather than a failure.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from urllib.parse import quote, urlparse

import httpx

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 15.0
MAX_BYTES = 512_000
USER_AGENT = "TripStash/0.1 (personal travel memory; +https://github.com/)"

# Platforms that publish a documented, keyless oEmbed endpoint. The response
# carries the caption, which is the part worth extracting.
OEMBED_ENDPOINTS: dict[str, str] = {
    "tiktok.com": "https://www.tiktok.com/oembed?url={url}",
    "vt.tiktok.com": "https://www.tiktok.com/oembed?url={url}",
    "vm.tiktok.com": "https://www.tiktok.com/oembed?url={url}",
    "youtube.com": "https://www.youtube.com/oembed?url={url}&format=json",
    "youtu.be": "https://www.youtube.com/oembed?url={url}&format=json",
    "vimeo.com": "https://vimeo.com/api/oembed.json?url={url}",
}

# Platforms that require an authenticated app to read anything. Asking is the
# only honest option.
NEEDS_THE_TRAVELLER = {
    "instagram.com",
    "www.instagram.com",
    "facebook.com",
    "www.facebook.com",
    "threads.net",
}

SOCIAL_HINTS = ("tiktok", "instagram", "facebook", "threads", "snapchat", "x.com", "twitter")


def _unreachable(host: str, exc: Exception) -> str:
    """Separate "the network stopped us" from "the platform said no".

    Both leave the traveller with the same next step, but only one of them is
    the platform's doing, and saying otherwise would be wrong.
    """
    name = type(exc).__name__
    if "Proxy" in name or "Connect" in name:
        return f"could not reach {host} - no route from this machine, or it is offline."
    return f"could not read {host} ({name})."


@dataclass(slots=True)
class LinkContent:
    title: str | None = None
    author: str | None = None
    text: str | None = None
    provider: str | None = None
    status: str = "ok"  # ok | blocked | empty | failed
    detail: str = ""

    @property
    def usable(self) -> bool:
        return bool(self.text or self.title)


class _MetaParser(HTMLParser):
    """Pulls the handful of tags a page publishes for sharing."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title: str | None = None
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self._in_title = True
            return
        if tag != "meta":
            return
        values = {key.lower(): (value or "") for key, value in attrs}
        key = values.get("property") or values.get("name")
        content = values.get("content")
        if key and content:
            self.meta[key.lower()] = content

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title and not self.title:
            cleaned = data.strip()
            if cleaned:
                self.title = cleaned


def host_of(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def is_social(url: str) -> bool:
    host = host_of(url)
    return any(hint in host for hint in SOCIAL_HINTS)


class LinkReader:
    """Fetches only what a site publishes for sharing."""

    name = "link-reader"

    def __init__(self, timeout_seconds: float = TIMEOUT_SECONDS) -> None:
        self.timeout_seconds = timeout_seconds

    def read(self, url: str) -> LinkContent:
        host = host_of(url)
        if not host:
            return LinkContent(status="failed", detail="not a valid URL")

        if host in NEEDS_THE_TRAVELLER or host.removeprefix("www.") in NEEDS_THE_TRAVELLER:
            return LinkContent(
                status="blocked",
                provider=host,
                detail=(
                    f"{host} only exposes posts to an authorised app. Paste the caption, "
                    "add a screenshot, or upload the downloaded video."
                ),
            )

        endpoint = self._oembed_endpoint(host)
        if endpoint:
            content = self._read_oembed(endpoint.format(url=quote(url, safe="")), host)
            if content.usable or content.status == "blocked":
                return content

        return self._read_page(url, host)

    @staticmethod
    def _oembed_endpoint(host: str) -> str | None:
        for suffix, endpoint in OEMBED_ENDPOINTS.items():
            if host == suffix or host.endswith("." + suffix):
                return endpoint
        return None

    def _fetch(self, url: str) -> httpx.Response:
        with httpx.Client(
            timeout=self.timeout_seconds,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
        ) as client:
            return client.get(url)

    def _read_oembed(self, endpoint: str, host: str) -> LinkContent:
        """The documented, keyless endpoint a platform publishes for embedding."""
        try:
            response = self._fetch(endpoint)
        except httpx.HTTPError as exc:
            return LinkContent(
                status="failed",
                provider=host,
                detail=_unreachable(host, exc),
            )

        if response.status_code in (401, 403, 404):
            return LinkContent(
                status="blocked",
                provider=host,
                detail=(
                    f"{host} returned {response.status_code} for this post - it may be "
                    "private, removed or region locked. Paste the caption or add a "
                    "screenshot and nothing is lost."
                ),
            )
        if response.status_code >= 400:
            return LinkContent(
                status="failed", provider=host, detail=f"oEmbed returned {response.status_code}"
            )

        try:
            data = response.json()
        except ValueError:
            return LinkContent(status="failed", provider=host, detail="oEmbed was not JSON")

        # On TikTok and YouTube the caption arrives as `title`, which is the
        # part worth extracting travel knowledge from.
        title = (data.get("title") or "").strip() or None
        author = (data.get("author_name") or "").strip() or None
        return LinkContent(
            title=title,
            author=author,
            text=title,
            provider=data.get("provider_name") or host,
            status="ok" if title else "empty",
            detail=(
                f"oEmbed: caption of {len(title)} chars" if title else "oEmbed returned no caption"
            ),
        )

    def _read_page(self, url: str, host: str) -> LinkContent:
        """Open Graph and the description a page publishes for sharing."""
        try:
            response = self._fetch(url)
        except httpx.HTTPError as exc:
            return LinkContent(status="failed", provider=host, detail=_unreachable(host, exc))

        if response.status_code >= 400:
            status = "blocked" if response.status_code in (401, 403, 429) else "failed"
            return LinkContent(
                status=status, provider=host, detail=f"the site returned {response.status_code}"
            )

        content_type = response.headers.get("content-type", "")
        if "html" not in content_type and "text" not in content_type:
            return LinkContent(
                status="empty", provider=host, detail=f"not a readable page ({content_type})"
            )

        parser = _MetaParser()
        try:
            parser.feed(response.text[:MAX_BYTES])
        except Exception:  # pragma: no cover - malformed markup
            logger.info("could not parse %s", url)

        meta = parser.meta
        title = meta.get("og:title") or meta.get("twitter:title") or parser.title
        description = (
            meta.get("og:description")
            or meta.get("twitter:description")
            or meta.get("description")
        )
        author = meta.get("author") or meta.get("article:author")

        parts = [part for part in (title, description) if part]
        text = "\n\n".join(unescape(re.sub(r"\s+", " ", part)).strip() for part in parts) or None

        return LinkContent(
            title=unescape(title).strip() if title else None,
            author=unescape(author).strip() if author else None,
            text=text,
            provider=host,
            status="ok" if text else "empty",
            detail=(
                f"page metadata: {len(text)} chars" if text else "the page published no description"
            ),
        )


def recovery_message(url: str) -> str:
    """What to do next, phrased for the platform in question.

    Only the advice. Why it failed is already on the link stage, and saying it
    twice in two tones is how an interface starts sounding like a machine.
    """
    if is_social(url):
        return (
            "Social platforms restrict what they publish. Paste the caption, add a "
            "screenshot, or upload the downloaded video - the link is kept either way."
        )
    return "Paste the text you wanted to keep, or add a screenshot. The link stays attached."


def extract_json_ld(html: str) -> list[dict]:
    """Structured data some article sites publish. Best effort, never required."""
    found: list[dict] = []
    for match in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.S | re.I
    ):
        try:
            payload = json.loads(match.group(1).strip())
        except ValueError:
            continue
        found.extend(payload if isinstance(payload, list) else [payload])
    return found
