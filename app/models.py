from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator

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


class HousingMarketSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    monthly_rent: float | None = Field(default=None, gt=0)
    monthly_budget: float | None = Field(default=None, gt=0)
    sale_price: float | None = Field(default=None, gt=0)
    purchase_budget: float | None = Field(default=None, gt=0)
    currency: str = Field(min_length=3, max_length=3, pattern="^[A-Z]{3}$")
    source_name: str = Field(min_length=2, max_length=120)
    source_url: str | None = Field(default=None, max_length=500)
    observed_at: str = Field(min_length=10, max_length=40)

    @model_validator(mode="after")
    def validate_complete_price_pairs(self) -> HousingMarketSnapshot:
        rent_pair = self.monthly_rent is not None and self.monthly_budget is not None
        sale_pair = self.sale_price is not None and self.purchase_budget is not None
        incomplete_rent = (self.monthly_rent is None) != (self.monthly_budget is None)
        incomplete_sale = (self.sale_price is None) != (self.purchase_budget is None)
        if incomplete_rent or incomplete_sale or not (rent_pair or sale_pair):
            raise ValueError("Provide a complete rent/budget or sale price/purchase budget pair")
        return self


class ClimateResilienceEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    score: int = Field(ge=1, le=100)
    source_name: str = Field(min_length=2, max_length=120)
    source_url: str | None = Field(default=None, max_length=500)
    observed_at: str = Field(min_length=10, max_length=40)


class LocationFitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    housing: HousingMarketSnapshot | None = None
    climate: ClimateResilienceEvidence | None = None
