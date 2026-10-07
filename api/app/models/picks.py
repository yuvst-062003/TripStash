"""Which activity types this trip is about.

A row per picked slug. Absence of rows means no filter at all, which is not the
same as an empty filter: a traveller who has picked nothing sees everything.
The unique constraint makes picking the same thing twice impossible rather than
merely discouraged.
"""

from __future__ import annotations

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, TimestampMixin


class ActivityPick(IdMixin, TimestampMixin, Base):
    __tablename__ = "activity_pick"
    __table_args__ = (UniqueConstraint("trip_id", "slug", name="uq_activity_pick_trip_slug"),)

    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    slug: Mapped[str] = mapped_column(String(32), nullable=False)
