"""The two free search drivers, against the shapes their APIs document."""

from __future__ import annotations

import pytest

from app.adapters import web_search


def test_tavily_turns_site_into_a_domain_filter(monkeypatch):
    sent = {}

    def fake_post(url, *, body, headers, timeout):
        sent.update(url=url, body=body, headers=headers)
        return {
            "results": [
                {"title": "Antigua", "url": "https://gringo.co.il/a", "content": "Stay near..."},
                {"title": "No link"},
            ]
        }

    monkeypatch.setattr(web_search, "post_json", fake_post)
    results = web_search.TavilyWebSearch("tvly-test").search("site:gringo.co.il Antigua Guatemala")

    assert sent["url"] == "https://api.tavily.com/search"
    assert sent["body"]["include_domains"] == ["gringo.co.il"]
    assert sent["body"]["query"] == "Antigua Guatemala"
    assert sent["body"]["search_depth"] == "basic"
    assert sent["headers"]["Authorization"] == "Bearer tvly-test"
    assert [(r.host, r.snippet) for r in results] == [("gringo.co.il", "Stay near...")]


def test_serper_reads_googles_organic_results(monkeypatch):
    sent = {}

    def fake_post(url, *, body, headers, timeout):
        sent.update(url=url, body=body, headers=headers)
        return {"organic": [{"title": "T", "link": "https://www.gringo.co.il/x", "snippet": "S"}]}

    monkeypatch.setattr(web_search, "post_json", fake_post)
    results = web_search.SerperWebSearch("k").search("site:gringo.co.il Lanquín")

    assert sent["url"] == "https://google.serper.dev/search"
    assert sent["body"]["q"] == "site:gringo.co.il Lanquín"
    assert sent["headers"] == {"X-API-KEY": "k"}
    assert results[0].host.endswith("gringo.co.il")


@pytest.mark.parametrize("driver", [web_search.TavilyWebSearch, web_search.SerperWebSearch])
def test_a_driver_without_its_key_refuses_to_start(driver):
    with pytest.raises(ValueError):
        driver(None)


def test_gringo_has_its_own_search_when_one_is_set(monkeypatch):
    from app.adapters import get_gringo_search, get_web_search
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "web_search_provider", "tavily")
    monkeypatch.setattr(settings, "web_search_api_key", "tvly-x")
    monkeypatch.setattr(settings, "gringo_search_provider", "serper")
    monkeypatch.setattr(settings, "gringo_search_api_key", "s-x")

    # The web search is built once per process; rebuild it for these settings,
    # and again afterwards so no other test inherits a Tavily driver.
    get_web_search.cache_clear()
    try:
        assert get_web_search().name == "tavily"
        assert get_gringo_search().name == "serper"
        monkeypatch.setattr(settings, "gringo_search_provider", "")
        assert get_gringo_search().name == "tavily"
    finally:
        get_web_search.cache_clear()


def test_reddit_threads_come_through_search_without_an_approved_app(monkeypatch):
    from app.adapters.web_search import WebResult
    from app.config import get_settings
    from app.models.core import Destination
    from app.services import discover

    class Engine:
        name = "tavily"

        def search(self, query, limit=5):
            assert query.startswith("site:reddit.com ")
            return [
                WebResult(
                    "https://www.reddit.com/r/backpacking/comments/abc/antigua_to_atitlan/",
                    "Antigua to Atitlan?",
                    "Take the shuttle, not the chicken bus.",
                    "www.reddit.com",
                ),
                WebResult("https://www.reddit.com/r/travel/", "r/travel", "", "www.reddit.com"),
            ]

    settings = get_settings()
    monkeypatch.setattr(settings, "web_search_provider", "tavily")
    monkeypatch.setattr(discover, "get_web_search", Engine)
    monkeypatch.setattr(discover, "get_gringo_search", Engine)

    out = discover.discover_between(
        Destination(name="Antigua", country="Guatemala"),
        Destination(name="San Pedro La Laguna", country="Guatemala"),
    )

    assert out["live"]["reddit"] is True
    # Threads only - a subreddit's front page is not something anyone said.
    assert [(v["by"], v["snippet"]) for v in out["reddit"]] == [
        ("r/backpacking", "Take the shuttle, not the chicken bus.")
    ]
