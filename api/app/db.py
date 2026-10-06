"""Engine, session factory and schema bootstrap."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.models.base import Base

_settings = get_settings()

_connect_args = {}
if _settings.database_url.startswith("sqlite"):
    _connect_args = {"check_same_thread": False}

engine: Engine = create_engine(
    _settings.database_url,
    echo=_settings.sql_echo,
    future=True,
    pool_pre_ping=True,
    connect_args=_connect_args,
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_connection, _record):  # pragma: no cover - driver hook
    if engine.dialect.name != "sqlite":
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


# Columns added after a database was first created. `create_all` will not add a
# column to a table that already exists, and there is no Alembic yet (see
# docs/data-model.md), so each additive column is reconciled explicitly. The
# list is deliberately short and append-only; anything that is not a nullable
# add belongs in a real migration.
_ADDITIVE_COLUMNS: tuple[tuple[str, str, str], ...] = (("destination", "nights", "INTEGER"),)


# What "nothing was supplied" means, per column type. Deliberately narrow: a
# type that is not here is reported rather than guessed at.
_SAFE_DEFAULTS: dict[str, str] = {
    "BOOLEAN": "false",
    "INTEGER": "0",
    "BIGINT": "0",
    "SMALLINT": "0",
    "FLOAT": "0",
    "DOUBLE PRECISION": "0",
    "NUMERIC": "0",
    "TEXT": "''",
    "VARCHAR": "''",
}


def _neutralise_legacy_not_null(inspector) -> list[str]:
    """Stop a column this build has never heard of from rejecting every insert.

    A deployed database outlives any one version of the code. When an earlier
    build left a column behind as NOT NULL with no server default, and the
    current models do not know about it, every insert fails: SQLAlchemy leaves
    an unknown column out of the statement entirely, so the row arrives with
    nothing for it and the constraint rejects it.

    Nothing here is wrong except the mismatch, so each such column is given a
    server-side default and inserts that omit it succeed again. The existing
    data is untouched, and the column is kept rather than dropped, because
    another build may still be reading it.

    Postgres only. SQLite cannot alter a column and does not need to: a
    development database is built from the current models in the first place.
    """
    if engine.dialect.name != "postgresql":
        return []

    log = logging.getLogger(__name__)
    repaired: list[str] = []
    present = set(inspector.get_table_names())

    for table in Base.metadata.sorted_tables:
        if table.name not in present:
            continue
        known = set(table.columns.keys())
        for column in inspector.get_columns(table.name):
            name = column["name"]
            if name in known or column.get("nullable", True):
                continue
            if column.get("default") is not None:
                continue
            literal = _SAFE_DEFAULTS.get(str(column["type"]).upper().split("(")[0].strip())
            if literal is None:
                log.warning(
                    "%s.%s is NOT NULL, has no default, and this build does not know it. "
                    "Inserts into %s will fail until it is given one by hand.",
                    table.name,
                    name,
                    table.name,
                )
                continue
            with engine.begin() as conn:
                conn.execute(
                    text(f"ALTER TABLE {table.name} ALTER COLUMN {name} SET DEFAULT {literal}")
                )
            repaired.append(f"{table.name}.{name}")

    if repaired:
        log.info("Defaulted %d legacy NOT NULL column(s): %s", len(repaired), ", ".join(repaired))
    return repaired


def _reconcile_additive_columns(inspector) -> None:
    tables = set(inspector.get_table_names())
    for table, column, column_type in _ADDITIVE_COLUMNS:
        if table not in tables:
            continue
        if column in {c["name"] for c in inspector.get_columns(table)}:
            continue
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}"))


def _try_enable_postgis() -> bool:
    """Turn PostGIS on where it is available. Never a reason to fail startup."""
    log = logging.getLogger(__name__)
    try:
        with engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    except SQLAlchemyError as error:
        # Not installed on the server, or the role may not create extensions.
        log.info(
            "PostGIS unavailable, using the bounding-box and haversine path instead (%s)",
            type(error).__name__,
        )
        return False
    return True


def init_db() -> None:
    """Create the schema and, where it exists, the PostGIS extension and index.

    `create_all` is deliberate for a single-user prototype; Alembic is the
    documented follow-up before the schema is deployed anywhere shared.
    """
    import app.models  # noqa: F401  (ensure every mapper is imported)

    # PostGIS makes nearby-place queries an indexed lookup, but it is an
    # optimisation and not a requirement: `services/spatial.py` already falls
    # back to a bounding box plus a haversine filter, which is exact and fast
    # enough for one person's saves. Plenty of managed Postgres offerings -
    # Railway's among them - do not ship the extension at all, and
    # `CREATE EXTENSION IF NOT EXISTS` still raises when it is not installed on
    # the machine. Refusing to start over a missing optimisation would take the
    # whole app down for it, so this is attempted and logged, never required.
    has_postgis = False
    if engine.dialect.name == "postgresql":
        has_postgis = _try_enable_postgis()

    Base.metadata.create_all(bind=engine)

    if has_postgis:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_place_geog ON place "
                    "USING GIST ((ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography))"
                )
            )

    inspector = inspect(engine)
    _reconcile_additive_columns(inspector)
    # A database that outlived an earlier build can carry NOT NULL columns this
    # one has never heard of. Left alone, they reject every insert.
    _neutralise_legacy_not_null(inspector)


def get_session() -> Iterator[Session]:
    """FastAPI dependency."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Standalone unit of work for workers and scripts."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
