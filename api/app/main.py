import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import Depends, FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession

from . import service
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
    pipeline = Pipeline(sf, hub, settings.online_ttl_seconds)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await init_schema(engine)
        task = asyncio.create_task(run_consumer(settings, pipeline)) if settings.mqtt_enabled else None
        yield
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await engine.dispose()

    app = FastAPI(title="Factory Flow API", version="0.1.0", lifespan=lifespan)
    app.state.pipeline = pipeline
    app.state.hub = hub
    origins = [o.strip() for o in settings.cors_origins.split(",")]
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

    @app.websocket("/ws")
    async def ws(websocket: WebSocket):
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

