"""Tagging a place with what you do there.

Every tag has to be defensible by reading the source: the word is in the quote
or it is not. These tests pin that a tag never appears without its word, which
is what keeps the filter strip on the same footing as the counts.
"""

from app.services.facets import ACTIVITY_WORDS, activities_for


def test_a_tag_needs_its_word_to_be_present():
    assert activities_for("Acatenango Volcano", ["the overnight hike is brutal"]) == [
        "hike",
        "volcano",
    ]


def test_nothing_is_tagged_from_an_empty_source():
    assert activities_for(None, []) == []
    assert activities_for("", [""]) == []


def test_a_place_with_no_matching_word_gets_no_tag():
    assert activities_for("Some Quiet Square", ["a nice place to sit"]) == []


def test_the_name_alone_can_tag_a_place():
    assert "islands" in activities_for("Ometepe", [])


def test_a_place_answers_to_more_than_one_chip():
    tags = activities_for("Tremendo Hostel", ["the rooftop is great for a party"])
    assert "nightlife" in tags


def test_tagging_is_stable_and_sorted():
    first = activities_for("Lake Atitlán", ["boat to the island", "the waterfall nearby"])
    second = activities_for("Lake Atitlán", ["the waterfall nearby", "boat to the island"])
    assert first == second == sorted(first)


def test_every_slug_has_at_least_one_word():
    for slug, words in ACTIVITY_WORDS.items():
        assert words, slug
        for word in words:
            assert word == word.lower()


def test_semuc_champey_is_tagged_from_its_own_name():
    """A Guatemalan case from the real seed."""
    assert "waterfall" in activities_for("Semuc Champey", [])
