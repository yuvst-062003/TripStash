"""The video feed: every saved clip for a spot, opened at its saved section.

A place page answers "what do I know about this". This answers the other
question a traveller asks about their own library: "show me what I saved".
The clips are the traveller's own, the order is their own, and nothing is
recommended into the feed.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters import get_storage
from app.db import get_session
from app.deps import current_trip
from app.models.capture import Source, SourcePlaceEvidence
from app.models.core import Destination, Trip
from app.models.enums import PlaceStatus
from app.models.places import Place, TripPlace
from app.schemas.api import ReelClip, ReelSpot
from app.services.reels import clip_window, is_playable, is_video_source

router = APIRouter(tags=["reels"])


def _scope_label(trip_place: TripPlace, place: Place, destinations: dict[str, Destination]) -> str:
    """Where this spot sits: its destination, else its city, else its country."""
    destination = destinations.get(trip_place.destination_id or "")
    if destination is not None:
        return destination.name
    return place.city or place.country or "Elsewhere"


def _rows(session: Session, trip: Trip, *, include_archived: bool = False):
    """Evidence joined to the source, the place and the traveller's layer."""
    stmt = (
        select(SourcePlaceEvidence, Source, TripPlace, Place)
        .join(Source, Source.id == SourcePlaceEvidence.source_id)
        .join(Place, Place.id == SourcePlaceEvidence.place_id)
        .join(
            TripPlace,
            (TripPlace.place_id == SourcePlaceEvidence.place_id)
            & (TripPlace.trip_id == SourcePlaceEvidence.trip_id),
        )
        .where(SourcePlaceEvidence.trip_id == trip.id)
    )
    if not include_archived:
        stmt = stmt.where(TripPlace.status != PlaceStatus.ARCHIVED)
    return session.execute(stmt).all()


def _destinations(session: Session, trip: Trip) -> dict[str, Destination]:
    rows = session.execute(
        select(Destination).where(Destination.trip_id == trip.id)
    ).scalars()
    return {destination.id: destination for destination in rows}


@router.get("/reels/spots", response_model=list[ReelSpot])
def list_spots(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
    destination_id: str | None = Query(default=None),
    scope: str | None = Query(default=None),
) -> list[ReelSpot]:
    """Which spots have video behind them, grouped by where they are.

    Spots with nothing playable are still listed, with `playable_count` at
    zero, so the count matches what the library actually holds.
    """
    destinations = _destinations(session, trip)
    spots: dict[str, ReelSpot] = {}

    for _evidence, source, trip_place, place in _rows(session, trip):
        if not is_video_source(source):
            continue
        label = _scope_label(trip_place, place, destinations)
        if destination_id and trip_place.destination_id != destination_id:
            continue
        if scope and label.casefold() != scope.casefold():
            continue

        spot = spots.get(trip_place.id)
        if spot is None:
            spots[trip_place.id] = spot = ReelSpot(
                trip_place_id=trip_place.id,
                place_id=place.id,
                name=place.name,
                category=str(place.category),
                city=place.city,
                country=place.country,
                status=str(trip_place.status),
                destination_id=trip_place.destination_id,
                scope_label=label,
                clip_count=0,
                playable_count=0,
                latest_saved_at=None,
            )
        spot.clip_count += 1
        if is_playable(source):
            spot.playable_count += 1
        if spot.latest_saved_at is None or (
            source.created_at and source.created_at > spot.latest_saved_at
        ):
            spot.latest_saved_at = source.created_at

    out = list(spots.values())
    out.sort(key=lambda s: (s.scope_label.casefold(), -s.clip_count, s.name.casefold()))
    return out


@router.get("/reels", response_model=list[ReelClip])
def list_clips(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
    trip_place_id: str | None = Query(default=None),
    place_id: str | None = Query(default=None),
    destination_id: str | None = Query(default=None),
    scope: str | None = Query(default=None),
    playable_only: bool = Query(default=False),
) -> list[ReelClip]:
    """The feed itself, newest first within each spot.

    With no filter this is every saved video across the trip; with one it is
    the feed for a single spot, city or destination.
    """
    destinations = _destinations(session, trip)
    # An explicitly requested spot is shown even when it has been archived -
    # the traveller asked for that one.
    rows = _rows(session, trip, include_archived=bool(trip_place_id or place_id))
    storage = get_storage()

    clips: list[ReelClip] = []
    for evidence, source, trip_place, place in rows:
        if not is_video_source(source):
            continue
        if trip_place_id and trip_place.id != trip_place_id:
            continue
        if place_id and place.id != place_id:
            continue
        if destination_id and trip_place.destination_id != destination_id:
            continue
        label = _scope_label(trip_place, place, destinations)
        if scope and label.casefold() != scope.casefold():
            continue
        playable = is_playable(source)
        if playable_only and not playable:
            continue

        window = clip_window(evidence.media_timestamp_seconds, source.duration_seconds)
        clips.append(
            ReelClip(
                id=evidence.id,
                source_id=source.id,
                trip_place_id=trip_place.id,
                place_id=place.id,
                place_name=place.name,
                place_category=str(place.category),
                city=place.city,
                country=place.country,
                scope_label=label,
                title=source.title,
                author=source.author,
                url=source.url,
                file_url=storage.signed_url(source.storage_key) if playable else None,
                media_type=source.media_type,
                duration_seconds=source.duration_seconds,
                width=source.width,
                height=source.height,
                moment_seconds=evidence.media_timestamp_seconds,
                start_seconds=window.start_seconds,
                end_seconds=window.end_seconds,
                is_whole_video=window.is_whole,
                takeaway=evidence.takeaway,
                quote=evidence.quote,
                confidence=evidence.confidence,
                saved_at=source.created_at,
            )
        )

    # Spots stay together so a destination feed reads as one spot after
    # another; a clip the app can play comes before one it can only link to.
    clips.sort(
        key=lambda c: (
            c.scope_label.casefold(),
            c.place_name.casefold(),
            c.file_url is None,
            -(c.saved_at.timestamp() if c.saved_at else 0.0),
        )
    )
    return clips


@router.get("/reels/spots/{trip_place_id}", response_model=ReelSpot)
def spot_detail(
    trip_place_id: str,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> ReelSpot:
    """One spot's header, so a feed opened by link can title itself."""
    destinations = _destinations(session, trip)
    counted: ReelSpot | None = None
    for _evidence, source, trip_place, place in _rows(session, trip, include_archived=True):
        if trip_place.id != trip_place_id or not is_video_source(source):
            continue
        if counted is None:
            counted = ReelSpot(
                trip_place_id=trip_place.id,
                place_id=place.id,
                name=place.name,
                category=str(place.category),
                city=place.city,
                country=place.country,
                status=str(trip_place.status),
                destination_id=trip_place.destination_id,
                scope_label=_scope_label(trip_place, place, destinations),
                clip_count=0,
                playable_count=0,
                latest_saved_at=None,
            )
        counted.clip_count += 1
        if is_playable(source):
            counted.playable_count += 1
        if counted.latest_saved_at is None or (
            source.created_at and source.created_at > counted.latest_saved_at
        ):
            counted.latest_saved_at = source.created_at

    if counted is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No saved video for this place yet.")
    return counted
