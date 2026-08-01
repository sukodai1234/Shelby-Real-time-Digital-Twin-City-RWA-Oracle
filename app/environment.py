from __future__ import annotations

import asyncio
import hashlib
import json
import time
from dataclasses import asdict, dataclass
from typing import Any

import httpx


class EnvironmentSourceError(RuntimeError):
    pass


BIOSENSORY_WEIGHTS = {
    "pm25": 0.22,
    "exogenous_exposure": 0.17,
    "precipitation_humidity": 0.22,
    "sea_salt_aerosol": 0.05,
    "wind": 0.17,
    "other_pollutants": 0.17,
}


@dataclass(frozen=True, slots=True)
class RiskBreakdown:
    score: int
    level: str
    alert_label: str
    air_quality: int
    precipitation: int
    humidity_weather: int
    humidity_only: int
    severe_weather: int

    def to_dict(self) -> dict[str, int | str]:
        return asdict(self)


def clamp_score(value: float) -> int:
    return max(1, min(100, round(value)))


def humidity_risk(relative_humidity: float) -> int:
    if relative_humidity > 90 or relative_humidity < 25:
        return 70
    if relative_humidity > 80 or relative_humidity < 35:
        return 40
    return 10


def precipitation_risk(current_mm_h: float, probability_pct: float) -> int:
    if current_mm_h >= 30:
        return 100
    if current_mm_h >= 10:
        return 70
    if current_mm_h >= 2:
        return 35
    if probability_pct > 70:
        return 30
    return 10


def air_quality_risk(us_aqi: float) -> int:
    if us_aqi <= 50:
        return 10
    if us_aqi <= 100:
        return 35
    if us_aqi <= 150:
        return 60
    if us_aqi <= 200:
        return 85
    return 100


def pm25_risk(pm25_ug_m3: float) -> int:
    return round(min(100, max(0, pm25_ug_m3 * 2.8)))


def wind_risk(wind_speed_kmh: float) -> int:
    wind_speed_ms = wind_speed_kmh / 3.6
    return 80 if wind_speed_ms < 0.8 or wind_speed_ms > 15 else 10


def sea_salt_aerosol_risk(sea_salt_ug_m3: float) -> int:
    """Versioned exposure heuristic; this is not a clinical salinity standard."""
    return round(min(100, max(0, sea_salt_ug_m3 * 4)))


def uv_risk(uv_index: float) -> int:
    if uv_index < 6:
        return 10
    if uv_index < 9:
        return 50
    if uv_index < 11:
        return 80
    return 100


def heat_stress_risk(apparent_temperature_c: float) -> int:
    if apparent_temperature_c < 32:
        return 10
    if apparent_temperature_c < 38:
        return 40
    if apparent_temperature_c < 42:
        return 75
    return 100


def no2_exposure_risk(nitrogen_dioxide_ug_m3: float) -> int:
    if nitrogen_dioxide_ug_m3 < 40:
        return 10
    if nitrogen_dioxide_ug_m3 >= 100:
        return 100
    return round(10 + (nitrogen_dioxide_ug_m3 - 40) * 90 / 60)


def precipitation_humidity_risk(
    precipitation_mm_h: float, relative_humidity_pct: float
) -> int:
    score = precipitation_risk(precipitation_mm_h, 0)
    if relative_humidity_pct < 25:
        score = max(score, 85)
    return score


def exogenous_exposure_risk(
    *,
    uv_index: float | None,
    apparent_temperature_c: float,
    nitrogen_dioxide_ug_m3: float | None,
) -> int | None:
    if uv_index is None or nitrogen_dioxide_ug_m3 is None:
        return None
    return round(
        uv_risk(uv_index) * 0.40
        + heat_stress_risk(apparent_temperature_c) * 0.40
        + no2_exposure_risk(nitrogen_dioxide_ug_m3) * 0.20
    )


def _risk_level(score: int) -> tuple[str, str]:
    if score >= 75:
        return "HIGH_DANGER", "High Danger (Rủi ro cao)"
    if score >= 50:
        return "WARNING", "Warning (Cảnh báo)"
    if score >= 30:
        return "MODERATE", "Moderate (Mức trung bình)"
    return "SAFE", "Safe (An toàn)"


