"""The capture and extraction pipeline."""

from __future__ import annotations

from app.adapters.ai import FakeAIAdapter
from app.adapters.base import MediaPayload
from app.models.enums import KnowledgeType
from tests.conftest import REEL_TRANSCRIPT


def test_one_source_yields_several_typed_items():
    """Spec 19.3: a single video is three places, a warning, a price and a tip."""
    result = FakeAIAdapter().extract(MediaPayload(kind="link", text=REEL_TRANSCRIPT))
    types = {c.type for c in result.candidates}

    assert KnowledgeType.PLACE in types
    assert KnowledgeType.ACCOMMODATION in types
    assert KnowledgeType.SAFETY in types
    assert KnowledgeType.TRANSPORT in types
    assert KnowledgeType.PACKING in types


def test_every_candidate_carries_evidence():
    result = FakeAIAdapter().extract(MediaPayload(kind="link", text=REEL_TRANSCRIPT))
    assert result.candidates
    for candidate in result.candidates:
        assert candidate.evidence, f"{candidate.title} has no evidence"
        assert candidate.evidence[0].quote.strip()
        assert 0.0 <= candidate.confidence <= 1.0


def test_border_advice_is_flagged_for_official_verification():
    result = FakeAIAdapter().extract(
        MediaPayload(kind="link", text="You need proof of onward travel at the border crossing.")
    )
    border = [c for c in result.candidates if c.type == KnowledgeType.BORDER]
    assert border and border[0].requires_official_verification


def test_unreadable_media_fails_recoverably_instead_of_inventing_content():
    """Spec 12: nothing is fabricated; the source stays in Inbox."""
    result = FakeAIAdapter().extract(MediaPayload(kind="video", filename="clip.mp4"))
    assert result.candidates == []
    assert result.failure_reason


def test_binary_media_is_not_given_a_made_up_transcript():
    transcript, ocr = FakeAIAdapter().transcribe(
        MediaPayload(kind="video", filename="clip.mp4", media_type="video/mp4", text="ignored")
    )
    assert transcript is None and ocr is None


def test_a_dated_festival_becomes_an_event_with_its_date():
    """Spec: things that happen are events, and the date comes through extraction."""
    from datetime import date

    from app.adapters.ai import FakeAIAdapter, parse_event_dates
    from app.adapters.base import MediaPayload

    assert parse_event_dates("Carnaval in Salvador is on 14 February 2027") == (
        date(2027, 2, 14),
        None,
    )
    start, end = parse_event_dates("the full moon party runs March 3-5, 2027")
    assert (start, end) == (date(2027, 3, 3), date(2027, 3, 5))
    assert parse_event_dates("a festival with no date") == (None, None)

    result = FakeAIAdapter().extract(
        MediaPayload(kind="note", text="Carnaval in Salvador is on 14 February 2027, wild.")
    )
    events = [c for c in result.candidates if c.type == "event"]
    assert len(events) == 1
    assert events[0].happens_on == date(2027, 2, 14)


def test_anthropic_adapter_maps_the_models_reply_onto_the_contract():
    """The real adapter validates the reply and drops any claim without a quote."""
    from datetime import date
    from types import SimpleNamespace

    from app.adapters.ai import AnthropicAIAdapter, _ExtractionOut
    from app.adapters.base import MediaPayload

    reply = _ExtractionOut.model_validate(
        {
            "title": "Carnaval weekend",
            "candidates": [
                {
                    "type": "event",
                    "title": "Carnaval in Salvador",
                    "body": "Carnaval in Salvador runs 14 to 17 February.",
                    "destination_scope": "Salvador",
                    "confidence": 0.8,
                    "happens_on": "2027-02-14",
                    "ends_on": "2027-02-17",
                    "evidence": [{"quote": "Carnaval in Salvador runs 14 to 17 February"}],
                },
                {
                    "type": "border",
                    "title": "Onward ticket",
                    "body": "They asked for proof of onward travel.",
                    "confidence": 0.6,
                    "evidence": [{"quote": "they asked for proof of onward travel"}],
                },
                {"type": "general", "title": "No quote, no claim", "confidence": 0.9},
            ],
        }
    )

    class Messages:
        def __init__(self):
            self.calls = []

        def parse(self, **kwargs):
            self.calls.append(kwargs)
            return SimpleNamespace(stop_reason="end_turn", parsed_output=reply)

    client = SimpleNamespace(messages=Messages())
    adapter = AnthropicAIAdapter(api_key="unused", model="claude-opus-5", client=client)
    result = adapter.extract(MediaPayload(kind="link", text="Carnaval in Salvador runs..."))

    assert [c.type for c in result.candidates] == ["event", "border"]
    assert result.candidates[0].happens_on == date(2027, 2, 14)
    assert result.candidates[0].ends_on == date(2027, 2, 17)
    assert result.candidates[1].requires_official_verification is True

    call = client.messages.calls[0]
    assert call["model"] == "claude-opus-5"
    assert call["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert call["output_format"] is _ExtractionOut

    empty = adapter.extract(MediaPayload(kind="video"))
    assert empty.candidates == [] and empty.failure_reason
