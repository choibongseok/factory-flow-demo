import pytest
import pytest_asyncio

from app.config import Settings
from app.db import init_schema, make_engine, make_session_factory
from app.hub import Hub
from app.main import create_app
from app.pipeline import Pipeline


@pytest.fixture
def settings():
    return Settings(database_url="sqlite+aiosqlite://", mqtt_enabled=False, startup_wait_seconds=5)


@pytest_asyncio.fixture
async def pipeline(settings):
    engine = make_engine(settings.database_url)
    await init_schema(engine)
    p = Pipeline(make_session_factory(engine), Hub())
    yield p
    await engine.dispose()


@pytest.fixture
def app(settings):
    return create_app(settings)
