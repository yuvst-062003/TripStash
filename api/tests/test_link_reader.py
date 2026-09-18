"""Reading what a link publishes.

A stub server stands in for the platforms, so the suite never touches the
network. What is asserted is the part that matters in practice: a caption is
recovered when the platform publishes one, and when it does not, the traveller
is told exactly what to do instead.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app.media.links import LinkReader, is_social, recovery_message

# What TikTok's public oEmbed endpoint returns: the caption arrives as `title`.
TIKTOK_OEMBED = {
    "version": "1.0",
    "type": "video",
    "title": (
        "Cerro de la Cruz at sunset is the best free view in Antigua. "
        "Careful with the taxi scam at the terminal, they quote four times the price."
    ),
    "author_name": "backpackerlina",
    "provider_name": "TikTok",
    "thumbnail_url": "https://example.test/thumb.jpg",
}

ARTICLE_HTML = """
<html><head>
<title>Crossing into Guatemala overland</title>
<meta property="og:title" content="Crossing into Guatemala overland" />
<meta property="og:description"
  content="At the border they sometimes ask for proof of onward travel." />
<meta name="author" content="A. Traveller" />
</head><body><p>ignored</p></body></html>
"""


class _Stub(BaseHTTPRequestHandler):
    routes: dict[str, tuple[int, str, str]] = {}

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        path = self.path.split("?")[0]
        status, content_type, body = _Stub.routes.get(path, (404, "text/plain", "missing"))
        encoded = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, *args) -> None:
        return


@pytest.fixture
def stub():
    _Stub.routes = {
        "/oembed": (200, "application/json", json.dumps(TIKTOK_OEMBED)),
        "/oembed-private": (403, "application/json", "{}"),
        "/oembed-empty": (200, "application/json", json.dumps({"author_name": "someone"})),
        "/article": (200, "text/html", ARTICLE_HTML),
        "/bare": (200, "text/html", "<html><head></head><body>nothing</body></html>"),
        "/binary": (200, "video/mp4", "not html"),
        "/rate-limited": (429, "text/html", "slow down"),
    }
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Stub)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    host, port = server.server_address
    yield f"http://{host}:{port}"
    server.shutdown()
    server.server_close()


@pytest.fixture
def reader():
    return LinkReader(timeout_seconds=5)


def test_a_published_caption_becomes_extractable_text(reader, stub):
    content = reader._read_oembed(f"{stub}/oembed", "tiktok.com")

    assert content.status == "ok"
    assert content.author == "backpackerlina"
    assert "Cerro de la Cruz" in (content.text or "")
    assert "taxi scam" in (content.text or "")
    assert content.usable


def test_a_private_or_removed_post_is_reported_as_blocked_not_broken(reader, stub):
    content = reader._read_oembed(f"{stub}/oembed-private", "tiktok.com")

    assert content.status == "blocked"
    assert not content.usable
    # The message says what happened and what to do about it.
    assert "403" in content.detail
    assert "screenshot" in content.detail


def test_a_platform_that_publishes_no_caption_is_empty_rather_than_failed(reader, stub):
    content = reader._read_oembed(f"{stub}/oembed-empty", "tiktok.com")
    assert content.status == "empty"
    assert not content.usable


def test_an_article_yields_its_open_graph_text(reader, stub):
    content = reader._read_page(f"{stub}/article", "example.test")

    assert content.status == "ok"
    assert content.title == "Crossing into Guatemala overland"
    assert "proof of onward travel" in (content.text or "")
    assert content.author == "A. Traveller"


def test_a_page_with_no_metadata_is_empty(reader, stub):
    content = reader._read_page(f"{stub}/bare", "example.test")
    assert content.status == "empty"
    assert not content.usable


def test_something_that_is_not_a_page_is_not_parsed_as_one(reader, stub):
    content = reader._read_page(f"{stub}/binary", "example.test")
    assert content.status == "empty"
    assert "not a readable page" in content.detail


def test_rate_limiting_reads_as_blocked(reader, stub):
    content = reader._read_page(f"{stub}/rate-limited", "example.test")
    assert content.status == "blocked"


def test_a_platform_that_needs_an_authorised_app_is_not_even_requested(reader):
    """No point pretending: Instagram publishes nothing to an anonymous reader."""
    content = reader.read("https://www.instagram.com/reel/abc123/")

    assert content.status == "blocked"
    assert not content.usable
    assert "downloaded video" in content.detail


def test_an_unreachable_host_fails_without_losing_the_link(reader):
    content = reader.read("https://tripstash-nonexistent.invalid/post/1")
    assert content.status == "failed"
    assert not content.usable


@pytest.mark.parametrize(
    "url,social",
    [
        ("https://vt.tiktok.com/ZSqsY4ykw/", True),
        ("https://www.instagram.com/reel/x/", True),
        ("https://example-blog.test/guatemala", False),
    ],
)
def test_social_links_are_recognised(url, social):
    assert is_social(url) is social


def test_the_recovery_message_is_specific_to_the_platform():
    social = recovery_message("https://vt.tiktok.com/ZSqsY4ykw/")
    article = recovery_message("https://example-blog.test/x")

    assert "downloaded video" in social and "caption" in social
    assert "downloaded video" not in article
    # Either way the link itself is never discarded.
    assert "link" in social and "link" in article


def test_the_advice_does_not_restate_the_cause():
    """The stage already says what went wrong; repeating it reads like a machine."""
    message = recovery_message("https://vt.tiktok.com/ZSqsY4ykw/")
    assert "could not reach" not in message
    assert "403" not in message
