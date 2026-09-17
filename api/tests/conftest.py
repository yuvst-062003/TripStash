"""Test harness.

The database URL is set before `app` is imported, so the engine binds to a
throwaway SQLite file rather than the development database.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="tripstash-tests-"))
os.environ["TRIPSTASH_DATABASE_URL"] = f"sqlite+pysqlite:///{_TMP / 'test.db'}"
os.environ["TRIPSTASH_STORAGE_DIR"] = str(_TMP / "storage")
os.environ["TRIPSTASH_SECRET_KEY"] = "test-secret-key-not-for-production"
os.environ["TRIPSTASH_WORKER_INLINE"] = "true"
# The suite never reaches the network; link reading has its own stubbed tests.
os.environ["TRIPSTASH_LINK_FETCH_ENABLED"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app.db import SessionLocal, engine, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.base import Base  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_database():
    Base.metadata.drop_all(bind=engine)
    init_db()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def session():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    finally:
        db.close()


@pytest.fixture
def auth(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "traveller@example.com", "password": "a-long-enough-password"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def trip(client: TestClient, auth: dict[str, str]) -> dict:
    response = client.post(
        "/api/v1/trips",
        headers=auth,
        json={
            "name": "Central America",
            "base_currency": "USD",
            "total_budget": 6000,
            "interests": ["hiking", "food"],
        },
    )
    assert response.status_code == 201, response.text
    client.post(
        "/api/v1/trips/current/destinations",
        headers=auth,
        json={"name": "Antigua", "country": "Guatemala", "lat": 14.5586, "lon": -90.7295,
              "is_current": True},
    )
    return response.json()


REEL_TRANSCRIPT = (
    "Antigua is unreal. Go to Cerro de la Cruz just before sunset for the best view of "
    "the city. We stayed at Tremendo Hostel and the rooftop is great. Careful with the "
    "taxi scam at the bus terminal, they will overcharge you badly. The shuttle to Lake "
    "Atitlán costs Q150 and takes about three hours. Bring a headlamp and a warm layer "
    "if you plan the Acatenango Volcano hike."
)
