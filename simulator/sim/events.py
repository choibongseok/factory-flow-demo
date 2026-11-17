"""Message envelope shared by every publisher (simulator, OPC-UA gateway)."""
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

# Position is high-rate and self-healing (the next one replaces it): QoS 0.
# Everything that must not be lost (status changes, goods movement, scans): QoS 1.
QOS = {"position": 0, "status": 1, "tag_read": 1, "scan": 1}


@dataclass(frozen=True)
class Message:
    topic: str
    payload: bytes
    qos: int


def make_message(line: str, device: str, event: str, data: dict, now: datetime | None = None) -> Message:
    body = {
        "event_id": uuid.uuid4().hex,
        "ts": (now or datetime.now(timezone.utc)).isoformat(),
        **data,
    }
    return Message(f"factory/{line}/{device}/{event}", json.dumps(body).encode(), QOS[event])
