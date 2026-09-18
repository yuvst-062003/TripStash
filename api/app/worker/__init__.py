"""Asynchronous processing.

The MVP runs jobs in FastAPI background tasks (or inline for deterministic
tests). The queue interface is isolated here so a real broker can replace it
without touching the routers.
"""

from app.worker.jobs import enqueue_source_processing, refresh_stale_facts

__all__ = ["enqueue_source_processing", "refresh_stale_facts"]
