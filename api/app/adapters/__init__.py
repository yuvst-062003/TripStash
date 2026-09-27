"""Provider registry.

One place decides which driver is live, so call sites only ever see the
protocols in app/adapters/base.py.
"""

from __future__ import annotations

from functools import lru_cache

from app.adapters.ai import FakeAIAdapter
from app.adapters.base import (
    AIAdapter,
    FxProvider,
    MediaPayload,
    PlacesProvider,
    ResolvedPlace,
    StorageAdapter,
    WeatherProvider,
    WeatherReading,
)
from app.adapters.fx import FakeFxProvider
from app.adapters.places import FakePlacesProvider
from app.adapters.storage import LocalStorageAdapter
from app.adapters.video_search import FakeVideoSearch, YouTubeVideoSearch
from app.adapters.weather import FakeWeatherProvider
from app.config import get_settings


@lru_cache
def get_ai() -> AIAdapter:
    """`fake` is the zero-dependency default; `local` runs open weights.

    The local adapter keeps the rule-based one as its fallback, so a stopped
    model server degrades the quality of extraction rather than breaking it.
    """
    settings = get_settings()
    if settings.ai_provider == "local":
        from app.adapters.local_llm import LocalLLMAdapter

        return LocalLLMAdapter(
            settings.llm_base_url,
            settings.llm_model,
            timeout_seconds=settings.llm_timeout_seconds,
            api_key=settings.llm_api_key,
            fallback=FakeAIAdapter(),
        )
    return FakeAIAdapter()


@lru_cache
def get_web_search():
    """`fake` is deterministic and keyless; `brave` searches the open web.

    A key that is set but wrong should fail loudly at startup rather than turn
    every search into silence, so the real driver refuses to construct without
    one. Nothing here decides whether a result is trustworthy: that is
    `app.services.web_grading`, and it is applied at the point of use.
    """
    settings = get_settings()
    if settings.web_search_provider == "brave":
        from app.adapters.web_search import BraveWebSearch

        return BraveWebSearch(settings.web_search_api_key)

    from app.adapters.web_search import FakeWebSearch

    return FakeWebSearch()


@lru_cache
def get_video_search():
    """`fake` is deterministic and keyless; `youtube` is the only real search.

    TikTok bars commercial use of its Research API and Instagram exposes no
    search a traveller could drive, so a found clip is a YouTube clip.
    """
    settings = get_settings()
    if settings.video_search_provider == "youtube" and settings.youtube_api_key:
        return YouTubeVideoSearch(settings.youtube_api_key, region=settings.youtube_region)
    return FakeVideoSearch()


@lru_cache
def get_places() -> PlacesProvider:
    return FakePlacesProvider()


@lru_cache
def get_weather() -> WeatherProvider:
    return FakeWeatherProvider()


@lru_cache
def get_fx() -> FxProvider:
    return FakeFxProvider()


@lru_cache
def get_storage() -> StorageAdapter:
    return LocalStorageAdapter()


__all__ = [
    "AIAdapter",
    "FxProvider",
    "MediaPayload",
    "PlacesProvider",
    "ResolvedPlace",
    "StorageAdapter",
    "WeatherProvider",
    "WeatherReading",
    "get_ai",
    "get_fx",
    "get_places",
    "get_storage",
    "get_video_search",
    "get_weather",
]
