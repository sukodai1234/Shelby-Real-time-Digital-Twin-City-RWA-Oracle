# Shelby Real-time Digital Twin City & RWA Oracle

Production-oriented v2 of a coastal-property digital twin. Signed sensor readings become deterministic
risk scores, immutable JSON evidence on Shelby, and compact verification anchors on Aptos.

## What is implemented

- FastAPI ingestion, evaluation, latest-state, OpenAPI, and per-asset WebSocket APIs
- Deterministic livability, structural health, maintenance, and corrosion-horizon engine
- HMAC-SHA256 sensor authentication, replay window, idempotency, and strict validation
- Content-addressed canonical JSON snapshots with SHA-256 integrity proofs
- Internal Node.js bridge using the official `@shelby-protocol/sdk` 0.4.1 on Shelbynet
- Aptos Move multi-asset registry with owner-controlled oracle rotation and Shelby proof anchoring
- Non-root containers, health checks, bounded in-memory state, CI, and unit/API tests
- Location-aware live weather, humidity, precipitation, three-day forecast, and CAMS air quality
- Explainable environmental risk index from 1–100 with a per-factor breakdown
- Bio-Sensory Risk Index for potential health danger, with source completeness and dynamic weights
- RWA Location Fit score that keeps health, housing affordability, and climate evidence auditable

## Data flow

1. A sensor signs `timestamp + sensor_id + asset_id + canonical_reading`.
2. The oracle validates the signature, calculates the twin snapshot, and hashes canonical JSON.
3. The Shelby bridge verifies that hash and uploads the evidence with `ShelbyNodeClient.upload()`.
4. An authorized Aptos oracle stores scores, the 32-byte hash, and Shelby blob name in Move.
5. Apps consume the latest snapshot through REST or a real-time per-asset WebSocket.

See [docs/architecture.md](docs/architecture.md) for trust boundaries and scaling guidance.

## Quick start without credentials

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest -q
uvicorn app.main:app --reload
```

Open `http://localhost:8000`, with API docs at `http://localhost:8000/docs`.
Shelby storage is safely reported as `disabled` until the bridge is configured.

The dashboard starts with Ho Chi Minh City. Search for any city or explicitly allow browser location
access to use device coordinates. The coordinates are sent to this FastAPI service, which requests
Open-Meteo weather and CAMS air-quality data server-side; no API key is required for non-commercial use.

## Live environmental risk

```bash
curl "http://localhost:8000/api/v1/environment/current?latitude=10.8231&longitude=106.6297"
curl "http://localhost:8000/api/v1/environment/locations?query=Ho%20Chi%20Minh"
```

Risk method `environment-risk-v2` produces a deterministic integer from 1 to 100:

| Component | Weight | Inputs |
| --- | ---: | --- |
| Air quality | 40% | U.S. AQI from CAMS: 10/35/60/85/100 at the 50/100/150/200 breakpoints |
| Precipitation | 40% | Current hourly intensity: 10 below 2, 35 at 2–9.99, 70 at 10–29.99, 100 at 30+ mm/h; a probability above 70% raises an otherwise dry score to 30 |
| Humidity + extreme weather | 20% | Relative humidity, WMO weather code, and 10 m wind; the highest applicable sub-score is used |

The total is `0.40 × AQI + 0.40 × rain + 0.20 × humidity/weather`, rounded and clamped to 1–100.
Scores are classified as `SAFE` (1–29), `MODERATE` (30–49), `WARNING` (50–74), or
`HIGH_DANGER` (75–100). These values are modelled environmental context, not a substitute for certified on-site
sensors or emergency-agency warnings. Responses include source URLs, source timestamps, grid
coordinates, forecast values, component scores, weights, the method version, and a SHA-256 integrity
hash for auditability. Current rainfall uses the hourly series aligned to the source observation hour;
it does not incorrectly treat the first forecast array item as the current hour.

## Bio-Sensory Risk Index

`biosensory-risk-v2.2` is the primary health-context index. A higher score means greater potential
danger; `health_suitability_score = 101 - risk` is included for location comparison.

| Component | Base weight | Source / interpretation |
| --- | ---: | --- |
| Fine particles | 22% | `min(100, PM2.5 × 2.8)` |
| Exogenous exposure | 17% | 40% UV + 40% apparent-temperature heat stress + 20% NO2 |
| Precipitation + humidity | 22% | Hourly rainfall bands; humidity below 25% raises drought stress to 85 |
| Sea-salt aerosol | 5% | `min(100, sea_salt_aerosol × 4)`; retained as context without over-penalizing naturally ventilated coastal locations |
| Wind | 17% | 10 m wind; below 0.8 m/s or above 15 m/s scores 80 |
| Other pollutants | 17% | Maximum CAMS component U.S. AQI for O3, SO2, and CO, clamped to 100 |

Version 2.2 reduces sea-salt aerosol from 15% to 5% and distributes the released 10 percentage
points evenly across the other five components (+2 points each). This prevents proximity to the sea
from dominating the index when measured particulate and gaseous pollution remain low.

