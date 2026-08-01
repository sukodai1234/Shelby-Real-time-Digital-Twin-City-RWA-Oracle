import pytest

from app.security import SignatureError, SignatureVerifier, sign_sensor_payload

PAYLOAD = {
    "temperature_c": 30.0,
    "humidity_pct": 70.0,
    "pm25_ug_m3": 15.0,
    "oxygen_pct": 20.8,
    "salinity_ppt": 4.0,
    "water_level_cm": 0.0,
}


def test_valid_signature() -> None:
    signature = sign_sensor_payload("secret", "1000", "sensor-1", "asset-1", PAYLOAD)
    verifier = SignatureVerifier({"sensor-1": "secret"}, max_age_seconds=60, required=True)
    verified = verifier.verify(
        asset_id="asset-1",
        payload=PAYLOAD,
        sensor_id="sensor-1",
        timestamp="1000",
        signature=signature,
        now=1_020,
    )
    assert verified is not None
    assert verified.sensor_id == "sensor-1"


def test_replay_window_is_enforced() -> None:
    signature = sign_sensor_payload("secret", "1000", "sensor-1", "asset-1", PAYLOAD)
    verifier = SignatureVerifier({"sensor-1": "secret"}, max_age_seconds=60, required=True)
    with pytest.raises(SignatureError, match="time window"):
        verifier.verify(
            asset_id="asset-1",
            payload=PAYLOAD,
            sensor_id="sensor-1",
            timestamp="1000",
            signature=signature,
            now=1_061,
        )
