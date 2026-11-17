"""Topic + payload -> NormalizedEvent. Pure functions, no I/O."""
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

TOPIC_ROOT = "factory"


class Position(BaseModel):
    x: float
    y: float
    heading: float | None = None


class Status(BaseModel):
    state: str = Field(min_length=1, max_length=32)
    battery: float | None = Field(default=None, ge=0, le=100)


class TagRead(BaseModel):
    tag_id: str = Field(min_length=1, max_length=64)
    sku: str = Field(min_length=1, max_length=64)
    direction: Literal["in", "out"]
    qty: int = Field(default=1, ge=1, le=10_000)
    rssi: float | None = None


class Scan(BaseModel):
    code: str = Field(min_length=1, max_length=256)
    result: Literal["ok", "fail"] = "ok"


SCHEMAS: dict[str, type[BaseModel]] = {
    "position": Position,
    "status": Status,
    "tag_read": TagRead,
    "scan": Scan,
}

ENVELOPE_KEYS = {"event_id", "ts"}


@dataclass(frozen=True)
class NormalizedEvent:
    event_id: str
    topic: str
    line: str
    device: str
    type: str
    ts: datetime
    data: dict[str, Any]


def as_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def parse_ts(value: Any, now: datetime | None = None) -> datetime:
    """Accept ISO-8601 or epoch seconds; fall back to arrival time."""
    now = now or datetime.now(timezone.utc)
    if value is None:
        return now
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        return as_utc(datetime.fromisoformat(str(value).replace("Z", "+00:00")))
    except (ValueError, OverflowError, OSError):
        return now


def derive_event_id(topic: str, body: dict[str, Any]) -> str:
    """Devices without their own ID still dedupe: same topic+body => same ID."""
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"))
    return "h-" + hashlib.sha1(f"{topic}\n{canonical}".encode()).hexdigest()[:40]


def parse_message(topic: str, payload: bytes, now: datetime | None = None) -> NormalizedEvent:
    parts = topic.split("/")
    if len(parts) != 4 or parts[0] != TOPIC_ROOT or not all(parts):
        raise ValueError(f"bad topic: {topic!r}")
    _, line, device, etype = parts
    if etype not in SCHEMAS:
        raise ValueError(f"unsupported event type: {etype!r}")

    try:
        body = json.loads(payload)
    except (ValueError, UnicodeDecodeError) as e:
        raise ValueError(f"payload is not JSON: {e}") from e
    if not isinstance(body, dict):
        raise ValueError("payload must be a JSON object")

    event_id = body.get("event_id")
    if event_id is None:
        event_id = derive_event_id(topic, body)
    event_id = str(event_id)
    if not 0 < len(event_id) <= 64:
        raise ValueError("event_id must be 1..64 chars")

    try:
        model = SCHEMAS[etype].model_validate({k: v for k, v in body.items() if k not in ENVELOPE_KEYS})
    except ValidationError as e:
        raise ValueError(f"invalid {etype} payload: {e.errors(include_url=False)}") from e

    return NormalizedEvent(
        event_id=event_id,
        topic=topic,
        line=line,
        device=device,
        type=etype,
        ts=parse_ts(body.get("ts"), now),
        data=model.model_dump(exclude_none=True),
    )
