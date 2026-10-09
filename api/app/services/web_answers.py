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

from app.adapters.travel_wiki import (
    ATTRIBUTION,
    Guide,
    also_answers,
    knowledge_type_for,
    sections_of_interest,
)
from app.adapters.web_search import WebResult, dedupe_by_host
from app.models.enums import KnowledgeType, Provenance
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


def guide_cards(guide: Guide | None) -> list[dict]:
    """A free travel guide, as typed answer cards.

    Preferred over a search engine because its sections already carry the
    meaning this app's knowledge types carry: "Stay safe" is a safety note and
    "Get in" is transport, so nothing has to infer what a paragraph is about -
    which is the part a language model would otherwise do, and occasionally get
    wrong.

    An encyclopedia is still people writing things down, however carefully, so
    it grades as REVIEWS at best and never as OFFICIAL. Attribution rides on
    every card, because CC BY-SA is free and not unconditional.
    """
    if guide is None:
        return []

    cards: list[dict] = []
    for section in sections_of_interest(guide.sections):
        text = " ".join(section.text.split())
        cards.append(
            {
                "type": "web",
                "title": f"{guide.title}: {section.heading.lower()}",
                "subtitle": "Wikivoyage",
                "body": text,
                "quote": text,
                "url": guide.url,
                "host": "en.wikivoyage.org",
                "knowledge_type": knowledge_type_for(section.heading),
                # A section can answer a second kind of question: a country's
                # visa rules sit under "Get in", so arrival is also border.
                "also_answers": also_answers(section.heading),
                # Curated and edited, but still an account rather than the
                # place itself speaking.
                "provenance": Provenance.REVIEWS,
                "sourcing": "found",
                "from_web": True,
                "yours": False,
                "attribution": guide.attribution,
            }
        )
    return cards


def guide_disclaimer(place: str) -> str:
    return (
        f"Read a free travel guide to {place}. None of it is yours and none of it is saved - "
        f"keep anything worth keeping and it joins your library. {ATTRIBUTION}."
    )


def card_answers(card: dict, wanted: KnowledgeType) -> bool:
    """Whether a guide card answers a question of this kind."""
    return card.get("knowledge_type") == wanted or wanted in card.get("also_answers", ())


#: How a kind of question is named when telling the traveller nothing of that
#: kind is saved. The enum's own values are field names, not words.
TOPIC_WORDS: dict[KnowledgeType, str] = {
    KnowledgeType.BORDER: "visas and borders",
    KnowledgeType.TRANSPORT: "getting there",
    KnowledgeType.ACCOMMODATION: "places to stay",
    KnowledgeType.ROUTE: "the route onward",
    KnowledgeType.PRICE: "prices",
}


def topic_words(kind: KnowledgeType | None) -> str:
    return TOPIC_WORDS.get(kind, kind.value) if kind is not None else ""
