"""A free travel guide for anywhere, with no key and no quota.

Wikivoyage is a better fit for this app than a general search engine: it is
written about destinations by people who went, its articles carry coordinates,
and its section headings are already the app's own vocabulary - "Stay safe" is
a safety note, "Get in" is transport, "Sleep" is accommodation.
"""

from app.adapters.travel_wiki import (
    ATTRIBUTION,
    FakeTravelWiki,
    Guide,
    GuideSection,
    knowledge_type_for,
    sections_of_interest,
)
from app.models.enums import KnowledgeType


def test_the_fake_answers_without_a_key_or_a_network():
    guide = FakeTravelWiki().guide("Antigua Guatemala")
    assert isinstance(guide, Guide)
    assert guide.title
    assert guide.sections


def test_a_place_it_has_never_heard_of_returns_nothing_rather_than_guessing():
    assert FakeTravelWiki().guide("Tremendo Hostel") is None
    assert FakeTravelWiki().guide("") is None


def test_a_guide_carries_where_the_place_is():
    guide = FakeTravelWiki().guide("Antigua Guatemala")
    assert guide.lat is not None and guide.lon is not None


def test_every_guide_carries_its_attribution():
    """CC BY-SA is free, not unconditional. Attribution travels with the text."""
    guide = FakeTravelWiki().guide("Antigua Guatemala")
    assert guide.attribution == ATTRIBUTION
    assert "Wikivoyage" in guide.attribution
    assert guide.url.startswith("https://")


# ---------------------------------------------------------------------------
# The section mapping
#
# This is why a travel guide beats a search engine here: its headings already
# carry the meaning the app's own knowledge types carry.
# ---------------------------------------------------------------------------


def test_safety_headings_become_safety_notes():
    assert knowledge_type_for("Stay safe") is KnowledgeType.SAFETY
    assert knowledge_type_for("Stay healthy") is KnowledgeType.SAFETY


def test_arrival_and_movement_become_transport():
    assert knowledge_type_for("Get in") is KnowledgeType.TRANSPORT
    assert knowledge_type_for("Get around") is KnowledgeType.TRANSPORT


def test_sleeping_becomes_accommodation():
    assert knowledge_type_for("Sleep") is KnowledgeType.ACCOMMODATION


def test_things_to_do_become_places():
    assert knowledge_type_for("See") is KnowledgeType.PLACE
    assert knowledge_type_for("Do") is KnowledgeType.PLACE
    assert knowledge_type_for("Eat") is KnowledgeType.PLACE


def test_going_onward_becomes_a_route():
    assert knowledge_type_for("Go next") is KnowledgeType.ROUTE


def test_an_unknown_heading_is_general_rather_than_dropped():
    assert knowledge_type_for("Cope") is KnowledgeType.GENERAL
    assert knowledge_type_for("") is KnowledgeType.GENERAL


def test_the_mapping_ignores_case_and_spacing():
    assert knowledge_type_for("  STAY SAFE  ") is KnowledgeType.SAFETY


def test_only_sections_a_traveller_would_ask_about_are_kept():
    """Wikivoyage articles carry headings nobody planning a trip needs.

    "Work" and "Cope" are for people moving somewhere, not visiting.
    """
    kept = sections_of_interest(
        [
            GuideSection(heading="See", text="Things to look at."),
            GuideSection(heading="Work", text="Getting a visa to work here."),
            GuideSection(heading="Stay safe", text="Watch your bag."),
            GuideSection(heading="Cope", text="Laundry and haircuts."),
        ]
    )
    assert [s.heading for s in kept] == ["See", "Stay safe"]


def test_an_empty_section_is_dropped_rather_than_shown_blank():
    kept = sections_of_interest(
        [GuideSection(heading="See", text="   "), GuideSection(heading="Do", text="Real text.")]
    )
    assert [s.heading for s in kept] == ["Do"]


# ---------------------------------------------------------------------------
# Picking the right article
# ---------------------------------------------------------------------------


def test_consecutive_sections_with_one_heading_are_merged():
    """The lead paragraph and a real "Understand" section are the same thing.

    Shown apart they read as two cards saying the same kind of thing, which
    makes the answer look padded.
    """
    from app.adapters.travel_wiki import merge_repeated_headings

    merged = merge_repeated_headings(
        [
            GuideSection(heading="Understand", text="Lead paragraph."),
            GuideSection(heading="Understand", text="The real section."),
            GuideSection(heading="See", text="Things."),
        ]
    )
    assert [s.heading for s in merged] == ["Understand", "See"]
    assert "Lead paragraph." in merged[0].text
    assert "The real section." in merged[0].text


def test_a_disambiguation_page_is_recognised_rather_than_answered_from():
    """"There is more than one place called Oaxaca" is not a travel guide.

    Answering from it tells the traveller nothing and looks like the app does
    not know what it is talking about - which, in that moment, it does not.
    """
    from app.adapters.travel_wiki import looks_like_disambiguation

    assert looks_like_disambiguation(
        "There is more than one place in the world called Oaxaca. You may be looking for..."
    )
    assert looks_like_disambiguation("Oaxaca may refer to:")
    assert not looks_like_disambiguation(
        "Ljubljana is the small but delightful capital of Slovenia."
    )


def test_an_empty_extract_is_not_mistaken_for_a_real_article():
    from app.adapters.travel_wiki import looks_like_disambiguation

    assert looks_like_disambiguation("")
    assert looks_like_disambiguation("   ")



# ---------------------------------------------------------------------------
# Subheadings stay in their section
# ---------------------------------------------------------------------------


def test_a_subheading_stays_inside_its_section():
    """A country's visa rules live under "Visa requirements" inside "Get in".

    Cutting at every heading left "Get in" empty and the rules under a heading
    nothing maps, so the guide said it had nothing on borders while holding
    thousands of words on them.
    """
    from app.adapters.travel_wiki import _split_sections

    extract = (
        "Brazil is big.\n== Get in ==\n=== Visa requirements ===\nMost visitors need "
        "no visa for 90 days.\n=== By plane ===\nFly to São Paulo.\n== Sleep ==\nHostels.\n"
    )
    sections = _split_sections(extract)
    assert [s.heading for s in sections] == ["Understand", "Get in", "Sleep"]
    get_in = sections[1].text
    assert "Visa requirements:" in get_in and "90 days" in get_in and "Fly to" in get_in


def test_a_very_long_section_is_cut_at_a_sentence_and_says_so():
    from app.adapters.travel_wiki import SECTION_CHARS, _split_sections

    long = ("A sentence about the border. " * 200).strip()
    [section] = _split_sections("== Get in ==\n" + long)
    assert len(section.text) <= SECTION_CHARS + 2
    assert section.text.endswith(". …")
