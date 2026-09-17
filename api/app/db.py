"""Engine, session factory and schema bootstrap."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
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


def init_db() -> None:
    """Create the schema and, on Postgres, the PostGIS extension and index.

    `create_all` is deliberate for a single-user prototype; Alembic is the
    documented follow-up before the schema is deployed anywhere shared.
    """
    import app.models  # noqa: F401  (ensure every mapper is imported)

    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))

    Base.metadata.create_all(bind=engine)

    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_place_geog ON place "
                    "USING GIST ((ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography))"
                )
            )


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
