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
