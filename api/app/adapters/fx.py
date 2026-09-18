"""Exchange-rate providers."""

from __future__ import annotations

# Indicative mid-market rates against USD. A real provider replaces this table;
# expenses store the converted amount at capture time so history stays stable.
_USD_RATES: dict[str, float] = {
    "USD": 1.0,
    "EUR": 0.92,
    "GBP": 0.79,
    "ILS": 3.70,
    "GTQ": 7.80,
    "MXN": 17.20,
    "COP": 3950.0,
    "THB": 35.50,
    "VND": 25400.0,
}


class FakeFxProvider:
    name = "fake"

    def rate(self, base: str, quote: str) -> float:
        base, quote = base.upper(), quote.upper()
        if base == quote:
            return 1.0
        if base not in _USD_RATES or quote not in _USD_RATES:
            raise ValueError(f"unsupported currency pair {base}/{quote}")
        return _USD_RATES[quote] / _USD_RATES[base]

    @property
    def supported(self) -> list[str]:
        return sorted(_USD_RATES)
