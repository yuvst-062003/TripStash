"""Spatial queries.

Postgres + PostGIS is the deployment target, so `nearby_place_ids` uses
`ST_DWithin` on a geography expression when the dialect supports it. The
portable branch (bounding box prefilter plus haversine) keeps SQLite viable
for development and tests and produces the same ordering.
"""

from __future__ import annotations

import math

from sqlalchemy import Select, and_, select, text
from sqlalchemy.orm import Session

from app.models.places import Place, TripPlace

EARTH_RADIUS_KM = 6371.0088


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance. Deterministic: the assistant must not guess."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def walking_minutes(distance_km: float, speed_kmh: float = 4.5) -> int:
    """Flat-ground walking estimate; labelled as an estimate everywhere it is shown."""
    return max(1, round(distance_km / speed_kmh * 60))


def bbox_around(lat: float, lon: float, radius_km: float) -> tuple[float, float, float, float]:
    """(min_lat, min_lon, max_lat, max_lon) that fully contains the radius."""
    d_lat = radius_km / 111.0
    # cos() collapses near the poles; clamp so the box never inverts.
    cos_lat = max(math.cos(math.radians(lat)), 0.01)
    d_lon = radius_km / (111.320 * cos_lat)
    return (
        max(-90.0, lat - d_lat),
        max(-180.0, lon - d_lon),
        min(90.0, lat + d_lat),
        min(180.0, lon + d_lon),
    )


def apply_bbox(stmt: Select, min_lat: float, min_lon: float, max_lat: float, max_lon: float):
    return stmt.where(
        and_(
            Place.lat >= min_lat,
            Place.lat <= max_lat,
            Place.lon >= min_lon,
            Place.lon <= max_lon,
        )
    )


def nearby_trip_places(
    session: Session,
    trip_id: str,
    lat: float,
    lon: float,
    radius_km: float,
    limit: int = 50,
) -> list[tuple[TripPlace, float]]:
    """Trip places within `radius_km`, nearest first, with the distance."""
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        stmt = (
            select(TripPlace)
            .join(Place, Place.id == TripPlace.place_id)
            .where(TripPlace.trip_id == trip_id)
            .where(
                text(
                    "ST_DWithin("
                    "ST_SetSRID(ST_MakePoint(place.lon, place.lat), 4326)::geography, "
                    "ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :radius_m)"
                )
            )
            .params(lat=lat, lon=lon, radius_m=radius_km * 1000)
            .limit(limit * 2)
        )
    else:
        min_lat, min_lon, max_lat, max_lon = bbox_around(lat, lon, radius_km)
        stmt = apply_bbox(
            select(TripPlace).join(Place, Place.id == TripPlace.place_id).where(
                TripPlace.trip_id == trip_id
            ),
            min_lat,
            min_lon,
            max_lat,
            max_lon,
        ).limit(limit * 4)

    rows = session.execute(stmt).scalars().unique().all()
    measured = [
        (tp, haversine_km(lat, lon, tp.place.lat, tp.place.lon))
        for tp in rows
    ]
    # The bbox prefilter is generous by construction; the radius is enforced here.
    measured = [pair for pair in measured if pair[1] <= radius_km]
    measured.sort(key=lambda pair: pair[1])
    return measured[:limit]
