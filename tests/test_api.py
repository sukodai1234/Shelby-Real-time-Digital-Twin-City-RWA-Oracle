from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

READING = {
    "temperature_c": 31,
    "humidity_pct": 82,
    "pm25_ug_m3": 42,
    "oxygen_pct": 20.1,
    "salinity_ppt": 18,
    "water_level_cm": 12,
}


class FakeEnvironmentService:
    async def current(self, latitude: float, longitude: float) -> dict:
        return {
            "location": {
                "requested_latitude": latitude,
                "requested_longitude": longitude,
            },
            "risk": {"score": 42, "method_version": "environment-risk-v2"},
            "biosensory": {"score": 30, "method_version": "biosensory-risk-v2"},
            "integrity": {"algorithm": "SHA-256", "sha256": "a" * 64},
        }

    async def search(self, query: str, count: int, language: str = "en") -> list[dict]:
        return [{"name": query, "latitude": 10.8, "longitude": 106.6}][:count]


def test_ingest_and_read_latest_snapshot() -> None:
    app = create_app(Settings())
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/assets/coastal-home-001/readings", json=READING, headers={"Idempotency-Key": "reading-1"}
        )
        assert response.status_code == 201
        body = response.json()
        assert len(body["integrity_sha256"]) == 64
        assert body["storage"]["status"] == "disabled"
        repeated = client.post(
            "/api/v1/assets/coastal-home-001/readings", json=READING, headers={"Idempotency-Key": "reading-1"}
        )
        assert repeated.json() == body
        latest = client.get("/api/v1/assets/coastal-home-001/snapshots/latest")
        assert latest.status_code == 200
        assert latest.json() == body


def test_invalid_asset_id_is_rejected() -> None:
    app = create_app(Settings())
    with TestClient(app) as client:
        response = client.post("/api/v1/assets/not%20safe/readings", json=READING)
    assert response.status_code == 422


def test_environment_endpoints_validate_location_and_return_risk() -> None:
    app = create_app(Settings())
    with TestClient(app) as client:
        app.state.environment = FakeEnvironmentService()
        response = client.get("/api/v1/environment/current?latitude=10.8231&longitude=106.6297")
        search = client.get("/api/v1/environment/locations?query=Ho%20Chi%20Minh")
        localized_search = client.get(
            "/api/v1/environment/locations?query=Ho%20Chi%20Minh&language=vi"
        )
        invalid_language = client.get(
            "/api/v1/environment/locations?query=Ho%20Chi%20Minh&language=fr"
        )
        invalid = client.get("/api/v1/environment/current?latitude=120&longitude=106")
    assert response.status_code == 200
    assert response.json()["risk"]["score"] == 42
    assert search.status_code == 200
    assert search.json()["results"][0]["name"] == "Ho Chi Minh"
    assert localized_search.status_code == 200
    assert invalid_language.status_code == 422
    assert invalid.status_code == 422


def test_location_fit_combines_verified_environment_and_market_evidence() -> None:
    app = create_app(Settings())
    payload = {
        "latitude": 10.8231,
        "longitude": 106.6297,
        "housing": {
            "monthly_rent": 750,
            "monthly_budget": 1000,
            "currency": "USD",
            "source_name": "Licensed market feed",
            "source_url": "https://example.com/market",
            "observed_at": "2026-08-01T12:00:00Z",
        },
        "climate": {
            "score": 80,
            "source_name": "Official seasonal outlook",
            "source_url": "https://example.com/climate",
            "observed_at": "2026-08-01T12:00:00Z",
        },
    }
    with TestClient(app) as client:
        app.state.environment = FakeEnvironmentService()
        response = client.post("/api/v1/location-fit", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["location_fit"]["score"] == 76
    assert body["location_fit"]["data_confidence_pct"] == 100
    assert len(body["integrity_sha256"]) == 64
