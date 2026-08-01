import asyncio

import httpx

from app.environment import (
    EnvironmentService,
    air_quality_risk,
    calculate_biosensory_index,
    calculate_environmental_risk,
    exogenous_exposure_risk,
    heat_stress_risk,
    humidity_risk,
    no2_exposure_risk,
    pm25_risk,
    precipitation_risk,
    sea_salt_aerosol_risk,
    uv_risk,
    wind_risk,
)


def test_environmental_risk_stays_between_one_and_one_hundred() -> None:
    healthy = calculate_environmental_risk(
        relative_humidity=50,
        current_precipitation_mm_h=0,
        precipitation_probability_pct=0,
        us_aqi=12,
        weather_code=0,
        wind_speed_kmh=5,
    )
    dangerous = calculate_environmental_risk(
        relative_humidity=100,
        current_precipitation_mm_h=30,
        precipitation_probability_pct=100,
        us_aqi=500,
        weather_code=99,
        wind_speed_kmh=100,
    )
    assert healthy.score == 10
    assert healthy.level == "SAFE"
    assert dangerous.score == 100
    assert dangerous.level == "HIGH_DANGER"


def test_risk_component_thresholds_match_version_two_specification() -> None:
    assert [air_quality_risk(value) for value in (50, 51, 101, 151, 201)] == [10, 35, 60, 85, 100]
    assert [precipitation_risk(value, 0) for value in (1.9, 2, 10, 30)] == [10, 35, 70, 100]
    assert precipitation_risk(0, 71) == 30
    assert humidity_risk(50) == 10
    assert humidity_risk(86) == 40
    assert humidity_risk(91) == 70


def test_biosensory_index_is_explainable_and_reports_completeness() -> None:
    result = calculate_biosensory_index(
        precipitation_mm_h=3,
        relative_humidity_pct=86,
        wind_speed_kmh=24,
        pm25_ug_m3=31,
        sea_salt_aerosol_ug_m3=None,
        uv_index=8,
        apparent_temperature_c=38,
        nitrogen_dioxide_ug_m3=20,
        other_pollutant_aqi_values=[55, 10, 15],
    )
    assert 1 <= result["score"] <= 100
    assert result["health_suitability_score"] == 101 - result["score"]
    assert result["data_confidence_pct"] == 95
    assert result["components"]["sea_salt_aerosol"] is None
    assert result["effective_weights"]["sea_salt_aerosol"] == 0
    assert result["method_version"] == "biosensory-risk-v2.2"


def test_biosensory_v2_component_formulas() -> None:
    assert pm25_risk(25) == 70
    assert sea_salt_aerosol_risk(18) == 72
    assert uv_risk(5) == 10
    assert uv_risk(8) == 50
    assert uv_risk(10) == 80
    assert uv_risk(11) == 100
    assert heat_stress_risk(31.9) == 10
    assert heat_stress_risk(38) == 75
    assert heat_stress_risk(42) == 100
    assert no2_exposure_risk(39) == 10
    assert no2_exposure_risk(70) == 55
    assert no2_exposure_risk(100) == 100
    assert wind_risk(2.5) == 80
    assert wind_risk(24) == 10
    assert wind_risk(55) == 80
    assert exogenous_exposure_risk(
        uv_index=8, apparent_temperature_c=38, nitrogen_dioxide_ug_m3=20
    ) == 52


def test_service_combines_live_sources_and_calculates_risk() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "air-quality" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "current": {
                        "time": "2026-08-01T12:00",
                        "us_aqi": 90,
                        "pm2_5": 31,
                        "pm10": 44,
                        "dust": 12,
                        "uv_index": 8,
                        "nitrogen_dioxide": 20,
                        "sulphur_dioxide": 5,
                        "ozone": 70,
                        "carbon_monoxide": 180,
                        "sea_salt_aerosol": 18,
                        "us_aqi_nitrogen_dioxide": 20,
                        "us_aqi_ozone": 55,
                        "us_aqi_sulphur_dioxide": 10,
                        "us_aqi_carbon_monoxide": 15,
                    }
                },
            )
        return httpx.Response(
            200,
            json={
                "latitude": 10.8,
                "longitude": 106.6,
                "timezone": "Asia/Ho_Chi_Minh",
                "elevation": 6,
                "current": {
                    "time": "2026-08-01T19:00",
                    "temperature_2m": 31,
                    "apparent_temperature": 38,
                    "relative_humidity_2m": 86,
                    "precipitation": 3,
                    "rain": 3,
                    "weather_code": 81,
                    "wind_speed_10m": 24,
                },
                "hourly": {
                    "time": ["2026-08-01T19:00"],
                    "precipitation": [3],
                    "rain": [3],
                    "precipitation_probability": [90],
                },
                "daily": {
                    "time": ["2026-08-01", "2026-08-02", "2026-08-03"],
                    "weather_code": [81, 61, 3],
                    "precipitation_sum": [18, 9, 1],
                    "precipitation_probability_max": [90, 70, 20],
                    "temperature_2m_max": [33, 32, 34],
                    "temperature_2m_min": [26, 25, 26],
                },
            },
        )

    service = EnvironmentService(
        weather_url="https://weather.test/forecast",
        air_quality_url="https://air-quality.test/current",
        geocoding_url="https://geocoding.test/search",
        timeout_seconds=1,
        cache_ttl_seconds=60,
        transport=httpx.MockTransport(handler),
    )
    result = asyncio.run(service.current(10.8231, 106.6297))
    assert result["current"]["relative_humidity_pct"] == 86
    assert result["air_quality"]["us_aqi"] == 90
    assert len(result["forecast"]) == 3
    assert 1 <= result["risk"]["score"] <= 100
    assert result["current"]["precipitation_rate_mm_h"] == 3
    assert result["current"]["precipitation_probability_pct"] == 90
    assert result["risk"]["score"] == 36
    assert result["risk"]["method_version"] == "environment-risk-v2"
    assert result["risk"]["weights"] == {
        "air_quality": 0.4,
        "precipitation": 0.4,
        "humidity_weather": 0.2,
    }
    assert result["biosensory"]["score"] == 50
    assert result["biosensory"]["method_version"] == "biosensory-risk-v2.2"
    assert result["biosensory"]["data_confidence_pct"] == 100
    assert result["air_quality"]["sea_salt_aerosol_ug_m3"] == 18
    assert len(result["integrity"]["sha256"]) == 64
