from __future__ import annotations

from typing import Any

LOCATION_FIT_WEIGHTS = {
    "health_suitability": 0.60,
    "housing_affordability": 0.25,
    "climate_resilience": 0.15,
}


def _affordability_ratio_score(cost: float, budget: float) -> int:
    ratio = cost / budget
    if ratio <= 0.50:
        return 100
    if ratio <= 0.75:
        return 85
    if ratio <= 1:
        return 65
    if ratio <= 1.25:
        return 35
    return 10


def calculate_housing_affordability(housing: dict[str, Any] | None) -> int | None:
    if not housing:
        return None
    scores: list[int] = []
    monthly_rent = housing.get("monthly_rent")
    monthly_budget = housing.get("monthly_budget")
    if monthly_rent is not None and monthly_budget is not None:
        scores.append(_affordability_ratio_score(monthly_rent, monthly_budget))
    sale_price = housing.get("sale_price")
    purchase_budget = housing.get("purchase_budget")
    if sale_price is not None and purchase_budget is not None:
        scores.append(_affordability_ratio_score(sale_price, purchase_budget))
    return round(sum(scores) / len(scores)) if scores else None


def calculate_location_fit(
    *,
    biosensory_risk_score: int,
    housing: dict[str, Any] | None = None,
    climate_resilience_score: int | None = None,
) -> dict[str, Any]:
    components: dict[str, int | None] = {
        "health_suitability": 101 - biosensory_risk_score,
        "housing_affordability": calculate_housing_affordability(housing),
        "climate_resilience": climate_resilience_score,
    }
    available_weight = sum(
        LOCATION_FIT_WEIGHTS[name] for name, value in components.items() if value is not None
    )
    score = round(
        sum(
            LOCATION_FIT_WEIGHTS[name] * value
            for name, value in components.items()
            if value is not None
        )
        / available_weight
    )
    effective_weights = {
        name: round(weight / available_weight, 4) if components[name] is not None else 0
        for name, weight in LOCATION_FIT_WEIGHTS.items()
    }
    return {
        "score": max(1, min(100, score)),
        "components": components,
        "base_weights": LOCATION_FIT_WEIGHTS,
        "effective_weights": effective_weights,
        "data_confidence_pct": round(available_weight * 100),
        "method_version": "rwa-location-fit-v1",
        "direction": "Higher score means a more suitable location for the supplied household profile",
    }
