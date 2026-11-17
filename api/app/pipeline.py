import logging
from dataclasses import dataclass, field

from . import service
from .hub import Hub
from .normalize import parse_message

log = logging.getLogger("pipeline")


@dataclass
class Stats:
    received: int = 0
    stored: int = 0
    duplicates: int = 0
    rejected: int = 0
    mqtt_connected: bool = False
    extra: dict = field(default_factory=dict)


class Pipeline:
    """MQTT message -> normalize -> idempotent store -> WebSocket broadcast."""

    def __init__(self, session_factory, hub: Hub, ttl: int = 20) -> None:
        self.sf = session_factory
        self.hub = hub
        self.ttl = ttl
        self.stats = Stats()

    async def handle(self, topic: str, payload: bytes) -> bool:
        self.stats.received += 1
        try:
            ev = parse_message(topic, payload)
        except ValueError as e:
            self.stats.rejected += 1
            log.warning("rejected %s: %s", topic, e)
            return False
        result = await service.ingest(self.sf, ev, self.ttl)
        if result is None:
            self.stats.duplicates += 1
            return False
        self.stats.stored += 1
        event, device = result
        await self.hub.broadcast({"kind": "event", "event": event, "device": device})
        return True
