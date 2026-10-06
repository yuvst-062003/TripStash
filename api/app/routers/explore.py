"""Explore: the map read at country and city distance.

Routers do HTTP and ownership; the rollup rules live in `services/explore.py`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_session
from app.deps import current_trip
from app.models.core import Trip
from app.schemas.api import ScopeResponse
from app.services import explore

router = APIRouter(prefix="/explore", tags=["explore"])


def _serialise(scope: explore.Scope) -> ScopeResponse:
    return ScopeResponse(
        name=scope.name,
        country=scope.country,
        place_count=scope.place_count,
        clip_count=scope.clip_count,
        visited_count=scope.visited_count,
        on_route=scope.on_route,
        lat=scope.lat,
        lon=scope.lon,
    )


@router.get("/countries", response_model=list[ScopeResponse])
def list_countries(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> list[ScopeResponse]:
    """Countries the traveller has something in. On-route ones lead."""
    return [_serialise(scope) for scope in explore.countries(session, trip.id)]


@router.get("/cities", response_model=list[ScopeResponse])
def list_cities(
    country: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    sort: str = Query(default="places", pattern="^(places|clips|name)$"),
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> list[ScopeResponse]:
    """Cities, filtered and ranked. A country lists cities, never single spots."""
    scopes = explore.cities(session, trip.id, country)

    if q:
        needle = q.strip().lower()
        scopes = [s for s in scopes if needle in s.name.lower()]

    if sort == "clips":
        scopes = sorted(scopes, key=lambda s: (-s.clip_count, -s.place_count, s.name))
    elif sort == "name":
        scopes = sorted(scopes, key=lambda s: s.name.lower())

    return [_serialise(scope) for scope in scopes]
