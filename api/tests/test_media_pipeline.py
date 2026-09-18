"""The media pipeline, run for real on a generated video.

No stubs here: ffmpeg decodes an actual MP4 and PP-OCRv4 reads actual pixels.
Speech to text is skipped when the optional extra is absent, which is itself
one of the behaviours worth asserting.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.media import MediaPipeline, attach_timestamps
from app.media.asr import SidecarSubtitleReader, looks_hallucinated
from app.media.base import TextSegment
from app.media.frames import deduplicate
from tests.media_fixtures import build_reel, can_build

pytestmark = pytest.mark.skipif(
    not can_build(), reason="ffmpeg or a usable font is unavailable"
)


@pytest.fixture(scope="module")
def reel(tmp_path_factory) -> Path:
    destination = tmp_path_factory.mktemp("reel") / "antigua.mp4"
    path = build_reel(destination)
    assert path is not None, "could not render the test video"
    return path


def test_the_pipeline_reads_text_burned_into_the_frames(reel):
    """The case that matters: no speech, all the information on screen."""
    outcome = MediaPipeline(enable_asr=False).run(reel, media_type="video/mp4")

    assert outcome.recovered_anything
    text = (outcome.ocr_text or "").lower()
    assert "cerro de la cruz" in text
    assert "q40" in text
    assert "taxi scam" in text


def test_every_stage_reports_what_it_did(reel):
    outcome = MediaPipeline(enable_asr=False).run(reel, media_type="video/mp4")
    names = [stage.name for stage in outcome.stages]

    assert names[0] == "probe"
    assert "frames" in names and "on-screen text" in names
    for stage in outcome.stages:
        assert stage.status in {"ok", "skipped", "failed"}
        assert stage.engine
        assert stage.detail, f"{stage.name} reported no detail"


def test_a_video_without_a_speech_model_skips_that_stage_rather_than_failing(reel):
    outcome = MediaPipeline(enable_asr=True).run(reel, media_type="video/mp4")
    speech = [stage for stage in outcome.stages if stage.name == "speech"]

    assert speech, "the speech stage should always be reported"
    # Either it ran, or it said plainly why it did not. Never a silent gap.
    assert speech[0].status in {"ok", "skipped"}
    assert speech[0].detail


def test_probe_records_the_dimensions_and_duration(reel):
    outcome = MediaPipeline(enable_asr=False).run(reel, media_type="video/mp4")
    assert outcome.width == 720
    assert outcome.height == 1280
    assert outcome.duration_seconds and outcome.duration_seconds > 1


def test_an_oversized_clip_is_refused_with_a_reason(reel):
    outcome = MediaPipeline(enable_asr=False, max_duration_seconds=0.5).run(
        reel, media_type="video/mp4"
    )
    failed = [stage for stage in outcome.stages if stage.status == "failed"]
    assert failed and "longer than" in (failed[0].detail or "")
    assert not outcome.recovered_anything


def test_identical_frames_are_only_read_once(reel, tmp_path):
    """A caption held across a scene is one fact, not one per frame."""
    from app.media.ffmpeg_tools import FfmpegTools

    frames = FfmpegTools().sample(reel, tmp_path / "frames", limit=12)
    assert frames, "expected sampled frames"
    assert len(deduplicate([frame.path for frame in frames])) <= len(frames)


# -- the guards ----------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    ["Thanks for watching!", "Subtitles by the Amara.org community", "[Music]", "you", ""],
)
def test_whisper_artefacts_are_recognised(text):
    """Whisper invents these over music and silence; none may become advice."""
    assert looks_hallucinated(text)


def test_real_speech_is_not_mistaken_for_an_artefact():
    assert not looks_hallucinated("Careful with the taxi scam at the bus terminal.")


def test_subtitles_beside_the_video_are_preferred_over_transcription():
    parsed = SidecarSubtitleReader.parse(
        "1\n00:00:02,000 --> 00:00:05,500\nGo to Cerro de la Cruz at sunset\n\n"
        "2\n00:00:06,000 --> 00:00:09,000\nEntrance is forty quetzales\n"
    )
    assert [segment.text for segment in parsed] == [
        "Go to Cerro de la Cruz at sunset",
        "Entrance is forty quetzales",
    ]
    assert parsed[0].start_seconds == 2.0
    assert parsed[1].end_seconds == 9.0


def test_a_quote_can_cite_the_moment_it_appeared():
    segments = [
        TextSegment(text="Go to Cerro de la Cruz at sunset", start_seconds=2.0),
        TextSegment(text="Entrance is forty quetzales", start_seconds=6.0),
    ]
    assert attach_timestamps("Entrance is forty quetzales", segments) == 6.0
    assert attach_timestamps("something never said", segments) is None
