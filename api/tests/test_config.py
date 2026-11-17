from app.config import Settings, normalize_database_url


def test_hosted_postgres_url_is_converted_for_asyncpg():
    url = "postgresql://user:pw@ep-1.region.example.tech/db?sslmode=require&channel_binding=require"
    assert normalize_database_url(url) == "postgresql+asyncpg://user:pw@ep-1.region.example.tech/db?ssl=require"


def test_postgres_scheme_alias_and_already_converted_urls():
    assert normalize_database_url("postgres://u:p@h/d").startswith("postgresql+asyncpg://u:p@h/d")
    ready = "postgresql+asyncpg://factory:factory@postgres:5432/factory"
    assert normalize_database_url(ready) == ready
    assert normalize_database_url("sqlite+aiosqlite://") == "sqlite+aiosqlite://"


def test_settings_normalizes_database_url_from_environment(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/d?sslmode=require")
    assert Settings().database_url == "postgresql+asyncpg://u:p@h/d?ssl=require"
