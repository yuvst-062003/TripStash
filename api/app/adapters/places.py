"""Place resolution providers."""

from __future__ import annotations

from app.adapters.base import ResolvedPlace
from app.adapters.gazetteer import GAZETTEER
from app.services.text import normalize_name, similarity


def _to_resolved(entry: dict, confidence: float) -> ResolvedPlace:
    return ResolvedPlace(
        provider="fake",
        provider_place_id=entry["provider_place_id"],
        name=entry["name"],
        lat=entry["lat"],
        lon=entry["lon"],
        category=entry["category"],
        address=entry.get("address"),
        city=entry.get("city"),
        country=entry.get("country"),
        phone=entry.get("phone"),
        website=entry.get("website"),
        aliases=list(entry.get("aliases", [])),
        opening_hours=entry.get("opening_hours"),
        price_level=entry.get("price_level"),
        match_confidence=round(confidence, 3),
    )


class FakePlacesProvider:
    """Deterministic gazetteer lookup.

    Returns *candidates* rather than a single answer, because spec 7.3 requires
    the user to confirm an ambiguous match before anything is saved.
    """

    name = "fake"

    def resolve(
        self,
        query: str,
        *,
        near_lat: float | None = None,
        near_lon: float | None = None,
        city_hint: str | None = None,
        limit: int = 5,
    ) -> list[ResolvedPlace]:
        query_norm = normalize_name(query)
        if not query_norm:
            return []

        scored: list[tuple[float, dict]] = []
        for entry in GAZETTEER:
            names = [entry["name"], *entry.get("aliases", [])]
            score = max(similarity(query, name) for name in names)
            if any(normalize_name(name) == query_norm for name in names):
                score = 1.0
            if score <= 0.0:
                continue
            if city_hint and normalize_name(city_hint) == normalize_name(entry.get("city") or ""):
                score = min(1.0, score + 0.15)
            if near_lat is not None and near_lon is not None:
                from app.services.spatial import haversine_km

                distance = haversine_km(near_lat, near_lon, entry["lat"], entry["lon"])
                if distance <= 50:
                    score = min(1.0, score + 0.1)
                elif distance > 1000:
                    score = max(0.0, score - 0.1)
            scored.append((score, entry))

        scored.sort(key=lambda pair: (-pair[0], pair[1]["name"]))
        return [_to_resolved(entry, score) for score, entry in scored[:limit] if score >= 0.25]

    def details(self, provider_place_id: str) -> ResolvedPlace | None:
        for entry in GAZETTEER:
            if entry["provider_place_id"] == provider_place_id:
                return _to_resolved(entry, 1.0)
        return None