The exogenous sub-score maps UV to 10/50/80/100, apparent temperature to 10/40/75/100
at 32/38/42 °C, and NO2 to 10 below 40 µg/m³, linearly increasing to 100 at
100 µg/m³. `apparent_temperature` is a feels-like heat-stress proxy, not a clinical body-temperature
measurement. Traffic congestion, noise, urban heat island, industrial proximity, and active-fire
proximity are exposed as future evidence layers and do not affect the score until a verified adapter
supplies them.

Waste and sewer odour belongs to a future **sanitation exposure** layer inside exogenous exposure.
It should only enter BSI when an official or calibrated source supplies H2S, NH3,
wastewater-overflow, solid-waste, or verified odour-complaint evidence. Substance-use prevalence is
not an environmental biological exposure and must not be inferred from neighbourhood appearance.
Only aggregated, anonymized official public-health and safety statistics may be used in a separate
Community Wellbeing score for Location Fit; it is intentionally excluded from BSI.

If an optional source is unavailable, its weight becomes zero, the remaining weights are normalized,
and `data_confidence_pct` drops. The API never silently substitutes a guessed sea-salt value. The
response exposes base weights, effective weights, component scores, raw readings, model timestamps,
and an integrity hash. This is decision support, not a diagnosis or emergency warning.

## RWA Location Fit

`POST /api/v1/location-fit` combines the inverse Bio-Sensory risk with traceable housing and climate
evidence. Health remains separate from money in the raw components; only the final suitability layer
combines them:

```text
Location Fit = 60% health suitability + 25% housing affordability + 15% climate resilience
```

```bash
curl -X POST http://localhost:8000/api/v1/location-fit \
  -H 'Content-Type: application/json' \
  -d '{
    "latitude": 10.8231,
    "longitude": 106.6297,
    "housing": {
      "monthly_rent": 750,
      "monthly_budget": 1000,
      "currency": "USD",
      "source_name": "Licensed market feed",
      "source_url": "https://example.com/listing-evidence",
      "observed_at": "2026-08-01T12:00:00Z"
    },
    "climate": {
      "score": 80,
      "source_name": "Official seasonal outlook",
      "source_url": "https://example.com/climate-evidence",
      "observed_at": "2026-08-01T12:00:00Z"
    }
  }'
```

Housing data is deliberately a normalized evidence input because listing and transaction licences are
country-specific. Production adapters must retain the provider URL, observation time, currency, and
licence. Missing housing or climate evidence is disclosed and weights are redistributed instead of
inventing a value.

## El Niño 2026–2027 readiness

The project is prepared to ingest versioned seasonal evidence from official WMO and NOAA/CPC
outlooks. These are stored separately from current weather because a global ENSO phase does not imply
the same local outcome everywhere. As of 31 July 2026, WMO reports a strengthening strong El Niño for
August–October 2026, while NOAA/CPC reports a 97% chance it persists through early spring 2027 and an
81% chance of a very strong event in October–December 2026. Never hard-code those probabilities into
the permanent risk formula; store each bulletin with its issue time and source hash.

- WMO: https://wmo.int/news/media-centre/strong-el-nino-expected-intensify-much-of-world-faces-above-normal-temperatures-and-major-changes
- NOAA CPC: https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml

## Run with Shelby

Shelby's API key, Aptos private key, and funded Shelbynet account are required for real uploads.

```bash
cp .env.example .env
# Fill SHELBY_API_KEY, SHELBY_ACCOUNT_PRIVATE_KEY, and a random SHELBY_BRIDGE_TOKEN.
docker compose up --build
```

The server-only API key can be created through Geomi. The Shelby/Aptos account needs APT for gas and
shelbyUSD for storage. Never expose the account private key to the browser or oracle container.

## Ingest a reading

```bash
curl -X POST http://localhost:8000/api/v1/assets/coastal-home-001/readings \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: sensor-001-1722470400' \
  -d '{
    "temperature_c": 31,
    "humidity_pct": 82,
    "pm25_ug_m3": 42,
    "oxygen_pct": 20.1,
    "salinity_ppt": 18,
    "water_level_cm": 12
  }'
```

For production, set `REQUIRE_SENSOR_SIGNATURES=true`. The hex signature is:

```text
HMAC_SHA256(sensor_secret, timestamp + "\n" + sensor_id + "\n" + asset_id + "\n" + canonical_json(reading))
```

Send it with `X-Sensor-Id`, `X-Timestamp`, and `X-Signature`.

## Aptos Move registry

```bash
cd contracts
aptos move test
aptos move compile
```

Before publishing, replace the named address in `contracts/Move.toml`. A registered asset contains an
owner, oracle, Shelby account, digital-twin scores, environmental readings, environmental risk,
Bio-Sensory risk, Location Fit score, data hashes,
Shelby blob names, and update timestamps. `update_environment` accepts the risk index from 1–100 and
can only be called by the asset's configured oracle. Coordinates are stored without lossy signed casts:
`latitude_offset_e6 = (latitude + 90) × 1e6` and
`longitude_offset_e6 = (longitude + 180) × 1e6`.

## Current production boundary

The project uploads evidence to Shelby and provides the Move contract that anchors it. Automatic Aptos
transaction submission is intentionally a separate next-stage worker: it needs nonce management,
retries, gas policy, and deployment-specific module addresses. The API cache is bounded but ephemeral;
use Redis/PostgreSQL and a durable queue for multi-instance production deployments.
