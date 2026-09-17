"""TripStash API application.

A modular monolith: one deployable, clear internal seams (adapters, services,
routers). See docs/adr/0001-modular-monolith.md for why.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.config import get_settings
from app.db import init_db
from app.routers import account, assistant, auth, capture, places, planner, trips
from app.services.extraction import CaptureError

logging.basicConfig(level=logging.INFO)

API_PREFIX = "/api/v1"

app = FastAPI(
    title="TripStash API",
    version=__version__,
    description=(
        "Personal travel memory and decision layer. Capture anything, confirm what "
        "was extracted, see it on your own map, and hand the next action to the "
        "service that does it best."
    ),
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (auth, trips, capture, places, assistant, planner, account):
    app.include_router(router.router, prefix=API_PREFIX)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health", tags=["meta"])
def health() -> dict:
    """Liveness plus which providers are live - useful when fakes are enabled."""
    return {
        "status": "ok",
        "version": __version__,
        "providers": {
            "ai": settings.ai_provider,
            "places": settings.places_provider,
            "weather": settings.weather_provider,
            "fx": settings.fx_provider,
            "storage": settings.storage_provider,
        },
    }


@app.exception_handler(CaptureError)
def capture_error_handler(request: Request, exc: CaptureError) -> JSONResponse:
    """Capture problems are the user's to resolve, so they carry their own text.

    Scoped to `CaptureError` deliberately: a blanket ValueError handler would
    dress internal failures up as validation errors and hide real bugs.
    """
    return JSONResponse(status_code=422, content={"detail": str(exc)})


# ----------------------------------------------------------------- the PWA
# Registered last, so /api and /health always win. Hashed assets are served
# with long caching; everything else falls back to index.html so a deep link
# like /places/abc opens the app, and sw.js is never cached.

if settings.static_dir and settings.static_dir.is_dir():
    _static = settings.static_dir
    app.mount("/assets", StaticFiles(directory=_static / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404)
        candidate = (_static / path).resolve()
        if path and candidate.is_file() and _static.resolve() in candidate.parents:
            no_store = {"Cache-Control": "no-cache, no-store, must-revalidate"}
            return FileResponse(candidate, headers=no_store if path == "sw.js" else None)
        return FileResponse(_static / "index.html", headers={"Cache-Control": "no-cache"})
