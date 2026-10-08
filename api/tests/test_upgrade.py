"""Upgrading a database that was built before this release.

`create_all` creates missing tables but never alters an existing one, so a
column added after a deploy is simply absent on the live database until
something puts it there. That is not a hypothetical: the volume on the
deployed instance holds a database from before the found tier existed.
"""

from __future__ import annotations

from sqlalchemy import create_engine, inspect, text

from app.db import _ADDED_COLUMNS


def test_every_column_added_since_release_is_registered():
    """A new column on an existing table must be listed, or a deploy breaks."""
    registered = {(table, column) for table, column, _ddl in _ADDED_COLUMNS}
    assert ("source", "found") in registered


def test_a_database_missing_the_column_is_upgraded(tmp_path):
    """Build the old shape, run the upgrade, and check the column arrives."""
    url = f"sqlite+pysqlite:///{tmp_path / 'old.db'}"
    engine = create_engine(url, future=True)

    # The source table as it was before the found tier.
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE source ("
                "id VARCHAR PRIMARY KEY, trip_id VARCHAR, kind VARCHAR, "
                "fingerprint VARCHAR NOT NULL)"
            )
        )
        conn.execute(
            text("INSERT INTO source (id, trip_id, kind, fingerprint) VALUES ('a','t','link','f')")
        )

    before = {c["name"] for c in inspect(engine).get_columns("source")}
    assert "found" not in before

    # The same additive upgrade init_db runs, applied to this engine.
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table, column, ddl in _ADDED_COLUMNS:
            if table not in tables:
                continue
            present = {col["name"] for col in inspector.get_columns(table)}
            if column not in present:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))

    after = {c["name"] for c in inspect(engine).get_columns("source")}
    assert "found" in after

    # The row that was already there survives, defaulted to not-found - which
    # is right: anything saved before the tier existed was saved by the
    # traveller, never found by the app.
    with engine.begin() as conn:
        value = conn.execute(text("SELECT found FROM source WHERE id='a'")).scalar()
    assert value in (0, False)
