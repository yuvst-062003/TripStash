"""Near-duplicate frame removal.

A scene-change sample still returns the same shot several times when a caption
lingers. A difference hash costs nothing and removes most of the OCR work.
"""

from __future__ import annotations

from pathlib import Path

HASH_SIZE = 8
# Under this many differing bits, two frames are the same shot in practice.
SIMILAR_BITS = 6


def dhash(path: Path) -> int | None:
    """Row-wise difference hash: 64 bits describing gradients, not pixels."""
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover - optional dependency
        return None

    try:
        with Image.open(path) as image:
            resized = image.convert("L").resize((HASH_SIZE + 1, HASH_SIZE))
            pixels = list(resized.getdata())
    except Exception:  # pragma: no cover - unreadable frame
        return None

    bits = 0
    for row in range(HASH_SIZE):
        offset = row * (HASH_SIZE + 1)
        for column in range(HASH_SIZE):
            left = pixels[offset + column]
            right = pixels[offset + column + 1]
            bits = (bits << 1) | int(left > right)
    return bits


def deduplicate(paths: list[Path]) -> list[Path]:
    """Keep the first of each visually distinct shot, in order."""
    kept: list[Path] = []
    seen: list[int] = []
    for path in paths:
        digest = dhash(path)
        if digest is None:
            kept.append(path)
            continue
        if any(bin(digest ^ other).count("1") <= SIMILAR_BITS for other in seen):
            continue
        seen.append(digest)
        kept.append(path)
    return kept
