import asyncio
from typing import Any

from app.climate import ClimateWatchService


def test_climate_watch_calculates_anomalies_hot_dry_fires_and_cache() -> None:
    calls = 0

    async def fetcher(url: str, params: dict[str, str]) -> dict[str, Any]:
        nonlocal calls
        calls += 1
        if "eonet" in url:
            return {"events": [{"id": "EONET-1", "title": "Test fire", "geometry": [{"date": "2026-06-01", "coordinates": [100.0, 13.0]}]}]}
        if "archive" in url:
            return {"daily": {"time": ["1991-06-01"], "temperature_2m_mean": [28], "precipitation_sum": [10]}}
        return {"daily": {"time": ["2026-06-01"], "temperature_2m_mean": [30], "precipitation_sum": [5]}}

    service = ClimateWatchService(1, fetcher)
    result = asyncio.run(service.get(13, 100))
    season = result["seasons"][0]
    assert season["temperature_anomaly_c"] == 2
    assert season["precipitation_anomaly_mm"] == -5
    assert season["hot_dry_signal"] is True
    assert result["wildfires"][0]["id"] == "EONET-1"
    assert asyncio.run(service.get(13, 100))["cached"] is True
    assert calls == 3
