from datetime import UTC, datetime

from app.engine import SensorReading, calculate_livability_score, evaluate_twin, structural_health_forecast


def test_healthy_reading_scores_high() -> None:
    reading = SensorReading(26, 60, 8, 20.9, 1, 0)
    assert calculate_livability_score(reading) >= 90
    assert structural_health_forecast(reading) >= 90
    assert evaluate_twin(reading).risk_level == "LOW"


def test_dangerous_reading_creates_alerts() -> None:
    snapshot = evaluate_twin(SensorReading(39, 95, 120, 18.5, 30, 80))
    assert snapshot.risk_level in {"HIGH", "CRITICAL"}
    assert len(snapshot.alerts) >= 4
    assert snapshot.corrosion_horizon_days >= 30


def test_snapshot_is_deterministic_when_time_is_fixed() -> None:
    reading = SensorReading(31, 80, 30, 20.5, 12, 5)
    recorded_at = datetime(2026, 8, 1, tzinfo=UTC)
    assert evaluate_twin(reading, recorded_at=recorded_at) == evaluate_twin(reading, recorded_at=recorded_at)
