"""Where a page off the open web sits in the source hierarchy.

The app's premise is that a claim carries its evidence: a quote, a clip, a
place you can point at. Search results are the easiest way to undermine that,
because a search engine returns confident prose about anything at all and
returns it instantly. So a result is graded the way everything else is - by
what it is, not by how it arrived - and it is held to the same grounding rule.

Two decisions worth stating, because neither is obvious:

**Search never produces an OFFICIAL claim.** A page can say anything about
itself, and a search engine ranking it first is not verification. The top of
the ladder is earned by corroboration the app does not have at search time.

**A web result never outranks something the traveller saved.** Their library
is the point of the app. A stranger's blog turning up in a search must not
displace a clip they chose to keep, so the best a web page manages is REVIEWS
and the ordinary case is CREATOR - the same tier as the person who filmed a
reel about the place, which is what a travel blogger is.
"""

from __future__ import annotations

from urllib.parse import urlparse

from app.models.enums import Provenance

#: Sites whose whole purpose is aggregating first-hand accounts. Still below
#: the traveller's own library, and still subject to the grounding rule.
REVIEW_HOSTS: frozenset[str] = frozenset(
    {
        "tripadvisor.com",
        "tripadvisor.co.uk",
        "yelp.com",
        "google.com",  # maps reviews
        "booking.com",
        "hostelworld.com",
        "lonelyplanet.com",
    }
)


def _host_of(url: str | None) -> str:
    if not url:
        return ""
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return ""
    return host.lower()


def _is_review_host(host: str) -> bool:
    """True for a review site or any of its subdomains.

    Matched on the host and nothing else: a page whose PATH happens to mention
    a review site is not that review site, and checking the whole URL string
    would let anyone claim the tier by naming it in a query parameter.
    """
    return any(host == known or host.endswith("." + known) for known in REVIEW_HOSTS)


def grade_result(url: str | None) -> Provenance:
    """The provenance a search result is entitled to, on its own."""
    host = _host_of(url)
    if host and _is_review_host(host):
        return Provenance.REVIEWS
    # Somebody writing about a place, which is what most of the web is.
    return Provenance.CREATOR


def _normalise(text: str) -> str:
    """Collapse whitespace and case, so formatting differences do not matter.

    Deliberately does NOT touch the words themselves: "2pm" and "3pm" must stay
    different, or the check stops being a check.
    """
    return " ".join(text.split()).casefold()


def keep_grounded(*, claim: str, quote: str | None, page_text: str) -> bool:
    """Whether a claim may be kept, given the page it came from.

    The same rule the extraction pipeline already applies: a claim survives
    only if a verbatim quote supporting it appears in the source. Nobody chose
    a search result, so if anything it needs the rule more than a reel does.

    `claim` is unused in the comparison and required in the signature on
    purpose: it keeps every caller holding the claim and its evidence together,
    rather than checking a quote in one place and using it somewhere else.
    """
    if not quote or not quote.strip():
        return False
    return _normalise(quote) in _normalise(page_text)
