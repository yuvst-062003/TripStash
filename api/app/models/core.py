"""User, Trip and Destination (spec 9)."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, IdMixin, TimestampMixin
from app.models.enums import TripPhase


class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "user_account"

    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120))
    locale: Mapped[str] = mapped_column(String(16), default="en-GB", nullable=False)
    base_currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", nullable=False)
    # Privacy preferences (spec 7.5 / 11.4) kept as an explicit opt-in map.
    allow_media_training: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allow_analytics: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    trips: Mapped[list[Trip]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Trip(IdMixin, TimestampMixin, Base):
    __tablename__ = "trip"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("user_account.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    # Approximate by design: spec 7.1 forbids mandatory exact dates.
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    base_currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    total_budget: Mapped[float | None] = mapped_column(Float)
    interests: Mapped[str | None] = mapped_column(Text)  # comma separated
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    user: Mapped[User] = relationship(back_populates="trips")
    destinations: Mapped[list[Destination]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="Destination.position"
    )

    def phase(self, today: date) -> TripPhase:
        if self.start_date and today < self.start_date:
            return TripPhase.BEFORE
        if self.end_date and today > self.end_date:
            return TripPhase.AFTER
        return TripPhase.DURING


class Destination(IdMixin, TimestampMixin, Base):
    """A stop on a flexible route. Dates stay optional on purpose."""

    __tablename__ = "destination"

    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    country: Mapped[str | None] = mapped_column(String(80))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    arrive_on: Mapped[date | None] = mapped_column(Date)
    depart_on: Mapped[date | None] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)

    trip: Mapped[Trip] = relationship(back_populates="destinations")


class AuditEvent(IdMixin, Base):
    """Sensitive access and important account actions (spec 11.4)."""

    __tablename__ = "audit_event"

    user_id: Mapped[str | None] = mapped_column(String(32), index=True)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    subject: Mapped[str | None] = mapped_column(String(160))
    detail: Mapped[str | None] = mapped_column(Text)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
