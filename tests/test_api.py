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
