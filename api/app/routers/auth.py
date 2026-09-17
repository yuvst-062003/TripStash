"""Authentication and account lifecycle."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.deps import audit, current_user
from app.models.core import User
from app.schemas.api import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from app.services.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, session: Session = Depends(get_session)) -> TokenResponse:
    existing = session.execute(
        select(User).where(User.email == body.email.lower())
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with that email exists.")

    try:
        password_hash = hash_password(body.password)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    user = User(
        email=body.email.lower(),
        password_hash=password_hash,
        display_name=body.display_name,
        base_currency=body.base_currency.upper(),
    )
    session.add(user)
    session.flush()
    audit(session, user_id=user.id, action="account.register")
    return TokenResponse(access_token=create_access_token(user.id))


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, session: Session = Depends(get_session)) -> TokenResponse:
    user = session.execute(
        select(User).where(User.email == body.email.lower())
    ).scalar_one_or_none()
    # Same error either way: never reveal whether the address is registered.
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password.")
    audit(session, user_id=user.id, action="account.login")
    return TokenResponse(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(current_user)) -> User:
    return user
