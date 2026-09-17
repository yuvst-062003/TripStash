"""AI adapters: structured extraction and media understanding.

`FakeAIAdapter` is a deterministic rule-based extractor. It is not a stand-in
for a model's judgement - it exists so the pipeline, the review screen and the
tests can be exercised end to end with no API key, and so the typed contract in
app/schemas/extraction.py is pinned by something executable.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Literal

from pydantic import BaseModel

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
_EVENT = re.compile(
    r"\b(festival|carnival|carnaval|fiesta|parade|full[- ]moon party|market day|"
    r"night market|concert|celebration|semana santa|d[ií]a de (los )?muertos|"
    r"fireworks|feria|procession)\b",
    re.IGNORECASE,
)
_MONTHS = (
    "january|february|march|april|may|june|july|august|september|october|november|december|"
    "jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec"
)
# "14 February", "February 14", "Feb 14-16", "on the 3rd of March", "2026-02-14".
_DATE_PATTERNS = (
    re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b"),
    re.compile(
        rf"\b(\d{{1,2}})(?:st|nd|rd|th)?(?: of)? ({_MONTHS})\b(?:[ ,]+(\d{{4}}))?",
        re.IGNORECASE,
    ),
    re.compile(
        rf"\b({_MONTHS})\.? (\d{{1,2}})(?:st|nd|rd|th)?"
        rf"(?:\s*[-–]\s*(\d{{1,2}}))?(?:[ ,]+(\d{{4}}))?\b",
        re.IGNORECASE,
    ),
)


_MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def _month_number(name: str) -> int:
    return _MONTH_KEYS.index(name.lower()[:3]) + 1


def parse_event_dates(
    sentence: str, reference: date | None = None
) -> tuple[date | None, date | None]:
    """The first date in a sentence, and a range end when one is written.

    Without a year, the next occurrence from `reference` is assumed — a
    festival mentioned in July "on 14 February" means next February.
    """
    today = reference or date.today()
    iso = _DATE_PATTERNS[0].search(sentence)
    if iso:
        try:
            return date(int(iso[1]), int(iso[2]), int(iso[3])), None
        except ValueError:
            return None, None
    day_first = _DATE_PATTERNS[1].search(sentence)
    month_first = _DATE_PATTERNS[2].search(sentence)
    if day_first:
        day, month, year = int(day_first[1]), _month_number(day_first[2]), day_first[3]
        end_day = None
    elif month_first:
        month, day = _month_number(month_first[1]), int(month_first[2])
        end_day, year = month_first[3], month_first[4]
    else:
        return None, None
    try:
        year_value = int(year) if year else today.year
        start = date(year_value, month, day)
        if not year and start < today:
            start = date(today.year + 1, month, day)
        end = date(start.year, month, int(end_day)) if end_day else None
    except ValueError:
        return None, None
    return start, end


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

        # A dated happening is an event before it is anything else: "the
        # carnival is on 14 February" must not become a transport tip.
        if _EVENT.search(sentence):
            happens_on, ends_on = parse_event_dates(sentence)
            return KnowledgeCandidate(
                type=KnowledgeType.EVENT,
                title=_gist(sentence),
                body=sentence.strip(),
                category="event",
                destination_scope=_destination_scope(sentence) or scope,
                confidence=round((0.7 if happens_on else 0.5) - penalty, 3),
                evidence=[Evidence(quote=_shorten(sentence, 400), channel=channel)],
                happens_on=happens_on,
                ends_on=ends_on,
            )

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

    Deliberately thin: the model fills the same typed contract the fake
    adapter fills, through structured outputs, and the reply is validated
    against it — so a malformed or refused response fails loudly rather than
    reaching the review screen. The rules the product enforces (verbatim
    evidence, nothing invented, events carry dates, border advice flagged)
    are in the system prompt, which is cached across calls.
    """

    name = "anthropic"

    def __init__(self, api_key: str | None, model: str, client: object | None = None) -> None:
        self.api_key = api_key
        self.model = model
        self._client = client

    def _get_client(self):
        if self._client is None:
            # Imported here so the fake provider needs no SDK installed.
            import anthropic

            self._client = anthropic.Anthropic(api_key=self.api_key)
        return self._client

    def transcribe(self, payload: MediaPayload) -> tuple[str | None, str | None]:
        raise NotImplementedError(
            "Wire a speech-to-text and OCR provider before enabling the anthropic adapter."
        )

    def extract(self, payload: MediaPayload) -> ExtractionResult:
        channels = [
            (name, text)
            for name, text in (
                ("caption", payload.text),
                ("transcript", payload.transcript),
                ("ocr", payload.ocr_text),
            )
            if text and text.strip()
        ]
        if not channels:
            # The honest failure: nothing readable, nothing to invent.
            return ExtractionResult(
                failure_reason="No readable caption, transcript or text — paste the caption "
                "or add a screenshot and try again."
            )

        parts = [f"[{name}]\n{text.strip()}" for name, text in channels]
        if payload.url:
            parts.insert(0, f"[url]\n{payload.url}")
        user_message = (
            f"Today is {today().isoformat()}.\n\n"
            "Extract every travel claim from this capture:\n\n" + "\n\n".join(parts)
        )

        response = self._get_client().messages.parse(
            model=self.model,
            max_tokens=16000,
            system=[
                {
                    "type": "text",
                    "text": _EXTRACTION_SYSTEM,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_message}],
            output_format=_ExtractionOut,
        )
        if response.stop_reason == "refusal":
            return ExtractionResult(failure_reason="The model declined to read this capture.")
        parsed: _ExtractionOut | None = response.parsed_output
        if parsed is None:
            return ExtractionResult(failure_reason="The model returned nothing usable.")
        return parsed.to_result()


