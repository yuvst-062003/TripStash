"""What other travellers say about the stretch between two stops.

Four sources, each labelled with where it came from, none of them copied:

- Gringo, the Israeli backpacker site. Its robots.txt turns away every bot
  but the search engines, so it is never fetched here. A search engine that
  is allowed to read it is asked instead (`site:gringo.co.il`), and only the
  engine's own snippet is shown, with a link to the page.
- The open web, through the same search: snippet and link, never the page.
- Reddit, through its official API only.
- YouTube, through its official API, as clips marked found.

Nothing here is written anywhere. It is reading material beside the `+`, and
a stop is added only when the traveller types or picks one.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass

from app.adapters import get_gringo_search, get_reddit, get_video_search, get_web_search
from app.config import get_settings
from app.models.core import Destination

GRINGO_HOST = "gringo.co.il"
PER_SOURCE = 3
SOURCE_TIMEOUT = 12.0
log = logging.getLogger(__name__)


@dataclass
class Voice:
    source: str  # gringo | web | reddit | youtube
    title: str
    snippet: str
    url: str
    by: str  # host, subreddit or channel

    def to_dict(self) -> dict:
        return asdict(self)


def _where(stop: Destination | None) -> str:
    if stop is None:
        return ""
    return " ".join(part for part in (stop.name, stop.country) if part)


def discover_between(after: Destination | None, nxt: Destination | None) -> dict:
    settings = get_settings()
    # Which sources are really connected. A stand-in answers locally, and the
    # screen says "not connected" rather than letting a stand-in read as Gringo.
    live = {
        "gringo": (settings.gringo_search_provider or settings.web_search_provider) != "fake",
        "web": settings.web_search_provider != "fake",
        "reddit": settings.reddit_provider != "fake",
        "youtube": settings.video_search_provider != "fake",
    }
    a, b = _where(after), _where(nxt)
    if not a and not b:
        return {"gringo": [], "web": [], "reddit": [], "youtube": [], "live": live}
    stretch = f"{a} to {b}" if a and b else (a or b)
    country = (after.country if after else None) or (nxt.country if nxt else None) or ""

    here = after.name if after else ""

    def gringo() -> list[Voice]:
        return [
            Voice("gringo", r.title, r.snippet, r.url, r.host)
            for r in get_gringo_search().search(f"site:{GRINGO_HOST} {here} {country}".strip())
            if r.host.endswith(GRINGO_HOST)
        ][:PER_SOURCE]

    def web() -> list[Voice]:
        return [
            Voice("web", r.title, r.snippet, r.url, r.host)
            for r in get_web_search().search(f"backpacking stops between {stretch}")
            # Gringo has its own row; the same page twice is noise.
            if not r.host.endswith(GRINGO_HOST)
        ][:PER_SOURCE]

    def reddit() -> list[Voice]:
        return [
            Voice("reddit", t.title, t.excerpt, t.url, f"r/{t.subreddit}")
            for t in get_reddit().search(stretch, limit=PER_SOURCE)
        ]

    def youtube() -> list[Voice]:
        return [
            Voice("youtube", v.title, v.description[:240], v.url, v.channel)
            for v in get_video_search().search(f"{stretch} backpacking", limit=PER_SOURCE)
        ]

    # All four at once, each on its own: the slowest source sets the wait, not
    # the sum of them, and one that is misconfigured or down comes back empty
    # (and not live) instead of taking the other three with it.
    jobs = {"gringo": gringo, "web": web, "reddit": reddit, "youtube": youtube}
    found: dict[str, list[Voice]] = {}
    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        futures = {name: pool.submit(job) for name, job in jobs.items()}
        for name, future in futures.items():
            try:
                found[name] = future.result(timeout=SOURCE_TIMEOUT)
            except Exception:  # noqa: BLE001 - a broken source is an empty one
                log.warning("discover: %s failed", name, exc_info=True)
                found[name] = []
                live[name] = False

    return {**{name: [v.to_dict() for v in voices] for name, voices in found.items()}, "live": live}
