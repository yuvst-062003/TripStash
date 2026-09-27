"""Turning search results into something the assistant may say.

The app's promise is that an answer carries its evidence and that the
traveller's own library outranks everything. Both survive contact with the open
web only if a web result is labelled as what it is, every time.
"""

from app.adapters.travel_wiki import FakeTravelWiki
from app.adapters.web_search import FakeWebSearch, WebResult
from app.models.enums import KnowledgeType, Provenance
from app.services.web_answers import guide_cards, web_cards, web_disclaimer


def _results() -> list[WebResult]:
    return [
        WebResult(
            url="https://www.tripadvisor.com/x",
            title="Acatenango - what visitors say",
            snippet="Reviews from people who climbed it.",
            host="www.tripadvisor.com",
        ),
        WebResult(
            url="https://someblog.example/guide",
            title="Two days on Acatenango",
            snippet="A traveller's account.",
            host="someblog.example",
        ),
    ]


def test_a_card_carries_the_tier_its_source_earned():
    cards = web_cards(_results())
    assert cards[0]["provenance"] == Provenance.REVIEWS
    assert cards[1]["provenance"] == Provenance.CREATOR


def test_every_card_says_it_came_from_the_web():
    """A reader must never have to guess whether this is theirs.

    The whole product rests on the difference between what you saved and what
    the app found, and a search result is the furthest thing from saved.
    """
    for card in web_cards(_results()):
        assert card["from_web"] is True
        assert card["yours"] is False


def test_a_card_keeps_the_link_so_a_claim_can_be_checked():
    for card in web_cards(_results()):
        assert card["url"].startswith("https://")
        assert card["host"]


def test_nothing_from_the_web_is_ever_presented_as_official():
    cards = web_cards(
        [
            WebResult(
                url="https://visitguatemala.com/official",
                title="Official tourism board",
                snippet="The official site.",
                host="visitguatemala.com",
            )
        ]
    )
    assert cards[0]["provenance"] is not Provenance.OFFICIAL


def test_the_snippet_is_carried_verbatim_as_the_quote():
    # It is the only text the app actually has from the page, so it is the only
    # thing that can support a claim.
    cards = web_cards(_results())
    assert cards[0]["quote"] == "Reviews from people who climbed it."


def test_a_result_with_no_snippet_is_dropped():
    """No quote, no card. The same rule a reel is held to.

    A title alone is a claim with nothing behind it, which is exactly what this
    app exists not to show.
    """
    cards = web_cards(
        [WebResult(url="https://x.example/a", title="Something", snippet="  ", host="x.example")]
    )
    assert cards == []


def test_results_are_deduplicated_by_site_before_becoming_cards():
    cards = web_cards(
        [
            WebResult(url="https://blog.example/a", title="A", snippet="s", host="blog.example"),
            WebResult(url="https://blog.example/b", title="B", snippet="s", host="blog.example"),
        ]
    )
    assert len(cards) == 1


def test_the_disclaimer_says_plainly_where_this_came_from():
    text = web_disclaimer(2).lower()
    # Names the source, and denies ownership. Checking for the meaning rather
    # than for one particular word: "none of it is yours" says it as well as
    # "not yours" does, and pinning the wording would only make the copy
    # harder to improve later.
    assert "web" in text
    assert "yours" in text
    assert "saved" in text


def test_the_disclaimer_reads_correctly_for_a_single_result():
    assert "1 page" in web_disclaimer(1)
    assert "pages" in web_disclaimer(3)


def test_the_fake_search_produces_usable_cards_end_to_end():
    cards = web_cards(FakeWebSearch().search("Acatenango Volcano"))
    assert cards
    assert all(c["from_web"] and not c["yours"] and c["quote"] for c in cards)


# ---------------------------------------------------------------------------
# The free travel guide
#
# Preferred over a search engine because it needs no key, and because its
# sections already carry the meaning the app's knowledge types carry - so
# nothing has to guess what a paragraph is about.
# ---------------------------------------------------------------------------

def test_a_guide_becomes_typed_cards():
    cards = guide_cards(FakeTravelWiki().guide("Antigua Guatemala"))
    kinds = {c["knowledge_type"] for c in cards}
    assert KnowledgeType.SAFETY in kinds
    assert KnowledgeType.TRANSPORT in kinds
    assert KnowledgeType.ACCOMMODATION in kinds


def test_guide_cards_carry_their_attribution():
    """CC BY-SA is free, not unconditional."""
    for card in guide_cards(FakeTravelWiki().guide("Antigua Guatemala")):
        assert "Wikivoyage" in card["attribution"]
        assert card["url"].startswith("https://")


def test_a_guide_card_is_never_presented_as_the_travellers_own():
    for card in guide_cards(FakeTravelWiki().guide("Antigua Guatemala")):
        assert card["from_web"] is True
        assert card["yours"] is False
        assert card["sourcing"] == "found"


def test_nothing_from_a_guide_is_official_either():
    # An encyclopedia is people writing things down, however carefully.
    for card in guide_cards(FakeTravelWiki().guide("Antigua Guatemala")):
        assert card["provenance"] != "official"


def test_no_guide_means_no_cards_rather_than_an_error():
    assert guide_cards(None) == []
