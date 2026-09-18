"""Weather providers."""

from __future__ import annotations

import hashlib
from datetime import UTC, date, datetime

from app.adapters.base import WeatherReading

_SUMMARIES = [
    "Clear",
    "Mostly sunny",
    "Partly cloudy",
    "Overcast",
    "Light rain",
    "Heavy rain showers",
]


class FakeWeatherProvider:
    """Deterministic pseudo-forecast keyed on (lat, lon, date).

    Deterministic on purpose: a recommendation that says "rain expected" must
    say the same thing when the test re-runs.
    """

    name = "fake"

    def forecast(self, lat: float, lon: float, on: date) -> WeatherReading:
        seed = hashlib.sha256(f"{lat:.2f}:{lon:.2f}:{on.isoformat()}".encode()).digest()
        summary = _SUMMARIES[seed[0] % len(_SUMMARIES)]
        temperature = 12 + (seed[1] % 22)
        precipitation = round((seed[2] % 101) / 100, 2)
        if summary.endswith("rain") or "rain" in summary:
            precipitation = max(precipitation, 0.55)
        return WeatherReading(
            summary=summary,
            temperature_c=float(temperature),
            precipitation_probability=precipitation,
            checked_at=datetime.now(UTC),
            for_date=on,
        )
