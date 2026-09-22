"""Serving the built PWA from the API process.

The compose stack puts nginx in front and proxies `/api` to this service. A
single-service host - Railway, Fly, a small VPS - has no second container to
do that, so the API serves the static build itself. Same origin either way,
which is what keeps CORS out of the picture and lets the service worker,
the share target and geolocation work at all.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

# The hashed bundles never change under a name; everything else must not be
# frozen, or an update can never reach an installed device.
IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}
NEVER_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate"}


def _headers(path: str) -> dict[str, str]:
    if path.startswith("assets/"):
        return IMMUTABLE
    return NEVER_CACHE


def mount_web(app: FastAPI, directory: Path) -> bool:
    """Serve `directory` as the single-page app, under everything else.

    Registered last on purpose: `/api/...`, `/health` and the docs are already
    declared, so they keep matching first. Returns whether anything was mounted
    so a misconfigured path fails loudly in the log rather than silently
    serving nothing.
    """
    root = directory.resolve()
    index = root / "index.html"
    if not index.is_file():
        logger.warning("TRIPSTASH_STATIC_DIR=%s has no index.html; not serving a web app", root)
        return False

    @app.get("/{path:path}", include_in_schema=False)
    def web_app(path: str) -> FileResponse:
        # An unknown API path is a 404, not the app shell: returning HTML with
        # a 200 would turn a typo in a fetch into a silent parse error.
        if path.startswith("api/"):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")

        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate, headers=_headers(path))
        # Any other route belongs to the client-side router.
        return FileResponse(index, headers=NEVER_CACHE)

    logger.info("serving the web app from %s", root)
    return True
