"""Breaking a country down into its cities.

The globe presses into a country, the country shows its cities, and a city
shows what there is to do there. Each level has to answer honestly with
whatever it actually holds, which for a city the traveller planned but never
saved a reel about is their own note and nothing else.
"""

from __future__ import annotations

from tests.conftest import REEL_TRANSCRIPT


def _capture_guatemala(client, auth) -> None:
    client.post(
        "/api/v1/sources",
        headers=auth,
        json={
            "url": "https://www.tiktok.com/@backpackerlina/video/7301",
            "text": REEL_TRANSCRIPT,
            "title": "3 days in Antigua",
        },
    )
    for candidate in client.get("/api/v1/inbox", headers=auth).json():
        if candidate["type"] not in ("place", "accommodation") or not candidate["resolutions"]:
            continue
        client.post(
            f"/api/v1/candidates/{candidate['id']}/approve",
            headers=auth,
            json={"provider_place_id": candidate["resolutions"][0]["provider_place_id"]},
        )


def test_a_country_breaks_into_the_cities_it_holds(client, auth, trip):
    _capture_guatemala(client, auth)
    response = client.get("/api/v1/countries/guatemala/cities", headers=auth)
    assert response.status_code == 200, response.text

    cities = response.json()
    assert cities, "Guatemala should hold at least the fixture's stop"
    names = {city["name"] for city in cities}
    assert "Antigua" in names


def test_a_planned_city_appears_even_with_nothing_saved(client, auth, trip):
    """A stop you planned is a place you can press, saved reel or not."""
    cities = client.get("/api/v1/countries/guatemala/cities", headers=auth).json()
    antigua = next(city for city in cities if city["name"] == "Antigua")

    assert antigua["in_route"] is True
    assert antigua["place_count"] == 0
    assert antigua["video_count"] == 0


def test_a_city_is_explained_in_the_travellers_own_words_first(client, auth, trip):
    """Their note outranks anything generated. The fixture writes one."""
    client.post(
        "/api/v1/trips/current/destinations",
        headers=auth,
        json={
            "name": "Lanquín",
            "country": "Guatemala",
            "lat": 15.575,
            "lon": -89.98,
            "notes": "2-3 days, Semuc Champey and the caves",
        },
    )
    cities = client.get("/api/v1/countries/guatemala/cities", headers=auth).json()
    lanquin = next(city for city in cities if city["name"] == "Lanquín")

    assert lanquin["explanation"] == "2-3 days, Semuc Champey and the caves"
    assert lanquin["explanation_source"] == "you"


def test_a_city_with_no_note_says_where_its_explanation_came_from(client, auth, trip):
    _capture_guatemala(client, auth)
    cities = client.get("/api/v1/countries/guatemala/cities", headers=auth).json()
    for city in cities:
        # Either the traveller wrote it, or it came from sources, or there is
        # honestly nothing yet. Never an unattributed sentence.
        assert city["explanation_source"] in ("you", "sources", "none")
        if city["explanation_source"] == "none":
            assert not city["explanation"]


def test_every_city_can_be_placed_on_a_map(client, auth, trip):
    _capture_guatemala(client, auth)
    for city in client.get("/api/v1/countries/guatemala/cities", headers=auth).json():
        assert city["lat"] is not None and city["lon"] is not None, city["name"]


def test_a_country_with_nothing_is_not_an_error(client, auth, trip):
    """An unexplored country answers with an empty list, never a 404."""
    response = client.get("/api/v1/countries/belize/cities", headers=auth)
    assert response.status_code == 200
    assert response.json() == []


def test_cities_carry_the_facets_present_in_them(client, auth, trip):
    """The filter strip is built from what a city actually holds."""
    _capture_guatemala(client, auth)
    cities = client.get("/api/v1/countries/guatemala/cities", headers=auth).json()
    antigua = next(city for city in cities if city["name"] == "Antigua")

    # Kinds are place categories; a chip that returns nothing is never offered.
    assert isinstance(antigua["kinds"], list)
    for kind in antigua["kinds"]:
        assert kind and kind == kind.lower()


def test_one_travellers_cities_are_not_anothers(client, auth, trip):
    _capture_guatemala(client, auth)
    other = client.post(
        "/api/v1/auth/register",
        json={"email": "cities-other@example.com", "password": "another-long-password"},
    )
    other_auth = {"Authorization": f"Bearer {other.json()['access_token']}"}
    client.post("/api/v1/trips", headers=other_auth, json={"name": "Another trip"})
    assert client.get("/api/v1/countries/guatemala/cities", headers=other_auth).json() == []


def test_a_city_reports_what_was_found_so_the_map_can_draw_the_difference(client, auth, trip):
    """The map draws an inked mark for a clip of yours and a dry one for a clip
    the app found. Without this count every city reads as entirely the
    traveller's own, which is the one thing the distinction exists to prevent.
    """
    _capture_guatemala(client, auth)
    cities = client.get("/api/v1/countries/guatemala/cities", headers=auth).json()
    assert cities, "the capture should have produced at least one city"
    for city in cities:
        assert "found_count" in city
        assert city["found_count"] <= city["video_count"]
