"""Background jobs: media processing and freshness refresh."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from fastapi import BackgroundTasks
from sqlalchemy import select

from app.adapters import get_places
from app.config import get_settings
from app.db import session_scope
from app.models.capture import Source
from app.models.enums import FactKind, Provenance, SourceStatus
from app.models.places import Place, PlaceFact
from app.services.extraction import process_source

logger = logging.getLogger(__name__)

REFRESH_AFTER = timedelta(days=7)


def enqueue_source_processing(source_id: str, background: BackgroundTasks | None = None) -> None:
    """Run extraction now, or hand it to a background task.

    Closing the application must not lose an upload (spec 7.5), so the Source
    row is already committed before this is called; a failure here leaves the
    item retryable in Inbox rather than dropping it.
    """
    if get_settings().worker_inline or background is None:
        _process(source_id)
        return
    background.add_task(_process, source_id)


def _process(source_id: str) -> None:
    try:
        with session_scope() as session:
            source = session.get(Source, source_id)
            if source is None:
                return
            process_source(session, source)
    except Exception:  # pragma: no cover - defensive; the retry path covers it
        logger.exception("extraction failed for source %s", source_id)
        with session_scope() as session:
            source = session.get(Source, source_id)
            if source is not None:
                source.status = SourceStatus.FAILED
                source.failure_reason = (
                    "Processing failed unexpectedly. The original is kept - retry, or "
                    "add the place manually."
                )


def refresh_stale_facts(limit: int = 50) -> int:
    """Re-check provider facts that have aged out (spec 8.2).

    Only provider-sourced rows are refreshed; user-entered values are never
    overwritten by enrichment.
    """
    provider = get_places()
    cutoff = datetime.now(UTC) - REFRESH_AFTER
    refreshed = 0

    with session_scope() as session:
        stale = session.execute(
            select(PlaceFact)
            .where(
                PlaceFact.provenance == Provenance.PROVIDER,
                PlaceFact.checked_at < cutoff,
            )
            .limit(limit)
        ).scalars()

        for fact in stale:
            place = session.get(Place, fact.place_id)
            if place is None or not place.provider_place_id:
                continue
            details = provider.details(place.provider_place_id)
            if details is None:
                continue
            value = {
                FactKind.HOURS: details.opening_hours,
                FactKind.PRICE: details.price_level,
                FactKind.PHONE: details.phone,
                FactKind.WEBSITE: details.website,
                FactKind.ADDRESS: details.address,
            }.get(FactKind(fact.kind))
            if not value:
                continue
            fact.value = value
            fact.checked_at = datetime.now(UTC)
            fact.expires_at = fact.checked_at + REFRESH_AFTER
            refreshed += 1

    return refreshed
