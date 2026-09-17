"""Place identity, the traveller's relationship to it, and verified facts.

Spec 9: `Place` stores canonical identity, `TripPlace` stores the personal
layer. Enrichment writes to `Place`/`PlaceFact` and must never overwrite the
user-entered fields on `TripPlace`.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, IdMixin, TimestampMixin
from app.models.enums import FactKind, PlaceCategory, PlaceStatus, Provenance

trip_place_collection = Table(
    "trip_place_collection",
    Base.metadata,
    Column("trip_place_id", ForeignKey("trip_place.id", ondelete="CASCADE"), primary_key=True),
    Column("collection_id", ForeignKey("collection.id", ondelete="CASCADE"), primary_key=True),
)


class Place(IdMixin, TimestampMixin, Base):
    """Canonical location, shared across trips and users."""

    __tablename__ = "place"
    __table_args__ = (
        UniqueConstraint("provider", "provider_place_id", name="uq_place_provider_identity"),
        Index("ix_place_bbox", "lat", "lon"),
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    normalized_name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    category: Mapped[str] = mapped_column(
        String(32), default=PlaceCategory.OTHER, nullable=False
    )
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    address: Mapped[str | None] = mapped_column(String(320))
    city: Mapped[str | None] = mapped_column(String(120), index=True)
    country: Mapped[str | None] = mapped_column(String(80))
    phone: Mapped[str | None] = mapped_column(String(40))
    website: Mapped[str | None] = mapped_column(String(320))
    provider: Mapped[str | None] = mapped_column(String(40))
    provider_place_id: Mapped[str | None] = mapped_column(String(120), index=True)
    # Local and English names both matter for accessibility (spec 12.1).
    aliases: Mapped[str | None] = mapped_column(Text)

    facts: Mapped[list[PlaceFact]] = relationship(
        back_populates="place", cascade="all, delete-orphan"
    )

    def alias_list(self) -> list[str]:
        return [a.strip() for a in (self.aliases or "").split("|") if a.strip()]


class TripPlace(IdMixin, TimestampMixin, Base):
    """The traveller's own layer over a Place: status, reason, notes, visits."""

    __tablename__ = "trip_place"
    __table_args__ = (UniqueConstraint("trip_id", "place_id", name="uq_trip_place"),)

    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    place_id: Mapped[str] = mapped_column(
        ForeignKey("place.id", ondelete="CASCADE"), nullable=False, index=True
    )
    destination_id: Mapped[str | None] = mapped_column(
        ForeignKey("destination.id", ondelete="SET NULL"), index=True
    )
    status: Mapped[str] = mapped_column(String(20), default=PlaceStatus.INBOX, nullable=False)
    # "Why saved" is the product's core differentiator (spec 2.2) - never
    # overwritten by enrichment, only by the user.
    reason_saved: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    is_favourite: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expected_cost: Mapped[float | None] = mapped_column(Float)
    expected_duration_minutes: Mapped[int | None] = mapped_column(Integer)
    best_time: Mapped[str | None] = mapped_column(String(120))
    rating: Mapped[int | None] = mapped_column(Integer)

    place: Mapped[Place] = relationship(lazy="joined")
    collections: Mapped[list[Collection]] = relationship(
        secondary=trip_place_collection, back_populates="trip_places"
    )
    visits: Mapped[list[Visit]] = relationship(
        back_populates="trip_place", cascade="all, delete-orphan"
    )


class Collection(IdMixin, TimestampMixin, Base):
    """Reusable tag such as Diving, Food, Nature, Nightlife, Extra time."""

    __tablename__ = "collection"
    __table_args__ = (UniqueConstraint("trip_id", "name", name="uq_collection_name"),)

    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    colour: Mapped[str | None] = mapped_column(String(16))

    trip_places: Mapped[list[TripPlace]] = relationship(
        secondary=trip_place_collection, back_populates="collections"
    )


class PlaceFact(IdMixin, TimestampMixin, Base):
    """A single changing fact with provenance and freshness (spec 8.2).

    Conflicting values are kept side by side rather than resolved silently.
    """

    __tablename__ = "place_fact"

    place_id: Mapped[str] = mapped_column(
        ForeignKey("place.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(20), default=FactKind.HOURS, nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    provenance: Mapped[str] = mapped_column(
        String(20), default=Provenance.PROVIDER, nullable=False
    )
    source_label: Mapped[str | None] = mapped_column(String(200))
    source_url: Mapped[str | None] = mapped_column(String(500))
    confidence: Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    place: Mapped[Place] = relationship(back_populates="facts")


class Visit(IdMixin, TimestampMixin, Base):
    __tablename__ = "visit"

    trip_place_id: Mapped[str] = mapped_column(
        ForeignKey("trip_place.id", ondelete="CASCADE"), nullable=False, index=True
    )
    visited_on: Mapped[date] = mapped_column(Date, nullable=False)
    rating: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    actual_cost: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str | None] = mapped_column(String(3))

    trip_place: Mapped[TripPlace] = relationship(back_populates="visits")
