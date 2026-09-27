"""Which activity types this trip is about.

Picks filter; they never score. An empty set of picks means no filter, so a
traveller who has picked nothing still sees everything. `PUT` replaces the
whole set rather than adding to it, because a pick list is a statement about
the trip and not a log of what was once considered.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.deps import current_trip
from app.models.core import Trip
from app.models.picks import ActivityPick
from app.schemas.api import ActivityOption, ActivityPicksRequest, ActivityPicksResponse
from app.services.activities import ACTIVITIES, ACTIVITY_SLUGS

router = APIRouter(tags=["activities"])


def _options() -> list[ActivityOption]:
    return [ActivityOption(slug=a.slug, label=a.label) for a in ACTIVITIES]


def _picked(session: Session, trip: Trip) -> list[str]:
    rows = session.execute(
        select(ActivityPick.slug).where(ActivityPick.trip_id == trip.id)
    ).scalars()
    return sorted(rows)


@router.get("/activities", response_model=ActivityPicksResponse)
def read_activities(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> ActivityPicksResponse:
    return ActivityPicksResponse(available=_options(), picked=_picked(session, trip))


@router.put("/activities", response_model=ActivityPicksResponse)
def set_activities(
    body: ActivityPicksRequest,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> ActivityPicksResponse:
    """Replace the whole set. Putting the same slug twice picks it once."""
    wanted = {slug.strip().lower() for slug in body.slugs if slug.strip()}
    unknown = sorted(wanted - ACTIVITY_SLUGS)
    if unknown:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Not an activity this app knows: {', '.join(unknown)}",
        )

    session.execute(delete(ActivityPick).where(ActivityPick.trip_id == trip.id))
    for slug in sorted(wanted):
        session.add(ActivityPick(trip_id=trip.id, slug=slug))
    session.flush()
    return ActivityPicksResponse(available=_options(), picked=sorted(wanted))
