"""Where a page off the open web sits in the source hierarchy.

The app's whole premise is that a claim carries its evidence. Dropping
ungraded web text into it would undermine the one thing that makes it worth
using, so a search result is graded the way anything else is - by what it is,
not by how it arrived.
"""

from app.models.enums import PROVENANCE_RANK, Provenance
from app.services.web_grading import grade_result, keep_grounded


def test_a_review_site_is_graded_as_reviews():
    assert grade_result("https://www.tripadvisor.com/Hotel_Review-x.html") is Provenance.REVIEWS
    assert grade_result("https://www.yelp.com/biz/somewhere") is Provenance.REVIEWS


def test_an_ordinary_page_is_graded_as_a_creator():
    # Someone writing about a place is the same kind of source as someone
    # filming it: worth reading, not authoritative.
    assert grade_result("https://someblog.example/guatemala-guide") is Provenance.CREATOR


def test_search_alone_never_produces_an_official_claim():
    """The top of the ladder has to be earned, not assumed.

    A page can say anything about itself, and a search engine ranking it first
    is not verification. Official standing needs corroboration the app does not
    have at search time.
    """
    for url in (
        "https://visitguatemala.com/official",
        "https://www.gob.gt/tourism",
        "https://hostel-tremendo.com/about",
    ):
        assert PROVENANCE_RANK[grade_result(url)] > PROVENANCE_RANK[Provenance.REVIEWS]


def test_a_web_result_never_outranks_a_clip_the_traveller_saved():
    """The traveller's own library is the point of the app.

    A stranger's blog turning up in search must not displace something they
    chose to keep.
    """
    web = PROVENANCE_RANK[grade_result("https://someblog.example/x")]
    assert web >= PROVENANCE_RANK[Provenance.USER]


def test_a_url_that_is_not_a_url_is_still_graded_rather_than_crashing():
    assert grade_result("not a url") is Provenance.CREATOR
    assert grade_result("") is Provenance.CREATOR
    assert grade_result(None) is Provenance.CREATOR


def test_the_domain_is_matched_on_the_host_not_anywhere_in_the_string():
    # A page that merely mentions a review site in its path is not that site.
    assert grade_result("https://fake.example/tripadvisor.com/review") is Provenance.CREATOR


def test_a_subdomain_of_a_review_site_still_counts():
    assert grade_result("https://en.tripadvisor.co.uk/x") is Provenance.REVIEWS


# ---------------------------------------------------------------------------
# The grounding rule, applied to the web
#
# The app already refuses a claim with no verbatim quote behind it. A search
# result is not an exception - if anything it needs the rule more, because
# nobody chose it.
# ---------------------------------------------------------------------------


def test_a_claim_with_a_quote_from_its_own_page_is_kept():
    kept = keep_grounded(
        claim="The 2pm shuttle is the one to book.",
        quote="Book the 2pm shuttle, not the 6am one.",
        page_text="Lots of preamble. Book the 2pm shuttle, not the 6am one. More text.",
    )
    assert kept is True


def test_a_claim_whose_quote_is_not_on_the_page_is_dropped():
    assert (
        keep_grounded(
            claim="The 2pm shuttle is the one to book.",
            quote="Book the 2pm shuttle, not the 6am one.",
            page_text="This page is about something else entirely.",
        )
        is False
    )


def test_a_claim_with_no_quote_at_all_is_dropped():
    assert keep_grounded(claim="Trust me.", quote=None, page_text="Anything.") is False
    assert keep_grounded(claim="Trust me.", quote="   ", page_text="Anything.") is False


def test_matching_ignores_whitespace_and_case_but_not_the_words():
    assert (
        keep_grounded(
            claim="x",
            quote="Book the 2PM   shuttle",
            page_text="...book the 2pm shuttle, not the 6am...",
        )
        is True
    )
    assert (
        keep_grounded(claim="x", quote="Book the 3pm shuttle", page_text="Book the 2pm shuttle")
        is False
    )
