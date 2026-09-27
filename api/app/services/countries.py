"""Counting a library by country.

Scope elsewhere resolves to one label per place - its destination, else its
city, else its country - so a place attached to a destination never groups under
the country it is in. This is the second axis: every place a traveller saved,
gathered by country, so "Guatemala, all 12 videos" can be answered before any
single place there has been opened.

Read-only. Nothing here writes.
"""

from __future__ import annotations

import unicodedata
from collections.abc import Callable, Iterable
from dataclasses import dataclass

# Shown when the gazetteer could not resolve a country. Named, not hidden: a
# place with no country is still a place the traveller saved, and a count that
# quietly omits it disagrees with every other screen.
UNKNOWN_COUNTRY = "Country not known"


def normalise_country(value: str | None) -> str:
    """A stable key for one country, however it was spelled.

    "Panama" and "panama" are the same country, and so is "Panama" with an
    accent. Marks are stripped and case folded so two spellings of one place
    cannot become two countries. An absent country folds to the empty key,
    which callers surface as UNKNOWN_COUNTRY.
    """
    if not value or not value.strip():
        return ""
    decomposed = unicodedata.normalize("NFKD", value.strip())
    without_marks = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return without_marks.casefold()


@dataclass(frozen=True)
class CountryTally:
    key: str
    name: str
    place_count: int
    video_count: int
    playable_count: int


def tally_countries(
    rows: Iterable[tuple],
    *,
    is_video: Callable[[object], bool],
    is_playable: Callable[[object], bool],
) -> list[CountryTally]:
    """Gather evidence rows into one tally per country.

    `rows` are the `(evidence, source, trip_place, place)` tuples the reels
    router already builds, so archived places are excluded upstream and these
    counts agree with what Saved shows. The predicates are injected rather than
    imported so this module stays independent of what counts as a video.
    """
    names: dict[str, str] = {}
    places: dict[str, set[str]] = {}
    videos: dict[str, int] = {}
    playable: dict[str, int] = {}

    for _evidence, source, _trip_place, place in rows:
        if not is_video(source):
            continue
        key = normalise_country(place.country)
        # The first spelling seen wins as the display name, so the traveller
        # sees the country written the way their own library writes it.
        names.setdefault(key, place.country.strip() if place.country else UNKNOWN_COUNTRY)
        places.setdefault(key, set()).add(place.id)
        videos[key] = videos.get(key, 0) + 1
        if is_playable(source):
            playable[key] = playable.get(key, 0) + 1

    out = [
        CountryTally(
            key=key,
            name=names[key],
            place_count=len(places[key]),
            video_count=videos[key],
            playable_count=playable.get(key, 0),
        )
        for key in names
    ]
    out.sort(key=lambda c: (-c.video_count, c.name.casefold()))
    return out
