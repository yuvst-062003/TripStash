"""Reading the text burned into the picture.

On travel content this is frequently the *primary* channel rather than a
fallback: the audio is often music, while the place name, the price and the
handle are on screen as captions.

RapidOCR ships PP-OCRv4 inside its wheel, so this runs offline with no
download and no account, under a permissive licence.
"""

from __future__ import annotations

import logging
import time
from functools import lru_cache

from app.media.base import Frame, TextSegment
from app.media.frames import deduplicate

logger = logging.getLogger(__name__)

# Below this the reader is guessing, and a guess becomes a fabricated quote.
MIN_CONFIDENCE = 0.55
MIN_LENGTH = 3


@lru_cache(maxsize=1)
def _reader():
    from rapidocr_onnxruntime import RapidOCR

    return RapidOCR()


class RapidOcrReader:
    """PP-OCRv4 over the sampled frames."""

    name = "rapidocr"

    @property
    def available(self) -> bool:
        try:
            import rapidocr_onnxruntime  # noqa: F401

            return True
        except ImportError:
            return False

    def read(self, frames: list[Frame]) -> list[TextSegment]:
        if not frames or not self.available:
            return []

        by_path = {frame.path: frame for frame in frames}
        distinct = deduplicate([frame.path for frame in frames])
        logger.info("ocr: %s frame(s) after removing duplicates of %s", len(distinct), len(frames))

        reader = _reader()
        segments: list[TextSegment] = []
        seen: set[str] = set()

        for path in distinct:
            frame = by_path[path]
            started = time.perf_counter()
            try:
                result, _ = reader(str(path))
            except Exception as exc:  # pragma: no cover - reader failure
                logger.warning("ocr failed on %s: %s", path.name, exc)
                continue
            logger.debug("ocr %s in %.2fs", path.name, time.perf_counter() - started)

            for _box, text, score in result or []:
                cleaned = " ".join(str(text).split())
                if len(cleaned) < MIN_LENGTH or float(score) < MIN_CONFIDENCE:
                    continue
                # A caption held across several frames is one fact, not three.
                key = cleaned.casefold()
                if key in seen:
                    continue
                seen.add(key)
                segments.append(
                    TextSegment(
                        text=cleaned,
                        start_seconds=frame.timestamp_seconds,
                        confidence=float(score),
                        channel="ocr",
                    )
                )
        return segments
