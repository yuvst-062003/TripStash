"""Deduplication order and merge safety (spec 10.3)."""

from __future__ import annotations

from app.models.enums import PlaceStatus
from app.models.places import Place, TripPlace
from app.services.dedupe import MatchRule, find_duplicate, merge_places
from app.services.text import normalize_name


def _place(session, **kwargs) -> Place:
    defaults = {
        "name": "Rainbow Café",
        "lat": 14.5570,
        "lon": -90.7345,
        "category": "cafe",
        "provider": "fake",
        "provider_place_id": "gt-rainbow-cafe",
    }
    defaults.update(kwargs)
    defaults["normalized_name"] = normalize_name(defaults["name"])
    place = Place(**defaults)
    session.add(place)
    session.flush()
    return place


def test_provider_identity_is_the_only_exact_match(session):
    existing = _place(session)
    match = find_duplicate(
        session,
        name="Something Else Entirely",
        lat=0.0,
        lon=0.0,
        provider="fake",
        provider_place_id="gt-rainbow-cafe",
    )
    assert match is not None
    assert match.place.id == existing.id
    assert match.rule is MatchRule.PROVIDER_ID
    assert match.is_exact


def test_nearby_same_name_is_a_possible_duplicate_not_an_automatic_merge(session):
    _place(session, provider=None, provider_place_id=None)
    match = find_duplicate(session, name="Rainbow Cafe", lat=14.5571, lon=-90.7346)
    assert match is not None
    assert match.rule is MatchRule.COORD_NAME
    assert not match.is_exact


def test_far_away_same_name_is_not_a_duplicate(session):
    _place(session, provider=None, provider_place_id=None)
    assert find_duplicate(session, name="Rainbow Cafe", lat=51.5, lon=-0.12) is None


def test_matching_phone_flags_a_duplicate(session):
    _place(session, provider=None, provider_place_id=None, phone="+502 7832 1919")
    match = find_duplicate(
        session, name="Totally Different", lat=None, lon=None, phone="+50278321919"
    )
    assert match is not None and match.rule is MatchRule.CONTACT


def test_merge_preserves_every_source_note_and_status(session, trip, auth, client):
    trip_id = trip["id"]
    keep = _place(session, name="Semuc Champey", provider_place_id="gt-semuc-champey")
    drop = _place(
        session,
        name="Semuc",
        provider=None,
        provider_place_id=None,
        lat=15.5343,
        lon=-89.9648,
        phone="+502 1111 1111",
    )

    session.add(
        TripPlace(
            trip_id=trip_id,
            place_id=keep.id,
            status=PlaceStatus.SAVED,
            reason_saved="Turquoise pools",
        )
    )
    session.add(
        TripPlace(
            trip_id=trip_id,
            place_id=drop.id,
            status=PlaceStatus.MUST_VISIT,
            reason_saved="Second source said go early",
            is_favourite=True,
        )
    )
    session.flush()

    merged = merge_places(session, keep=keep, drop=drop)
    session.flush()

    trip_places = [tp for tp in session.query(TripPlace).filter_by(trip_id=trip_id).all()]
    assert len(trip_places) == 1
    survivor = trip_places[0]
    assert survivor.place_id == merged.id
    # The stronger status and the favourite flag both survive.
    assert survivor.status == PlaceStatus.MUST_VISIT
    assert survivor.is_favourite
    # Neither reason is lost.
    assert "Turquoise pools" in survivor.reason_saved
    assert "Second source said go early" in survivor.reason_saved
    # Identifiers from the dropped record are folded in, not discarded.
    assert merged.phone == "+502 1111 1111"
    assert "Semuc" in (merged.aliases or "")
