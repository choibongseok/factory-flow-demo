"""Pure OPC-UA -> MQTT message conversion (no network, no asyncua), so it can be unit-tested.

event_id is derived from the machine's own sequence number instead of a fresh UUID: if the gateway
restarts and re-reads the same value, the API's idempotent insert drops the repeat.
"""
import json
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass(frozen=True)
class Published:
    topic: str
    payload: str
    qos: int = 1


class ScanBridge:
    """Turns polled machine variables into scan + status events, once per new sequence number."""

    def __init__(self, line: str, device: str) -> None:
        self.line, self.device = line, device
        self.last_seq: int | None = None

    def poll(self, seq: int, code: str, ok: bool, running: bool, now: datetime | None = None) -> list[Published]:
        if seq == 0 or seq == self.last_seq:  # 0 = machine has not scanned anything yet
            return []
        self.last_seq = seq
        ts = (now or datetime.now(timezone.utc)).isoformat()
        base = f"factory/{self.line}/{self.device}"
        scan = {"event_id": f"opcua-{self.device}-{seq}", "ts": ts, "code": code, "result": "ok" if ok else "fail"}
        status = {"event_id": f"opcua-{self.device}-status-{seq}", "ts": ts, "state": "active" if running else "idle"}
        return [Published(f"{base}/scan", json.dumps(scan)), Published(f"{base}/status", json.dumps(status))]
