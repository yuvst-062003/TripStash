"""The media pipeline: several small free models, one at a time.

    ffmpeg ─┬─ audio  ─→ speech to text ─→ transcript + timestamps
            └─ frames ─→ dedupe ─→ OCR   ─→ on-screen text + timestamps
                                              ↓
                                   structured extraction (elsewhere)

Stages run sequentially and are individually skippable, which is what makes
this affordable on an ordinary CPU: only one model is resident at a time, and a
video with no speech simply skips the speech stage rather than failing.

Nothing here invents content. A stage that cannot run is recorded as skipped
with a reason, and the source stays recoverable in Inbox.
"""

from __future__ import annotations

import logging
import shutil
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

from app.media.asr import FasterWhisperReader, NullSpeechToText, SidecarSubtitleReader
from app.media.base import ProbeResult, StageResult, TextSegment
from app.media.ffmpeg_tools import FfmpegTools
from app.media.ocr import RapidOcrReader

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class MediaResult:
    transcript: str | None = None
    ocr_text: str | None = None
    duration_seconds: float | None = None
    width: int | None = None
    height: int | None = None
    stages: list[StageResult] = field(default_factory=list)
    segments: list[TextSegment] = field(default_factory=list)

    @property
    def recovered_anything(self) -> bool:
        return bool(self.transcript or self.ocr_text)


def _timed(name: str, engine: str):
    """Small helper so every stage reports the same shape."""

    def make(status: str, started: float, detail: str | None = None,
             segments: list[TextSegment] | None = None) -> StageResult:
        return StageResult(
            name=name,
            engine=engine,
            status=status,
            duration_ms=int((time.perf_counter() - started) * 1000),
            detail=detail,
            segments=segments or [],
        )

    return make


