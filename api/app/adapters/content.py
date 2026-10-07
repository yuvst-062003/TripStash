"""Reading public pages, under the rules that make it legitimate.

docs/sources.md sets six preconditions before any fetch runs, and they are not
steps to do afterwards. This module enforces them, and it fails closed: a host
whose robots.txt and terms have not been read is not fetchable, full stop.

That is not hypothetical. `gringo.co.il` is named in the design as the source
for the Israeli backpacker view of South America, and neither its robots.txt
nor its terms have ever been read - the development sandbox cannot reach the
host. So it is listed here as unverified, and the default adapter refuses it by
name until somebody does that reading. An adapter that quietly fetched it
anyway would be the whole problem.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from urllib.parse import urlparse

from app.adapters.base import FetchedPage, PermissionDecision

# How many pages one host may serve us in a day, across seeded collection, a
# city opened on demand and a curious afternoon combined - so the three cannot
# add up to something that looks like a crawl.
DEFAULT_DAILY_BUDGET = 60

# Identifies us honestly, with somewhere to complain to. Not negotiable.
USER_AGENT = "TripStashBot/0.1 (+https://github.com/yuvst-062003/TripStash; personal travel app)"


@dataclass(frozen=True)
class HostPolicy:
    """What was actually read about a host, and when.

    `robots_read` and `terms_read` are facts about work somebody did, not
    defaults. Both start false and nothing flips them but evidence.
    """

    host: str
    robots_read: bool = False
    terms_read: bool = False
    terms_allow_automated_access: bool = False
    crawl_delay_seconds: float = 1.0
    disallowed_prefixes: tuple[str, ...] = ()
    # The host's published API, when it has one. Its own usage policy governs
    # it rather than robots.txt, which is written for crawlers of pages.
    api_paths: tuple[str, ...] = ()
    # Set when a publisher asks to be left alone. Permanent, and it outranks
    # everything above it.
    removal_requested: bool = False
    note: str = ""


# Hosts whose robots.txt and terms have actually been read. Wikivoyage is here
# because it is CC BY-SA and its reuse terms are published; the others are not,
# and listing them without the reading would defeat the point of the list.
KNOWN_HOSTS: dict[str, HostPolicy] = {
    "en.wikivoyage.org": HostPolicy(
        host="en.wikivoyage.org",
        robots_read=True,
        terms_read=True,
        terms_allow_automated_access=True,
        crawl_delay_seconds=1.0,
        disallowed_prefixes=("/w/", "/wiki/Special:"),
        # The MediaWiki API sits under /w/ but is the sanctioned way in for a
        # program, under the Wikimedia API etiquette (identify, go serially).
        api_paths=("/w/api.php",),
        note="CC BY-SA. The one tier whose text may be reused in full, with attribution.",
    ),
}

# Named in the design, deliberately not fetchable yet. Each entry says what is
# missing, and the refusal repeats it rather than saying "blocked".
UNVERIFIED_HOSTS: dict[str, str] = {
    "gringo.co.il": (
        "robots.txt and terms of use have never been read - the development "
        "sandbox cannot reach the host. Read both before pointing an adapter here."
    ),
}


class HostNotVerifiedError(RuntimeError):
    """Raised when something tries to fetch a host nobody has cleared."""


@dataclass
class FakeContentSource:
    """The default. Serves fixture pages and never touches the network.

    The whole stack runs with no accounts and no network, so this is what is
    wired up unless somebody deliberately chooses otherwise. It applies exactly
    the same permission rules as a real fetcher would, so a test that passes
    here is testing the rules and not the transport.
    """

    name: str = "fake"
    pages: dict[str, str] = field(default_factory=dict)
    policies: dict[str, HostPolicy] = field(default_factory=lambda: dict(KNOWN_HOSTS))
    unverified: dict[str, str] = field(default_factory=lambda: dict(UNVERIFIED_HOSTS))
    daily_budget: int = DEFAULT_DAILY_BUDGET
    _spent: dict[tuple[str, str], int] = field(default_factory=dict)
    _last_fetch: dict[str, float] = field(default_factory=dict)

    # -- the gate ----------------------------------------------------------

    def may_fetch(self, url: str) -> PermissionDecision:
        host = (urlparse(url).hostname or "").lower()
        if not host:
            return PermissionDecision(False, "That is not a URL with a host in it.")

        if host in self.unverified:
            return PermissionDecision(False, f"{host}: {self.unverified[host]}")

        policy = self.policies.get(host)
        if policy is None:
            return PermissionDecision(
                False,
                f"{host} has not been checked. Its robots.txt and terms have to be read "
                f"before anything is fetched from it.",
            )

        # A removal request outranks every other consideration, including a
        # trust tier and including a cached copy.
        if policy.removal_requested:
            return PermissionDecision(False, f"{host} asked not to be read. That is permanent.")
        if not policy.robots_read:
            return PermissionDecision(False, f"{host}: robots.txt has not been read.")
        if not policy.terms_read:
            return PermissionDecision(False, f"{host}: the terms of use have not been read.")
        if not policy.terms_allow_automated_access:
            return PermissionDecision(
                False,
                f"{host} forbids automated access in its terms. Its trust tier does not "
                f"override that.",
            )

        path = urlparse(url).path or "/"
        is_api = any(path.startswith(api) for api in policy.api_paths)
        for prefix in () if is_api else policy.disallowed_prefixes:
            if path.startswith(prefix):
                return PermissionDecision(False, f"{host}: robots.txt disallows {prefix}.")

        today = datetime.now(UTC).date().isoformat()
        if self._spent.get((host, today), 0) >= self.daily_budget:
            return PermissionDecision(
                False, f"{host}: today's fetch budget of {self.daily_budget} is spent."
            )

        return PermissionDecision(True, "ok", crawl_delay_seconds=policy.crawl_delay_seconds)

    # -- the fetch ---------------------------------------------------------

    def fetch(
        self, url: str, *, etag: str | None = None, last_modified: str | None = None
    ) -> FetchedPage:
        decision = self.may_fetch(url)
        if not decision.allowed:
            raise HostNotVerifiedError(decision.reason)

        host = (urlparse(url).hostname or "").lower()
        self._wait_for_crawl_delay(host, decision.crawl_delay_seconds)

        today = datetime.now(UTC).date().isoformat()
        self._spent[(host, today)] = self._spent.get((host, today), 0) + 1

        body = self.pages.get(url)
        if body is None:
            raise LookupError(f"No fixture page for {url}.")

        # A conditional request that the fixture says is unchanged comes back
        # empty, which is what makes a freshness check nearly free for the host.
        if etag and etag == self._etag_for(url):
            return FetchedPage(
                url=url,
                title=None,
                text="",
                fetched_at=datetime.now(UTC),
                etag=etag,
                last_modified=last_modified,
                not_modified=True,
            )

        title, text = _split_title(body)
        return FetchedPage(
            url=url,
            title=title,
            text=text,
            fetched_at=datetime.now(UTC),
            etag=self._etag_for(url),
            last_modified=last_modified,
        )

    def _wait_for_crawl_delay(self, host: str, delay: float) -> None:
        """One request at a time per host, at the published delay."""
        if delay <= 0:
            return
        previous = self._last_fetch.get(host)
        now = time.monotonic()
        if previous is not None and now - previous < delay:
            time.sleep(delay - (now - previous))
        self._last_fetch[host] = time.monotonic()

    def _etag_for(self, url: str) -> str:
        body = self.pages.get(url, "")
        return f'W/"{abs(hash((url, body))):x}"'


def _split_title(body: str) -> tuple[str | None, str]:
    """First line is the title when the fixture provides one."""
    lines = [line.strip() for line in body.strip().splitlines()]
    if not lines:
        return None, ""
    if lines[0].startswith("# "):
        return lines[0][2:].strip(), "\n".join(lines[1:]).strip()
    return None, "\n".join(lines).strip()
