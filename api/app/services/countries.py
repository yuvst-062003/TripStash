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
    #: How many of `video_count` the app found rather than the traveller saved.
    #: The two are never merged: a found clip counts for nothing until stamped,
    #: and the map draws the difference as a dry impression against an inked one.
    found_count: int = 0


def tally_countries(
    rows: Iterable[tuple],
    *,
    is_video: Callable[[object], bool],
    is_playable: Callable[[object], bool],
    is_found: Callable[[object], bool] | None = None,
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
    found: dict[str, int] = {}

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
        # A caller with no notion of a found tier leaves every count at zero
        # rather than having to invent a predicate.
        if is_found is not None and is_found(source):
            found[key] = found.get(key, 0) + 1

    out = [
        CountryTally(
            key=key,
            name=names[key],
            place_count=len(places[key]),
            video_count=videos[key],
            playable_count=playable.get(key, 0),
            found_count=found.get(key, 0),
        )
        for key in names
    ]
    out.sort(key=lambda c: (-c.video_count, c.name.casefold()))
    return out


@dataclass(frozen=True)
class GlobeCountry:
    """One pressable country on the globe.

    Two things put a country here, and either is enough: the traveller planned
    a stop in it, or a video they saved names a place in it. A country that
    only satisfies the first has no video yet and still has to be reachable,
    because the globe is how a country gets opened.
    """

    key: str
    name: str
    lat: float
    lon: float
    in_route: bool
    stop_count: int
    place_count: int
    video_count: int
    playable_count: int
    found_count: int = 0


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def globe_countries(
    destinations: Iterable,
    rows: Iterable[tuple],
    *,
    is_video: Callable[[object], bool],
    is_playable: Callable[[object], bool],
    is_found: Callable[[object], bool] | None = None,
) -> list[GlobeCountry]:
    """The globe's index: every country the trip touches, placed and counted.

    Coordinates are averaged from whatever the country actually holds - its
    stops first, since those are where the traveller decided to be, and its
    saved places otherwise. A country with neither cannot be drawn and is left
    out rather than dropped at a guessed position.
    """
    # Read once: `rows` is walked twice below, and a generator would be empty
    # the second time round.
    rows = list(rows)

    names: dict[str, str] = {}
    stops: dict[str, int] = {}
    coords: dict[str, list[tuple[float, float]]] = {}
    place_coords: dict[str, list[tuple[float, float]]] = {}
    # Where each country first appears along the route. The globe draws the
    # trip as a line through this list, so the order is not presentation: a
    # list sorted by name draws a line that visits the countries in
    # alphabetical order, which on a map of the Americas is a zigzag.
    first_stop: dict[str, int] = {}

    for index, destination in enumerate(destinations):
        key = normalise_country(destination.country)
        if not key:
            continue
        names.setdefault(key, (destination.country or "").strip())
        first_stop.setdefault(key, index)
        stops[key] = stops.get(key, 0) + 1
        if destination.lat is not None and destination.lon is not None:
            coords.setdefault(key, []).append((destination.lat, destination.lon))

    tallies = {
        t.key: t
        for t in tally_countries(
            rows, is_video=is_video, is_playable=is_playable, is_found=is_found
        )
    }
    for _evidence, source, _trip_place, place in rows:
        if not is_video(source):
            continue
        key = normalise_country(place.country)
        names.setdefault(key, place.country.strip() if place.country else UNKNOWN_COUNTRY)
        if place.lat is not None and place.lon is not None:
            place_coords.setdefault(key, []).append((place.lat, place.lon))

    out: list[GlobeCountry] = []
    for key, name in names.items():
        points = coords.get(key) or place_coords.get(key) or []
        lat = _mean([p[0] for p in points])
        lon = _mean([p[1] for p in points])
        if lat is None or lon is None:
            # Nothing to place it by. Better absent than drawn on the equator.
            continue
        tally = tallies.get(key)
        out.append(
            GlobeCountry(
                key=key,
                name=name,
                lat=lat,
                lon=lon,
                in_route=key in stops,
                stop_count=stops.get(key, 0),
                place_count=tally.place_count if tally else 0,
                video_count=tally.video_count if tally else 0,
                playable_count=tally.playable_count if tally else 0,
                found_count=tally.found_count if tally else 0,
            )
        )

    # The route first, in travelling order, because that is the trip. Only the
    # countries that are not on it need a rule to arrange them, and there the
    # one with the most to watch is the one worth offering first.
    out.sort(
        key=lambda c: (
            not c.in_route,
            first_stop.get(c.key, 0) if c.in_route else 0,
            -c.video_count,
            c.name.casefold(),
        )
    )
    return out