def calculate_biosensory_index(
    *,
    precipitation_mm_h: float,
    relative_humidity_pct: float,
    wind_speed_kmh: float,
    pm25_ug_m3: float,
    sea_salt_aerosol_ug_m3: float | None,
    uv_index: float | None,
    apparent_temperature_c: float,
    nitrogen_dioxide_ug_m3: float | None,
    other_pollutant_aqi_values: list[float],
) -> dict[str, Any]:
    components: dict[str, int | None] = {
        "pm25": pm25_risk(pm25_ug_m3),
        "exogenous_exposure": exogenous_exposure_risk(
            uv_index=uv_index,
            apparent_temperature_c=apparent_temperature_c,
            nitrogen_dioxide_ug_m3=nitrogen_dioxide_ug_m3,
        ),
        "precipitation_humidity": precipitation_humidity_risk(
            precipitation_mm_h, relative_humidity_pct
        ),
        "sea_salt_aerosol": (
            sea_salt_aerosol_risk(sea_salt_aerosol_ug_m3)
            if sea_salt_aerosol_ug_m3 is not None
            else None
        ),
        "wind": wind_risk(wind_speed_kmh),
        "other_pollutants": (
            round(min(100, max(other_pollutant_aqi_values)))
            if other_pollutant_aqi_values
            else None
        ),
    }
    available_weight = sum(
        BIOSENSORY_WEIGHTS[name] for name, value in components.items() if value is not None
    )
    score = clamp_score(
        sum(
            BIOSENSORY_WEIGHTS[name] * value
            for name, value in components.items()
            if value is not None
        )
        / available_weight
    )
    level, alert_label = _risk_level(score)
    effective_weights = {
        name: round(weight / available_weight, 4) if components[name] is not None else 0
        for name, weight in BIOSENSORY_WEIGHTS.items()
    }
    return {
        "score": score,
        "level": level,
        "alert_label": alert_label,
        "health_suitability_score": 101 - score,
        "data_confidence_pct": round(available_weight * 100),
        "components": components,
        "base_weights": BIOSENSORY_WEIGHTS,
        "effective_weights": effective_weights,
        "method_version": "biosensory-risk-v2.2",
        "direction": "Higher score means greater potential health danger",
        "medical_notice": "Decision-support heuristic; not a diagnosis or a clinical exposure limit.",
        "exogenous_coverage": {
            "included": ["uv_index", "apparent_temperature", "nitrogen_dioxide"],
            "evidence_layers_not_yet_in_score": [
                "traffic_congestion",
                "noise",
                "urban_heat_island",
                "industrial_facility_proximity",
                "active_fire_proximity",
                "wastewater_overflow",
                "hydrogen_sulfide",
                "ammonia",
                "solid_waste_exposure",
                "verified_odor_complaints",
            ],
        },
    }


def weather_code_risk(weather_code: int, wind_speed_kmh: float) -> int:
    if weather_code in {96, 99}:
        code_score = 100
    elif weather_code == 95:
        code_score = 85
    elif weather_code in {65, 67, 75, 82, 85, 86}:
        code_score = 70
    elif weather_code in {45, 48, 51, 53, 55, 56, 57, 61, 63, 66, 71, 73, 77, 80, 81}:
        code_score = 40
    else:
        code_score = 10
    if wind_speed_kmh >= 75:
        wind_score = 100
    elif wind_speed_kmh >= 50:
        wind_score = 70
    elif wind_speed_kmh >= 30:
        wind_score = 40
    else:
        wind_score = 10
    return max(code_score, wind_score)


def calculate_environmental_risk(
    *,
    relative_humidity: float,
    current_precipitation_mm_h: float,
    precipitation_probability_pct: float,
    us_aqi: float,
    weather_code: int,
    wind_speed_kmh: float,
) -> RiskBreakdown:
    humidity = humidity_risk(relative_humidity)
    precipitation = precipitation_risk(current_precipitation_mm_h, precipitation_probability_pct)
    air_quality = air_quality_risk(us_aqi)
    severe_weather = weather_code_risk(weather_code, wind_speed_kmh)
    humidity_weather = max(humidity, severe_weather)
    score = clamp_score(air_quality * 0.40 + precipitation * 0.40 + humidity_weather * 0.20)
    level, alert_label = _risk_level(score)
    return RiskBreakdown(
        score,
        level,
        alert_label,
        air_quality,
        precipitation,
        humidity_weather,
        humidity,
        severe_weather,
    )


def _number(mapping: dict[str, Any], key: str, default: float = 0.0) -> float:
    value = mapping.get(key, default)
    if not isinstance(value, int | float):
        raise EnvironmentSourceError(f"Environmental source returned an invalid {key}")
    return float(value)


