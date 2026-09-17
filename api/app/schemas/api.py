"""Request and response bodies for the versioned HTTP API."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import (
    BookingKind,
    KnowledgeType,
    PlaceCategory,
    PlaceStatus,
    SourceKind,
)


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")


# ------------------------------------------------------------------- auth


class RegisterRequest(ApiModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=256)
    display_name: str | None = None
    base_currency: str = Field(default="USD", min_length=3, max_length=3)


class LoginRequest(ApiModel):
    email: EmailStr
    password: str


class TokenResponse(ApiModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(ApiModel):
    id: str
    email: str
    display_name: str | None
    base_currency: str
    locale: str
    timezone: str


# ------------------------------------------------------------------- trip


class TripCreate(ApiModel):
    name: str = Field(min_length=1, max_length=160)
    start_date: date | None = None
    end_date: date | None = None
    base_currency: str = Field(default="USD", min_length=3, max_length=3)
    total_budget: float | None = Field(default=None, ge=0)
    interests: list[str] = Field(default_factory=list)


class DestinationCreate(ApiModel):
    name: str = Field(min_length=1, max_length=160)
    country: str | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    arrive_on: date | None = None
    depart_on: date | None = None
    is_current: bool = False
    notes: str | None = None


class DestinationUpdate(ApiModel):
    """Only what a traveller changes after the fact: dates, notes, and being there."""

    arrive_on: date | None = None
    depart_on: date | None = None
    notes: str | None = None
    is_current: bool | None = None


class DestinationResponse(ApiModel):
    id: str
    name: str
    country: str | None
    lat: float | None
    lon: float | None
    position: int
    arrive_on: date | None
    depart_on: date | None
    is_current: bool
    notes: str | None


class TripResponse(ApiModel):
    id: str
    name: str
    start_date: date | None
    end_date: date | None
    base_currency: str
    total_budget: float | None
    interests: list[str]
    phase: str
    destinations: list[DestinationResponse]


# ---------------------------------------------------------------- capture


class LinkCapture(ApiModel):
    url: str | None = None
    text: str | None = None
    title: str | None = None
    author: str | None = None
    published_on: date | None = None
    kind: SourceKind = SourceKind.LINK


class SourceResponse(ApiModel):
    id: str
    kind: str
    status: str
    url: str | None
    title: str | None
    author: str | None
    filename: str | None
    media_type: str | None
    byte_size: int | None
    published_on: date | None
    created_at: datetime
    processed_at: datetime | None
    failure_reason: str | None
    attempts: int
    candidate_count: int = 0
    pending_count: int = 0
    file_url: str | None = None


class EvidenceResponse(ApiModel):
    quote: str
    media_timestamp_seconds: float | None = None
    channel: str = "text"


class ResolutionOption(ApiModel):
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
    aliases: list[str] = Field(default_factory=list)
    opening_hours: str | None = None
    price_level: str | None = None
    match_confidence: float


class CandidateResponse(ApiModel):
    id: str
    source_id: str
    type: KnowledgeType
    status: str
    title: str
    body: str | None
    category: str | None
    destination_scope: str | None
    confidence: float
    is_place_candidate: bool
    evidence: list[EvidenceResponse]
    resolutions: list[ResolutionOption]
    duplicate_of_place_id: str | None
    duplicate_of_name: str | None = None
    duplicate_reason: str | None
    happens_on: date | None = None
    ends_on: date | None = None


class ApproveCandidate(ApiModel):
    reason_saved: str | None = None
    provider_place_id: str | None = None
    merge_into_place_id: str | None = None
    override_name: str | None = None
    override_lat: float | None = Field(default=None, ge=-90, le=90)
    override_lon: float | None = Field(default=None, ge=-180, le=180)
    override_category: PlaceCategory | None = None
    destination_id: str | None = None


class CandidateEdit(ApiModel):
    title: str | None = None
    body: str | None = None
    type: KnowledgeType | None = None
    category: str | None = None
    destination_scope: str | None = None


# ----------------------------------------------------------------- places


class PlaceSummary(ApiModel):
    trip_place_id: str
    place_id: str
    name: str
    category: str
    city: str | None
    country: str | None
    lat: float
    lon: float
    status: str
    is_favourite: bool
    needs_review: bool
    reason_saved: str | None
    source_count: int
    distance_km: float | None = None
    walking_minutes: int | None = None


class PlaceUpdate(ApiModel):
    status: PlaceStatus | None = None
    reason_saved: str | None = None
    notes: str | None = None
    is_favourite: bool | None = None
    expected_cost: float | None = Field(default=None, ge=0)
    expected_duration_minutes: int | None = Field(default=None, ge=0)
    best_time: str | None = None
    rating: int | None = Field(default=None, ge=1, le=5)
    destination_id: str | None = None
    collection_ids: list[str] | None = None


class VisitCreate(ApiModel):
    visited_on: date
    rating: int | None = Field(default=None, ge=1, le=5)
    notes: str | None = None
    actual_cost: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)


class CollectionCreate(ApiModel):
    name: str = Field(min_length=1, max_length=80)
    colour: str | None = None


# -------------------------------------------------------------------- ask


class AskRequest(ApiModel):
    question: str = Field(min_length=1, max_length=2000)
    surface: str = "home"
    trip_place_id: str | None = None
    place_id: str | None = None
    source_id: str | None = None
    destination_id: str | None = None
    collection_id: str | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    on: date | None = None
    saved_only: bool = False


# ------------------------------------------------------------------- plan


class ItineraryCreate(ApiModel):
    title: str | None = None
    on_date: date
    trip_place_id: str | None = None
    destination_id: str | None = None
    start_time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end_time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    notes: str | None = None


class BookingCreate(ApiModel):
    kind: BookingKind = BookingKind.STAY
    title: str = Field(min_length=1, max_length=200)
    provider: str | None = None
    confirmation_code: str | None = None
    place_id: str | None = None
    destination_id: str | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    cancellation_deadline: datetime | None = None
    amount: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    notes: str | None = None


class ExpenseCreate(ApiModel):
    spent_on: date
    amount: float = Field(gt=0)
    currency: str = Field(min_length=3, max_length=3)
    category: str = "other"
    place_id: str | None = None
    destination_id: str | None = None
    country: str | None = None
    note: str | None = None
    # Idempotency key so a replayed offline queue does not double-charge.
    client_op_id: str | None = None


class KnowledgeCreate(ApiModel):
    """A thing the traveller writes down themselves: an event, a tip, a warning."""

    type: KnowledgeType = KnowledgeType.GENERAL
    title: str = Field(min_length=1, max_length=240)
    body: str | None = None
    destination_scope: str | None = None
    happens_on: date | None = None
    ends_on: date | None = None


class KnowledgeUpdate(ApiModel):
    title: str | None = None
    body: str | None = None
    type: KnowledgeType | None = None
    happens_on: date | None = None
    ends_on: date | None = None
    category: str | None = None
    destination_scope: str | None = None
    is_archived: bool | None = None
