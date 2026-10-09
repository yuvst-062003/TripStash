"""A stop added by name alone lands on the map.

The `+` on the trip screen sends only a name. Until this, the stop was stored
with no coordinates and no country: no pin, no legs ("Distance unknown"), no
fly-in, and no country page. Now the name is placed when the stop is added.
"""

from __future__ import annotations

from app.adapters.travel_wiki import Guide, WikivoyageTravelWiki, country_of


def _add(client, auth, **body) -> dict:
    response = client.post("/api/v1/trips/current/destinations", headers=auth, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_a_stop_added_by_name_alone_is_placed_and_given_a_country(client, auth, trip):
    stop = _add(client, auth, name="Flores")
    assert stop["lat"] is not None and stop["lon"] is not None
    assert stop["country"] == "Guatemala"


def test_a_placed_stop_gets_a_leg_from_the_stop_before_it(client, auth, trip):
    _add(client, auth, name="Flores")
    route = client.get("/api/v1/trips/current/route", headers=auth).json()
    leg = route["stops"][-1]["leg_in"]
    assert leg is not None and leg["distance_km"] is not None
    assert leg["distance_km"] > 100  # Antigua to Flores is most of Guatemala


def test_a_name_the_guide_does_not_know_falls_back_to_the_gazetteer(client, auth, trip):
    # The fake guide has never heard of Bacalar; the in-repo gazetteer has.
    stop = _add(client, auth, name="Bacalar")
    assert stop["lat"] is not None
    assert stop["country"] == "Mexico"


def test_an_unknown_name_is_still_added_rather_than_refused(client, auth, trip):
    """A place nobody can locate is still a place the traveller means to go.

    It is stored unplaced, and the route copes: no pin, an honest "distance
    unknown" leg, and no crash.
    """
    stop = _add(client, auth, name="Xyzzyville")
    assert stop["lat"] is None and stop["lon"] is None and stop["country"] is None
    route = client.get("/api/v1/trips/current/route", headers=auth)
    assert route.status_code == 200
    assert route.json()["stops"][-1]["leg_in"]["distance_km"] is None


def test_what_the_caller_sent_is_never_overwritten(client, auth, trip):
    """A caller that knows where the place is has said so; only blanks fill."""
    stop = _add(client, auth, name="Flores", lat=1.0, lon=2.0)
    assert (stop["lat"], stop["lon"]) == (1.0, 2.0)
    assert stop["country"] == "Guatemala"

    stop = _add(client, auth, name="Flores", country="Elsewhere")
    assert stop["country"] == "Elsewhere"
    assert stop["lat"] is not None


# ---------------------------------------------------------------------------
# Reading the country out of a Wikivoyage article
# ---------------------------------------------------------------------------


def test_the_iso_code_on_the_coordinates_wins_when_set():
    assert country_of("Somewhere", "Somewhere is a town in Peru.", "CO") == "Colombia"


def test_the_country_in_the_title_is_read_before_the_text():
    assert country_of("Flores (Guatemala)", "Flores is a town on an island.") == "Guatemala"
    assert country_of("Cartagena (Spain)", "Cartagena is a port in Murcia.") == "Spain"


def test_a_bracket_that_is_not_a_country_falls_through_to_the_opening_sentence():
    text = "Oaxaca is the colorful capital of the Mexican state of Oaxaca."
    assert country_of("Oaxaca (city)", text) == "Mexico"


def test_the_opening_sentence_names_the_country_the_place_is_in():
    assert country_of("Flores", "Flores is a town in Petén, Guatemala.") == "Guatemala"
    text = "Cartagena is a city on Colombia's Caribbean coast in the Bolívar."
    assert country_of("Cartagena", text) == "Colombia"


def test_an_article_about_a_country_is_in_that_country():
    assert country_of("Guatemala", "Guatemala is a country in Central America.") == "Guatemala"


def test_no_country_is_better_than_a_guessed_one():
    assert country_of("Xyzzyville", "Xyzzyville is a town somewhere.") is None


class _CannedWikivoyage(WikivoyageTravelWiki):
    """The real adapter with its one network call replaced by a table."""

    def __init__(self, pages: dict[str, dict], search: list[str]) -> None:
        super().__init__()
        self._pages = pages
        self._search = search

    def _get(self, params: dict[str, str]) -> dict:
        if params.get("list") == "search":
            return {"query": {"search": [{"title": t} for t in self._search]}}
        page = self._pages.get(params["titles"])
        return {"query": {"pages": {"1": page}}} if page else {}


def test_locate_skips_a_disambiguation_page_and_an_article_with_no_coordinates():
    wiki = _CannedWikivoyage(
        pages={
            "Flores": {"title": "Flores", "extract": "There's more than one place called Flores:"},
            "Flores (Indonesia)": {
                "title": "Flores (Indonesia)",
                "extract": "Flores is an island in Indonesia.",
            },
            "Flores (Guatemala)": {
                "title": "Flores (Guatemala)",
                "extract": "Flores is a town in Petén, Guatemala.",
                "coordinates": [{"lat": 16.93, "lon": -89.8833}],
            },
        },
        search=["Flores", "Flores (Indonesia)", "Flores (Guatemala)"],
    )
    found = wiki.locate("Flores")
    assert isinstance(found, Guide)
    assert found.title == "Flores (Guatemala)"
    assert (found.lat, found.lon, found.country) == (16.93, -89.8833, "Guatemala")


def test_locate_refuses_an_article_that_never_names_the_place_asked_for():
    """A search for a name nobody wrote about still returns something; a pin
    on it would be a confident wrong answer."""
    wiki = _CannedWikivoyage(
        pages={
            "Guatemala": {
                "title": "Guatemala",
                "extract": "Guatemala is a country in Central America.",
                "coordinates": [{"lat": 15.5, "lon": -90.25}],
            }
        },
        search=["Guatemala"],
    )
    assert wiki.locate("Xyzzyville") is None
