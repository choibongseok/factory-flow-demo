"""Lightweight server status for clients that wake a sleeping host: never touches the DB or the broker."""
import os
import time
from dataclasses import dataclass, field
from typing import Callable

VERSION = os.getenv("APP_VERSION", "0.1.0")
FRESH_SECONDS = 10.0


@dataclass
class Checks:
    db: str = "pending"      # pending | ok | error
    mqtt: str = "pending"    # pending | ok | error


@dataclass
class StatusTracker:
    clock: Callable[[], float] = time.monotonic
    started: float = field(init=False)
    checks: Checks = field(default_factory=Checks)
    last_event_at: float | None = None

    def __post_init__(self) -> None:
        self.started = self.clock()

    def event_seen(self) -> None:
        self.last_event_at = self.clock()

    def snapshot(self, events_per_s: float = 0.0) -> dict:
        now = self.clock()
        age = None if self.last_event_at is None else round(now - self.last_event_at, 2)
        if age is None:
            simulator = "pending"
        elif age <= FRESH_SECONDS:
            simulator = "running"
        else:
            simulator = "stopped"
        values = [self.checks.db, self.checks.mqtt, simulator]
        if "error" in values:
            state = "degraded"
        elif "pending" in values:
            state = "starting"
        elif simulator == "stopped":
            state = "degraded"
        else:
            state = "ready"
        return {
            "state": state,
            "version": VERSION,
            "uptime_s": int(now - self.started),
            "checks": {
                "db": self.checks.db,
                "mqtt": self.checks.mqtt,
                "simulator": simulator,
                "ingest": {"last_event_age_s": age, "events_per_s": round(events_per_s, 1)},
            },
        }
