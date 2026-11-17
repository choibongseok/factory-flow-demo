import logging
from datetime import datetime, timezone
from dataclasses import dataclass, field

from . import service
from .hub import Hub
from .metrics import MetricsStore
from .status import StatusTracker
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

    def __init__(self, session_factory, hub: Hub, ttl: int = 20, metrics: MetricsStore | None = None, tracker: StatusTracker | None = None) -> None:
        self.sf = session_factory
        self.hub = hub
        self.ttl = ttl
        self.stats = Stats()
        self.metrics = metrics or MetricsStore()
        self.tracker = tracker or StatusTracker()

    async def handle(self, topic: str, payload: bytes) -> bool:
        self.stats.received += 1
        try:
            ev = parse_message(topic, payload)
        except ValueError as e:
            self.stats.rejected += 1
            self.metrics.record_rejected()
            log.warning("rejected %s: %s", topic, e)
            return False
        try:
            result = await service.ingest(self.sf, ev, self.ttl)
        except Exception:
            self.tracker.checks.db = "error"
            raise
        self.tracker.checks.db = "ok"
        self.tracker.event_seen()
        if result is None:
            self.stats.duplicates += 1
            self.metrics.record_duplicate(ev.line)
            return False
        self.stats.stored += 1
        latency_ms = (datetime.now(timezone.utc) - ev.ts).total_seconds() * 1000  # event time -> stored
        is_read = ev.type == "tag_read"
        self.metrics.record_stored(
            ev.line, latency_ms,
            ev.data["direction"] if is_read else None, ev.data.get("qty", 1) if is_read else 0,
        )
        event, device = result
        await self.hub.broadcast({"kind": "event", "event": event, "device": device})
        return True
