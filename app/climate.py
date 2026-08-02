from __future__ import annotations

import asyncio
import math
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime
from time import monotonic
from typing import Any

import httpx

JsonFetcher = Callable[[str, dict[str, str]], Awaitable[dict[str, Any]]]

CLIMATE_URL = "https://climate-api.open-meteo.com/v1/climate"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events"
CACHE_SECONDS = 6 * 60 * 60


def _season(month: int) -> str:
    return ("winter", "spring", "summer", "autumn")[(month % 12) // 3]


def _average(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def _distance_km(latitude: float, longitude: float, other_lat: float, other_lon: float) -> float:
    radius_km = 6_371.0
    d_lat, d_lon = math.radians(other_lat - latitude), math.radians(other_lon - longitude)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(latitude)) * math.cos(math.radians(other_lat)) * math.sin(d_lon / 2) ** 2
    return 2 * radius_km * math.asin(math.sqrt(a))


class ClimateWatchService:
    """On-demand climate aggregation with a small, per-location six-hour cache."""

    def __init__(self, timeout_seconds: float, fetcher: JsonFetcher | None = None) -> None:
        self.timeout_seconds = timeout_seconds
        self.fetcher = fetcher or self._http_get
        self._cache: dict[tuple[float, float], tuple[float, dict[str, Any]]] = {}
        self._lock = asyncio.Lock()

    async def _http_get(self, url: str, params: dict[str, str]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            return response.json()

    async def get(self, latitude: float, longitude: float) -> dict[str, Any]:
        key = (round(latitude, 3), round(longitude, 3))
        cached = self._cache.get(key)
        if cached and monotonic() - cached[0] < CACHE_SECONDS:
            return {**cached[1], "cached": True}
        async with self._lock:
            cached = self._cache.get(key)
            if cached and monotonic() - cached[0] < CACHE_SECONDS:
                return {**cached[1], "cached": True}
            result = await self._load(latitude, longitude)
            self._cache[key] = (monotonic(), result)
            return result

    async def _load(self, latitude: float, longitude: float) -> dict[str, Any]:
        seasonal_params = {
            "latitude": str(latitude), "longitude": str(longitude), "start_date": "2026-01-01",
            "end_date": "2027-12-31", "daily": "temperature_2m_mean,precipitation_sum",
            "models": "EC_Earth3P_HR", "timezone": "auto",
        }
        baseline_params = {
            "latitude": str(latitude), "longitude": str(longitude), "start_date": "1991-01-01",
            "end_date": "2020-12-31", "daily": "temperature_2m_mean,precipitation_sum", "timezone": "auto",
        }
        fire_params = {"status": "open", "category": "wildfires", "limit": "100"}
        seasonal, baseline, fires = await asyncio.gather(
            self.fetcher(CLIMATE_URL, seasonal_params),
            self.fetcher(ARCHIVE_URL, baseline_params),
            self.fetcher(EONET_URL, fire_params),
        )
        seasons = self._summarize_seasons(seasonal, baseline)
        nearby_fires = self._nearby_fires(fires, latitude, longitude)
        return {
            "latitude": latitude,
            "longitude": longitude,
            "generated_at": datetime.now(UTC).isoformat(),
            "cache_ttl_seconds": CACHE_SECONDS,
            "cached": False,
            "source": "Open-Meteo Climate API (ECMWF EC-Earth3P-HR) and NASA EONET",
            "seasons": seasons,
            "wildfires": nearby_fires,
        }

    def _summarize_seasons(self, seasonal: dict[str, Any], baseline: dict[str, Any]) -> list[dict[str, Any]]:
        future_daily = seasonal.get("daily", {})
        historic_daily = baseline.get("daily", {})
        baseline_by_season: dict[str, dict[str, list[float]]] = {}
        for raw_date, temp, rain in zip(historic_daily.get("time", []), historic_daily.get("temperature_2m_mean", []), historic_daily.get("precipitation_sum", []), strict=True):
            bucket = baseline_by_season.setdefault(_season(date.fromisoformat(raw_date).month), {"temp": [], "rain": []})
            if temp is not None: bucket["temp"].append(float(temp))
            if rain is not None: bucket["rain"].append(float(rain))
        future_by_season: dict[tuple[int, str], dict[str, list[float]]] = {}
        for raw_date, temp, rain in zip(future_daily.get("time", []), future_daily.get("temperature_2m_mean", []), future_daily.get("precipitation_sum", []), strict=True):
            item_date = date.fromisoformat(raw_date)
            bucket = future_by_season.setdefault((item_date.year, _season(item_date.month)), {"temp": [], "rain": []})
            if temp is not None: bucket["temp"].append(float(temp))
            if rain is not None: bucket["rain"].append(float(rain))
        result = []
        for (year, name), values in sorted(future_by_season.items()):
            temp, rain = _average(values["temp"]), round(sum(values["rain"]), 1)
            reference = baseline_by_season.get(name, {"temp": [], "rain": []})
            baseline_temp, baseline_rain = _average(reference["temp"]), round(sum(reference["rain"]) / 30, 1) if reference["rain"] else None
            temp_anomaly = round(temp - baseline_temp, 1) if temp is not None and baseline_temp is not None else None
            rain_anomaly = round(rain - baseline_rain, 1) if baseline_rain is not None else None
            hot_dry = bool(temp_anomaly is not None and rain_anomaly is not None and temp_anomaly >= 1.0 and rain_anomaly < 0)
            result.append({"year": year, "season": name, "temperature_c": temp, "precipitation_mm": rain, "temperature_anomaly_c": temp_anomaly, "precipitation_anomaly_mm": rain_anomaly, "hot_dry_signal": hot_dry})
        return result

    def _nearby_fires(self, payload: dict[str, Any], latitude: float, longitude: float) -> list[dict[str, Any]]:
        fires = []
        for event in payload.get("events", []):
            geometries = event.get("geometry") or []
            coordinates = geometries[-1].get("coordinates") if geometries else None
            if not isinstance(coordinates, list) or len(coordinates) < 2:
                continue
            fire_lon, fire_lat = coordinates[:2]
            distance = _distance_km(latitude, longitude, float(fire_lat), float(fire_lon))
            if distance <= 500:
                fires.append({"id": event.get("id"), "title": event.get("title"), "date": geometries[-1].get("date"), "distance_km": round(distance, 1)})
        return sorted(fires, key=lambda fire: fire["distance_km"])
