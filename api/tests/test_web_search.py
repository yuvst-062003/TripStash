"""Searching the open web for a place the traveller asked about."""

import json

import pytest

from app.adapters.web_search import (
    BraveWebSearch,
    FakeWebSearch,
    WebResult,
    dedupe_by_host,
)


def test_the_fake_answers_without_a_key_or_a_network():
    results = FakeWebSearch().search("Acatenango Volcano", limit=3)
    assert results
    assert all(isinstance(r, WebResult) for r in results)
    assert all(r.url and r.title and r.snippet for r in results)


def test_the_fake_is_deterministic_so_tests_can_rely_on_it():
    assert FakeWebSearch().search("Antigua") == FakeWebSearch().search("Antigua")


def test_the_fake_names_the_thing_that_was_asked_about():
    # Otherwise a test can pass while the query is being dropped entirely.
    results = FakeWebSearch().search("Lake Atitlán")
    assert any("Atitlán" in r.title or "Atitlán" in r.snippet for r in results)


def test_the_fake_respects_the_limit():
    assert len(FakeWebSearch().search("anywhere", limit=2)) == 2


def test_an_empty_query_returns_nothing_rather_than_everything():
    assert FakeWebSearch().search("") == []
    assert FakeWebSearch().search("   ") == []


# ---------------------------------------------------------------------------
# One result per site
#
# Search engines happily return five pages of the same blog. Five results from
# one source is one source, and presenting it as five would overstate how much
# the app actually found.
# ---------------------------------------------------------------------------


def _result(url: str, title: str = "t") -> WebResult:
    return WebResult(url=url, title=title, snippet="s", host="")


def test_only_the_first_result_from_a_site_is_kept():
    kept = dedupe_by_host(
        [
            _result("https://blog.example/a", "first"),
            _result("https://blog.example/b", "second"),
            _result("https://other.example/c", "third"),
        ]
    )
    assert [r.title for r in kept] == ["first", "third"]


def test_subdomains_of_one_site_count_as_that_site():
    kept = dedupe_by_host(
        [_result("https://en.example.com/a"), _result("https://fr.example.com/b")]
    )
    assert len(kept) == 1


def test_a_result_with_no_usable_host_is_dropped_rather_than_grouped():
    kept = dedupe_by_host([_result("not-a-url"), _result("https://ok.example/a")])
    assert [r.url for r in kept] == ["https://ok.example/a"]


# ---------------------------------------------------------------------------
# The real driver
# ---------------------------------------------------------------------------


def test_the_real_driver_refuses_to_run_without_a_key():
    """Better a clear refusal than a silent fallback to nothing.

    A search that quietly returns no results looks identical to a place nobody
    has written about, which is a very different thing.
    """
    with pytest.raises(ValueError, match="key"):
        BraveWebSearch(api_key=None)


def test_the_real_driver_reads_the_shape_the_provider_returns(monkeypatch):
    payload = {
        "web": {
            "results": [
                {
                    "url": "https://example.com/a",
                    "title": "A guide to Antigua",
                    "description": "Cobbled streets and a volcano.",
                },
                {"url": "https://other.com/b", "title": "B", "description": "d"},
            ]
        }
    }

    captured: dict[str, object] = {}

    def fake_open(request, timeout=0, **_):  # noqa: ANN001
        captured["url"] = request.full_url
        captured["headers"] = dict(request.headers)

        class _Response:
            def read(self) -> bytes:
                return json.dumps(payload).encode()

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        return _Response()

    monkeypatch.setattr("urllib.request.urlopen", fake_open)

    results = BraveWebSearch(api_key="k").search("Antigua", limit=2)

    assert [r.title for r in results] == ["A guide to Antigua", "B"]
    assert results[0].host == "example.com"
    assert "Antigua" in str(captured["url"])
    # The key travels in a header, never in the query string, where it would be
    # logged by every proxy on the way.
    assert any("subscription" in h.lower() for h in captured["headers"])


def test_a_provider_that_fails_returns_nothing_rather_than_raising(monkeypatch):
    """A search that cannot run must not take the conversation down with it."""

    def boom(request, timeout=0, **_):  # noqa: ANN001
        raise OSError("network is down")

    monkeypatch.setattr("urllib.request.urlopen", boom)
    assert BraveWebSearch(api_key="k").search("Antigua") == []


def test_a_malformed_response_returns_nothing_rather_than_raising(monkeypatch):
    def garbage(request, timeout=0, **_):  # noqa: ANN001
        class _Response:
            def read(self) -> bytes:
                return b"not json at all"

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        return _Response()

    monkeypatch.setattr("urllib.request.urlopen", garbage)
    assert BraveWebSearch(api_key="k").search("Antigua") == []
