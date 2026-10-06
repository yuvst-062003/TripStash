"""Rolling the traveller's places up into countries and cities.

The redesign asks a country to list *cities*, ranked by how much is there. A
cafe should not be ranked against a city, so the rollup happens on `Place.city`
and `Place.country` and never flattens to individual spots.

**What "popularity" means here, and what it does not.** TripStash holds one
traveller's library. There is no corpus of what other people saved, so a count
of "places other travellers love" would have nothing behind it. Every number
these functions return is counted from this install: your saved places, your
clips. The screens label them that way. A public count needs a provider, and
until one exists, saying "142 places" would be inventing an audience.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import Select, case, func, select
from sqlalchemy.orm import Session

from app.models.capture import SourcePlaceEvidence
from app.models.core import Destination
from app.models.enums import PlaceStatus
from app.models.places import Place, TripPlace

# Places the traveller has not triaged yet are not part of a city's count:
# the inbox is a queue, not a library.
COUNTED_STATUSES = (
    PlaceStatus.SAVED,
    PlaceStatus.MUST_VISIT,
    PlaceStatus.PLANNED,
    PlaceStatus.VISITED,
)


@dataclass(frozen=True)
class Scope:
    """A country or a city, with what the traveller has there."""

    name: str
    country: str | None
    place_count: int
    clip_count: int
    visited_count: int
    on_route: bool
    lat: float | None
    lon: float | None


def _counted(trip_id: str) -> Select:
    return (
        select(TripPlace)
        .join(Place, Place.id == TripPlace.place_id)
        .where(TripPlace.trip_id == trip_id, TripPlace.status.in_(COUNTED_STATUSES))
    )


def _clip_counts(session: Session, trip_id: str, column) -> dict[str, int]:
    """How many saved video moments sit in each scope.

    A clip is one piece of evidence carrying a timestamp, which is what the
    feed opens at - counting sources instead would undercount a video that
    named three places.
    """
    rows = session.execute(
        select(column, func.count(SourcePlaceEvidence.id))
        .join(Place, Place.id == SourcePlaceEvidence.place_id)
        .where(
            SourcePlaceEvidence.trip_id == trip_id,
            SourcePlaceEvidence.media_timestamp_seconds.is_not(None),
            column.is_not(None),
        )
        .group_by(column)
    ).all()
    return {key: count for key, count in rows if key}


def _route_names(session: Session, trip_id: str) -> tuple[set[str], set[str]]:
    """The countries and the stop names the trip already passes through."""
    rows = session.execute(
        select(Destination.name, Destination.country).where(Destination.trip_id == trip_id)
    ).all()
    cities = {name.strip().lower() for name, _ in rows if name}
    countries = {country.strip().lower() for _, country in rows if country}
    return countries, cities


def countries(session: Session, trip_id: str) -> list[Scope]:
    """Every country the traveller has something in, most first."""
    on_route, _ = _route_names(session, trip_id)
    clips = _clip_counts(session, trip_id, Place.country)

    rows = session.execute(
        _counted(trip_id)
        .with_only_columns(
            Place.country,
            func.count(TripPlace.id),
            func.sum(case((TripPlace.status == PlaceStatus.VISITED, 1), else_=0)),
            func.avg(Place.lat),
            func.avg(Place.lon),
        )
        .where(Place.country.is_not(None))
        .group_by(Place.country)
    ).all()

    scopes = [
        Scope(
            name=country,
            country=country,
            place_count=count,
            clip_count=clips.get(country, 0),
            visited_count=int(visited or 0),
            on_route=country.strip().lower() in on_route,
            lat=lat,
            lon=lon,
        )
        for country, count, visited, lat, lon in rows
        if country
    ]
    # A country already on the route comes first: it is the one being planned.
    scopes.sort(key=lambda s: (not s.on_route, -s.place_count, s.name))
    return scopes


def cities(session: Session, trip_id: str, country: str | None = None) -> list[Scope]:
    """Cities, ranked by how much of the traveller's library sits in them."""
    on_route_countries, on_route_cities = _route_names(session, trip_id)
    clips = _clip_counts(session, trip_id, Place.city)

    statement = (
        _counted(trip_id)
        .with_only_columns(
            Place.city,
            Place.country,
            func.count(TripPlace.id),
            func.sum(case((TripPlace.status == PlaceStatus.VISITED, 1), else_=0)),
            func.avg(Place.lat),
            func.avg(Place.lon),
        )
        .where(Place.city.is_not(None))
        .group_by(Place.city, Place.country)
    )
    if country:
        statement = statement.where(func.lower(Place.country) == country.strip().lower())

    scopes = [
        Scope(
            name=city,
            country=in_country,
            place_count=count,
            clip_count=clips.get(city, 0),
            visited_count=int(visited or 0),
            on_route=city.strip().lower() in on_route_cities
            or (in_country or "").strip().lower() in on_route_countries,
            lat=lat,
            lon=lon,
        )
        for city, in_country, count, visited, lat, lon in session.execute(statement).all()
        if city
    ]
    scopes.sort(key=lambda s: (-s.place_count, s.name))
    return scopes