def _optional_number(mapping: dict[str, Any], key: str) -> float | None:
    if mapping.get(key) is None:
        return None
    return _number(mapping, key)


class EnvironmentService:
    def __init__(
        self,
        *,
        weather_url: str,
        air_quality_url: str,
        geocoding_url: str,
        timeout_seconds: float,
        cache_ttl_seconds: int,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._weather_url = weather_url
        self._air_quality_url = air_quality_url
        self._geocoding_url = geocoding_url
        self._timeout = timeout_seconds
        self._cache_ttl = cache_ttl_seconds
        self._transport = transport
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._lock = asyncio.Lock()

    async def current(self, latitude: float, longitude: float) -> dict[str, Any]:
        cache_key = f"{latitude:.4f}:{longitude:.4f}"
        now = time.monotonic()
        cached = self._cache.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]

        weather_params = {
            "latitude": latitude,
            "longitude": longitude,
            "current": (
                "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,"
                "rain,weather_code,wind_speed_10m"
            ),
            "hourly": "precipitation,rain,precipitation_probability",
            "daily": (
                "weather_code,precipitation_sum,precipitation_probability_max,"
                "temperature_2m_max,temperature_2m_min"
            ),
            "forecast_days": 3,
            "timezone": "auto",
        }
        air_params = {
            "latitude": latitude,
            "longitude": longitude,
            "current": (
                "us_aqi,pm2_5,pm10,dust,uv_index,nitrogen_dioxide,sulphur_dioxide,"
                "ozone,carbon_monoxide,sea_salt_aerosol,us_aqi_nitrogen_dioxide,"
                "us_aqi_ozone,us_aqi_sulphur_dioxide,us_aqi_carbon_monoxide"
            ),
            "timezone": "auto",
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                weather_response, air_response = await asyncio.gather(
                    client.get(self._weather_url, params=weather_params),
                    client.get(self._air_quality_url, params=air_params),
                )
            weather_response.raise_for_status()
            air_response.raise_for_status()
            weather = weather_response.json()
            air = air_response.json()
            result = self._combine(latitude, longitude, weather, air)
        except (httpx.HTTPError, ValueError, KeyError, TypeError, EnvironmentSourceError) as exc:
            raise EnvironmentSourceError("Live environmental data is temporarily unavailable") from exc

        async with self._lock:
            if len(self._cache) >= 500:
                oldest_key = min(self._cache, key=lambda key: self._cache[key][0])
                self._cache.pop(oldest_key, None)
            self._cache[cache_key] = (now + self._cache_ttl, result)
        return result

    async def search(self, query: str, count: int, language: str = "en") -> list[dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                response = await client.get(
                    self._geocoding_url,
                    params={"name": query, "count": count, "language": language, "format": "json"},
                )
            response.raise_for_status()
            results = response.json().get("results", [])
            return [
                {
                    "name": item["name"],
                    "country": item.get("country", item.get("country_code", "")),
                    "admin1": item.get("admin1"),
                    "latitude": item["latitude"],
                    "longitude": item["longitude"],
                    "timezone": item.get("timezone"),
                }
                for item in results
            ]
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise EnvironmentSourceError("Location search is temporarily unavailable") from exc

    @staticmethod
    def _combine(
        requested_latitude: float,
        requested_longitude: float,
        weather: dict[str, Any],
        air: dict[str, Any],
    ) -> dict[str, Any]:
        current = weather["current"]
        air_current = air["current"]
        daily = weather["daily"]
        hourly = weather.get("hourly", {})
        humidity = _number(current, "relative_humidity_2m")
        apparent_temperature = _number(current, "apparent_temperature")
        current_precipitation = _number(current, "precipitation")
        current_rain = _number(current, "rain")
        current_hour = str(current["time"])[:13]
        hourly_times = hourly.get("time", [])
        hourly_index = next(
            (index for index, value in enumerate(hourly_times) if str(value)[:13] == current_hour),
            None,
        )
        if hourly_index is None:
            precipitation_rate = current_precipitation
            rain_rate = current_rain
            precipitation_probability = float(daily["precipitation_probability_max"][0])
        else:
            precipitation_rate = float(hourly["precipitation"][hourly_index])
            rain_rate = float(hourly["rain"][hourly_index])
            precipitation_probability = float(hourly["precipitation_probability"][hourly_index])
        aqi = _number(air_current, "us_aqi")
        pm25 = _number(air_current, "pm2_5")
        weather_code = round(_number(current, "weather_code"))
        wind_speed = _number(current, "wind_speed_10m")
        risk = calculate_environmental_risk(
            relative_humidity=humidity,
            current_precipitation_mm_h=precipitation_rate,
            precipitation_probability_pct=precipitation_probability,
            us_aqi=aqi,
            weather_code=weather_code,
            wind_speed_kmh=wind_speed,
        )
        other_pollutant_aqi_values = [
            value
            for key in (
                "us_aqi_ozone",
                "us_aqi_sulphur_dioxide",
                "us_aqi_carbon_monoxide",
            )
            if (value := _optional_number(air_current, key)) is not None
        ]
        biosensory = calculate_biosensory_index(
            precipitation_mm_h=precipitation_rate,
            relative_humidity_pct=humidity,
            wind_speed_kmh=wind_speed,
            pm25_ug_m3=pm25,
            sea_salt_aerosol_ug_m3=_optional_number(air_current, "sea_salt_aerosol"),
            uv_index=_optional_number(air_current, "uv_index"),
            apparent_temperature_c=apparent_temperature,
            nitrogen_dioxide_ug_m3=_optional_number(air_current, "nitrogen_dioxide"),
            other_pollutant_aqi_values=other_pollutant_aqi_values,
        )
        forecast = [
            {
                "date": date,
                "weather_code": daily["weather_code"][index],
                "precipitation_sum_mm": daily["precipitation_sum"][index],
                "precipitation_probability_max_pct": daily["precipitation_probability_max"][index],
                "temperature_max_c": daily["temperature_2m_max"][index],
                "temperature_min_c": daily["temperature_2m_min"][index],
            }
            for index, date in enumerate(daily["time"])
        ]
        result = {
            "schema_version": "1.1",
            "location": {
                "requested_latitude": requested_latitude,
                "requested_longitude": requested_longitude,
                "weather_grid_latitude": weather.get("latitude"),
                "weather_grid_longitude": weather.get("longitude"),
                "timezone": weather.get("timezone", "GMT"),
                "elevation_m": weather.get("elevation"),
            },
            "observed_at": current["time"],
            "current": {
                "temperature_c": _number(current, "temperature_2m"),
                "apparent_temperature_c": apparent_temperature,
                "relative_humidity_pct": humidity,
                "precipitation_mm": current_precipitation,
                "rain_mm": current_rain,
                "precipitation_rate_mm_h": precipitation_rate,
                "rain_rate_mm_h": rain_rate,
                "precipitation_probability_pct": precipitation_probability,
                "weather_code": weather_code,
                "wind_speed_kmh": wind_speed,
            },
            "air_quality": {
                "us_aqi": aqi,
                "pm25_ug_m3": pm25,
                "pm10_ug_m3": _number(air_current, "pm10"),
                "dust_ug_m3": _optional_number(air_current, "dust"),
                "sea_salt_aerosol_ug_m3": _optional_number(air_current, "sea_salt_aerosol"),
                "uv_index": _optional_number(air_current, "uv_index"),
                "nitrogen_dioxide_ug_m3": _optional_number(air_current, "nitrogen_dioxide"),
                "sulphur_dioxide_ug_m3": _optional_number(air_current, "sulphur_dioxide"),
                "ozone_ug_m3": _optional_number(air_current, "ozone"),
                "carbon_monoxide_ug_m3": _optional_number(air_current, "carbon_monoxide"),
                "observed_at": air_current["time"],
            },
            "forecast": forecast,
            "risk": {
                **risk.to_dict(),
                "method_version": "environment-risk-v2",
                "weights": {
                    "air_quality": 0.40,
                    "precipitation": 0.40,
                    "humidity_weather": 0.20,
                },
            },
            "biosensory": biosensory,
            "sources": [
                {"name": "Open-Meteo Forecast API", "url": "https://open-meteo.com/en/docs"},
                {
                    "name": "CAMS via Open-Meteo Air Quality API",
                    "url": "https://open-meteo.com/en/docs/air-quality-api",
                },
            ],
            "data_notice": "Modelled observation and forecast data; not an on-site physical sensor reading.",
        }
        canonical = json.dumps(result, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
        result["integrity"] = {
            "algorithm": "SHA-256",
            "sha256": hashlib.sha256(canonical).hexdigest(),
            "scope": "Canonical JSON response excluding this integrity object",
        }
        return result
