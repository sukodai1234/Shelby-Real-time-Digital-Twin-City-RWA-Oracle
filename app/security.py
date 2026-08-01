from __future__ import annotations

import hashlib
import hmac
import json
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any


class SignatureError(ValueError):
    pass


def canonical_json(value: Mapping[str, Any]) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode()


def build_signature_message(
    timestamp: str, sensor_id: str, asset_id: str, payload: Mapping[str, Any]
) -> bytes:
    return b"\n".join([timestamp.encode(), sensor_id.encode(), asset_id.encode(), canonical_json(payload)])


def sign_sensor_payload(
    secret: str, timestamp: str, sensor_id: str, asset_id: str, payload: Mapping[str, Any]
) -> str:
    return hmac.new(
        secret.encode(), build_signature_message(timestamp, sensor_id, asset_id, payload), hashlib.sha256
    ).hexdigest()


@dataclass(frozen=True, slots=True)
class VerifiedSensor:
    sensor_id: str
    timestamp: int


class SignatureVerifier:
    def __init__(self, secrets: Mapping[str, str], max_age_seconds: int, required: bool) -> None:
        self._secrets = secrets
        self._max_age_seconds = max_age_seconds
        self._required = required

    def verify(
        self,
        *,
        asset_id: str,
        payload: Mapping[str, Any],
        sensor_id: str | None,
        timestamp: str | None,
        signature: str | None,
        now: int | None = None,
    ) -> VerifiedSensor | None:
        supplied = any((sensor_id, timestamp, signature))
        if not supplied and not self._required:
            return None
        if not sensor_id or not timestamp or not signature:
            raise SignatureError("X-Sensor-Id, X-Timestamp and X-Signature must be supplied together")
        secret = self._secrets.get(sensor_id)
        if not secret:
            raise SignatureError("Unknown sensor")
        try:
            parsed_timestamp = int(timestamp)
        except ValueError as exc:
            raise SignatureError("X-Timestamp must be Unix seconds") from exc
        current = int(time.time()) if now is None else now
        if abs(current - parsed_timestamp) > self._max_age_seconds:
            raise SignatureError("Sensor signature is outside the accepted time window")
        expected = sign_sensor_payload(secret, timestamp, sensor_id, asset_id, payload)
        if not hmac.compare_digest(expected, signature.lower()):
            raise SignatureError("Invalid sensor signature")
        return VerifiedSensor(sensor_id=sensor_id, timestamp=parsed_timestamp)
