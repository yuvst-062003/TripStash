"""Contracts for the media understanding pipeline.

A video is not one problem but three - what was said, what was written on the
screen, and what is visible - and each wants a different, small, free model.
Every stage sits behind one of these protocols so it can be swapped, disabled
or stubbed without touching the pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol


@dataclass(slots=True)
class ProbeResult:
    """What the container says about itself, before anything is decoded."""

    duration_seconds: float | None = None
    width: int | None = None
    height: int | None = None
    has_audio: bool = False
    has_video: bool = False


@dataclass(slots=True)
class Frame:
    path: Path
    timestamp_seconds: float


@dataclass(slots=True)
class TextSegment:
    """A line of recovered text and where in the media it came from."""

    text: str
    start_seconds: float | None = None
    end_seconds: float | None = None
    confidence: float | None = None
    channel: str = "transcript"


@dataclass(slots=True)
class StageResult:
    """What one stage did, for the per-item status specification 7.5 requires."""

    name: str
    engine: str
    status: str  # ok | skipped | failed
    duration_ms: int = 0
    detail: str | None = None
    segments: list[TextSegment] = field(default_factory=list)


class MediaProbe(Protocol):
    name: str

    def probe(self, path: Path) -> ProbeResult: ...


class AudioExtractor(Protocol):
    name: str

    def extract_audio(self, path: Path, destination: Path) -> Path | None: ...


class FrameSampler(Protocol):
    name: str

    def sample(self, path: Path, destination: Path, *, limit: int) -> list[Frame]: ...


class SpeechToText(Protocol):
    name: str

    def transcribe(self, audio_path: Path) -> list[TextSegment]: ...


class FrameReader(Protocol):
    """Text burned into the picture: captions, prices, handles, signs."""

    name: str

    def read(self, frames: list[Frame]) -> list[TextSegment]: ...
