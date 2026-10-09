"""Two things a guide-sourced answer has to say.

A visa or border question carries the official-verification warning whatever
answered it, and "nothing saved" names the topic that is missing rather than
the place, which may have plenty saved about it.
"""

from __future__ import annotations

from app.adapters.travel_wiki import heading_answers
from app.models.enums import KnowledgeType
from app.services.assistant import OFFICIAL_NOTE, _answer_from_the_web


def _ask(client, auth, question: str) -> dict:
    response = client.post("/api/v1/ask", headers=auth, json={"question": question})
    assert response.status_code == 200, response.text
    return response.json()


def _note(client, auth, **body) -> None:
    response = client.post("/api/v1/knowledge", headers=auth, json=body)
    assert response.status_code == 201, response.text


# ---------------------------------------------------------------- borders


def test_wikivoyage_keeps_visa_rules_under_get_in_so_that_section_answers_a_border_question():
    assert heading_answers("Get in", KnowledgeType.BORDER)
    assert heading_answers("Get in", KnowledgeType.TRANSPORT)
    assert not heading_answers("Sleep", KnowledgeType.BORDER)


def test_a_visa_question_answered_from_the_guide_carries_the_official_warning(
    client, auth, trip
):
    answer = _ask(client, auth, "Do I need a visa for Guatemala?")
    assert "guide:wikivoyage" in answer["tools_used"]
    assert OFFICIAL_NOTE in answer["disclaimers"]
    # The arrival section leads, because that is where the visa rules are.
    assert answer["cards"][0]["title"].endswith("get in")
    assert "nothing on" not in answer["answer"]


def test_a_visa_question_answered_from_saved_notes_still_carries_it(client, auth, trip):
    _note(
        client,
        auth,
        type="border",
        title="90 days on arrival",
        body="Guatemala stamps 90 days for the CA-4 region.",
        destination_scope="Guatemala",
    )
    answer = _ask(client, auth, "Do I need a visa for Guatemala?")
    assert OFFICIAL_NOTE in answer["disclaimers"]


def test_a_visa_question_nobody_can_answer_still_carries_it(client, auth, trip):
    # The fake guide has never heard of this place and the fake search finds
    # nothing: the warning is about the subject, not about who answered.
    answer = _ask(client, auth, "Do I need a visa for Xyzzyland?")
    assert OFFICIAL_NOTE in answer["disclaimers"]


# ---------------------------------------------------------------- wording


def test_nothing_saved_names_the_topic_not_the_place(client, auth, trip):
    """Plenty saved about Antigua, nothing on safety: say so exactly."""
    _note(
        client,
        auth,
        type="general",
        title="Bring a headlamp",
        body="For the Acatenango hike from Antigua.",
        destination_scope="Antigua",
    )
    answer = _ask(client, auth, "Is Antigua safe at night?")
    assert answer["answer"].startswith("Nothing saved about safety in Antigua yet")
    assert "Nothing saved about Antigua" not in answer["answer"]


def test_a_topic_the_guide_lacks_is_named_in_plain_words(trip):
    # The fake guide to Ljubljana has no "Buy" section, so the answer says
    # what is missing - in words, not in the enum's field name.
    answer = _answer_from_the_web("What do things cost in Ljubljana?", prefer=KnowledgeType.PRICE)
    assert answer.text.startswith("Nothing saved about prices in Ljubljana")
    assert "nothing on prices there either" in answer.text
