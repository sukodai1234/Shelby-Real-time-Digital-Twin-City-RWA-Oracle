from __future__ import annotations

import asyncio
import hashlib
import random
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .config import Settings
from .engine import SensorReading, evaluate_twin
from .models import IngestResponse, SensorReadingRequest
from .security import SignatureError, SignatureVerifier, canonical_json
from .state import OracleState
from .storage import ShelbyStorage, ShelbyStorageError, StorageReceipt

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


def demo_reading() -> SensorReading:
    return SensorReading(
        temperature_c=round(random.uniform(25, 36), 1),
        humidity_pct=round(random.uniform(55, 92), 1),
        pm25_ug_m3=round(random.uniform(8, 70), 1),
        oxygen_pct=round(random.uniform(19.0, 21.0), 2),
        salinity_ppt=round(random.uniform(2, 24), 1),
        water_level_cm=round(random.uniform(0, 55), 1),
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.oracle = OracleState(resolved.max_cached_assets)
        app.state.storage = ShelbyStorage(
            bridge_url=resolved.shelby_bridge_url,
            bridge_token=resolved.shelby_bridge_token,
            ttl_seconds=resolved.shelby_blob_ttl_seconds,
            timeout_seconds=resolved.outbound_timeout_seconds,
        )
        app.state.verifier = SignatureVerifier(
            resolved.sensor_secrets or {},
            resolved.signature_max_age_seconds,
            resolved.require_sensor_signatures,
        )
        yield

    app = FastAPI(title="Shelby Real-time Digital Twin & RWA Oracle", version="2.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Idempotency-Key", "X-Sensor-Id", "X-Timestamp", "X-Signature"],
    )

    @app.get("/", include_in_schema=False)
    async def dashboard() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/health")
    async def health() -> dict:
        return {
            "status": "ok",
            "service": "shelby-rwa-oracle",
            "version": "2.0.0",
            "shelby_storage": "configured" if app.state.storage.enabled else "disabled",
        }

    @app.post("/api/v1/evaluate")
    async def evaluate(payload: SensorReadingRequest) -> dict:
        return {"reading": payload.model_dump(), "snapshot": evaluate_twin(payload.to_domain()).to_dict()}

    @app.post(
        "/api/v1/assets/{asset_id}/readings",
        response_model=IngestResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def ingest_reading(
        asset_id: str,
        payload: SensorReadingRequest,
        idempotency_key: str | None = Header(default=None, max_length=128),
        x_sensor_id: str | None = Header(default=None, max_length=128),
        x_timestamp: str | None = Header(default=None, max_length=32),
        x_signature: str | None = Header(default=None, max_length=128),
    ) -> dict:
        allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
        if not asset_id or len(asset_id) > 128 or any(char not in allowed for char in asset_id):
            raise HTTPException(
                status_code=422, detail="asset_id may only contain letters, digits, '-' and '_'"
            )
        scoped_key = f"{asset_id}:{idempotency_key}" if idempotency_key else None
        if scoped_key:
            cached = await app.state.oracle.idempotent_result(scoped_key)
            if cached:
                return cached
        reading_dict = payload.model_dump()
        try:
            verified = app.state.verifier.verify(
                asset_id=asset_id,
                payload=reading_dict,
                sensor_id=x_sensor_id,
                timestamp=x_timestamp,
                signature=x_signature,
            )
        except SignatureError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
        snapshot = evaluate_twin(payload.to_domain()).to_dict()
        document = {
            "asset_id": asset_id,
            "sensor_id": verified.sensor_id if verified else None,
            "reading": reading_dict,
            "snapshot": snapshot,
        }
        integrity_sha256 = hashlib.sha256(canonical_json(document)).hexdigest()
        try:
            receipt = await app.state.storage.upload_snapshot(
                asset_id=asset_id, integrity_sha256=integrity_sha256, document=document
            )
        except ShelbyStorageError as exc:
            if resolved.shelby_storage_required:
                raise HTTPException(
                    status_code=503, detail="Shelby storage is temporarily unavailable"
                ) from exc
            receipt = StorageReceipt(status="failed", error=str(exc))
        result = {**document, "integrity_sha256": integrity_sha256, "storage": receipt.to_dict()}
        await app.state.oracle.save(asset_id, result, scoped_key)
        return result

    @app.get("/api/v1/assets/{asset_id}/snapshots/latest", response_model=IngestResponse)
    async def latest_snapshot(asset_id: str) -> dict:
        result = await app.state.oracle.latest(asset_id)
        if result is None:
            raise HTTPException(status_code=404, detail="No snapshot has been ingested for this asset")
        return result

    @app.websocket("/ws/assets/{asset_id}")
    async def asset_stream(websocket: WebSocket, asset_id: str) -> None:
        await websocket.accept()
        queue = await app.state.oracle.subscribe(asset_id)
        try:
            latest = await app.state.oracle.latest(asset_id)
            if latest:
                await websocket.send_json(latest)
            while True:
                await websocket.send_json(await queue.get())
        except WebSocketDisconnect:
            pass
        finally:
            await app.state.oracle.unsubscribe(asset_id, queue)

    @app.websocket("/ws/demo")
    async def demo_stream(websocket: WebSocket) -> None:
        await websocket.accept()
        try:
            while True:
                reading = demo_reading()
                await websocket.send_json(
                    {"reading": asdict(reading), "snapshot": evaluate_twin(reading).to_dict()}
                )
                await asyncio.sleep(2)
        except WebSocketDisconnect:
            pass

    return app


app = create_app()
