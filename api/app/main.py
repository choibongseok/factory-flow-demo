import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import Depends, FastAPI, Query, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession

from . import service
from .status import StatusTracker
from .config import Settings
from .db import init_schema, make_engine, make_session_factory
from .hub import Hub
from .mqtt_consumer import run_consumer
from .pipeline import Pipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    engine = make_engine(settings.database_url)
    sf = make_session_factory(engine)
    hub = Hub()
    tracker = StatusTracker()
    pipeline = Pipeline(sf, hub, settings.online_ttl_seconds, tracker=tracker)
    origins = [o.strip() for o in settings.cors_origins.split(",")]

    async def bootstrap() -> None:
        """Schema init, then the MQTT consumer. Runs in the background so the HTTP port answers at once."""
        try:
            await init_schema(engine)
        except Exception:  # noqa: BLE001
            tracker.checks.db = "error"
            logging.getLogger("db").exception("database unavailable")
            return
        tracker.checks.db = "ok"
        if settings.mqtt_enabled:
            await run_consumer(settings, pipeline)

    async def purge_loop() -> None:
        while True:
            try:
                n = await service.purge_older_than(sf, settings.event_retention_hours)
                if n:
                    logging.getLogger("retention").info("purged %d old events", n)
            except Exception:  # noqa: BLE001
                logging.getLogger("retention").exception("purge failed")
            await asyncio.sleep(600)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        tasks = [asyncio.create_task(bootstrap())]
        if settings.event_retention_hours > 0:
            tasks.append(asyncio.create_task(purge_loop()))
        if settings.startup_wait_seconds > 0:  # tests: wait for the schema before serving
            deadline = asyncio.get_event_loop().time() + settings.startup_wait_seconds
            while tracker.checks.db == "pending" and asyncio.get_event_loop().time() < deadline:
                await asyncio.sleep(0.01)
        yield
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await engine.dispose()

    app = FastAPI(title="Factory Flow API", version="0.1.0", lifespan=lifespan)
    app.state.pipeline = pipeline
    app.state.hub = hub
    app.state.tracker = tracker
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])

    async def get_session():
        async with sf() as session:
            yield session

    @app.get("/health")
    async def health():
        s = pipeline.stats
        return {
            "status": "ok",
            "mqtt_connected": s.mqtt_connected,
            "received": s.received,
            "stored": s.stored,
            "duplicates": s.duplicates,
            "rejected": s.rejected,
            "ws_clients": len(hub),
        }

    @app.get("/api/status")
    async def status(response: Response):
        """First call of every client: answers immediately, whatever the DB or broker are doing."""
        response.headers["Cache-Control"] = "no-store"
        rate = pipeline.metrics.snapshot(10)["summary"]["per_second"]
        return tracker.snapshot(rate)

    @app.get("/api/devices")
    async def devices(line: str | None = None, session: AsyncSession = Depends(get_session)):
        return await service.list_devices(session, line, settings.online_ttl_seconds)

    @app.get("/api/events")
    async def events(
        line: str | None = None,
        device: str | None = None,
        type: str | None = None,
        limit: int = Query(50, ge=1, le=500),
        before: datetime | None = None,
        session: AsyncSession = Depends(get_session),
    ):
        return await service.list_events(session, line, device, type, limit, before)

    @app.get("/api/inventory")
    async def inventory(line: str | None = None, session: AsyncSession = Depends(get_session)):
        return await service.inventory(session, line)

    @app.get("/api/movements")
    async def movements(
        line: str | None = None,
        limit: int = Query(50, ge=1, le=500),
        session: AsyncSession = Depends(get_session),
    ):
        return await service.list_movements(session, line, limit)

    @app.get("/api/metrics")
    async def metrics(
        seconds: int = Query(300, ge=10, le=3600),
        step: int = Query(1, ge=1, le=60),
        line: str | None = None,
    ):
        return pipeline.metrics.snapshot(seconds, step, line)

    @app.websocket("/ws")
    async def ws(websocket: WebSocket):
        origin = websocket.headers.get("origin")
        if "*" not in origins and origin is not None and origin not in origins:
            await websocket.close(code=1008)  # policy violation: origin not allowed
            return
        await hub.connect(websocket)
        try:
            async with sf() as session:
                snapshot = await service.list_devices(session, None, settings.online_ttl_seconds)
            await websocket.send_json({"kind": "snapshot", "devices": snapshot})
            while True:
                await websocket.receive_text()  # keep-alive; clients send nothing meaningful
        except WebSocketDisconnect:
            pass
        finally:
            hub.disconnect(websocket)

    return app

