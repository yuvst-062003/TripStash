"""Shared FastAPI dependencies: authentication, trip scoping, audit."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models.core import AuditEvent, Trip, User
from app.services.security import decode_access_token

CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


def current_user(
    session: Session = Depends(get_session),
    authorization: str | None = Header(default=None),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise CREDENTIALS_ERROR
    user_id = decode_access_token(authorization.split(" ", 1)[1].strip())
    if user_id is None:
        raise CREDENTIALS_ERROR
    user = session.get(User, user_id)
    if user is None:
        raise CREDENTIALS_ERROR
    return user


def current_trip(
    session: Session = Depends(get_session), user: User = Depends(current_user)
) -> Trip:
    """The MVP runs one active trip; every scoped query goes through here."""
    trip = session.execute(
        select(Trip).where(Trip.user_id == user.id, Trip.is_active.is_(True))
    ).scalars().first()
    if trip is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active trip. Create one first.",
        )
    return trip


def owned_or_404(obj, trip: Trip, message: str = "Not found"):
    """Ownership check on every request (spec 11.4) - never trust an ID."""
    if obj is None or getattr(obj, "trip_id", None) != trip.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)
    return obj


def audit(
    session: Session, *, user_id: str | None, action: str, subject: str | None = None,
    detail: str | None = None,
) -> None:
    """Record sensitive access. Never write document or receipt contents here."""
    session.add(
        AuditEvent(
            user_id=user_id,
            action=action,
            subject=subject,
            detail=detail,
            at=datetime.now(UTC),
        )
    )
