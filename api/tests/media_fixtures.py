"""Builds a stand-in travel Reel: burned-in captions, no speech.

This is the hard case and the common one. The audio on a Reel is usually music,
while the place name and the price are text on the screen, so a pipeline that
only listens recovers nothing.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]

SCENES = [
    ["CERRO DE LA CRUZ", "sunset spot in Antigua"],
    ["Rainbow Cafe", "cheap breakfast", "entrance Q40"],
    ["watch the taxi scam", "at the bus terminal"],
]


def _font_path() -> str | None:
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    found = list(Path("/usr/share/fonts").rglob("*.ttf"))
    return str(found[0]) if found else None


def ffmpeg_exe() -> str | None:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg")


def can_build() -> bool:
    try:
        import PIL  # noqa: F401
    except ImportError:
        return False
    return ffmpeg_exe() is not None and _font_path() is not None


def build_reel(destination: Path, *, seconds_per_scene: int = 2) -> Path | None:
    """Render the scenes with Pillow, then encode them into a silent MP4."""
    if not can_build():
        return None

    from PIL import Image, ImageDraw, ImageFont

    font_path = _font_path()
    frames_dir = destination.parent / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    index = 0
    for scene_number, lines in enumerate(SCENES):
        image = Image.new("RGB", (720, 1280), (22 + scene_number * 26, 70, 58))
        draw = ImageDraw.Draw(image)
        y = 420
        for position, line in enumerate(lines):
            size = 58 if position == 0 else 40
            draw.text((60, y), line, font=ImageFont.truetype(font_path, size), fill="white")
            y += size + 30
        # Repeated frames give the encoder something to hold each scene on.
        for _ in range(seconds_per_scene):
            image.save(frames_dir / f"f_{index:04d}.png")
            index += 1

    result = subprocess.run(
        [
            ffmpeg_exe(), "-y", "-loglevel", "error",
            "-framerate", "1",
            "-i", str(frames_dir / "f_%04d.png"),
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            str(destination),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0 or not destination.exists():
        return None
    return destination
