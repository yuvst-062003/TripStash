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
    """Structured extraction and grounded answering."""

    name: str

    def extract(self, payload: MediaPayload) -> ExtractionResult: ...

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

    def delete(self, key: str) -> None: ...

    def signed_url(self, key: str) -> str: ...
