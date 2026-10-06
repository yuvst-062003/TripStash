"""Provider registry.

One place decides which driver is live, so call sites only ever see the
protocols in app/adapters/base.py.
"""

from __future__ import annotations

from functools import lru_cache

from app.adapters.ai import FakeAIAdapter
from app.adapters.base import (
    AIAdapter,
    ContentSourceAdapter,
    FetchedPage,
    FxProvider,
    MediaPayload,
    PermissionDecision,
    PlacesProvider,
    ResolvedPlace,
    SearchProvider,
    SearchResult,
    StorageAdapter,
    WeatherProvider,
    WeatherReading,
)
from app.adapters.content import FakeContentSource
from app.adapters.fx import FakeFxProvider
from app.adapters.places import FakePlacesProvider
from app.adapters.search import FakeSearchProvider
from app.adapters.storage import LocalStorageAdapter
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


@lru_cache
def get_content_source() -> ContentSourceAdapter:
    """Reads public pages. The fake is the default and touches no network.

    There is deliberately no `real` branch yet: the preconditions in
    docs/sources.md have to be satisfied per host before one would be
    legitimate, and the fake applies exactly the same gate, so wiring a
    transport behind it later changes how bytes arrive and nothing else.
    """
    return FakeContentSource()


@lru_cache
def get_search() -> SearchProvider:
    return FakeSearchProvider()


__all__ = [
    "AIAdapter",
    "ContentSourceAdapter",
    "FetchedPage",
    "FxProvider",
    "MediaPayload",
    "PermissionDecision",
    "PlacesProvider",
    "ResolvedPlace",
    "SearchProvider",
    "SearchResult",
    "StorageAdapter",
    "WeatherProvider",
    "WeatherReading",
    "get_ai",
    "get_content_source",
    "get_fx",
    "get_places",
    "get_search",
    "get_storage",
    "get_weather",
]
