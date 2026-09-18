"""Trip operations: plan, bookings, money, files, agent runs, offline sync."""

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
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, TimestampMixin
from app.models.enums import BookingKind


class ItineraryItem(IdMixin, TimestampMixin, Base):
    """A date- or time-bound plan entry. `on_date` with no time is valid."""

    __tablename__ = "itinerary_item"

    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    destination_id: Mapped[str | None] = mapped_column(
        ForeignKey("destination.id", ondelete="SET NULL")
    )
    trip_place_id: Mapped[str | None] = mapped_column(
        ForeignKey("trip_place.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    on_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[str | None] = mapped_column(String(5))
    end_time: Mapped[str | None] = mapped_column(String(5))
    notes: Mapped[str | None] = mapped_column(Text)
    is_done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class Booking(IdMixin, TimestampMixin, Base):
    """An external reservation, imported after the provider completed it."""

    __tablename__ = "booking"

    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    destination_id: Mapped[str | None] = mapped_column(
        ForeignKey("destination.id", ondelete="SET NULL")
    )
    place_id: Mapped[str | None] = mapped_column(ForeignKey("place.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(20), default=BookingKind.STAY, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    provider: Mapped[str | None] = mapped_column(String(80))
    confirmation_code: Mapped[str | None] = mapped_column(String(120))
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancellation_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    amount: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str | None] = mapped_column(String(3))
    notes: Mapped[str | None] = mapped_column(Text)


class Expense(IdMixin, TimestampMixin, Base):
    __tablename__ = "expense"

    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    destination_id: Mapped[str | None] = mapped_column(
        ForeignKey("destination.id", ondelete="SET NULL")
    )
    place_id: Mapped[str | None] = mapped_column(ForeignKey("place.id", ondelete="SET NULL"))
    spent_on: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    # Converted at capture time so history is stable when rates move.
    amount_base: Mapped[float] = mapped_column(Float, nullable=False)
    category: Mapped[str] = mapped_column(String(40), default="other", nullable=False)
    country: Mapped[str | None] = mapped_column(String(80))
    note: Mapped[str | None] = mapped_column(String(240))


class Document(IdMixin, TimestampMixin, Base):
    """Metadata only. Raw identity documents stay out until spec 16's review."""

    __tablename__ = "document"

    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[str] = mapped_column(String(40), default="ticket", nullable=False)
    storage_key: Mapped[str] = mapped_column(String(300), nullable=False)
    media_type: Mapped[str | None] = mapped_column(String(120))
    byte_size: Mapped[int | None] = mapped_column(Integer)
    is_sensitive: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    available_offline: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expires_on: Mapped[date | None] = mapped_column(Date)


class AgentRun(IdMixin, TimestampMixin, Base):
    """One Ask invocation: context, tools used, sources cited, typed output."""

    __tablename__ = "agent_run"

    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    surface: Mapped[str] = mapped_column(String(40), default="home", nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    context_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    tools_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    citations_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    output_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="completed", nullable=False)
    latency_ms: Mapped[int | None] = mapped_column(Integer)


class SyncOperation(IdMixin, TimestampMixin, Base):
    """An offline mutation replayed on reconnect. `client_op_id` is the
    idempotency key that stops a retried queue from double-applying."""

    __tablename__ = "sync_operation"

    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    client_op_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    operation: Mapped[str] = mapped_column(String(60), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="applied", nullable=False)
    conflict_detail: Mapped[str | None] = mapped_column(Text)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
