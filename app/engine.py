from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Literal

RiskLevel = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]


@dataclass(frozen=True, slots=True)
class SensorReading:
    temperature_c: float
    humidity_pct: float
    pm25_ug_m3: float
    oxygen_pct: float
    salinity_ppt: float
    water_level_cm: float = 0.0


@dataclass(frozen=True, slots=True)
class TwinSnapshot:
    schema_version: str
    livability_score: float
    structural_health_score: float
    risk_level: RiskLevel
    estimated_maintenance_pct: float
    corrosion_horizon_days: int
    alerts: tuple[str, ...]
    recorded_at: str

    def to_dict(self) -> dict:
        result = asdict(self)
        result["alerts"] = list(self.alerts)
        return result


def clamp(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    return max(minimum, min(maximum, value))


def calculate_livability_score(reading: SensorReading) -> float:
    temperature_penalty = abs(reading.temperature_c - 26.0) * 1.4
    humidity_penalty = max(0.0, reading.humidity_pct - 65.0) * 0.45
    pm25_penalty = max(0.0, reading.pm25_ug_m3 - 12.0) * 0.5
    oxygen_penalty = max(0.0, 20.9 - reading.oxygen_pct) * 20.0
    flood_penalty = max(0.0, reading.water_level_cm - 20.0) * 0.45
    return round(
        clamp(100.0 - temperature_penalty - humidity_penalty - pm25_penalty - oxygen_penalty - flood_penalty),
        2,
    )


def structural_health_forecast(reading: SensorReading) -> float:
    salinity_penalty = reading.salinity_ppt * 1.8
    humidity_penalty = max(0.0, reading.humidity_pct - 60.0) * 0.35
    heat_penalty = max(0.0, reading.temperature_c - 32.0) * 1.2
    flood_penalty = max(0.0, reading.water_level_cm - 10.0) * 0.5
    return round(clamp(100.0 - salinity_penalty - humidity_penalty - heat_penalty - flood_penalty), 2)


def estimate_corrosion_horizon_days(reading: SensorReading, structural_score: float) -> int:
    exposure = (
        reading.salinity_ppt * 1.7
        + max(0.0, reading.humidity_pct - 60.0) * 0.8
        + max(0.0, reading.water_level_cm - 10.0) * 0.6
    )
    if exposure <= 0:
        return 3_650
    return max(30, min(3_650, round((structural_score + 20.0) * 1_200 / exposure)))


def classify_risk(livability: float, structural: float) -> RiskLevel:
    score = min(livability, structural)
    if score < 30:
        return "CRITICAL"
    if score < 50:
        return "HIGH"
    if score < 70:
        return "MEDIUM"
    return "LOW"


def build_alerts(reading: SensorReading, livability: float, structural: float) -> tuple[str, ...]:
    alerts: list[str] = []
    if reading.pm25_ug_m3 > 35:
        alerts.append("PM2.5 is above the healthy threshold")
    if reading.oxygen_pct < 19.5:
        alerts.append("Oxygen level is potentially unsafe")
    if reading.salinity_ppt > 15:
        alerts.append("High salinity may accelerate structural corrosion")
    if reading.water_level_cm > 30:
        alerts.append("Flood-risk water level detected")
    if livability < 50:
        alerts.append("Livability score requires immediate review")
    if structural < 50:
        alerts.append("Structural inspection is recommended")
    return tuple(alerts)


def evaluate_twin(reading: SensorReading, *, recorded_at: datetime | None = None) -> TwinSnapshot:
    livability = calculate_livability_score(reading)
    structural = structural_health_forecast(reading)
    timestamp = recorded_at or datetime.now(UTC)
    return TwinSnapshot(
        schema_version="2.0",
        livability_score=livability,
        structural_health_score=structural,
        risk_level=classify_risk(livability, structural),
        estimated_maintenance_pct=round(clamp((100.0 - structural) * 0.35, 0.0, 35.0), 2),
        corrosion_horizon_days=estimate_corrosion_horizon_days(reading, structural),
        alerts=build_alerts(reading, livability, structural),
        recorded_at=timestamp.astimezone(UTC).isoformat(),
    )
