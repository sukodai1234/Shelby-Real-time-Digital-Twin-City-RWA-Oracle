from app.location_fit import calculate_housing_affordability, calculate_location_fit


def test_location_fit_redistributes_only_available_evidence() -> None:
    health_only = calculate_location_fit(biosensory_risk_score=30)
    assert health_only["score"] == 71
    assert health_only["data_confidence_pct"] == 60
    assert health_only["effective_weights"]["health_suitability"] == 1


def test_location_fit_combines_health_housing_and_climate_without_mixing_units() -> None:
    housing = {
        "monthly_rent": 750,
        "monthly_budget": 1_000,
        "sale_price": 160_000,
        "purchase_budget": 200_000,
    }
    assert calculate_housing_affordability(housing) == 75
    result = calculate_location_fit(
        biosensory_risk_score=30,
        housing=housing,
        climate_resilience_score=80,
    )
    assert result["score"] == 73
    assert result["data_confidence_pct"] == 100
    assert result["method_version"] == "rwa-location-fit-v1"
