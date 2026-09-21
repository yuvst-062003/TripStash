"""Runtime configuration.

Every setting has a default that keeps the stack runnable with no external
accounts, so a fresh clone boots into the fake-provider mode described in
docs/architecture.md.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]

# This exact string is in the repository, so it is public. It signs session
# tokens and the signed file URLs, which means shipping it would let anyone who
# can read the source forge a login for any account and mint a URL for any
# stored file.
INSECURE_SECRET = "dev-only-insecure-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="TRIPSTASH_",
        env_file=(REPO_ROOT / ".env"),
        extra="ignore",
    )

    # SQLite keeps `pytest` and a bare `uvicorn` run dependency-free; the
    # deployment target is Postgres + PostGIS (see app/services/spatial.py).
    database_url: str = f"sqlite+pysqlite:///{REPO_ROOT / 'var' / 'tripstash.db'}"
    sql_echo: bool = False

    # development | production. Production refuses the shipped defaults.
    environment: str = "development"

    secret_key: str = INSECURE_SECRET
    access_token_ttl_minutes: int = 60 * 24 * 30

    storage_dir: Path = REPO_ROOT / "var" / "storage"
    signed_url_ttl_seconds: int = 600
    max_upload_bytes: int = 200 * 1024 * 1024

    ai_provider: str = "fake"
    places_provider: str = "fake"
    weather_provider: str = "fake"
    fx_provider: str = "fake"
    storage_provider: str = "local"

    # Any OpenAI-compatible local server: Ollama, llama.cpp, LM Studio, vLLM.
    # Nothing here costs money; the weights run on your own machine.
    llm_base_url: str = "http://localhost:11434/v1"
    llm_model: str = "qwen2.5:7b-instruct-q4_K_M"
    llm_timeout_seconds: float = 120.0
    llm_api_key: str | None = None

    places_api_key: str | None = None
    weather_api_key: str | None = None

    # Reading what a pasted link publishes about itself. Disabled in tests so
    # the suite never touches the network.
    link_fetch_enabled: bool = True
    link_timeout_seconds: float = 15.0

    # Media understanding. OCR runs offline from weights bundled in the wheel;
    # speech to text needs the `asr` extra and fetches its model once.
    media_enabled: bool = True
    media_asr: bool = True
    media_ocr: bool = True
    media_max_frames: int = 12
    media_max_duration_seconds: float = 900.0
    media_asr_model: str = "small"

    # When true the extraction pipeline runs in FastAPI background tasks.
    # A separate queue worker replaces this without changing call sites.
    worker_inline: bool = True

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


class InsecureDeploymentError(RuntimeError):
    """Raised instead of booting with a default that only suits a laptop."""


def assert_deployable(settings: Settings) -> None:
    """Refuse to start a production instance with the shipped secret.

    A silent insecure default is worse than a crash: the crash is noticed on
    the first deploy, the default is noticed after someone reads the trip.
    """
    if settings.environment == "development":
        return

    if settings.secret_key == INSECURE_SECRET or len(settings.secret_key) < 32:
        raise InsecureDeploymentError(
            "TRIPSTASH_SECRET_KEY is still the development default, or is too "
            "short, and TRIPSTASH_ENVIRONMENT is not 'development'. It signs "
            "session tokens and file URLs, so this would let anyone who can read "
            "the source sign in as you.\n\n"
            "Generate one and set it:\n"
            "  python -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )

    # An empty list means the web app is served from the same origin, which is
    # how the bundled compose file runs. Only a localhost-only list is wrong.
    if settings.cors_origins and all(
        "localhost" in origin or "127.0.0.1" in origin for origin in settings.cors_origins
    ):
        logger.warning(
            "TRIPSTASH_CORS_ORIGINS still points only at localhost; the web app "
            "will be refused by the browser once it is served from a real domain."
        )


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    assert_deployable(settings)
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    if settings.database_url.startswith("sqlite"):
        (REPO_ROOT / "var").mkdir(parents=True, exist_ok=True)
    return settings
