import asyncio
import logging

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from .models import Base

log = logging.getLogger("db")


def make_engine(url: str) -> AsyncEngine:
    kwargs = {}
    if url.startswith("sqlite"):
        from sqlalchemy.pool import StaticPool

        kwargs = {"poolclass": StaticPool, "connect_args": {"check_same_thread": False}}
    elif "-pooler" in url:
        kwargs = {"connect_args": {"statement_cache_size": 0}}  # PgBouncer transaction mode: no prepared statements
    return create_async_engine(url, pool_pre_ping=True, **kwargs)


def make_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def init_schema(engine: AsyncEngine, attempts: int = 30) -> None:
    """create_all with retry so the API can start before Postgres is ready."""
    for i in range(1, attempts + 1):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            return
        except Exception as e:  # noqa: BLE001 - startup retry
            if i == attempts:
                raise
            log.warning("db not ready (%s), retry %d/%d", e.__class__.__name__, i, attempts)
            await asyncio.sleep(1)
