"""A free travel guide for anywhere, with no key and no quota.

The assistant could only answer from the traveller's own library, which is a
dead end for exactly the person this app is for: someone still deciding where
to go. A general search engine would fill that gap, but every usable one wants
a key and a bill.

Wikivoyage wants neither, and for this app it is the better source anyway:

- It is written about destinations by people who went there.
- Its articles carry coordinates, so a place it describes can be put on the map.
- Its section headings are already this app's vocabulary. "Stay safe" is a
  safety note, "Get in" is transport, "Sleep" is accommodation. Nothing has to
  guess what a paragraph is about, which is the part a language model would
  otherwise be needed for - and the part it would sometimes get wrong.

CC BY-SA 4.0: free to use, not unconditional. Attribution travels with the
text, on every card, which is why it is a field on `Guide` rather than
something a caller is trusted to remember.

Its honest limit: it covers destinations, not individual businesses. Ask it
about Antigua and it answers; ask it about one hostel in Antigua and it has
never heard of the place. That is the right shape for choosing where to go and
the wrong shape for choosing where to sleep, and the app should say so rather
than return nothing and look broken.
"""

from __future__ import annotations

import urllib.parse
from dataclasses import dataclass, field

from app.adapters._http import get_json
from app.models.enums import KnowledgeType

API = "https://en.wikivoyage.org/w/api.php"
ATTRIBUTION = "Wikivoyage, CC BY-SA 4.0"

#: Wikimedia asks for a descriptive agent that identifies the application.
#: Sending a real one is the price of the free quota, and it is a fair price.
USER_AGENT = "TripStash/0.1 (trip planning; https://github.com/yuvst-062003/TripStash)"

TIMEOUT_SECONDS = 8.0


@dataclass(frozen=True)
class GuideSection:
    heading: str
    text: str


@dataclass(frozen=True)
class Guide:
    title: str
    url: str
    sections: list[GuideSection] = field(default_factory=list)
    lat: float | None = None
    lon: float | None = None
    attribution: str = ATTRIBUTION


#: A Wikivoyage heading, and what this app already calls that kind of thing.
#: The mapping is the whole reason this source beats a search engine here.
_HEADINGS: dict[str, KnowledgeType] = {
    "get in": KnowledgeType.TRANSPORT,
    "get around": KnowledgeType.TRANSPORT,
    "sleep": KnowledgeType.ACCOMMODATION,
    "stay safe": KnowledgeType.SAFETY,
    "stay healthy": KnowledgeType.SAFETY,
    "see": KnowledgeType.PLACE,
    "do": KnowledgeType.PLACE,
    "eat": KnowledgeType.PLACE,
    "drink": KnowledgeType.PLACE,
    "buy": KnowledgeType.PRICE,
    "go next": KnowledgeType.ROUTE,
    "understand": KnowledgeType.GENERAL,
}

#: Headings a traveller planning a visit would actually ask about. "Work" and
#: "Cope" are written for people moving somewhere, not visiting.
_WORTH_KEEPING = frozenset(_HEADINGS)


#: How a Wikivoyage disambiguation page introduces itself.
_DISAMBIGUATION = (
    "there is more than one place",
    "may refer to",
    "can refer to",
    "is the name of several",
)


def looks_like_disambiguation(extract: str) -> bool:
    """Whether this is a list of places rather than a guide to one.

    Search for "Oaxaca" and Wikivoyage offers the disambiguation page, which
    tells a traveller nothing and makes the app look like it does not know
    what it is talking about - which, at that moment, it does not.
    """
    text = (extract or "").strip().casefold()
    if not text:
        return True
    opening = text[:300]
    return any(marker in opening for marker in _DISAMBIGUATION)


def merge_repeated_headings(sections: list[GuideSection]) -> list[GuideSection]:
    """Fold consecutive sections that share a heading into one.

    An article's lead paragraph and its own "Understand" section are the same
    kind of thing; shown apart they read as two cards saying the same thing,
    which makes an answer look padded.
    """
    merged: list[GuideSection] = []
    for section in sections:
        if merged and merged[-1].heading.casefold() == section.heading.casefold():
            previous = merged.pop()
            merged.append(
                GuideSection(
                    heading=previous.heading,
                    text=f"{previous.text}\n\n{section.text}".strip(),
                )
            )
        else:
            merged.append(section)
    return merged


def knowledge_type_for(heading: str) -> KnowledgeType:
    return _HEADINGS.get((heading or "").strip().casefold(), KnowledgeType.GENERAL)


def sections_of_interest(sections: list[GuideSection]) -> list[GuideSection]:
    """Only the sections worth reading, and only the ones with text in them."""
    return [
        section
        for section in sections
        if section.heading.strip().casefold() in _WORTH_KEEPING and section.text.strip()
    ]


