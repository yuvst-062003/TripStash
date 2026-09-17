"""Speech to text, and the guard that keeps it honest.

Whisper-family models hallucinate on silence and music - they emit subtitle
credits and "thanks for watching" over a soundtrack. On travel content, where
the audio is very often just music, an ungrounded transcript would become
fabricated travel advice. Two defences apply here: the no-speech probability
the model itself reports, and a denylist of the artefacts it invents.

A third defence sits downstream: the extractor only accepts claims whose quote
appears verbatim in the recovered text, so an invented line that survives this
module still cannot become a saved place.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from app.media.base import TextSegment

logger = logging.getLogger(__name__)

# The model is not confident anything was said.
MAX_NO_SPEECH = 0.6
MIN_AVG_LOGPROB = -1.0

# Phrases whisper produces from music and silence, not from speech.
HALLUCINATION_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"^thanks? for watching",
        r"^subscribe",
        r"^subtitles? by",
        r"^amara\.org",
        r"^transcription by",
        r"^\[?music\]?$",
        r"^\[?applause\]?$",
        r"^you$",
        r"^bye[.!]?$",
    )
]


def looks_hallucinated(text: str) -> bool:
    cleaned = text.strip()
    if len(cleaned) < 3:
        return True
    return any(pattern.match(cleaned) for pattern in HALLUCINATION_PATTERNS)


class SidecarSubtitleReader:
    """Reads a subtitle file the traveller uploaded alongside the video.

    Not a model, and the most reliable source there is: if a `.srt` or `.vtt`
    exists, it beats any transcription. Runs everywhere, costs nothing.
    """

    name = "sidecar-subtitles"

    @property
    def available(self) -> bool:
        return True

    def transcribe(self, audio_path: Path) -> list[TextSegment]:
        for suffix in (".srt", ".vtt"):
            candidate = audio_path.with_suffix(suffix)
            if candidate.exists():
                return self.parse(candidate.read_text(encoding="utf-8", errors="replace"))
        return []

    @staticmethod
    def parse(raw: str) -> list[TextSegment]:
        segments: list[TextSegment] = []
        timing = re.compile(
            r"(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*"
            r"(\d{2}):(\d{2}):(\d{2})[.,](\d{3})"
        )
        start: float | None = None
        end: float | None = None
        buffer: list[str] = []

        def flush() -> None:
            if buffer:
                text = " ".join(part.strip() for part in buffer if part.strip())
                if text:
                    segments.append(
                        TextSegment(text=text, start_seconds=start, end_seconds=end)
                    )
            buffer.clear()

        for line in raw.splitlines():
            match = timing.search(line)
            if match:
                flush()
                h1, m1, s1, ms1, h2, m2, s2, ms2 = (int(g) for g in match.groups())
                start = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000
                end = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000
                continue
            if not line.strip() or line.strip().isdigit() or line.startswith("WEBVTT"):
                flush()
                continue
            buffer.append(line)
        flush()
        return segments


class FasterWhisperReader:
    """Local speech to text. MIT licence, no account, runs on CPU.

    The model is fetched once on first use, which is the only step in this
    pipeline that needs a network connection.
    """

    name = "faster-whisper"

    def __init__(self, model_size: str = "small", compute_type: str = "int8") -> None:
        self.model_size = model_size
        self.compute_type = compute_type
        self._model = None

    @property
    def available(self) -> bool:
        try:
            import faster_whisper  # noqa: F401

            return True
        except ImportError:
            return False

    def _load(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                self.model_size, device="cpu", compute_type=self.compute_type
            )
        return self._model

    def transcribe(self, audio_path: Path) -> list[TextSegment]:
        if not self.available:
            return []

        model = self._load()
        raw_segments, info = model.transcribe(
            str(audio_path),
            vad_filter=True,
            beam_size=1,
            condition_on_previous_text=False,
        )
        logger.info("asr: detected language %s", getattr(info, "language", "?"))

        kept: list[TextSegment] = []
        for segment in raw_segments:
            text = (segment.text or "").strip()
            if looks_hallucinated(text):
                continue
            if getattr(segment, "no_speech_prob", 0.0) > MAX_NO_SPEECH:
                continue
            if getattr(segment, "avg_logprob", 0.0) < MIN_AVG_LOGPROB:
                continue
            kept.append(
                TextSegment(
                    text=text,
                    start_seconds=float(segment.start),
                    end_seconds=float(segment.end),
                )
            )
        return kept


class NullSpeechToText:
    """No transcription available; the source stays recoverable."""

    name = "none"
    available = True

    def transcribe(self, audio_path: Path) -> list[TextSegment]:
        del audio_path
        return []
