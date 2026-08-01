from __future__ import annotations

import json
import os
from dataclasses import dataclass


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True, slots=True)
class Settings:
    environment: str = "development"
    cors_origins: tuple[str, ...] = ("http://localhost:8000",)
    require_sensor_signatures: bool = False
    sensor_secrets: dict[str, str] | None = None
    signature_max_age_seconds: int = 300
    shelby_bridge_url: str | None = None
    shelby_bridge_token: str | None = None
    shelby_storage_required: bool = False
    shelby_blob_ttl_seconds: int = 30 * 24 * 60 * 60
    outbound_timeout_seconds: float = 15.0
    max_cached_assets: int = 1_000

    @classmethod
    def from_env(cls) -> Settings:
        raw_secrets = os.getenv("SENSOR_SECRETS_JSON", "{}")
        try:
            secrets = json.loads(raw_secrets)
        except json.JSONDecodeError as exc:
            raise ValueError("SENSOR_SECRETS_JSON must contain valid JSON") from exc
        if not isinstance(secrets, dict) or not all(
            isinstance(key, str) and isinstance(value, str) for key, value in secrets.items()
        ):
            raise ValueError("SENSOR_SECRETS_JSON must be a string-to-string object")

        origins = tuple(
            origin.strip()
            for origin in os.getenv("CORS_ORIGINS", "http://localhost:8000").split(",")
            if origin.strip()
        )
        settings = cls(
            environment=os.getenv("APP_ENV", "development"),
            cors_origins=origins,
            require_sensor_signatures=_as_bool(os.getenv("REQUIRE_SENSOR_SIGNATURES")),
            sensor_secrets=secrets,
            signature_max_age_seconds=int(os.getenv("SIGNATURE_MAX_AGE_SECONDS", "300")),
            shelby_bridge_url=os.getenv("SHELBY_BRIDGE_URL") or None,
            shelby_bridge_token=os.getenv("SHELBY_BRIDGE_TOKEN") or None,
            shelby_storage_required=_as_bool(os.getenv("SHELBY_STORAGE_REQUIRED")),
            shelby_blob_ttl_seconds=int(os.getenv("SHELBY_BLOB_TTL_SECONDS", str(30 * 24 * 60 * 60))),
            outbound_timeout_seconds=float(os.getenv("OUTBOUND_TIMEOUT_SECONDS", "15")),
            max_cached_assets=int(os.getenv("MAX_CACHED_ASSETS", "1000")),
        )
        settings.validate()
        return settings

    def validate(self) -> None:
        if self.signature_max_age_seconds <= 0:
            raise ValueError("SIGNATURE_MAX_AGE_SECONDS must be positive")
        if self.shelby_blob_ttl_seconds <= 0:
            raise ValueError("SHELBY_BLOB_TTL_SECONDS must be positive")
        if self.max_cached_assets <= 0:
            raise ValueError("MAX_CACHED_ASSETS must be positive")
        if self.shelby_bridge_url and not self.shelby_bridge_token:
            raise ValueError("SHELBY_BRIDGE_TOKEN is required when SHELBY_BRIDGE_URL is configured")
        if self.shelby_storage_required and not self.shelby_bridge_url:
            raise ValueError("SHELBY_BRIDGE_URL is required when SHELBY_STORAGE_REQUIRED=true")
        if self.require_sensor_signatures and not self.sensor_secrets:
            raise ValueError("At least one sensor secret is required when signatures are enforced")
