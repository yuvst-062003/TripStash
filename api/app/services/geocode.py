"""Putting a stop that was only named onto the map.

The `+` on the trip screen sends a name and nothing else, which is right: a
traveller adding Cartagena should not have to know where Cartagena is. But a
stop with no coordinates has no pin, no legs, cannot be flown into, and with
no country never reaches a country page. So the name is resolved here, once,
when the stop is added, and what was found is stored with it.

The free travel guide is asked first: it has an article for nearly every
destination a traveller would name, with coordinates on it, and it needs no
key. The in-repo gazetteer is the fallback, for the handful of places the
fakes know, so the loop still closes with no network at all.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.adapters import get_travel_wiki
from app.adapters.gazetteer import DESTINATION_HINTS, GAZETTEER
from app.services.text import normalize_name


@dataclass(frozen=True)
class Located:
    lat: float
    lon: float
    country: str | None
    #: Which source placed it, for the log and for a test to assert on.
    via: str


def locate_destination(name: str) -> Located | None:
    """Where a named destination is, or nothing rather than a guess."""
    wanted = normalize_name(name or "")
    if not wanted:
        return None

    guide = get_travel_wiki().locate(name)
    if guide is not None and guide.lat is not None and guide.lon is not None:
        return Located(lat=guide.lat, lon=guide.lon, country=guide.country, via="wikivoyage")

    for hint, (lat, lon, country) in DESTINATION_HINTS.items():
        if normalize_name(hint) == wanted:
            return Located(lat=lat, lon=lon, country=country, via="gazetteer")
    for entry in GAZETTEER:
        names = [entry["name"], *entry.get("aliases", [])]
        if any(normalize_name(n) == wanted for n in names):
            return Located(
                lat=entry["lat"], lon=entry["lon"], country=entry.get("country"), via="gazetteer"
            )
    return None
