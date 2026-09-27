"""Breaking a country down into the cities it holds.

Two things put a city here, and either is enough: the traveller planned a stop
in it, or a place they saved sits in it. A city that only satisfies the first
has nothing saved yet and still has to be pressable, because the map is how a
city gets opened.

The explanation is theirs before it is anyone else's. A stop they wrote a note
on is explained in their own words; only a city they never described falls
back to what its sources say, and the answer always names which of the two it
was so nothing arrives unattributed.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

from app.services.countries import normalise_country

# How an explanation was arrived at. Never blank: a city with nothing to say
# says "none" rather than presenting silence as a description.
FROM_YOU = "you"
FROM_SOURCES = "sources"
FROM_NOTHING = "none"


def normalise_city(value: str | None) -> str:
    """A key for one city, however it was spelled. Empty when unknown."""
    return normalise_country(value)


@dataclass
class CityBreakdown:
    key: str
    name: str
    lat: float | None
    lon: float | None
    in_route: bool
    destination_id: str | None
    explanation: str
    explanation_source: str
    place_count: int
    video_count: int
    playable_count: int
    #: How many of `video_count` the app found rather than the traveller saved.
    #: Kept apart from the total for the same reason it is at every other level:
    #: a found clip is a suggestion until it is stamped, and the map draws that
    #: as a dry impression rather than an inked one.
    found_count: int = 0
    kinds: list[str] = field(default_factory=list)


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def cities_in_country(
    country_key: str,
    destinations: Iterable,
    rows: Iterable[tuple],
    *,
    is_video: Callable[[object], bool],
    is_playable: Callable[[object], bool],
    is_found: Callable[[object], bool] | None = None,
) -> list[CityBreakdown]:
    """Every city of one country, placed, counted and explained.

    `rows` are the `(evidence, source, trip_place, place)` tuples the reels
    router builds, so archived places are already excluded and these counts
    agree with the rest of the app.
    """
    rows = list(rows)
    wanted = normalise_country(country_key)

    cities: dict[str, CityBreakdown] = {}
    coords: dict[str, list[tuple[float, float]]] = {}
    place_ids: dict[str, set[str]] = {}
    kinds: dict[str, set[str]] = {}

    for destination in destinations:
        if normalise_country(destination.country) != wanted:
            continue
        key = normalise_city(destination.name)
        if not key:
            continue
        note = (destination.notes or "").strip()
        cities[key] = CityBreakdown(
            key=key,
            name=(destination.name or "").strip(),
            lat=destination.lat,
            lon=destination.lon,
            in_route=True,
            destination_id=destination.id,
            explanation=note,
            explanation_source=FROM_YOU if note else FROM_NOTHING,
            place_count=0,
            video_count=0,
            playable_count=0,
            found_count=0,
        )

    for _evidence, source, _trip_place, place in rows:
        if normalise_country(place.country) != wanted:
            continue
        key = normalise_city(place.city)
        if not key:
            continue
        city = cities.get(key)
        if city is None:
            cities[key] = city = CityBreakdown(
                key=key,
                name=(place.city or "").strip(),
                lat=None,
                lon=None,
                in_route=False,
                destination_id=None,
                explanation="",
                explanation_source=FROM_NOTHING,
                place_count=0,
                video_count=0,
                playable_count=0,
                found_count=0,
            )
        if place.lat is not None and place.lon is not None:
            coords.setdefault(key, []).append((place.lat, place.lon))
        place_ids.setdefault(key, set()).add(place.id)
        if place.category:
            kinds.setdefault(key, set()).add(str(place.category))
        if is_video(source):
            city.video_count += 1
            if is_playable(source):
                city.playable_count += 1
            if is_found is not None and is_found(source):
                city.found_count += 1

    for key, city in cities.items():
        city.place_count = len(place_ids.get(key, ()))
        city.kinds = sorted(kinds.get(key, ()))
        if city.lat is None or city.lon is None:
            points = coords.get(key, [])
            city.lat = _mean([p[0] for p in points])
            city.lon = _mean([p[1] for p in points])

    # A city with no coordinates cannot be drawn, and a map that silently drops
    # a stop is worse than one that never offered it.
    placed = [city for city in cities.values() if city.lat is not None and city.lon is not None]
    placed.sort(key=lambda c: (not c.in_route, -c.video_count, c.name.casefold()))
    return placed


@dataclass
class CityPlace:
    trip_place_id: str
    place_id: str
    name: str
    kind: str
    activities: list[str]
    status: str
    lat: float | None
    lon: float | None
    video_count: int
    playable_count: int
    found_count: int
    quote: str | None


def places_in_city(
    country_key: str,
    city_key: str,
    rows: Iterable[tuple],
    *,
    is_video: Callable[[object], bool],
    is_playable: Callable[[object], bool],
    tag: Callable[[str | None, list[str]], list[str]],
    is_found: Callable[[object], bool] | None = None,
) -> list[CityPlace]:
    """Everything saved in one city, tagged for the filter strip.

    Videos are counted in one list whether the traveller saved them or the app
    found them; `found_count` says how many of the total were found, so the
    shelf can mark those without splitting them off.
    """
    wanted_country = normalise_country(country_key)
    wanted_city = normalise_city(city_key)

    places: dict[str, CityPlace] = {}
    quotes: dict[str, list[str]] = {}

    for evidence, source, trip_place, place in rows:
        if normalise_country(place.country) != wanted_country:
            continue
        if normalise_city(place.city) != wanted_city:
            continue

        entry = places.get(trip_place.id)
        if entry is None:
            places[trip_place.id] = entry = CityPlace(
                trip_place_id=trip_place.id,
                place_id=place.id,
                name=place.name,
                kind=str(place.category or "other"),
                activities=[],
                status=str(trip_place.status),
                lat=place.lat,
                lon=place.lon,
                video_count=0,
                playable_count=0,
                found_count=0,
                quote=None,
            )

        quote = (getattr(evidence, "quote", None) or "").strip()
        if quote:
            quotes.setdefault(trip_place.id, []).append(quote)
            if entry.quote is None:
                entry.quote = quote

        if is_video(source):
            entry.video_count += 1
            if is_playable(source):
                entry.playable_count += 1
            if is_found is not None and is_found(source):
                entry.found_count += 1

    for key, entry in places.items():
        entry.activities = tag(entry.name, quotes.get(key, []))

    out = list(places.values())
    out.sort(key=lambda p: (-p.video_count, p.name.casefold()))
    return out
