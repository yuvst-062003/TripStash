"""ffmpeg-backed probing, audio extraction and frame sampling.

The binary comes from the `imageio-ffmpeg` wheel, so there is no system
dependency to install and nothing to download at run time.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
from pathlib import Path

from app.media.base import Frame, ProbeResult

logger = logging.getLogger(__name__)

# A still frame every few seconds is the floor, so a video with no scene cuts
# still yields something to read.
FALLBACK_INTERVAL_SECONDS = 2.0
MIN_INTERVAL_SECONDS = 0.5
TIMEOUT_SECONDS = 180


def ffmpeg_path() -> str | None:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # pragma: no cover - optional dependency
        return shutil.which("ffmpeg")


def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args, capture_output=True, text=True, timeout=TIMEOUT_SECONDS, check=False
    )


class FfmpegTools:
    """Probe, demux and sample. One binary, three jobs."""

    name = "ffmpeg"

    def __init__(self) -> None:
        self.exe = ffmpeg_path()

    @property
    def available(self) -> bool:
        return self.exe is not None

    # -- probe -----------------------------------------------------------

    def probe(self, path: Path) -> ProbeResult:
        if not self.exe:
            return ProbeResult()

        # The static build ships ffprobe beside ffmpeg; fall back to parsing
        # ffmpeg's own stderr when it does not.
        probe_exe = self.exe.replace("ffmpeg", "ffprobe")
        if Path(probe_exe).exists():
            result = _run(
                [
                    probe_exe,
                    "-v", "quiet",
                    "-print_format", "json",
                    "-show_format",
                    "-show_streams",
                    str(path),
                ]
            )
            if result.returncode == 0:
                return self._parse_probe(result.stdout)

        return self._probe_via_ffmpeg(path)

    @staticmethod
    def _parse_probe(raw: str) -> ProbeResult:
        try:
            data = json.loads(raw)
        except ValueError:
            return ProbeResult()

        streams = data.get("streams", [])
        video = next((s for s in streams if s.get("codec_type") == "video"), None)
        duration = data.get("format", {}).get("duration")
        return ProbeResult(
            duration_seconds=float(duration) if duration else None,
            width=video.get("width") if video else None,
            height=video.get("height") if video else None,
            has_audio=any(s.get("codec_type") == "audio" for s in streams),
            has_video=video is not None,
        )

    def _probe_via_ffmpeg(self, path: Path) -> ProbeResult:
        """Read ffmpeg's own report of the file.

        The `imageio-ffmpeg` wheel ships ffmpeg without ffprobe, so this is the
        ordinary path rather than a rare fallback.
        """
        result = _run([self.exe, "-hide_banner", "-i", str(path)])
        text = result.stderr
        probe = ProbeResult(has_audio="Audio:" in text, has_video="Video:" in text)

        duration = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
        if duration:
            hours, minutes, seconds = duration.groups()
            probe.duration_seconds = int(hours) * 3600 + int(minutes) * 60 + float(seconds)

        # Dimensions appear in the video stream line as ", 720x1280 [SAR ...".
        size = re.search(r"Video:.*?,\s*(\d{2,5})x(\d{2,5})", text, re.S)
        if size:
            probe.width, probe.height = int(size.group(1)), int(size.group(2))
        return probe

    # -- audio -----------------------------------------------------------

    def extract_audio(self, path: Path, destination: Path) -> Path | None:
        """16 kHz mono WAV, which is what every local speech model expects."""
        if not self.exe:
            return None
        destination.parent.mkdir(parents=True, exist_ok=True)
        result = _run(
            [
                self.exe, "-y", "-loglevel", "error",
                "-i", str(path),
                "-vn", "-ac", "1", "-ar", "16000",
                "-f", "wav", str(destination),
            ]
        )
        if result.returncode != 0 or not destination.exists():
            logger.info("audio extraction failed: %s", result.stderr[:200])
            return None
        return destination

    # -- frames ----------------------------------------------------------

    def sample(
        self,
        path: Path,
        destination: Path,
        *,
        limit: int = 12,
        duration_seconds: float | None = None,
    ) -> list[Frame]:
        """Even-interval frames, capped, with exact timestamps.

        Sampling every frame is unaffordable - a sixty second clip is eighteen
        hundred images. Spreading `limit` frames across the duration costs a
        handful of OCR calls, never misses a scene, and gives each frame a
        timestamp that is exactly right, which is what lets a saved quote cite
        the moment it appeared. Visual redundancy is removed afterwards by the
        perceptual hash in `app.media.frames`.
        """
        if not self.exe:
            return []
        destination.mkdir(parents=True, exist_ok=True)

        if duration_seconds and duration_seconds > 0:
            interval = max(MIN_INTERVAL_SECONDS, duration_seconds / limit)
        else:
            interval = FALLBACK_INTERVAL_SECONDS

        pattern = destination / "frame_%04d.png"
        result = _run(
            [
                self.exe, "-y", "-loglevel", "error",
                "-i", str(path),
                "-vf", f"fps=1/{interval:.4f},scale='min(720,iw)':-2",
                "-frames:v", str(limit),
                str(pattern),
            ]
        )
        if result.returncode != 0:
            logger.info("frame sampling failed: %s", result.stderr[:200])
            return []

        files = sorted(destination.glob("frame_*.png"))
        # `fps` emits the first frame at t=0, then one every `interval`.
        return [
            Frame(path=file, timestamp_seconds=round(index * interval, 3))
            for index, file in enumerate(files)
        ]
