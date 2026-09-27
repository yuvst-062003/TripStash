"""Turning search results into something the assistant may say.

Two promises have to survive contact with the open web.

The first is that an answer carries its evidence. A search result's snippet is
the only text the app actually holds from that page, so it is the only thing
that can support a claim - and a result with no snippet is a title with nothing
behind it, which is precisely what this app exists not to show. So it is
dropped, exactly as an ungrounded claim from a reel would be.

The second is that the traveller's own library outranks everything. That only
holds if a web result is labelled as what it is, every single time: `from_web`
and `yours` are on every card, not because a caller might want them but so that
no caller can accidentally render one as something the traveller saved.
"""

from __future__ import annotations

from app.adapters.web_search import WebResult, dedupe_by_host
from app.services.web_grading import grade_result


def web_cards(results: list[WebResult]) -> list[dict]:
    """Search results as answer cards, graded and labelled.

    Deduplicated by site first: five pages of one blog is one source, and
    showing it as five would overstate what was found.
    """
    cards: list[dict] = []
    for result in dedupe_by_host(results):
        quote = (result.snippet or "").strip()
        if not quote:
            # No quote, no card.
            continue
        cards.append(
            {
                # The same field names every other answer card uses, so the
                # existing renderer shows it without a special case, plus the
                # web-specific ones it needs to be honest about itself.
                "type": "web",
                "title": result.title,
                "subtitle": result.host,
                "body": quote,
                "quote": quote,
                "url": result.url,
                "host": result.host,
                "provenance": grade_result(result.url),
                # A web result is the app having looked, not the traveller
                # having saved - which is exactly what "found" already means
                # everywhere else in this app.
                "sourcing": "found",
                # Said on every card, so nothing downstream has to remember.
                "from_web": True,
                "yours": False,
            }
        )
    return cards


def web_disclaimer(count: int) -> str:
    """What the traveller is told about where this came from."""
    pages = "1 page" if count == 1 else f"{count} pages"
    return (
        f"Read {pages} from the web. None of it is yours and none of it is saved - "
        "keep anything worth keeping and it joins your library."
    )
