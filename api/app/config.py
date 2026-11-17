from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    """Accept the connection string a hosted Postgres hands out and make it usable with asyncpg.

    postgres:// and postgresql:// become postgresql+asyncpg://, and libpq-style sslmode=... becomes ssl=...
    (asyncpg does not know sslmode; channel_binding is not supported either and is dropped).
    """
    parts = urlsplit(url)
    scheme = parts.scheme
    if scheme in ("postgres", "postgresql"):
        scheme = "postgresql+asyncpg"
    if not scheme.startswith("postgresql+asyncpg"):
        return url
    query = []
    for k, v in parse_qsl(parts.query, keep_blank_values=True):
        if k == "channel_binding":
            continue
        query.append(("ssl", v) if k == "sslmode" else (k, v))
    return urlunsplit((scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    database_url: str = "postgresql+asyncpg://factory:factory@localhost:5432/factory"
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_topic: str = "factory/+/+/+"
    mqtt_client_id: str = "factory-api"
    mqtt_enabled: bool = True
    # A device is "online" if its latest event is newer than this many seconds.
    online_ttl_seconds: int = 20
    cors_origins: str = "*"
    # 0 = keep forever. A small hosted database can set e.g. 24 to stay under its size limit.
    event_retention_hours: float = 0
    # How long startup waits for the database before serving (0 = serve /api/status immediately).
    startup_wait_seconds: float = 0

    @field_validator("database_url")
    @classmethod
    def _normalize_url(cls, v: str) -> str:
        return normalize_database_url(v)
