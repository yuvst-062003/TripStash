"""An alternative: kept on the trip, with its places, but not travelled."""

from __future__ import annotations


def _add(client, auth, name, nights=None):
    body = {"name": name, "country": "Mexico", "lat": 17.0, "lon": -96.7}
    if nights is not None:
        body["nights"] = nights
    response = client.post("/api/v1/trips/current/destinations", headers=auth, json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_an_alternative_leaves_the_route_and_its_dates(client, auth, trip):
    client.patch("/api/v1/trips/current", headers=auth, json={"start_date": "2027-01-01"})
    first = client.get("/api/v1/trips/current", headers=auth).json()["destinations"][0]["id"]
    client.patch(f"/api/v1/trips/current/destinations/{first}", headers=auth, json={"nights": 3})
    oaxaca = _add(client, auth, "Oaxaca")

    route = client.patch(
        f"/api/v1/trips/current/destinations/{oaxaca}", headers=auth, json={"on_route": False}
    ).json()

    assert [s["destination"]["name"] for s in route["stops"]] == ["Antigua"]
    assert [a["name"] for a in route["alternatives"]] == ["Oaxaca"]
    # Undecided nights on an alternative no longer erase the trip's end.
    assert route["end_date"] == "2027-01-04"
    checks = client.get("/api/v1/trips/current/checks", headers=auth).json()
    assert not any(c["destination_id"] == oaxaca for c in checks)


def test_putting_it_back_restores_the_stay_it_had(client, auth, trip):
    stop = _add(client, auth, "Oaxaca", nights=4)
    client.patch(
        f"/api/v1/trips/current/destinations/{stop}", headers=auth, json={"on_route": False}
    )

    route = client.patch(
        f"/api/v1/trips/current/destinations/{stop}", headers=auth, json={"on_route": True}
    ).json()

    back = next(s for s in route["stops"] if s["destination"]["id"] == stop)
    assert back["nights"] == 4
    assert route["alternatives"] == []


def test_a_plans_alternatives_are_recognised_once_on_upgrade(tmp_path):
    """Databases from before this column marked alternatives by their note."""
    from sqlalchemy import create_engine, text

    from app import db

    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE destination (id TEXT, nights INTEGER, arrive_on DATE, "
                "depart_on DATE, notes TEXT)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO destination VALUES "
                "('a', NULL, NULL, NULL, 'אלטרנטיבה · הוצאה מהמסלול'),"
                "('b', NULL, NULL, NULL, 'Alternative · cut'),"
                "('c', NULL, NULL, NULL, 'not decided yet'),"
                "('d', 4, '2027-01-01', '2027-01-05', 'Alternative wording but dated')"
            )
        )
    original = db.engine
    db.engine = engine
    try:
        db._add_missing_columns()
    finally:
        db.engine = original
    with engine.begin() as conn:
        rows = dict(conn.execute(text("SELECT id, on_route FROM destination")).all())
    assert rows == {"a": 0, "b": 0, "c": 1, "d": 1}
