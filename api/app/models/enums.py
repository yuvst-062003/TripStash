"""Domain vocabularies.

Stored as plain strings so a new value never needs a database migration; the
enums exist to keep the Python side honest and to document the spec's
lifecycle rules in one place.
"""

from __future__ import annotations

from enum import StrEnum


class PlaceStatus(StrEnum):
    """Spec 7.2. `booked` is derived, `favourite` and `needs_review` are flags."""

    INBOX = "inbox"
    SAVED = "saved"
    MUST_VISIT = "must_visit"
    PLANNED = "planned"
    VISITED = "visited"
    ARCHIVED = "archived"


ACTIVE_PLACE_STATUSES = (
    PlaceStatus.SAVED,
    PlaceStatus.MUST_VISIT,
    PlaceStatus.PLANNED,
    PlaceStatus.VISITED,
)


class PlaceCategory(StrEnum):
    ATTRACTION = "attraction"
    RESTAURANT = "restaurant"
    CAFE = "cafe"
    BAR = "bar"
    VIEWPOINT = "viewpoint"
    ACCOMMODATION = "accommodation"
    ACTIVITY = "activity"
    TRANSPORT = "transport"
    SHOP = "shop"
    NATURE = "nature"
    OTHER = "other"


class SourceKind(StrEnum):
    LINK = "link"
    VIDEO = "video"
    IMAGE = "image"
    SCREENSHOT = "screenshot"
    ARTICLE = "article"
    MESSAGE = "message"
    NOTE = "note"
    MANUAL = "manual"


class SourceStatus(StrEnum):
    """Batch import states required by spec 7.5."""

    QUEUED = "queued"
    PROCESSING = "processing"
    NEEDS_REVIEW = "needs_review"
    COMPLETED = "completed"
    FAILED = "failed"


class KnowledgeType(StrEnum):
    """Spec 19: a single source yields several typed items, not only places."""

    PLACE = "place"
    ACCOMMODATION = "accommodation"
    SAFETY = "safety"
    BORDER = "border"
    TRANSPORT = "transport"
    ROUTE = "route"
    PRICE = "price"
    PACKING = "packing"
    GENERAL = "general"


PLACE_LIKE_TYPES = (KnowledgeType.PLACE, KnowledgeType.ACCOMMODATION)


class Provenance(StrEnum):
    """Spec 8.1 source hierarchy, highest trust first."""

    OFFICIAL = "official"
    PROVIDER = "provider"
    REVIEWS = "reviews"
    CREATOR = "creator"
    USER = "user"
    INFERENCE = "inference"


PROVENANCE_RANK = {
    Provenance.OFFICIAL: 0,
    Provenance.PROVIDER: 1,
    Provenance.REVIEWS: 2,
    Provenance.USER: 3,
    Provenance.CREATOR: 4,
    Provenance.INFERENCE: 5,
}


class CandidateStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    IGNORED = "ignored"
    MERGED = "merged"


class FactKind(StrEnum):
    HOURS = "hours"
    PRICE = "price"
    PHONE = "phone"
    WEBSITE = "website"
    ADDRESS = "address"
    ACCESS = "access"
    TICKET = "ticket"
    CLOSURE = "closure"


class BookingKind(StrEnum):
    STAY = "stay"
    TRANSPORT = "transport"
    ACTIVITY = "activity"


class TripPhase(StrEnum):
    BEFORE = "before"
    DURING = "during"
    AFTER = "after"
