"""What the assistant notices about a route, and where it could go next.

Both are read-only. A check that has a fix offers it as a proposal - the same
Add / Dismiss the assistant uses everywhere - and nothing changes until the
traveller presses Add. Every figure here comes from the route, the library or
the itinerary service, so each claim can be traced to something stored.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.capture import KnowledgeItem
from app.models.core import Destination, Trip
from app.models.enums import KnowledgeType, PlaceStatus
from app.models.places import Place, TripPlace
from app.services.cities import normalise_city
from app.services.countries import normalise_country
from app.services.itinerary import schedule
from app.services.spatial import haversine_km

# A ground leg longer than this is a day lost on a bus, worth saying out loud.
LONG_LEG_MINUTES = 10 * 60


@dataclass
class Check:
    id: str
    kind: str
    title: str
    body: str
    destination_id: str | None = None
    # A fix the traveller can accept with one press, or None when the only
    # honest answer is to look at it themselves.
    fix: dict | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def route_checks(session: Session, trip: Trip) -> list[Check]:
    computed = schedule(trip)
    checks: list[Check] = []

    for stop in computed.stops:
        d = stop.destination
        if stop.nights is None:
            checks.append(
                Check(
                    id=f"nights:{d.id}",
                    kind="nights_missing",
                    title=f"{d.name} has no nights yet",
                    body="Every date after it stays blank until it has a number.",
                    destination_id=d.id,
                )
            )
        leg = stop.leg_in
        if leg is None:
            continue
        if leg.distance_km is not None and leg.duration_minutes is None:
            checks.append(
                Check(
                    id=f"leg:{leg.from_destination_id}:{d.id}",
                    kind="long_leg",
                    title=f"{leg.distance_km:,.0f} km to {d.name}",
                    body="Too far to estimate by road - plan a flight, or a stop between.",
                    destination_id=d.id,
                )
            )
        elif leg.duration_minutes and leg.duration_minutes > LONG_LEG_MINUTES:
            hours = round(leg.duration_minutes / 60)
            checks.append(
                Check(
                    id=f"leg:{leg.from_destination_id}:{d.id}",
                    kind="long_leg",
                    title=f"About {hours} hours on the road to {d.name}",
                    body="An estimate, not a timetable. A night bus, or a stop between?",
                    destination_id=d.id,
                )
            )

    # Dated events on a stop: are you there when it happens?
    by_id = {s.destination.id: s for s in computed.stops}
    # An event written by hand names its stop rather than pointing at it.
    by_name = {normalise_city(s.destination.name): s for s in computed.stops}
    events = session.execute(
        select(KnowledgeItem).where(
            KnowledgeItem.trip_id == trip.id,
            KnowledgeItem.type == KnowledgeType.EVENT,
            KnowledgeItem.is_archived.is_(False),
            KnowledgeItem.happens_on.is_not(None),
        )
    ).scalars()
    for event in events:
        stop = by_id.get(event.destination_id or "") or by_name.get(
            normalise_city(event.destination_scope)
        )
        if stop is None or stop.arrive_on is None or stop.depart_on is None:
            continue
        starts = event.happens_on
        ends = event.ends_on or starts
        if stop.arrive_on <= starts and stop.depart_on > ends:
            continue
        fix = None
        if stop.arrive_on <= starts and stop.nights is not None:
            # Staying on until the morning after it ends covers the whole event.
            needed = (ends + timedelta(days=1) - stop.arrive_on).days
            if needed > stop.nights:
                fix = {
                    "type": "set_nights",
                    "label": f"Stay {needed} nights in {stop.destination.name}",
                    "payload": {"destination_id": stop.destination.id, "nights": needed},
                }
        checks.append(
            Check(
                id=f"event:{event.id}",
                kind="event_missed",
                title=f"{event.title}: {starts:%b %-d}–{ends:%b %-d}",
                body=(
                    f"You are in {stop.destination.name} {stop.arrive_on:%b %-d}–"
                    f"{stop.depart_on:%b %-d}, so you would miss some or all of it."
                ),
                destination_id=stop.destination.id,
                fix=fix,
            )
        )

    return checks


@dataclass
class StopSuggestion:
    name: str
    country: str | None
    lat: float
    lon: float
    place_count: int
    detour_km: float
    why: str
    places: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def stop_suggestions(
    session: Session, trip: Trip, after: Destination | None, limit: int = 5
) -> list[StopSuggestion]:
    """Cities you saved places in that the route does not visit yet.

    Ranked by how far out of the way they are between `after` and the stop
    that follows it, so the first suggestion is the cheapest one to add. Only
    the traveller's own library is read: a place nobody saved is not proposed.
    """
    ordered = sorted(trip.destinations, key=lambda d: (d.position, d.id or ""))
    on_route = {normalise_city(d.name) for d in ordered}

    nxt = None
    if after is not None:
        later = [d for d in ordered if d.position > after.position]
        nxt = later[0] if later else None

    rows = session.execute(
        select(Place, TripPlace)
        .join(TripPlace, TripPlace.place_id == Place.id)
        .where(TripPlace.trip_id == trip.id, TripPlace.status != PlaceStatus.ARCHIVED)
    ).all()

    cities: dict[str, dict] = {}
    for place, _trip_place in rows:
        key = normalise_city(place.city)
        if not key or key in on_route or place.lat is None or place.lon is None:
            continue
        entry = cities.setdefault(
            key,
            {"name": place.city, "country": place.country, "pts": [], "names": []},
        )
        entry["pts"].append((place.lat, place.lon))
        entry["names"].append(place.name)

    def detour(lat: float, lon: float) -> float:
        a = (after.lat, after.lon) if after and after.lat is not None else None
        b = (nxt.lat, nxt.lon) if nxt and nxt.lat is not None else None
        if a and b:
            return haversine_km(a[0], a[1], lat, lon) + haversine_km(lat, lon, b[0], b[1]) - (
                haversine_km(a[0], a[1], b[0], b[1])
            )
        if a:
            return haversine_km(a[0], a[1], lat, lon)
        return 0.0

    out: list[StopSuggestion] = []
    for entry in cities.values():
        lat = sum(p[0] for p in entry["pts"]) / len(entry["pts"])
        lon = sum(p[1] for p in entry["pts"]) / len(entry["pts"])
        count = len(entry["pts"])
        out.append(
            StopSuggestion(
                name=entry["name"],
                country=entry["country"],
                lat=lat,
                lon=lon,
                place_count=count,
                detour_km=round(max(0.0, detour(lat, lon)), 1),
                why=f"{count} of your saved {'place' if count == 1 else 'places'} "
                f"{'is' if count == 1 else 'are'} there",
                places=entry["names"][:3],
            )
        )

    # Same-country first when there is a neighbour to compare with: a detour
    # inside the country you are already in is the cheap kind.
    here = normalise_country(after.country) if after else None
    out.sort(key=lambda s: (normalise_country(s.country) != here, s.detour_km))
    return out[:limit]
