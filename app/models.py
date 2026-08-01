from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from .engine import SensorReading


class SensorReadingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    temperature_c: float = Field(ge=-20, le=70)
    humidity_pct: float = Field(ge=0, le=100)
    pm25_ug_m3: float = Field(ge=0, le=1_000)
    oxygen_pct: float = Field(ge=0, le=25)
    salinity_ppt: float = Field(ge=0, le=100)
    water_level_cm: float = Field(default=0, ge=0, le=1_000)

    def to_domain(self) -> SensorReading:
        return SensorReading(**self.model_dump())


class StorageProof(BaseModel):
    status: str
    account: str | None = None
    blob_name: str | None = None
    expires_at: str | None = None
    error: str | None = None


class IngestResponse(BaseModel):
    asset_id: str
    sensor_id: str | None
    reading: dict
    snapshot: dict
    integrity_sha256: str
    storage: StorageProof
