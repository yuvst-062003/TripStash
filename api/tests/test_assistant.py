

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

    # Either source counts. The free travel guide is tried first and usually
    # answers, so naming one tool here would pin the implementation rather
    # than the behaviour: what matters is that the question left the library.
    assert any(t.startswith(("guide:", "web:")) for t in answer["tools_used"])
    assert answer["cards"], "something beyond the library should have been read"


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
    """Checked for the meaning, not for one word.

    The answer may come from a free travel guide or from a search engine, and
    those disclaimers read differently. What must be true either way is that
    the traveller is told none of it is theirs and none of it is saved.
    """
    answer = client.post(
        "/api/v1/ask", headers=auth, json={"question": "What is there to do in Ljubljana?"}
    ).json()
    said = " ".join(answer["disclaimers"]).lower()
    assert "yours" in said
    assert "saved" in said


def test_the_library_is_still_answered_from_first(client, auth, trip):
    """The web is a fallback, not a first resort.

    Somewhere the traveller has saved things about must answer from those, or
    the app has stopped being about their own library.
    """
    answer = client.post(
        "/api/v1/ask", headers=auth, json={"question": "Why did I save Acatenango?"}
    ).json()
    assert not any(c.get("from_web") for c in answer["cards"])


# ---------------------------------------------------------------------------
# A typed question about somewhere unsaved
#
# "Is Tbilisi safe at night?" is a safety question, and safety questions take a
# different path that used to dead-end at "you have not saved any safety notes".
# The free travel guide has a "Stay safe" section, and its headings are already
# this app's knowledge types - so the right section can be handed back without
# anything having to infer what the paragraph is about.
# ---------------------------------------------------------------------------


def test_a_safety_question_about_an_unsaved_place_reaches_the_guide(client, auth, trip):
    answer = client.post(
        "/api/v1/ask", headers=auth, json={"question": "Is Antigua safe at night?"}
    ).json()

    assert any(t.startswith(("guide:", "web:")) for t in answer["tools_used"])
    assert answer["cards"], "the guide should have supplied something"


def test_a_typed_question_is_answered_with_that_type_first(client, auth, trip):
    """Asked about safety, lead with the safety section, not with sightseeing."""
    answer = client.post(
        "/api/v1/ask", headers=auth, json={"question": "Is Antigua safe at night?"}
    ).json()

    web = [c for c in answer["cards"] if c.get("from_web")]
    assert web
    assert web[0]["knowledge_type"] == "safety"


def test_the_guide_answer_is_still_never_presented_as_the_travellers(client, auth, trip):
    answer = client.post(
        "/api/v1/ask", headers=auth, json={"question": "Is Antigua safe at night?"}
    ).json()
    for card in answer["cards"]:
        if card.get("from_web"):
            assert card["yours"] is False
            assert "Wikivoyage" in card.get("attribution", "")


def test_a_typed_question_does_not_answer_with_a_note_about_somewhere_else(client, auth, trip):
    """Asked about Tbilisi, a note about Antigua is not an answer.

    The handler filtered saved notes by TYPE and never by place, so any safety
    question returned every safety note in the trip - which reads as an answer
    and is not one. Seeded here rather than assumed, because an empty trip
    falls through to the guide and hides the bug entirely.
    """
    seeded = client.post(
        "/api/v1/knowledge",
        headers=auth,
        json={
            "type": "safety",
            "title": "Watch your bag in Antigua",
            "body": "Busy market, keep it in front of you.",
            "destination_scope": "Antigua",
        },
    )
    assert seeded.status_code in (200, 201), seeded.text

    answer = client.post(
        "/api/v1/ask", headers=auth, json={"question": "Is Tbilisi safe at night?"}
    ).json()

    saved = [c for c in answer["cards"] if not c.get("from_web")]
    for card in saved:
        blob = f"{card.get('title', '')} {card.get('body', '')} {card.get('subtitle', '')}"
        assert "Tbilisi" in blob, f"asked about Tbilisi, answered with {card.get('title')!r}"
