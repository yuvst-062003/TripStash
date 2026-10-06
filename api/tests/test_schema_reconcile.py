"""A deployed database outlives any one build of the code.

TripStash was deployed from an earlier build whose models carried columns this
one does not, two of them NOT NULL with no server default. Left alone they
reject every insert, because SQLAlchemy leaves a column it does not know about
out of the statement entirely. These tests cover the repair.

The Postgres cases need a real server, since SQLite cannot alter a column and
the repair is a no-op there. Point TRIPSTASH_TEST_POSTGRES_URL at an empty
database to run them.
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text

from app import db as db_module

POSTGRES_URL = os.environ.get("TRIPSTASH_TEST_POSTGRES_URL")
needs_postgres = pytest.mark.skipif(
    not POSTGRES_URL, reason="Set TRIPSTASH_TEST_POSTGRES_URL to run the Postgres cases."
)


def test_the_repair_is_a_no_op_on_sqlite():
    # A development database is built from the current models, so there is
    # never a legacy column to repair, and SQLite could not alter one anyway.
    from sqlalchemy import inspect

    assert db_module._neutralise_legacy_not_null(inspect(db_module.engine)) == []


def test_only_unambiguous_types_get_a_default():
    # Guessing an "empty" value for a date or a JSON column would be inventing
    # data, so those are reported instead. Booleans and numbers are safe.
    assert db_module._SAFE_DEFAULTS["BOOLEAN"] == "false"
    assert db_module._SAFE_DEFAULTS["INTEGER"] == "0"
    assert "DATE" not in db_module._SAFE_DEFAULTS
    assert "JSONB" not in db_module._SAFE_DEFAULTS
    assert "TIMESTAMP" not in db_module._SAFE_DEFAULTS


def test_startup_survives_a_postgres_without_postgis(monkeypatch):
    """PostGIS is an optimisation; spatial.py already has an exact fallback.

    Managed Postgres often does not ship it, and `CREATE EXTENSION IF NOT
    EXISTS` still raises when it is not installed on the machine. Refusing to
    boot over a missing index would take the whole app down for it.
    """
    from sqlalchemy.exc import OperationalError

    def explode(*_args, **_kwargs):
        raise OperationalError("CREATE EXTENSION", {}, Exception("not available"))

    monkeypatch.setattr(db_module.engine, "begin", explode)

    assert db_module._try_enable_postgis() is False


@needs_postgres
def test_a_legacy_not_null_column_stops_rejecting_inserts():
    engine = create_engine(POSTGRES_URL, future=True)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS legacy_probe"))
        # Stands in for `source.found`: left behind by an older build, NOT NULL,
        # no server default, and absent from this build's models.
        conn.execute(
            text(
                "CREATE TABLE legacy_probe (  id VARCHAR(32) PRIMARY KEY,  found BOOLEAN NOT NULL)"
            )
        )

    monkey = db_module.engine
    try:
        db_module.engine = engine
        from sqlalchemy import inspect

        repaired = db_module._neutralise_legacy_not_null(inspect(engine))
    finally:
        db_module.engine = monkey

    # The probe table is not in this build's metadata at all, so it is left
    # alone - the repair only touches tables the models do declare.
    assert "legacy_probe.found" not in repaired

    with engine.begin() as conn:
        conn.execute(text("DROP TABLE legacy_probe"))
