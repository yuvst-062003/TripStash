"""Provider-facing protocols.

Call sites depend on these, never on a concrete driver, so swapping the fake
implementations for real ones is a configuration change (spec 10.1).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Protocol

from app.schemas.extraction import ExtractionResult


@dataclass(slots=True)
class MediaPayload:
    """What the pipeline managed to obtain from a source, in one envelope."""

    kind: str
    url: str | None = None
    text: str | None = None
    transcript: str | None = None
    ocr_text: str | None = None
    filename: str | None = None
    media_type: str | None = None
    duration_seconds: float | None = None


class AIAdapter(Protocol):
    """Structured extraction and grounded answering.

    `hints` carries the traveller's own destinations and previously approved
    items. An adapter may ignore them; a model-backed one uses them to adapt to
    this traveller without any training.
    """

    name: str

    def extract(self, payload: MediaPayload, hints: object | None = None) -> ExtractionResult: ...

    def transcribe(self, payload: MediaPayload) -> tuple[str | None, str | None]:
        """Return (transcript, ocr_text) for uploaded media."""
        ...


@dataclass(slots=True)
class ResolvedPlace:
    """A place provider's answer, already normalised."""

    provider: str
    provider_place_id: str
    name: str
    lat: float
    lon: float
    category: str
    address: str | None = None
    city: str | None = None
    country: str | None = None
    phone: str | None = None
    website: str | None = None
    aliases: list[str] = field(default_factory=list)
    opening_hours: str | None = None
    price_level: str | None = None
    match_confidence: float = 0.5


class PlacesProvider(Protocol):
    name: str

    def resolve(
        self,
        query: str,
        *,
        near_lat: float | None = None,
        near_lon: float | None = None,
        city_hint: str | None = None,
        limit: int = 5,
    ) -> list[ResolvedPlace]: ...

    def details(self, provider_place_id: str) -> ResolvedPlace | None: ...


@dataclass(slots=True)
class WeatherReading:
    summary: str
    temperature_c: float
    precipitation_probability: float
    checked_at: datetime
    for_date: date


class WeatherProvider(Protocol):
    name: str

    def forecast(self, lat: float, lon: float, on: date) -> WeatherReading: ...


class FxProvider(Protocol):
    name: str

    def rate(self, base: str, quote: str) -> float: ...


class StorageAdapter(Protocol):
    name: str

    def put(self, key: str, data: bytes, media_type: str | None = None) -> str: ...

    def get(self, key: str) -> bytes: ...

    def size(self, key: str) -> int: ...

    def read_range(self, key: str, start: int, end: int) -> bytes: ...

    def delete(self, key: str) -> None: ...

    def signed_url(self, key: str) -> str: ...


@dataclass(frozen=True)
class PermissionDecision:
    """Whether a URL may be fetched, and the reason either way.

    The reason is not decoration: when the answer is no, the traveller is told
    which rule stopped it rather than being shown an empty section.
    """

    allowed: bool
    reason: str
    crawl_delay_seconds: float = 0.0


@dataclass(frozen=True)
class FetchedPage:
    """One public page, reduced to what TripStash is allowed to keep.

    `text` is readable body text held only long enough for evidence-grounded
    extraction to run against it. What survives that step is a fact, one short
    verbatim quote, and the credit and link back - never the article. See
    docs/sources.md.
    """

    url: str
    title: str | None
    text: str
    fetched_at: datetime
    etag: str | None = None
    last_modified: str | None = None
    # True when the host answered "nothing has changed", so a freshness check
    # costs the publisher almost nothing.
    not_modified: bool = False


class ContentSourceAdapter(Protocol):
    """Reads a public page, under the rules in docs/sources.md.

    Implementations must refuse rather than guess: a host whose robots.txt or
    terms have not been read is not fetchable, and saying so is the point.
    """

    name: str

    def may_fetch(self, url: str) -> PermissionDecision: ...

    def fetch(
        self, url: str, *, etag: str | None = None, last_modified: str | None = None
    ) -> FetchedPage: ...


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    snippet: str


class SearchProvider(Protocol):
    """The assistant's web search. It may propose; it may never act."""

    name: str

    def search(self, query: str, *, limit: int = 5) -> list[SearchResult]: ...
