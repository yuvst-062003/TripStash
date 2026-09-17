"""The typed extraction contract (spec 10.2, 19.3).

Every AI adapter - fake or real - must return this shape. Keeping the schema
here rather than inside a provider is what makes the LLM replaceable: the
pipeline, the review screen and the tests all speak this language.
"""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import KnowledgeType, PlaceCategory


class Evidence(BaseModel):
    """Verbatim support for one extracted claim. No evidence, no claim."""

    model_config = ConfigDict(extra="forbid")

    quote: str = Field(min_length=1, max_length=2000)
    # Where in the media the quote came from, when the medium has a timeline.
    media_timestamp_seconds: float | None = None
    channel: str = Field(default="text", pattern="^(text|transcript|ocr|caption|frame)$")


class PlaceCandidate(BaseModel):
    """An unresolved place mentioned by a source."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    category: PlaceCategory = PlaceCategory.OTHER
    address_hint: str | None = None
    city_hint: str | None = None
    country_hint: str | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    provider: str | None = None
    provider_place_id: str | None = None


class KnowledgeCandidate(BaseModel):
    """One typed item proposed for review.

    A single video routinely yields several of these - three places, a safety
    warning, a price estimate and a transport tip - which is why the review
    screen groups by `type` instead of assuming everything is a marker.
    """

    model_config = ConfigDict(extra="forbid")

    type: KnowledgeType
    title: str = Field(min_length=1, max_length=240)
    body: str | None = None
    category: str | None = None
    destination_scope: str | None = None
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    evidence: list[Evidence] = Field(default_factory=list)
    place: PlaceCandidate | None = None
    source_date: date | None = None
    # Border, visa and entry advice is never answered from a creator alone.
    requires_official_verification: bool = False


class ExtractionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    author: str | None = None
    published_on: date | None = None
    language: str | None = None
    summary: str | None = None
    candidates: list[KnowledgeCandidate] = Field(default_factory=list)
    # Populated when the adapter could not read the content at all, so the
    # source stays recoverable in Inbox instead of disappearing (spec 12).
    failure_reason: str | None = None
