"""The container runs the seed on every boot, so in production it must never
drop a table and never create a login with the password printed in the source."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app import seed as seed_module
from app.config import get_settings
from app.db import session_scope
from app.models.core import Trip, User


@pytest.fixture
def production(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "production")
    yield settings


def test_production_never_rebuilds_an_existing_database(production, client, auth, trip):
    with session_scope() as session:
        if not session.execute(
            select(User).where(User.email == seed_module.DEMO_EMAIL)
        ).scalar_one_or_none():
            session.add(User(email=seed_module.DEMO_EMAIL, password_hash="x", display_name="d"))
    seed_module._marker_path().write_text("an-older-version")

    seed_module.seed()

    with session_scope() as session:
        assert session.execute(select(Trip)).scalars().first() is not None


def test_production_without_a_chosen_password_creates_no_demo_login(production, monkeypatch):
    monkeypatch.delenv("TRIPSTASH_DEMO_PASSWORD", raising=False)

    seed_module.seed()

    with session_scope() as session:
        demo = session.execute(
            select(User).where(User.email == seed_module.DEMO_EMAIL)
        ).scalar_one_or_none()
    assert demo is None
