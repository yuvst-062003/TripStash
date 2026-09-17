"""AI adapters: structured extraction and media understanding.

`FakeAIAdapter` is a deterministic rule-based extractor. It is not a stand-in
for a model's judgement - it exists so the pipeline, the review screen and the
tests can be exercised end to end with no API key, and so the typed contract in
app/schemas/extraction.py is pinned by something executable.
"""

from __future__ import annotations

import re
from datetime import date

from app.adapters.base import MediaPayload
from app.adapters.gazetteer import DESTINATION_HINTS, GAZETTEER
from app.models.enums import KnowledgeType, PlaceCategory
from app.schemas.extraction import (
    Evidence,
    ExtractionResult,
    KnowledgeCandidate,
    PlaceCandidate,
)
from app.services.text import normalize_name

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
_TRIGGER_PLACE = re.compile(
    r"(?:go to|visit|check out|stop at|head to|stay at|eat at|don't miss|do not miss|"
    r"must see|must visit|try)\s+((?:[A-Z][\w'’\-]*\s?){1,5})"
)
_PRICE = re.compile(
    r"(?:[$€£]\s?\d[\d,.]*|\b(?:Q|MXN|USD|EUR|GBP|COP|GTQ|THB)\s?\d[\d,.]*|"
    r"\b\d[\d,.]*\s?(?:quetzales|pesos|dollars|euros|baht|usd|q)\b)",
    re.IGNORECASE,
)

# Ordered by priority: the first rule a sentence matches claims it.
_RULES: list[tuple[KnowledgeType, str, re.Pattern[str], bool]] = [
    (
        KnowledgeType.SAFETY,
        "safety",
        re.compile(
            r"\b(scam|scammed|rip off|ripped off|robbed|robbery|theft|pickpocket|"
            r"unsafe|dangerous|danger|careful|be aware|avoid|don't walk|do not walk|"
            r"overcharge|fake guide|watch out)\b",
            re.IGNORECASE,
        ),
        True,
    ),
    (
        KnowledgeType.BORDER,
        "entry",
        re.compile(
            r"\b(visa|border|immigration|customs|entry stamp|exit fee|onward ticket|"
            r"proof of onward|passport control|crossing)\b",
            re.IGNORECASE,
        ),
        True,
    ),
    (
        KnowledgeType.TRANSPORT,
        "transport",
        re.compile(
            r"\b(shuttle|chicken bus|colectivo|collectivo|minibus|bus|ferry|boat|lancha|"
            r"tuk tuk|taxi|uber|didi|grab|metro|airport transfer|flight|overnight bus)\b",
            re.IGNORECASE,
        ),
        False,
    ),
    (
        KnowledgeType.PACKING,
        "packing",
        re.compile(
            r"\b(bring|pack|packing|wear|layers|headlamp|head torch|rain jacket|"
            r"sunscreen|water bottle|hiking boots|sleeping bag|power bank)\b",
            re.IGNORECASE,
        ),
        False,
    ),
    (
        KnowledgeType.ROUTE,
        "route",
        re.compile(
            r"\b(route|itinerary|day \d|then head|loop|first stop|next stop|"
            r"\d+\s?(?:days|weeks) in)\b",
            re.IGNORECASE,
        ),
        False,
    ),
    (
        KnowledgeType.ACCOMMODATION,
        "stay",
        re.compile(
            r"\b(hostel|hotel|guesthouse|guest house|dorm|airbnb|homestay)\b", re.IGNORECASE
        ),
        False,
    ),
    (
        KnowledgeType.GENERAL,
        "tip",
        re.compile(
            r"\b(tip|pro tip|recommend|underrated|worth it|best time|book ahead)\b",
            re.IGNORECASE,
        ),
        False,
    ),
]

_CATEGORY_BY_GAZETTEER = {entry["provider_place_id"]: entry["category"] for entry in GAZETTEER}

_TEXTUAL_MEDIA = {"text/plain", "text/vtt", "application/x-subrip", "text/markdown"}
_TEXTUAL_SUFFIXES = (".txt", ".md", ".vtt", ".srt", ".json")


def _sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SENTENCE_SPLIT.split(text) if p and p.strip()]
    return [p for p in parts if len(p) > 3]


