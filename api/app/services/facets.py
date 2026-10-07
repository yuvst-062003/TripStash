"""What a place is, and what you do there.

The filter strip mixes two columns because a traveller scanning a city does
not separate them: "hostels" is what a place *is*, "hiking" is what you *do*
there, and Tremendo Hostel answers to both.

The first column already exists as `Place.category`. The second is derived,
and derived by matching words that are **literally present** in the evidence -
never by asking a model what a place is like. A place is tagged `hike` because
one of its own quotes contains the word, which is a claim the traveller can
check by reading the quote. That keeps the filter on the same footing as every
count in this app: something observed, not something guessed.
"""

from __future__ import annotations

from collections.abc import Iterable

# Activity slug to the words that put a place under it. Matched against the
# place's own name and the verbatim quotes saved with it, lowercased. Kept
# deliberately literal: a word that is not in the source cannot tag anything.
ACTIVITY_WORDS: dict[str, tuple[str, ...]] = {
    "hike": ("hike", "hiking", "trek", "trekking", "summit", "trail", "hik"),
    "surf": ("surf", "surfing", "waves", "surfboard"),
    "volcano": ("volcano", "volcan", "crater", "lava"),
    "dive": ("dive", "diving", "snorkel", "scuba", "reef"),
    "spanish": ("spanish school", "spanish class", "learn spanish", "escuela"),
    "street_food": ("street food", "market", "mercado", "taco", "tlayuda", "comedor"),
    "nightlife": ("hostel", "party", "nightlife", "rooftop", "bar crawl"),
    "waterfall": ("waterfall", "cascada", "cave", "cenote", "pools", "champey"),
    "ruins": ("ruins", "temple", "pyramid", "archaeolog", "maya", "teotihuac"),
    "wildlife": ("wildlife", "monkey", "turtle", "sloth", "birdwatch"),
    "coffee": ("coffee farm", "coffee tour", "finca", "plantation"),
    "islands": ("island", "isla", "ferry", "ometepe", "archipelago"),
}


def activities_for(name: str | None, quotes: Iterable[str]) -> list[str]:
    """Which activity chips this place answers to.

    Matched on the place's own name and the quotes saved with it. Returns
    sorted slugs so the same place always tags identically.
    """
    haystack = " ".join(filter(None, [(name or "").lower(), *(q.lower() for q in quotes)]))
    if not haystack.strip():
        return []
    return sorted(
        slug for slug, words in ACTIVITY_WORDS.items() if any(word in haystack for word in words)
    )
