from __future__ import annotations

import base64
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from .security import canonical_json


class ShelbyStorageError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class StorageReceipt:
    status: str
    account: str | None = None
    blob_name: str | None = None
    expires_at: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, str | None]:
        return {
            "status": self.status,
            "account": self.account,
            "blob_name": self.blob_name,
            "expires_at": self.expires_at,
            "error": self.error,
        }


class ShelbyStorage:
    def __init__(
        self, *, bridge_url: str | None, bridge_token: str | None, ttl_seconds: int, timeout_seconds: float
    ) -> None:
        self._bridge_url = bridge_url.rstrip("/") if bridge_url else None
        self._bridge_token = bridge_token
        self._ttl_seconds = ttl_seconds
        self._timeout_seconds = timeout_seconds

    @property
    def enabled(self) -> bool:
        return self._bridge_url is not None

    async def upload_snapshot(
        self, *, asset_id: str, integrity_sha256: str, document: Mapping[str, Any]
    ) -> StorageReceipt:
        if not self._bridge_url:
            return StorageReceipt(status="disabled")
        blob_name = f"digital-twins/{asset_id}/{integrity_sha256}.json"
        payload = {
            "blobName": blob_name,
            "dataBase64": base64.b64encode(canonical_json(document)).decode("ascii"),
            "expectedSha256": integrity_sha256,
            "ttlSeconds": self._ttl_seconds,
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
                response = await client.post(
                    f"{self._bridge_url}/v1/blobs",
                    json=payload,
                    headers={"Authorization": f"Bearer {self._bridge_token}"},
                )
            response.raise_for_status()
            body = response.json()
            return StorageReceipt(
                status="stored",
                account=body["account"],
                blob_name=body["blobName"],
                expires_at=datetime.fromtimestamp(body["expirationMicros"] / 1_000_000, UTC).isoformat(),
            )
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            raise ShelbyStorageError(f"Shelby bridge upload failed: {exc}") from exc
