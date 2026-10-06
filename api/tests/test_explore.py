"""Explore: countries and cities, counted from this library and no other."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models.capture import Source, SourcePlaceEvidence
from app.models.core import Trip
from app.models.enums import PlaceStatus, SourceKind, SourceStatus
from app.models.places import Place, TripPlace


def _place(session, *, name, city, country, lat=0.0, lon=0.0, category="sight") -> Place:
    place = Place(
        name=name,
        normalized_name=name.lower(),
        category=category,
        lat=lat,
        lon=lon,
        city=city,
        country=country,
    )
    session.add(place)
    session.flush()
    return place


@pytest.fixture
def library(client: TestClient, auth: dict[str, str]):
    """A trip whose route is in Brazil, with places in three cities."""
    client.post(
        "/api/v1/trips",
        headers=auth,
        json={"name": "South America", "start_date": "2026-03-01", "base_currency": "BRL"},
    )
    client.post(
        "/api/v1/trips/current/destinations",
        headers=auth,
        json={"name": "Rio de Janeiro", "country": "Brazil", "nights": 4},
    )

    session = SessionLocal()
    trip = session.query(Trip).filter(Trip.is_active.is_(True)).one()
    rows = [
        ("Aprazível", "Rio de Janeiro", "Brazil", PlaceStatus.SAVED),
        ("Parque Lage", "Rio de Janeiro", "Brazil", PlaceStatus.VISITED),
        ("Pedra do Sal", "Rio de Janeiro", "Brazil", PlaceStatus.MUST_VISIT),
        ("Casa do Alemão", "Paraty", "Brazil", PlaceStatus.SAVED),
        ("Mercado Central", "Buenos Aires", "Argentina", PlaceStatus.PLANNED),
        # In the inbox, so it is not part of any count: a queue is not a library.
        ("Untriaged bar", "Rio de Janeiro", "Brazil", PlaceStatus.INBOX),
    ]
    places = {}
    for name, city, country, status in rows:
        place = _place(session, name=name, city=city, country=country)
        places[name] = place
        session.add(
            TripPlace(trip_id=trip.id, place_id=place.id, status=status, reason_saved="because")
        )

    # One clip, in Rio: a piece of evidence that carries a timestamp.
    source = Source(
        trip_id=trip.id,
        kind=SourceKind.LINK,
        url="https://example.test/rio",
        title="Rio in a day",
        status=SourceStatus.COMPLETED,
        fingerprint="rio-fingerprint",
    )
    session.add(source)
    session.flush()
    session.add(
        SourcePlaceEvidence(
            source_id=source.id,
            trip_id=trip.id,
            place_id=places["Parque Lage"].id,
            takeaway="The gardens",
            quote="go early",
            media_timestamp_seconds=31.0,
        )
    )
    session.commit()
    session.close()
    return trip


def test_countries_carry_their_counts_and_the_route_leads(client, auth, library):
    rows = client.get("/api/v1/explore/countries", headers=auth).json()

    by_name = {row["name"]: row for row in rows}
    assert by_name["Brazil"]["place_count"] == 4
    assert by_name["Brazil"]["visited_count"] == 1
    assert by_name["Brazil"]["clip_count"] == 1
    assert by_name["Argentina"]["place_count"] == 1
    # The country being planned comes first even though counts would tie.
    assert rows[0]["name"] == "Brazil"
    assert rows[0]["on_route"] is True
    assert by_name["Argentina"]["on_route"] is False


def test_the_inbox_is_not_counted(client, auth, library):
    rows = client.get("/api/v1/explore/countries", headers=auth).json()

    # Six places exist; the untriaged one is not part of the library.
    assert sum(row["place_count"] for row in rows) == 5


def test_a_country_lists_cities_ranked_by_what_is_there(client, auth, library):
    rows = client.get("/api/v1/explore/cities", headers=auth, params={"country": "Brazil"}).json()

    assert [row["name"] for row in rows] == ["Rio de Janeiro", "Paraty"]
    assert rows[0]["place_count"] == 3
    assert rows[0]["clip_count"] == 1
    assert rows[1]["place_count"] == 1
    # Filtering by country means exactly that.
    assert all(row["country"] == "Brazil" for row in rows)


def test_the_country_filter_ignores_case(client, auth, library):
    rows = client.get("/api/v1/explore/cities", headers=auth, params={"country": "brazil"}).json()

    assert [row["name"] for row in rows] == ["Rio de Janeiro", "Paraty"]


def test_search_filters_the_city_list_live(client, auth, library):
    rows = client.get("/api/v1/explore/cities", headers=auth, params={"q": "par"}).json()

    assert [row["name"] for row in rows] == ["Paraty"]


def test_cities_can_be_ranked_by_clips_instead(client, auth, library):
    rows = client.get("/api/v1/explore/cities", headers=auth, params={"sort": "clips"}).json()

    assert rows[0]["name"] == "Rio de Janeiro"
    assert rows[0]["clip_count"] == 1


def test_an_unknown_sort_is_refused_rather_than_ignored(client, auth, library):
    response = client.get("/api/v1/explore/cities", headers=auth, params={"sort": "popularity"})

    assert response.status_code == 422


def test_a_city_on_the_route_is_marked(client, auth, library):
    rows = client.get("/api/v1/explore/cities", headers=auth).json()

    by_name = {row["name"]: row for row in rows}
    assert by_name["Rio de Janeiro"]["on_route"] is True
    assert by_name["Buenos Aires"]["on_route"] is False


def test_explore_needs_authentication(client, auth, library):
    assert client.get("/api/v1/explore/countries").status_code == 401
    assert client.get("/api/v1/explore/cities").status_code == 401


def test_an_empty_library_lists_nothing_rather_than_failing(client, auth):
    client.post("/api/v1/trips", headers=auth, json={"name": "Blank", "base_currency": "USD"})

    assert client.get("/api/v1/explore/countries", headers=auth).json() == []
    assert client.get("/api/v1/explore/cities", headers=auth).json() == []


def test_the_map_can_be_narrowed_to_one_city(client, auth, library):
    rio = client.get("/api/v1/map", headers=auth, params={"city": "Rio de Janeiro"}).json()

    names = sorted(f["properties"]["name"] for f in rio["features"])
    assert names == ["Aprazível", "Parque Lage", "Pedra do Sal"]


def test_the_city_filter_on_the_map_ignores_case_and_padding(client, auth, library):
    response = client.get("/api/v1/map", headers=auth, params={"city": "  paraty "}).json()

    assert [f["properties"]["name"] for f in response["features"]] == ["Casa do Alemão"]


def test_a_city_with_nothing_in_it_returns_an_empty_collection(client, auth, library):
    response = client.get("/api/v1/map", headers=auth, params={"city": "Lima"}).json()

    assert response["type"] == "FeatureCollection"
    assert response["features"] == []
