"""Capture, extraction staging and typed travel knowledge (spec 7.3, 10.2, 19)."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, IdMixin, TimestampMixin
from app.models.enums import (
    CandidateStatus,
    KnowledgeType,
    Provenance,
    SourceKind,
    SourceStatus,
)


class Source(IdMixin, TimestampMixin, Base):
    """The original artefact, persisted before any extraction is attempted.

    Step 1 of the pipeline is always "persist Source" so a failed extraction
    never loses the traveller's input (spec 10.2, 12).
    """

    __tablename__ = "source"
    __table_args__ = (
        UniqueConstraint("trip_id", "fingerprint", name="uq_source_fingerprint"),
    )

    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(20), default=SourceKind.LINK, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default=SourceStatus.QUEUED, nullable=False)
    url: Mapped[str | None] = mapped_column(String(1000))
    title: Mapped[str | None] = mapped_column(String(300))
    author: Mapped[str | None] = mapped_column(String(160))
    # Raw caption / transcript / OCR text, whichever the pipeline could obtain.
    raw_text: Mapped[str | None] = mapped_column(Text)
    transcript: Mapped[str | None] = mapped_column(Text)
    ocr_text: Mapped[str | None] = mapped_column(Text)

    # Media metadata retained per spec 7.5.
    storage_key: Mapped[str | None] = mapped_column(String(300))
    filename: Mapped[str | None] = mapped_column(String(300))
    media_type: Mapped[str | None] = mapped_column(String(120))
    byte_size: Mapped[int | None] = mapped_column(Integer)
    duration_seconds: Mapped[float | None] = mapped_column(Float)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_on: Mapped[date | None] = mapped_column(Date)
    # Content hash - the duplicate-import guard required by spec 6.1 step 2.
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    provenance: Mapped[str] = mapped_column(String(20), default=Provenance.CREATOR, nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    candidates: Mapped[list[ExtractionCandidate]] = relationship(
        back_populates="source", cascade="all, delete-orphan"
    )
    evidence: Mapped[list[SourcePlaceEvidence]] = relationship(
        back_populates="source", cascade="all, delete-orphan"
    )
    stages: Mapped[list[MediaStage]] = relationship(
        back_populates="source",
        cascade="all, delete-orphan",
        order_by="MediaStage.position",
    )


class MediaStage(IdMixin, TimestampMixin, Base):
    """One step of the media pipeline, recorded so the traveller can see it.

    Specification 7.5 requires per-item status on a batch import. A single
    `status` on the source answers "is it done"; these rows answer "what did it
    actually manage to read, with which engine, and how long did it take".
    """

    __tablename__ = "media_stage"

    source_id: Mapped[str] = mapped_column(
        ForeignKey("source.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    engine: Mapped[str] = mapped_column(String(60), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="ok", nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)

    source: Mapped[Source] = relationship(back_populates="stages")


class ExtractionCandidate(IdMixin, TimestampMixin, Base):
    """A proposed item awaiting the traveller's decision.

    Nothing reaches Saved or Map from here without an explicit approve, which
    is the "avoid silent AI additions" rule (spec 7.3).
    """

    __tablename__ = "extraction_candidate"

    source_id: Mapped[str] = mapped_column(
        ForeignKey("source.id", ondelete="CASCADE"), nullable=False, index=True
    )
    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type: Mapped[str] = mapped_column(String(20), default=KnowledgeType.GENERAL, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default=CandidateStatus.PENDING, nullable=False
    )
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(32))
    destination_scope: Mapped[str | None] = mapped_column(String(160))
    confidence: Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    # Whether this candidate actually names a place. A stay or transport *tip*
    # carries no location, so it becomes knowledge rather than a map pin even
    # though its type sits in PLACE_LIKE_TYPES.
    is_place_candidate: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Verbatim quote(s) backing the claim, with media timestamps where known.
    evidence_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    # Resolved place options for place-like candidates, best match first.
    resolution_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    duplicate_of_place_id: Mapped[str | None] = mapped_column(String(32))
    duplicate_reason: Mapped[str | None] = mapped_column(String(200))
    resolved_place_id: Mapped[str | None] = mapped_column(String(32))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    source: Mapped[Source] = relationship(back_populates="candidates")


class SourcePlaceEvidence(IdMixin, TimestampMixin, Base):
    """Why this source counts as evidence for this place (spec 9)."""

    __tablename__ = "source_place_evidence"
    __table_args__ = (
        UniqueConstraint("source_id", "place_id", name="uq_source_place_evidence"),
    )

    source_id: Mapped[str] = mapped_column(
        ForeignKey("source.id", ondelete="CASCADE"), nullable=False, index=True
    )
    place_id: Mapped[str] = mapped_column(
        ForeignKey("place.id", ondelete="CASCADE"), nullable=False, index=True
    )
    trip_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    takeaway: Mapped[str | None] = mapped_column(Text)
    quote: Mapped[str | None] = mapped_column(Text)
    media_timestamp_seconds: Mapped[float | None] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float, default=0.5, nullable=False)

    source: Mapped[Source] = relationship(back_populates="evidence")


class KnowledgeItem(IdMixin, TimestampMixin, Base):
    """Non-place travel knowledge: safety, transport, border, price, packing.

    Spec 19.1: every item keeps its source, date, evidence, type, scope,
    category, confidence and freshness, and stays correctable by the user.
    """

    __tablename__ = "knowledge_item"

    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_id: Mapped[str | None] = mapped_column(
        ForeignKey("source.id", ondelete="SET NULL"), index=True
    )
    destination_id: Mapped[str | None] = mapped_column(
        ForeignKey("destination.id", ondelete="SET NULL"), index=True
    )
    place_id: Mapped[str | None] = mapped_column(
        ForeignKey("place.id", ondelete="SET NULL"), index=True
    )
    type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(40))
    destination_scope: Mapped[str | None] = mapped_column(String(160), index=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    provenance: Mapped[str] = mapped_column(String(20), default=Provenance.CREATOR, nullable=False)
    evidence_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    source_date: Mapped[date | None] = mapped_column(Date)
    # Border and visa answers must be re-verified against official sources.
    requires_official_verification: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    user_edited: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