class FakeTravelWiki:
    """Deterministic guides, so the path works with no network at all.

    Only knows the places the demo trip touches, and returns nothing for
    anything else - which is also how the real one behaves for a hostel.
    """

    name = "fake"

    _KNOWN = {
        "antigua guatemala": (14.5667, -90.7333),
        "antigua": (14.5667, -90.7333),
        "guatemala": (15.5, -90.25),
        "lake atitlán": (14.6906, -91.2025),
        "ljubljana": (46.0514, 14.5060),
    }

    def guide(self, place: str) -> Guide | None:
        key = (place or "").strip().casefold()
        if not key or key not in self._KNOWN:
            return None
        lat, lon = self._KNOWN[key]
        name = place.strip()
        return Guide(
            title=name,
            url=f"https://en.wikivoyage.org/wiki/{urllib.parse.quote(name.replace(' ', '_'))}",
            lat=lat,
            lon=lon,
            sections=[
                GuideSection(
                    heading="Understand",
                    text=f"{name} is a destination this guide describes for travellers.",
                ),
                GuideSection(
                    heading="Get in",
                    text=f"How travellers usually arrive in {name}, and roughly how long it takes.",
                ),
                GuideSection(
                    heading="See",
                    text=f"The things people go to {name} to look at.",
                ),
                GuideSection(
                    heading="Sleep",
                    text=f"Where travellers stay in {name}, from hostels upward.",
                ),
                GuideSection(
                    heading="Stay safe",
                    text=f"What to watch for in {name} after dark and in crowds.",
                ),
            ],
        )


class WikivoyageTravelWiki:
    """The real one. No key, no quota, no account."""

    name = "wikivoyage"

    def __init__(self, *, timeout_seconds: float = TIMEOUT_SECONDS) -> None:
        self._timeout = timeout_seconds

    def _get(self, params: dict[str, str]) -> dict:
        # A guide that cannot be fetched must not take the conversation down
        # with it: get_json returns nothing and the assistant answers from the
        # library instead, saying so.
        url = f"{API}?{urllib.parse.urlencode({**params, 'format': 'json'})}"
        return get_json(url, headers={"User-Agent": USER_AGENT}, timeout=self._timeout)

    def _candidate_titles(self, place: str) -> list[str]:
        """The few best matches, not just the first.

        The top hit for a place name is often a disambiguation page, so the
        caller needs somewhere to go next rather than giving up on it.
        """
        found = self._get({"action": "query", "list": "search", "srsearch": place, "srlimit": "3"})
        hits = (found.get("query") or {}).get("search") or []
        return [hit["title"] for hit in hits]

    def guide(self, place: str) -> Guide | None:
        subject = (place or "").strip()
        if not subject:
            return None

        for title in self._candidate_titles(subject):
            # Plain text rather than HTML: the app stores what was said, not
            # how it was marked up.
            page = self._get(
                {
                    "action": "query",
                    "prop": "extracts|coordinates",
                    "titles": title,
                    "explaintext": "1",
                }
            )
            pages = (page.get("query") or {}).get("pages") or {}
            if not pages:
                continue
            record = next(iter(pages.values()))
            extract = record.get("extract") or ""

            if looks_like_disambiguation(extract):
                # A list of places, not a guide to one. Try the next match.
                continue

            coords = (record.get("coordinates") or [{}])[0]
            return Guide(
                title=title,
                url=(
                    "https://en.wikivoyage.org/wiki/"
                    + urllib.parse.quote(title.replace(" ", "_"))
                ),
                sections=merge_repeated_headings(_split_sections(extract)),
                lat=coords.get("lat"),
                lon=coords.get("lon"),
            )

        return None


def _split_sections(extract: str) -> list[GuideSection]:
    """Cut a plain-text extract at its own headings.

    The API returns one string with headings marked as `== Heading ==`. Parsing
    that is simpler and far more predictable than asking for HTML and stripping
    tags, and it keeps the text exactly as written - which matters, because the
    text is what gets quoted.
    """
    sections: list[GuideSection] = []
    heading = "Understand"
    body: list[str] = []

    for line in extract.splitlines():
        stripped = line.strip()
        if stripped.startswith("==") and stripped.endswith("==") and len(stripped) > 4:
            if body:
                sections.append(GuideSection(heading=heading, text="\n".join(body).strip()))
                body = []
            heading = stripped.strip("=").strip()
        else:
            body.append(line)

    if body:
        sections.append(GuideSection(heading=heading, text="\n".join(body).strip()))
    return sections
