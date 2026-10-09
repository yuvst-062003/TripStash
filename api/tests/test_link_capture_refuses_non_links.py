"""A pasted "link" that is not one is refused, not stored as a failure.

A source that could never have been fetched is a typo, and a typo wants a
correction - not a failed row in Sources with Retry under it.
"""

from __future__ import annotations

from app.routers.capture import looks_like_a_link


def test_a_string_that_is_not_a_web_address_is_refused_with_a_reason(client, auth, trip):
    response = client.post(
        "/api/v1/sources", headers=auth, json={"url": "not a url", "kind": "link"}
    )
    assert response.status_code == 422
    assert "http" in response.json()["detail"]
    assert client.get("/api/v1/sources", headers=auth).json() == []


def test_a_real_link_is_still_accepted(client, auth, trip):
    response = client.post(
        "/api/v1/sources",
        headers=auth,
        json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "kind": "link"},
    )
    assert response.status_code == 201, response.text


def test_a_pasted_message_with_no_link_is_still_a_source(client, auth, trip):
    response = client.post(
        "/api/v1/sources",
        headers=auth,
        json={"text": "Go to Cerro de la Cruz at sunset.", "kind": "link"},
    )
    assert response.status_code == 201, response.text


def test_what_counts_as_a_link():
    assert looks_like_a_link("https://example.com/x")
    assert looks_like_a_link("  http://example.com ")
    assert not looks_like_a_link("not a url")
    assert not looks_like_a_link("example.com")  # no scheme: the browser would search it
    assert not looks_like_a_link("ftp://example.com/x")
    assert not looks_like_a_link("https://localhost")
