"""One container serving both the API and the built PWA.

This is the shape a single-service host runs: no nginx, no second origin, so
the API has to hand out the app shell without ever shadowing an API route.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.web import mount_web


@pytest.fixture
def served(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>TripStash</title>")
    (tmp_path / "assets" / "index-abc123.js").write_text("console.log('bundle')")
    (tmp_path / "sw.js").write_text("self.addEventListener('fetch', () => {})")

    app = FastAPI()

    @app.get("/api/v1/places")
    def places() -> list[str]:
        return ["a real route"]

    assert mount_web(app, tmp_path)
    return TestClient(app)


def test_the_api_still_wins_over_the_app_shell(served):
    assert served.get("/api/v1/places").json() == ["a real route"]


def test_an_unknown_api_path_is_a_404_not_the_app_shell(served):
    """Returning HTML with a 200 would turn a typo into a silent parse error."""
    response = served.get("/api/v1/nope")

    assert response.status_code == 404
    assert "<!doctype html>" not in response.text


def test_a_client_side_route_gets_the_app_shell(served):
    for path in ("/", "/clips", "/clips/feed", "/places/abc123"):
        response = served.get(path)
        assert response.status_code == 200, path
        assert "TripStash" in response.text, path


def test_the_bundle_is_frozen_and_the_service_worker_is_not(served):
    """An update can never reach an installed device through a cached sw.js."""
    assert "immutable" in served.get("/assets/index-abc123.js").headers["cache-control"]
    assert "no-store" in served.get("/sw.js").headers["cache-control"]
    assert "no-store" in served.get("/").headers["cache-control"]


def test_a_path_that_climbs_out_of_the_build_gets_the_shell_not_the_file(served, tmp_path):
    secret = tmp_path.parent / "elsewhere.txt"
    secret.write_text("not yours")

    response = served.get("/../elsewhere.txt")

    assert response.status_code == 200
    assert "not yours" not in response.text


def test_no_web_app_is_served_when_nothing_was_built(tmp_path):
    assert mount_web(FastAPI(), tmp_path / "missing") is False


# ----------------------------------------------------- the database URL


@pytest.mark.parametrize(
    "given",
    ["postgres://u:p@host:5432/db", "postgresql://u:p@host:5432/db"],
)
def test_a_managed_postgres_url_can_be_pasted_in_untouched(given):
    """Railway, Render, Heroku and Neon all hand out a driverless URL."""
    assert Settings(database_url=given).database_url == "postgresql+psycopg://u:p@host:5432/db"


def test_an_explicit_driver_is_left_alone():
    given = "postgresql+asyncpg://u:p@host/db"
    assert Settings(database_url=given).database_url == given