_EXTRACTION_SYSTEM = """You turn one piece of saved travel content — a Reel caption, a \
transcript, a screenshot's text, a message — into typed, checkable claims for a private \
travel memory.

Rules, in order of importance:
1. Never invent. Every candidate must be backed by a verbatim quote from the text, in \
`evidence`. If the text names nothing concrete, return no candidates and say why in \
`failure_reason`.
2. One candidate per claim. A video that names a hostel, warns about a taxi scam and \
quotes a shuttle price yields three candidates, not one.
3. `type` is the kind of thing it is: `place` for somewhere you can go (attach `place` with \
the best name, category and city/country hints; never guess coordinates), `accommodation` \
for a stay, `safety` for a warning, `border` for entry/visa/customs, `transport` for getting \
around, `route` for an order of stops, `price` for a cost, `packing` for what to bring, \
`event` for something that happens on a date (festival, market day, party), `general` for \
any other tip.
4. Events carry their date in `happens_on` (ISO, and `ends_on` for a range) when the text \
gives one; resolve a month-and-day to the next occurrence after today.
5. `border` claims always set `requires_official_verification`.
6. `confidence` is how sure you are the claim is real and correctly typed (0.3–0.9), lower \
for hedged or second-hand statements.
7. `title` is a short gist (under 60 characters); `body` is the claim in one plain sentence. \
Keep the creator's language; do not translate.
"""


class _EvidenceOut(BaseModel):
    quote: str
    channel: Literal["text", "transcript", "ocr", "caption", "frame"] = "caption"
    media_timestamp_seconds: float | None = None


class _PlaceOut(BaseModel):
    name: str
    category: PlaceCategory = PlaceCategory.OTHER
    address_hint: str | None = None
    city_hint: str | None = None
    country_hint: str | None = None


class _CandidateOut(BaseModel):
    type: KnowledgeType
    title: str
    body: str | None = None
    destination_scope: str | None = None
    confidence: float = 0.5
    evidence: list[_EvidenceOut] = []
    place: _PlaceOut | None = None
    happens_on: str | None = None
    ends_on: str | None = None
    requires_official_verification: bool = False


class _ExtractionOut(BaseModel):
    """The model's side of the contract: plain strings for dates, no regex constraints."""

    title: str | None = None
    author: str | None = None
    published_on: str | None = None
    language: str | None = None
    summary: str | None = None
    candidates: list[_CandidateOut] = []
    failure_reason: str | None = None

    def to_result(self) -> ExtractionResult:
        return ExtractionResult(
            title=self.title,
            author=self.author,
            published_on=_iso_date(self.published_on),
            language=self.language,
            summary=self.summary,
            failure_reason=self.failure_reason,
            candidates=[
                KnowledgeCandidate(
                    type=c.type,
                    title=c.title[:240],
                    body=c.body,
                    category=c.place.category if c.place else None,
                    destination_scope=c.destination_scope,
                    confidence=min(0.95, max(0.05, c.confidence)),
                    evidence=[
                        Evidence(
                            quote=e.quote[:2000],
                            channel=e.channel,
                            media_timestamp_seconds=e.media_timestamp_seconds,
                        )
                        for e in c.evidence
                        if e.quote.strip()
                    ],
                    place=(
                        PlaceCandidate(
                            name=c.place.name[:200],
                            category=c.place.category,
                            address_hint=c.place.address_hint,
                            city_hint=c.place.city_hint,
                            country_hint=c.place.country_hint,
                        )
                        if c.place
                        else None
                    ),
                    happens_on=_iso_date(c.happens_on),
                    ends_on=_iso_date(c.ends_on),
                    requires_official_verification=c.requires_official_verification
                    or c.type is KnowledgeType.BORDER,
                )
                for c in self.candidates
                if c.evidence  # rule 1: no quote, no claim
            ],
        )


def _iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def today() -> date:
    from datetime import UTC, datetime

    return datetime.now(UTC).date()
