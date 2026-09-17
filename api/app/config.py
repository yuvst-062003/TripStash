"""Runtime configuration.

Every setting has a default that keeps the stack runnable with no external
accounts, so a fresh clone boots into the fake-provider mode described in
docs/architecture.md.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


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

    secret_key: str = "dev-only-insecure-change-me"
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


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    if settings.database_url.startswith("sqlite"):
        (REPO_ROOT / "var").mkdir(parents=True, exist_ok=True)
    return settings