class MediaPipeline:
    """Runs the stages over one uploaded file."""

    def __init__(
        self,
        *,
        enable_asr: bool = True,
        enable_ocr: bool = True,
        max_frames: int = 12,
        max_duration_seconds: float = 900.0,
        asr_model_size: str = "small",
    ) -> None:
        self.ffmpeg = FfmpegTools()
        self.ocr = RapidOcrReader()
        self.sidecar = SidecarSubtitleReader()
        self.asr = FasterWhisperReader(asr_model_size) if enable_asr else NullSpeechToText()
        self.enable_ocr = enable_ocr
        self.max_frames = max_frames
        self.max_duration_seconds = max_duration_seconds

    def run(self, media_path: Path, *, media_type: str | None = None) -> MediaResult:
        result = MediaResult()
        workspace = Path(tempfile.mkdtemp(prefix="tripstash-media-"))
        try:
            probe = self._probe(media_path, result)
            if result.duration_seconds and result.duration_seconds > self.max_duration_seconds:
                result.stages.append(
                    StageResult(
                        name="probe",
                        engine=self.ffmpeg.name,
                        status="failed",
                        detail=(
                            f"{result.duration_seconds:.0f}s is longer than the "
                            f"{self.max_duration_seconds:.0f}s limit. Trim it and try again."
                        ),
                    )
                )
                return result

            is_image = (media_type or "").startswith("image")
            if is_image:
                self._read_image(media_path, result)
            else:
                self._speech(media_path, workspace, result, probe)
                self._on_screen_text(media_path, workspace, result)
            return result
        finally:
            shutil.rmtree(workspace, ignore_errors=True)

    # -- stages ----------------------------------------------------------

    def _probe(self, media_path: Path, result: MediaResult) -> ProbeResult:
        stage = _timed("probe", self.ffmpeg.name)
        started = time.perf_counter()
        if not self.ffmpeg.available:
            result.stages.append(stage("skipped", started, "ffmpeg is not installed"))
            return ProbeResult()
        probe = self.ffmpeg.probe(media_path)
        result.duration_seconds = probe.duration_seconds
        result.width, result.height = probe.width, probe.height
        detail = " · ".join(
            part
            for part in (
                f"{probe.duration_seconds:.1f}s" if probe.duration_seconds else None,
                f"{probe.width}x{probe.height}" if probe.width else None,
                "audio" if probe.has_audio else "no audio",
            )
            if part
        )
        result.stages.append(stage("ok", started, detail or "probed"))
        return probe

    def _speech(
        self,
        media_path: Path,
        workspace: Path,
        result: MediaResult,
        probe: ProbeResult,
    ) -> None:
        # A subtitle file the traveller uploaded beats any transcription.
        sidecar = self.sidecar.transcribe(media_path)
        if sidecar:
            started = time.perf_counter()
            result.stages.append(
                _timed("speech", self.sidecar.name)(
                    "ok", started, f"{len(sidecar)} subtitle line(s)", sidecar
                )
            )
            self._absorb(result, sidecar, "transcript")
            return

        audio_stage = _timed("audio", self.ffmpeg.name)
        started = time.perf_counter()
        audio_path: Path | None = None
        if self.ffmpeg.available and probe.has_audio:
            audio_path = self.ffmpeg.extract_audio(media_path, workspace / "audio.wav")
        if audio_path is None:
            reason = "no audio track" if not probe.has_audio else "audio could not be extracted"
            result.stages.append(audio_stage("skipped", started, reason))
        else:
            size_kb = audio_path.stat().st_size // 1024
            result.stages.append(audio_stage("ok", started, f"16 kHz mono, {size_kb} KB"))

        speech_stage = _timed("speech", self.asr.name)
        started = time.perf_counter()
        if audio_path is None:
            result.stages.append(speech_stage("skipped", started, "no audio to transcribe"))
            return
        if not getattr(self.asr, "available", False):
            result.stages.append(
                speech_stage(
                    "skipped",
                    started,
                    "no speech model installed - install the `asr` extra, or upload a caption",
                )
            )
            return

        try:
            segments = self.asr.transcribe(audio_path)
        except Exception as exc:  # pragma: no cover - model runtime failure
            logger.warning("speech stage failed: %s", exc)
            result.stages.append(speech_stage("failed", started, str(exc)[:200]))
            return

        detail = (
            f"{len(segments)} segment(s)"
            if segments
            else "no speech found - music or silence, nothing invented"
        )
        result.stages.append(speech_stage("ok", started, detail, segments))
        self._absorb(result, segments, "transcript")

    def _on_screen_text(self, media_path: Path, workspace: Path, result: MediaResult) -> None:
        frames_stage = _timed("frames", self.ffmpeg.name)
        started = time.perf_counter()
        if not self.enable_ocr or not self.ffmpeg.available:
            result.stages.append(frames_stage("skipped", started, "frame sampling disabled"))
            return

        frames = self.ffmpeg.sample(
            media_path,
            workspace / "frames",
            limit=self.max_frames,
            duration_seconds=result.duration_seconds,
        )
        result.stages.append(
            frames_stage(
                "ok" if frames else "skipped",
                started,
                f"{len(frames)} frame(s) sampled across the clip",
            )
        )
        if not frames:
            return

        ocr_stage = _timed("on-screen text", self.ocr.name)
        started = time.perf_counter()
        if not self.ocr.available:
            result.stages.append(ocr_stage("skipped", started, "no OCR engine installed"))
            return

        try:
            segments = self.ocr.read(frames)
        except Exception as exc:  # pragma: no cover - reader runtime failure
            logger.warning("ocr stage failed: %s", exc)
            result.stages.append(ocr_stage("failed", started, str(exc)[:200]))
            return

        result.stages.append(
            ocr_stage("ok", started, f"{len(segments)} line(s) read", segments)
        )
        self._absorb(result, segments, "ocr")

    def _read_image(self, media_path: Path, result: MediaResult) -> None:
        """A screenshot is the same problem with one frame."""
        from app.media.base import Frame

        stage = _timed("on-screen text", self.ocr.name)
        started = time.perf_counter()
        if not self.ocr.available:
            result.stages.append(stage("skipped", started, "no OCR engine installed"))
            return
        segments = self.ocr.read([Frame(path=media_path, timestamp_seconds=0.0)])
        result.stages.append(stage("ok", started, f"{len(segments)} line(s) read", segments))
        self._absorb(result, segments, "ocr")

    # -- output ----------------------------------------------------------

    @staticmethod
    def _absorb(result: MediaResult, segments: list[TextSegment], target: str) -> None:
        if not segments:
            return
        result.segments.extend(segments)
        text = "\n".join(segment.text for segment in segments)
        if target == "transcript":
            result.transcript = text
        else:
            result.ocr_text = text


def attach_timestamps(quote: str, segments: list[TextSegment]) -> float | None:
    """Where in the media a quote came from.

    `Evidence.media_timestamp_seconds` has existed since the first commit and
    was always null, because nothing knew when a line was said or shown. With
    segments it can be filled, so a saved quote deep-links into the moment.
    """
    needle = " ".join(quote.split()).casefold()
    if not needle:
        return None
    for segment in segments:
        haystack = " ".join(segment.text.split()).casefold()
        if haystack and (haystack in needle or needle in haystack):
            return segment.start_seconds
    return None