def _shorten(text: str, limit: int = 120) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rsplit(" ", 1)[0] + "…"


def _gist(sentence: str, limit: int = 58) -> str:
    """A short label for the review screen.

    The card already shows the full sentence and the quote it came from, so a
    title that repeats either is noise. This takes the leading clause and
    trims it to something scannable.
    """
    cleaned = re.sub(r"\s+", " ", sentence).strip().rstrip(".!?")
    for separator in (" — ", " - ", ", and ", "; ", ", but ", ", so "):
        head = cleaned.split(separator)[0]
        if 12 <= len(head) < len(cleaned):
            cleaned = head
            break
    if len(cleaned) <= limit:
        return cleaned[:1].upper() + cleaned[1:]
    clipped = cleaned[:limit].rsplit(" ", 1)[0]
    return (clipped[:1].upper() + clipped[1:]) + "…"


def _destination_scope(text: str) -> str | None:
    lowered = normalize_name(text)
    for hint in DESTINATION_HINTS:
        if normalize_name(hint) in lowered:
            return hint.title()
    for entry in GAZETTEER:
        if normalize_name(entry["name"]) in lowered and entry.get("city"):
            return entry["city"]
    return None


class FakeAIAdapter:
    """Rule-based typed extraction over whatever text the pipeline obtained."""

    name = "fake"

    def transcribe(self, payload: MediaPayload) -> tuple[str | None, str | None]:
        """Decode text-bearing uploads; refuse to invent a transcript.

        A binary video or photo returns (None, None) so the source lands in
        Inbox with a retry and manual-entry path (spec 12) instead of being
        silently completed with fabricated content.
        """
        raw = payload.text
        is_textual = (payload.media_type in _TEXTUAL_MEDIA) or (
            payload.filename or ""
        ).lower().endswith(_TEXTUAL_SUFFIXES)
        if raw and is_textual:
            return raw, None
        return None, None

    def extract(self, payload: MediaPayload) -> ExtractionResult:
        channels: list[tuple[str, str]] = []
        if payload.text:
            channels.append(("caption" if payload.url else "text", payload.text))
        if payload.transcript:
            channels.append(("transcript", payload.transcript))
        if payload.ocr_text:
            channels.append(("ocr", payload.ocr_text))

        if not channels:
            return ExtractionResult(
                failure_reason=(
                    "No readable text, transcript or OCR output was available for this "
                    "source. It stays in Inbox - add a caption, screenshot or note, or "
                    "enter the place manually."
                )
            )

        combined = "\n".join(text for _, text in channels)
        scope = _destination_scope(combined)
        candidates: list[KnowledgeCandidate] = []
        candidates.extend(self._place_candidates(channels, scope))
        candidates.extend(self._knowledge_candidates(channels, scope))

        return ExtractionResult(
            title=payload.filename or (payload.url or None),
            summary=_shorten(combined, 220),
            candidates=candidates,
        )

    # -- places ----------------------------------------------------------

    def _place_candidates(
        self, channels: list[tuple[str, str]], scope: str | None
    ) -> list[KnowledgeCandidate]:
        found: dict[str, KnowledgeCandidate] = {}

        for channel, text in channels:
            normalized = normalize_name(text)
            penalty = 0.0 if channel in ("text", "caption") else 0.05

            for entry in GAZETTEER:
                names = [entry["name"], *entry.get("aliases", [])]
                hit = next((n for n in names if normalize_name(n) in normalized), None)
                if not hit:
                    continue
                key = entry["provider_place_id"]
                if key in found:
                    continue
                quote = self._quote_containing(text, hit) or hit
                category = _CATEGORY_BY_GAZETTEER.get(key, "other")
                found[key] = KnowledgeCandidate(
                    type=(
                        KnowledgeType.ACCOMMODATION
                        if category == "accommodation"
                        else KnowledgeType.PLACE
                    ),
                    title=entry["name"],
                    body=_shorten(quote, 240),
                    category=category,
                    destination_scope=entry.get("city") or scope,
                    confidence=round(0.9 - penalty, 3),
                    evidence=[Evidence(quote=_shorten(quote, 400), channel=channel)],
                    place=PlaceCandidate(
                        name=entry["name"],
                        category=PlaceCategory(category),
                        city_hint=entry.get("city"),
                        country_hint=entry.get("country"),
                        provider="fake",
                        provider_place_id=key,
                    ),
                )

            for match in _TRIGGER_PLACE.finditer(text):
                raw_name = match.group(1).strip(" ,.;:")
                if len(raw_name) < 3:
                    continue
                key = f"phrase:{normalize_name(raw_name)}"
                if key in found or any(
                    normalize_name(raw_name) == normalize_name(c.title) for c in found.values()
                ):
                    continue
                quote = self._quote_containing(text, match.group(0)) or match.group(0)
                found[key] = KnowledgeCandidate(
                    type=KnowledgeType.PLACE,
                    title=raw_name,
                    body=_shorten(quote, 240),
                    category=None,
                    destination_scope=scope,
                    # Low on purpose: an unresolved proper noun is a guess and
                    # the review screen must show it as one.
                    confidence=round(0.45 - penalty, 3),
                    evidence=[Evidence(quote=_shorten(quote, 400), channel=channel)],
                    place=PlaceCandidate(name=raw_name, city_hint=scope),
                )

        return list(found.values())

    # -- non-place knowledge ---------------------------------------------

    def _knowledge_candidates(
        self, channels: list[tuple[str, str]], scope: str | None
    ) -> list[KnowledgeCandidate]:
        out: list[KnowledgeCandidate] = []
        seen: set[str] = set()

        for channel, text in channels:
            penalty = 0.0 if channel in ("text", "caption") else 0.05
            for sentence in _sentences(text):
                candidate = self._classify(sentence, channel, penalty, scope)
                if candidate is None:
                    continue
                key = f"{candidate.type}:{normalize_name(candidate.title)}"
                if key in seen:
                    continue
                seen.add(key)
                out.append(candidate)
        return out

    def _classify(
        self, sentence: str, channel: str, penalty: float, scope: str | None
    ) -> KnowledgeCandidate | None:
        price_hit = _PRICE.search(sentence)

        for knowledge_type, category, pattern, official in _RULES:
            match = pattern.search(sentence)
            if not match:
                continue
            # A price mentioned inside a transport or stay tip stays with that
            # tip; a bare number sentence becomes its own price estimate below.
            confidence = round(min(0.8, 0.55 + 0.05 * len(pattern.findall(sentence))) - penalty, 3)
            return KnowledgeCandidate(
                type=knowledge_type,
                # The type chip already says what this is; the title is a gist.
                title=_gist(sentence),
                body=sentence.strip(),
                category=category,
                destination_scope=_destination_scope(sentence) or scope,
                confidence=confidence,
                evidence=[Evidence(quote=_shorten(sentence, 400), channel=channel)],
                requires_official_verification=official,
            )

        if price_hit:
            return KnowledgeCandidate(
                type=KnowledgeType.PRICE,
                title=_gist(sentence),
                body=sentence.strip(),
                category="price",
                destination_scope=_destination_scope(sentence) or scope,
                # Prices from creators are estimates until a provider confirms.
                confidence=round(0.55 - penalty, 3),
                evidence=[Evidence(quote=_shorten(sentence, 400), channel=channel)],
            )
        return None

    @staticmethod
    def _quote_containing(text: str, needle: str) -> str | None:
        for sentence in _sentences(text):
            if normalize_name(needle) in normalize_name(sentence):
                return sentence
        return None


class AnthropicAIAdapter:
    """Real extraction through the Claude API.

    Deliberately thin: it hands the model the same schema the fake adapter
    fills in, and validates the reply against it, so a malformed or refused
    response fails loudly rather than reaching the review screen.
    """

    name = "anthropic"

    def __init__(self, api_key: str, model: str) -> None:
        self.api_key = api_key
        self.model = model

    def transcribe(self, payload: MediaPayload) -> tuple[str | None, str | None]:
        raise NotImplementedError(
            "Wire a speech-to-text and OCR provider before enabling the anthropic adapter."
        )

    def extract(self, payload: MediaPayload) -> ExtractionResult:
        raise NotImplementedError(
            "Set TRIPSTASH_AI_PROVIDER=fake, or implement this call against the "
            "Claude API using app/schemas/extraction.ExtractionResult as the tool schema."
        )


def today() -> date:
    from datetime import UTC, datetime

    return datetime.now(UTC).date()
