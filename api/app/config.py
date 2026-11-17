from pydantic_settings import BaseSettings, SettingsConfigDict


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
