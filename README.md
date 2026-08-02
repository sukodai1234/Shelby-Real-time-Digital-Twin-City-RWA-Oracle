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
- Climate Watch 2026–2027: lazy-loaded Open-Meteo/ECMWF seasonal outlooks, 1991–2020 anomalies,
  hot-and-dry signals, nearby NASA EONET wildfires, six-hour cache, and English/Vietnamese/Chinese UI

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
owner, oracle, Shelby account, scores, risk level, data hash, blob name, and update timestamp. Risk is
encoded as `0=LOW`, `1=MEDIUM`, `2=HIGH`, `3=CRITICAL`.

## Current production boundary

The project uploads evidence to Shelby and provides the Move contract that anchors it. Automatic Aptos
transaction submission is intentionally a separate next-stage worker: it needs nonce management,
retries, gas policy, and deployment-specific module addresses. The API cache is bounded but ephemeral;
use Redis/PostgreSQL and a durable queue for multi-instance production deployments.
