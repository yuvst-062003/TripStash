"""Searching the open web for a place the traveller asked about.

The assistant could not do this at all: nothing in the app fetched a page or
queried a search engine, so a question about somewhere with no saved clips had
no answer available beyond what was already in the library.

Fake by default, as every provider here is. The fake returns deterministic
results so the pipeline, the grading and the tests run with no key, no quota
and no network, and swapping in the real driver is configuration.

What comes back is NOT trusted on arrival. `app.services.web_grading` decides
what tier a result is entitled to - never OFFICIAL from search alone, never
above the traveller's own library - and the grounding rule still applies, so a
claim with no verbatim quote behind it is dropped exactly as it would be from
a reel.
"""

from __future__ import annotations

import urllib.parse
from dataclasses import dataclass
from urllib.parse import urlparse

from app.adapters._http import get_json, post_json

#: Long enough for a slow provider, short enough that a question does not hang.
TIMEOUT_SECONDS = 8.0

#: More than this and the assistant is reading noise rather than sources.
DEFAULT_LIMIT = 5


@dataclass(frozen=True)
class WebResult:
    """One page the search returned. Ungraded: trust is decided elsewhere."""

    url: str
    title: str
    snippet: str
    host: str


def host_of(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""


def _registrable(host: str) -> str:
    """The site a host belongs to, near enough for grouping results.

    Two labels is wrong for co.uk and friends, so three are kept when the
    second-to-last is a common second-level domain. This groups results; it is
    not a security boundary and does not need a public-suffix list to be worth
    having.
    """
    parts = [p for p in host.split(".") if p]
    if len(parts) <= 2:
        return host
    if parts[-2] in {"co", "com", "org", "net", "ac", "gov"} and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def dedupe_by_host(results: list[WebResult]) -> list[WebResult]:
    """One result per site, first one wins.

    A search engine will happily return five pages of the same blog. Five
    results from one source is one source, and showing it as five would
    overstate how much the app actually found - which is the one thing this
    app is supposed not to do.
    """
    seen: set[str] = set()
    kept: list[WebResult] = []
    for result in results:
        host = result.host or host_of(result.url)
        if not host:
            # Nothing to group it by, and nothing to grade it by either.
            continue
        site = _registrable(host)
        if site in seen:
            continue
        seen.add(site)
        kept.append(result)
    return kept


class FakeWebSearch:
    """Deterministic results, so the feature works with no key at all.

    Not a stand-in for real search: it exists so the grading, the grounding
    rule and the tests can run without a quota, and so the typed contract is
    pinned by something executable.
    """

    name = "fake"

    def search(self, query: str, limit: int = DEFAULT_LIMIT) -> list[WebResult]:
        subject = query.strip()
        if not subject:
            return []

        shapes = [
            (
                "https://example-guides.test/{slug}",
                "{subject}: a practical guide",
                "What to do in {subject}, how long to stay, and what it costs.",
            ),
            (
                "https://www.tripadvisor.com/Attraction-{slug}",
                "{subject} - what visitors say",
                "Reviews and photographs from people who went to {subject}.",
            ),
            (
                "https://backpacker-notes.test/{slug}",
                "Two days in {subject}",
                "A traveller's account of {subject}, written after the trip.",
            ),
            (
                "https://transport-info.test/{slug}",
                "Getting to {subject}",
                "Buses and shuttles serving {subject}, with rough times.",
            ),
            (
                "https://example-blog.test/{slug}",
                "{subject} on a budget",
                "Where to sleep and eat near {subject} without spending much.",
            ),
        ]
        slug = urllib.parse.quote_plus(subject.casefold().replace(" ", "-"))

        out = [
            WebResult(
                url=url.format(slug=slug),
                title=title.format(subject=subject),
                snippet=snippet.format(subject=subject),
                host=host_of(url.format(slug=slug)),
            )
            for url, title, snippet in shapes
        ]
        return out[: max(0, limit)]


class BraveWebSearch:
    """The real driver.

    Brave's API is used because it sells search results outright rather than
    licensing someone else's index, its terms permit this use, and it does not
    require a business relationship to get a key. The adapter shape is the
    thing that matters: another provider is a different `search` body.
    """

    name = "brave"
    endpoint = "https://api.search.brave.com/res/v1/web/search"

    def __init__(self, api_key: str | None, *, timeout_seconds: float = TIMEOUT_SECONDS) -> None:
        if not api_key:
            # A search that quietly returns nothing looks exactly like a place
            # nobody has written about, which is a very different thing. Fail
            # where the mistake is, which is configuration.
            raise ValueError("web search needs an API key; set TRIPSTASH_WEB_SEARCH_API_KEY")
        self._api_key = api_key
        self._timeout = timeout_seconds

    def search(self, query: str, limit: int = DEFAULT_LIMIT) -> list[WebResult]:
        subject = query.strip()
        if not subject:
            return []

        url = f"{self.endpoint}?{urllib.parse.urlencode({'q': subject, 'count': max(1, limit)})}"
        # A failed search must not take the conversation down with it: this
        # returns nothing and the assistant answers from the library, saying so.
        payload = get_json(
            url,
            headers={
                "Accept": "application/json",
                # In a header, never the query string, where every proxy on the
                # way would log it.
                "X-Subscription-Token": self._api_key,
            },
            timeout=self._timeout,
        )
        if not payload:
            return []

        raw = (payload.get("web") or {}).get("results") or []
        out: list[WebResult] = []
        for item in raw[:limit]:
            link = (item.get("url") or "").strip()
            if not link:
                continue
            out.append(
                WebResult(
                    url=link,
                    title=(item.get("title") or "").strip() or link,
                    snippet=(item.get("description") or "").strip(),
                    host=host_of(link),
                )
            )
        return out


class TavilyWebSearch:
    """Free web search: 1,000 searches a month that refill, no card on file.

    With no payment method there is nothing to overspend: past the monthly
    allowance the API refuses, and the refusal arrives here as no results.
    """

    name = "tavily"
    endpoint = "https://api.tavily.com/search"

    def __init__(self, api_key: str | None, *, timeout_seconds: float = TIMEOUT_SECONDS) -> None:
        if not api_key:
            raise ValueError("Tavily needs a key; set TRIPSTASH_WEB_SEARCH_API_KEY")
        self._api_key = api_key
        self._timeout = timeout_seconds

    def search(self, query: str, limit: int = DEFAULT_LIMIT) -> list[WebResult]:
        subject = query.strip()
        if not subject:
            return []
        # `site:` is a search-engine operator; Tavily takes the domain apart.
        domains: list[str] = []
        words = []
        for word in subject.split():
            if word.startswith("site:"):
                domains.append(word[5:])
            else:
                words.append(word)
        body = {
            "query": " ".join(words) or subject,
            "max_results": max(1, min(limit, 20)),
            "search_depth": "basic",  # one credit
        }
        if domains:
            body["include_domains"] = domains
        payload = post_json(
            self.endpoint,
            body=body,
            # In a header, never the body or the URL, where it would be logged.
            headers={"Authorization": f"Bearer {self._api_key}"},
            timeout=self._timeout,
        )
        out: list[WebResult] = []
        for item in payload.get("results") or []:
            link = (item.get("url") or "").strip()
            if not link:
                continue
            out.append(
                WebResult(
                    url=link,
                    title=(item.get("title") or "").strip() or link,
                    snippet=(item.get("content") or "").strip()[:400],
                    host=host_of(link),
                )
            )
        return out[:limit]


class SerperWebSearch:
    """Google's results, through Serper: 2,500 free searches, no card.

    Chosen for Gringo in particular. Gringo's robots.txt admits Google and
    turns every other bot away, so Google's index is the one way to see what
    Gringo says that respects the site's own rule - and only the snippet
    Google shows, with a link, ever reaches the screen.
    """

    name = "serper"
    endpoint = "https://google.serper.dev/search"

    def __init__(self, api_key: str | None, *, timeout_seconds: float = TIMEOUT_SECONDS) -> None:
        if not api_key:
            raise ValueError("Serper needs a key; set TRIPSTASH_GRINGO_SEARCH_API_KEY")
        self._api_key = api_key
        self._timeout = timeout_seconds

    def search(self, query: str, limit: int = DEFAULT_LIMIT) -> list[WebResult]:
        subject = query.strip()
        if not subject:
            return []
        payload = post_json(
            self.endpoint,
            body={"q": subject, "num": max(1, min(limit, 10))},
            headers={"X-API-KEY": self._api_key},
            timeout=self._timeout,
        )
        out: list[WebResult] = []
        for item in payload.get("organic") or []:
            link = (item.get("link") or "").strip()
            if not link:
                continue
            out.append(
                WebResult(
                    url=link,
                    title=(item.get("title") or "").strip() or link,
                    snippet=(item.get("snippet") or "").strip(),
                    host=host_of(link),
                )
            )
        return out[:limit]
