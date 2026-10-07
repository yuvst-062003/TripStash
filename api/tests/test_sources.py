"""The source pipeline refuses before it fetches.

docs/sources.md lists six preconditions, and they are preconditions rather than
cleanup. These tests are the enforcement: an adapter that quietly fetched an
unchecked host would be the whole problem the rules exist to prevent.
"""

from __future__ import annotations

import pytest

from app.adapters import get_content_source, get_search
from app.adapters.base import SearchResult
from app.adapters.content import (
    DEFAULT_DAILY_BUDGET,
    UNVERIFIED_HOSTS,
    FakeContentSource,
    HostNotVerifiedError,
    HostPolicy,
)
from app.adapters.search import FakeSearchProvider

WIKIVOYAGE = "https://en.wikivoyage.org/wiki/Rio_de_Janeiro"


@pytest.fixture
def source() -> FakeContentSource:
    return FakeContentSource(
        pages={
            WIKIVOYAGE: "# Rio de Janeiro\nThe metro fare is R$7.10 as of March 2026.",
        },
        # No delay, or every test pays for the politeness the real one owes.
        policies={
            "en.wikivoyage.org": HostPolicy(
                host="en.wikivoyage.org",
                robots_read=True,
                terms_read=True,
                terms_allow_automated_access=True,
                crawl_delay_seconds=0.0,
                disallowed_prefixes=("/w/",),
            )
        },
    )


# -- the gate ---------------------------------------------------------------


def test_a_host_nobody_has_checked_is_not_fetchable(source):
    decision = source.may_fetch("https://some-travel-blog.test/rio")

    assert decision.allowed is False
    assert "robots.txt" in decision.reason


def test_an_unchecked_host_raises_rather_than_fetching(source):
    with pytest.raises(HostNotVerifiedError):
        source.fetch("https://some-travel-blog.test/rio")


def test_gringo_is_refused_by_name_until_somebody_reads_its_terms():
    # Named in the design as a source; its robots.txt and terms have never
    # been read, because the sandbox cannot reach the host. Until they are,
    # this refusal is the honest state and the reason says why.
    decision = get_content_source().may_fetch("https://gringo.co.il/peru")

    assert decision.allowed is False
    assert "never been read" in decision.reason
    assert "gringo.co.il" in UNVERIFIED_HOSTS


def test_terms_that_forbid_automation_are_not_overridden_by_a_trust_tier(source):
    source.policies["official.test"] = HostPolicy(
        host="official.test",
        robots_read=True,
        terms_read=True,
        terms_allow_automated_access=False,
    )

    decision = source.may_fetch("https://official.test/visas")

    assert decision.allowed is False
    assert "forbids automated access" in decision.reason


def test_a_removal_request_outranks_everything(source):
    source.policies["en.wikivoyage.org"] = HostPolicy(
        host="en.wikivoyage.org",
        robots_read=True,
        terms_read=True,
        terms_allow_automated_access=True,
        removal_requested=True,
    )

    decision = source.may_fetch(WIKIVOYAGE)

    assert decision.allowed is False
    assert "permanent" in decision.reason.lower()


def test_a_disallowed_path_is_refused_even_on_an_allowed_host(source):
    assert source.may_fetch("https://en.wikivoyage.org/w/index.php").allowed is False
    assert source.may_fetch(WIKIVOYAGE).allowed is True


def test_something_that_is_not_a_url_is_refused(source):
    assert source.may_fetch("not a url at all").allowed is False


# -- budget and politeness --------------------------------------------------


def test_a_host_has_a_daily_budget_across_every_path_into_the_pipeline(source):
    source.daily_budget = 2

    source.fetch(WIKIVOYAGE)
    source.fetch(WIKIVOYAGE)

    # Seeded collection, a city opened on demand and a curious afternoon all
    # draw on the same budget, so together they cannot look like a crawl.
    assert source.may_fetch(WIKIVOYAGE).allowed is False
    with pytest.raises(HostNotVerifiedError):
        source.fetch(WIKIVOYAGE)


def test_the_default_budget_is_bounded_rather_than_unlimited():
    assert 0 < DEFAULT_DAILY_BUDGET < 1000


def test_the_crawl_delay_is_reported_so_a_caller_cannot_ignore_it(source):
    source.policies["en.wikivoyage.org"] = HostPolicy(
        host="en.wikivoyage.org",
        robots_read=True,
        terms_read=True,
        terms_allow_automated_access=True,
        crawl_delay_seconds=2.5,
    )

    assert source.may_fetch(WIKIVOYAGE).crawl_delay_seconds == 2.5


def test_the_user_agent_identifies_us_and_says_where_to_complain():
    from app.adapters.content import USER_AGENT

    assert "TripStash" in USER_AGENT
    assert "http" in USER_AGENT


# -- what comes back --------------------------------------------------------


def test_a_fetched_page_carries_its_url_and_the_moment_it_was_read(source):
    page = source.fetch(WIKIVOYAGE)

    assert page.url == WIKIVOYAGE
    assert page.title == "Rio de Janeiro"
    assert "R$7.10" in page.text
    assert page.fetched_at is not None
    # The validator needs this to check a quote is verbatim in the source.
    assert page.etag


def test_a_conditional_refetch_costs_the_publisher_nothing(source):
    first = source.fetch(WIKIVOYAGE)

    again = source.fetch(WIKIVOYAGE, etag=first.etag)

    assert again.not_modified is True
    assert again.text == ""


def test_the_fake_is_the_default_so_the_stack_runs_with_no_network():
    assert get_content_source().name == "fake"
    assert get_search().name == "fake"


# -- the assistant's search -------------------------------------------------


def test_search_returns_only_what_it_was_given():
    provider = FakeSearchProvider(
        results={
            "rio metro": [
                SearchResult(
                    title="Rio de Janeiro",
                    url=WIKIVOYAGE,
                    snippet="The metro fare is R$7.10.",
                )
            ]
        }
    )

    hits = provider.search("what is the rio metro fare")

    assert len(hits) == 1
    assert hits[0].url == WIKIVOYAGE
    # Nothing plausible is invented for a query it does not know.
    assert provider.search("best bar in Lisbon") == []


def test_search_on_an_empty_question_returns_nothing(source):
    assert FakeSearchProvider().search("   ") == []


def test_the_search_provider_has_no_way_to_write_anything():
    # It may propose; it may never act. A write method here would be the door.
    public = {name for name in dir(FakeSearchProvider) if not name.startswith("_")}

    assert public == {"name", "search"}


def test_the_travel_guide_passes_the_same_gate():
    """Wikivoyage's API sits under /w/, which robots.txt keeps crawlers out of;
    the API is the sanctioned way in, so it is allowed and the pages are not."""
    gate = get_content_source()
    assert gate.may_fetch("https://en.wikivoyage.org/w/api.php?action=query").allowed
    assert not gate.may_fetch("https://en.wikivoyage.org/w/index.php?title=Rio").allowed


def test_a_refused_host_is_never_asked_for_a_guide(monkeypatch):
    from app.adapters import travel_wiki

    calls: list[str] = []
    monkeypatch.setattr(travel_wiki, "get_json", lambda url, **_: calls.append(url) or {})
    monkeypatch.setattr(travel_wiki, "API", "https://gringo.co.il/w/api.php")

    assert travel_wiki.WikivoyageTravelWiki()._get({"action": "query"}) == {}
    assert calls == []
