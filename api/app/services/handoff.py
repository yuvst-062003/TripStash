"""External handoffs (spec 7.4).

The app is the memory and decision layer; navigation, booking and rides are
completed by whoever already does them well. Every handoff therefore returns a
link plus a web fallback, and none of them may ever be reported as a completed
booking or purchase - opening a link is not a transaction.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote_plus

from app.models.places import Place


@dataclass(slots=True)
class Handoff:
    key: str
    label: str
    url: str
    # Used when the native application is not installed or the deep link fails.
    web_fallback: str | None = None
    # Shown to the user so an opened link is never mistaken for a confirmation.
    note: str | None = None


def navigate(place: Place, *, mode: str = "walking") -> Handoff:
    mode = mode if mode in {"walking", "driving", "transit", "bicycling"} else "walking"
    coords = f"{place.lat},{place.lon}"
    return Handoff(
        key="navigate",
        label="Navigate with Google Maps",
        url=(
            "https://www.google.com/maps/dir/?api=1"
            f"&destination={coords}&travelmode={mode}"
        ),
        web_fallback=f"https://www.google.com/maps/search/?api=1&query={coords}",
    )


def ride(place: Place) -> Handoff:
    return Handoff(
        key="ride",
        label="Open Uber",
        url=(
            "https://m.uber.com/ul/?action=setPickup&pickup=my_location"
            f"&dropoff[latitude]={place.lat}&dropoff[longitude]={place.lon}"
            f"&dropoff[nickname]={quote_plus(place.name)}"
        ),
        web_fallback=f"https://www.google.com/maps/search/?api=1&query={place.lat},{place.lon}",
        note="Coverage varies by country; copy the address if no ride app opens.",
    )


def stay_search(
    destination: str, *, checkin: str | None = None, checkout: str | None = None
) -> list[Handoff]:
    where = quote_plus(destination)
    booking = f"https://www.booking.com/searchresults.html?ss={where}"
    if checkin and checkout:
        booking += f"&checkin={checkin}&checkout={checkout}"
    return [
        Handoff(
            key="booking",
            label="Search Booking.com",
            url=booking,
            note="Prices and availability are shown by the provider, not by TripStash.",
        ),
        Handoff(
            key="hostelworld",
            label="Search Hostelworld",
            url=f"https://www.hostelworld.com/search?search_keywords={where}",
            note="Import the confirmation afterwards to attach it to the route.",
        ),
    ]


def contact(place: Place) -> list[Handoff]:
    out: list[Handoff] = []
    if place.phone:
        out.append(Handoff(key="call", label="Call", url=f"tel:{place.phone.replace(' ', '')}"))
    if place.website:
        out.append(Handoff(key="website", label="Official website", url=place.website))
    return out


def for_place(place: Place, *, mode: str = "walking") -> list[Handoff]:
    handoffs = [navigate(place, mode=mode), ride(place), *contact(place)]
    if place.category == "accommodation":
        handoffs.extend(stay_search(place.city or place.name))
    return handoffs


def serialise(handoffs: list[Handoff]) -> list[dict]:
    return [
        {
            "key": h.key,
            "label": h.label,
            "url": h.url,
            "web_fallback": h.web_fallback,
            "note": h.note,
        }
        for h in handoffs
    ]
