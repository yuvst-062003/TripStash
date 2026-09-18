"""Text normalisation shared by place resolution and deduplication.

Kept deterministic and dependency-free: the deduplication order in spec 10.3
puts fuzzy similarity last, as a candidate generator only, so this module
never needs to be clever.
"""

from __future__ import annotations

import re
import unicodedata

_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_SPACES = re.compile(r"\s+")

# Dropped before comparison so "Rainbow Café" and "Cafe Rainbow" still match.
_STOPWORDS = {
    "the", "a", "an", "de", "la", "el", "los", "las", "du", "le",
    "cafe", "restaurant", "bar", "hostel", "hotel", "volcano", "volcan",
    "park", "national", "lake", "lago", "mercado", "market",
}


def strip_accents(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def normalize_name(value: str) -> str:
    """Lowercase, accent-free, punctuation-free, single-spaced."""
    cleaned = _PUNCT.sub(" ", strip_accents(value).lower())
    return _SPACES.sub(" ", cleaned).strip()


def significant_tokens(value: str) -> set[str]:
    tokens = {t for t in normalize_name(value).split() if len(t) > 1}
    stripped = tokens - _STOPWORDS
    # Never return an empty set: "The Lake" must still compare as something.
    return stripped or tokens


def similarity(left: str, right: str) -> float:
    """Jaccard overlap of significant tokens, 0.0-1.0."""
    a, b = significant_tokens(left), significant_tokens(right)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    intersection = len(a & b)
    if not intersection:
        return 0.0
    return intersection / len(a | b)


def digits_only(value: str | None) -> str | None:
    if not value:
        return None
    digits = re.sub(r"\D", "", value)
    return digits or None


def normalize_website(value: str | None) -> str | None:
    if not value:
        return None
    host = re.sub(r"^https?://", "", value.strip().lower())
    host = host.split("/")[0]
    return host.removeprefix("www.") or None
