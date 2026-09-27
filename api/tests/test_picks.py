"""Which activity types a trip is about.

Picks filter; they never score. The tests pin both halves of that: the
vocabulary is stable, and an empty set of picks is not the same as a filter
that matches nothing.
"""

from app.services.activities import ACTIVITIES, ACTIVITY_SLUGS


def test_the_vocabulary_is_stable_and_lowercase():
    assert len(ACTIVITIES) == 12
    for activity in ACTIVITIES:
        assert activity.slug == activity.slug.lower()
        assert activity.slug.replace("_", "").isalpha()
        assert activity.label and activity.label[0].isupper()
    assert len(ACTIVITY_SLUGS) == len(ACTIVITIES)
    assert "hike" in ACTIVITY_SLUGS
    assert "surf" in ACTIVITY_SLUGS


def test_a_pick_is_stored_once_per_trip(client, auth, trip):
    first = client.put("/api/v1/activities", headers=auth, json={"slugs": ["hike", "surf"]})
    assert first.status_code == 200, first.text
    assert sorted(first.json()["picked"]) == ["hike", "surf"]

    # Putting again replaces rather than accumulating.
    second = client.put("/api/v1/activities", headers=auth, json={"slugs": ["hike"]})
    assert second.json()["picked"] == ["hike"]

    read = client.get("/api/v1/activities", headers=auth)
    assert read.json()["picked"] == ["hike"]
    assert len(read.json()["available"]) == 12


def test_the_same_slug_twice_picks_it_once(client, auth, trip):
    response = client.put("/api/v1/activities", headers=auth, json={"slugs": ["surf", "surf"]})
    assert response.json()["picked"] == ["surf"]


def test_an_unknown_slug_is_refused(client, auth, trip):
    response = client.put("/api/v1/activities", headers=auth, json={"slugs": ["parkour"]})
    assert response.status_code == 422
    assert "parkour" in response.text


def test_picking_nothing_is_allowed_and_means_no_filter(client, auth, trip):
    client.put("/api/v1/activities", headers=auth, json={"slugs": ["hike"]})
    cleared = client.put("/api/v1/activities", headers=auth, json={"slugs": []})
    assert cleared.status_code == 200
    assert cleared.json()["picked"] == []


def test_one_travellers_picks_are_not_anothers(client, auth, trip):
    client.put("/api/v1/activities", headers=auth, json={"slugs": ["hike", "surf"]})
    other = client.post(
        "/api/v1/auth/register",
        json={"email": "picks-other@example.com", "password": "another-long-password"},
    )
    other_auth = {"Authorization": f"Bearer {other.json()['access_token']}"}
    client.post("/api/v1/trips", headers=other_auth, json={"name": "Another trip"})
    assert client.get("/api/v1/activities", headers=other_auth).json()["picked"] == []
