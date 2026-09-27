

# ---------------------------------------------------------------------------
# Asking about somewhere the library has never heard of
#
# Until now this was a dead end: "I only answer from your own trip records."
# True at the time, and useless to someone still deciding where to go.
# ---------------------------------------------------------------------------


def test_a_question_about_an_unsaved_place_reaches_the_web(client, auth, trip):
    answer = client.post(
        "/api/v1/ask",
        headers=auth,
        json={"question": "What is there to do in Ljubljana?"},
    ).json()

    assert "web:search" in answer["tools_used"]
    assert answer["cards"], "the web should have supplied something to read"


def test_everything_from_the_web_is_marked_as_not_the_travellers(client, auth, trip):
    answer = client.post(
        "/api/v1/ask", headers=auth, json={"question": "What is there to do in Ljubljana?"}
    ).json()

    web_cards = [c for c in answer["cards"] if c.get("from_web")]
    assert web_cards
    for card in web_cards:
        assert card["yours"] is False
        assert card["quote"], "a card with no quote is a claim with nothing behind it"
        assert card["provenance"] != "official"


def test_the_traveller_is_told_the_answer_left_their_library(client, auth, trip):
    answer = client.post(
        "/api/v1/ask", headers=auth, json={"question": "What is there to do in Ljubljana?"}
    ).json()
    assert any("web" in d.lower() for d in answer["disclaimers"])


def test_the_library_is_still_answered_from_first(client, auth, trip):
    """The web is a fallback, not a first resort.

    Somewhere the traveller has saved things about must answer from those, or
    the app has stopped being about their own library.
    """
    answer = client.post(
        "/api/v1/ask", headers=auth, json={"question": "Why did I save Acatenango?"}
    ).json()
    assert not any(c.get("from_web") for c in answer["cards"])
