"""Deduplication in the order spec 10.3 mandates.

The order matters more than the cleverness: an exact provider identity is the
only signal allowed to merge on its own. Everything weaker returns a
*possible* duplicate, which the review screen shows the user.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.base import ResolvedPlace
from app.models.places import Place
from app.services.spatial import bbox_around, haversine_km
from app.services.text import digits_only, normalize_name, normalize_website, similarity

# Two pins this close with a matching name are the same place in practice.
COORD_MATCH_KM = 0.15
FUZZY_CANDIDATE_KM = 2.0
NAME_MATCH_THRESHOLD = 0.6
FUZZY_THRESHOLD = 0.75


class MatchRule(StrEnum):
    PROVIDER_ID = "provider_id"
    COORD_NAME = "coordinate_and_name"
    CONTACT = "address_phone_or_website"
    ALIAS = "alias_or_translation"
    FUZZY = "fuzzy_similarity"


@dataclass(slots=True)
class DuplicateMatch:
    place: Place
    rule: MatchRule
    score: float

    @property
    def is_exact(self) -> bool:
        """Only a canonical provider identity may merge without asking."""
        return self.rule is MatchRule.PROVIDER_ID

    def describe(self) -> str:
        return {
            MatchRule.PROVIDER_ID: "Same provider place ID",
            MatchRule.COORD_NAME: "Within 150 m with a matching name",
            MatchRule.CONTACT: "Same address, phone or website",
            MatchRule.ALIAS: "Matches a known alias or translated name",
            MatchRule.FUZZY: "Similar name nearby - confirm before merging",
        }[self.rule]


def find_duplicate(
    session: Session,
    *,
    name: str,
    lat: float | None,
    lon: float | None,
    provider: str | None = None,
    provider_place_id: str | None = None,
    address: str | None = None,
    phone: str | None = None,
    website: str | None = None,
    aliases: list[str] | None = None,
) -> DuplicateMatch | None:
    """Return the strongest match, or None. Never merges by itself."""

    # 1. Exact external provider ID.
    if provider and provider_place_id:
        existing = session.execute(
            select(Place).where(
                Place.provider == provider, Place.provider_place_id == provider_place_id
            )
        ).scalar_one_or_none()
        if existing is not None:
            return DuplicateMatch(existing, MatchRule.PROVIDER_ID, 1.0)

    nearby: list[Place] = []
    if lat is not None and lon is not None:
        min_lat, min_lon, max_lat, max_lon = bbox_around(lat, lon, FUZZY_CANDIDATE_KM)
        nearby = list(
            session.execute(
                select(Place).where(
                    Place.lat.between(min_lat, max_lat), Place.lon.between(min_lon, max_lon)
                )
            ).scalars()
        )

        # 2. Coordinate proximity plus normalised name.
        for place in nearby:
            distance = haversine_km(lat, lon, place.lat, place.lon)
            if distance > COORD_MATCH_KM:
                continue
            score = similarity(name, place.name)
            if normalize_name(name) == place.normalized_name:
                return DuplicateMatch(place, MatchRule.COORD_NAME, 1.0)
            if score >= NAME_MATCH_THRESHOLD:
                return DuplicateMatch(place, MatchRule.COORD_NAME, score)

    # 3. Address, phone or website match.
    contact_match = _match_by_contact(session, address=address, phone=phone, website=website)
    if contact_match is not None:
        return contact_match

    # 4. Aliases and multilingual names. Scoped to nearby candidates when
    # coordinates are known - two identically named cafés on different
    # continents are not the same place.
    alias_pool = [name, *(aliases or [])]
    alias_scope = nearby if lat is not None and lon is not None else _by_normalized_name(
        session, name
    )
    for place in alias_scope:
        known = [place.name, *place.alias_list()]
        for candidate_name in alias_pool:
            if any(normalize_name(candidate_name) == normalize_name(k) for k in known):
                return DuplicateMatch(place, MatchRule.ALIAS, 0.95)

    # 5. Fuzzy similarity - a candidate generator only, never a merge.
    best: DuplicateMatch | None = None
    for place in nearby:
        score = max(similarity(n, place.name) for n in alias_pool)
        if score >= FUZZY_THRESHOLD and (best is None or score > best.score):
            best = DuplicateMatch(place, MatchRule.FUZZY, score)
    return best


def find_duplicate_for_resolved(session: Session, resolved: ResolvedPlace) -> DuplicateMatch | None:
    return find_duplicate(
        session,
        name=resolved.name,
        lat=resolved.lat,
        lon=resolved.lon,
        provider=resolved.provider,
        provider_place_id=resolved.provider_place_id,
        address=resolved.address,
        phone=resolved.phone,
        website=resolved.website,
        aliases=resolved.aliases,
    )


def _by_normalized_name(session: Session, name: str) -> list[Place]:
    return list(
        session.execute(
            select(Place).where(Place.normalized_name == normalize_name(name))
        ).scalars()
    )


def _match_by_contact(
    session: Session, *, address: str | None, phone: str | None, website: str | None
) -> DuplicateMatch | None:
    phone_digits = digits_only(phone)
    host = normalize_website(website)
    if not (phone_digits or host or address):
        return None

    for place in session.execute(select(Place)).scalars():
        if phone_digits and digits_only(place.phone) == phone_digits:
            return DuplicateMatch(place, MatchRule.CONTACT, 0.9)
        if host and normalize_website(place.website) == host:
            return DuplicateMatch(place, MatchRule.CONTACT, 0.85)
        if address and place.address and normalize_name(address) == normalize_name(place.address):
            return DuplicateMatch(place, MatchRule.CONTACT, 0.85)
    return None


def merge_places(session: Session, *, keep: Place, drop: Place) -> Place:
    """Fold `drop` into `keep`, preserving every source, note and identifier.

    Spec 10.3: a merge must lose nothing. Fields on `keep` win only where
    `keep` actually has a value.
    """
    from app.models.capture import KnowledgeItem, SourcePlaceEvidence
    from app.models.ops import Booking, Expense
    from app.models.places import PlaceFact, TripPlace

    if keep.id == drop.id:
        return keep

    carry_over = ("address", "city", "country", "phone", "website", "provider", "provider_place_id")
    for field in carry_over:
        if getattr(keep, field, None) in (None, "") and getattr(drop, field, None):
            setattr(keep, field, getattr(drop, field))

    aliases = {*keep.alias_list(), *drop.alias_list(), drop.name} - {keep.name}
    keep.aliases = "|".join(sorted(a for a in aliases if a))

    for fact in list(drop.facts):
        fact.place_id = keep.id
    for model in (SourcePlaceEvidence, KnowledgeItem, Booking, Expense):
        for row in session.execute(select(model).where(model.place_id == drop.id)).scalars():
            row.place_id = keep.id

    kept_trip_places = {
        tp.trip_id: tp
        for tp in session.execute(
            select(TripPlace).where(TripPlace.place_id == keep.id)
        ).scalars()
    }
    for trip_place in session.execute(
        select(TripPlace).where(TripPlace.place_id == drop.id)
    ).scalars():
        survivor = kept_trip_places.get(trip_place.trip_id)
        if survivor is None:
            trip_place.place_id = keep.id
            kept_trip_places[trip_place.trip_id] = trip_place
            continue
        _fold_trip_place(survivor, trip_place)
        session.delete(trip_place)

    session.flush()
    session.delete(drop)
    session.flush()
    _ = PlaceFact  # imported for the relationship side effect above
    return keep


def _fold_trip_place(survivor, duplicate) -> None:
    """User-entered content is never dropped, only concatenated."""
    from app.models.enums import PlaceStatus

    priority = [
        PlaceStatus.ARCHIVED,
        PlaceStatus.INBOX,
        PlaceStatus.SAVED,
        PlaceStatus.PLANNED,
        PlaceStatus.MUST_VISIT,
        PlaceStatus.VISITED,
    ]
    if priority.index(PlaceStatus(duplicate.status)) > priority.index(PlaceStatus(survivor.status)):
        survivor.status = duplicate.status

    for field in ("reason_saved", "notes"):
        extra = getattr(duplicate, field)
        if not extra:
            continue
        current = getattr(survivor, field)
        setattr(survivor, field, f"{current}\n{extra}".strip() if current else extra)

    survivor.is_favourite = survivor.is_favourite or duplicate.is_favourite
    survivor.needs_review = survivor.needs_review or duplicate.needs_review
    for field in ("expected_cost", "expected_duration_minutes", "best_time", "rating"):
        if getattr(survivor, field) is None:
            setattr(survivor, field, getattr(duplicate, field))
    for visit in list(duplicate.visits):
        visit.trip_place_id = survivor.id
    for collection in duplicate.collections:
        if collection not in survivor.collections:
            survivor.collections.append(collection)
