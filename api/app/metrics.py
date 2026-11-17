"""In-memory per-second metrics, aggregated on read.

Not persisted: the dashboard only needs recent history, and Postgres already holds the events themselves.
The web demo engine (web/src/lib/metrics.ts) implements the same bucket and percentile rules.
"""
import math
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable


LATENCY_WINDOW_SECONDS = 5  # series p50/p95 use a moving window this long (a bucket's own seconds if longer)


def percentile(values: list[float], p: float) -> float | None:
    """Nearest-rank percentile; None for an empty list."""
    if not values:
        return None
    s = sorted(values)
    return s[max(0, math.ceil(p / 100 * len(s)) - 1)]


@dataclass
class LineBucket:
    stored: int = 0
    duplicates: int = 0
    in_qty: int = 0
    out_qty: int = 0
    lat: list[float] = field(default_factory=list)


class MetricsStore:
    def __init__(self, retention_seconds: int = 3600, clock: Callable[[], float] = time.time) -> None:
        self.retention = retention_seconds
        self.clock = clock
        self._sec: dict[int, dict[str, LineBucket]] = defaultdict(lambda: defaultdict(LineBucket))
        self._rejected: dict[int, int] = defaultdict(int)

    def _now(self, at: float | None) -> int:
        return int(self.clock() if at is None else at)

    def _prune(self, now: int) -> None:
        cutoff = now - self.retention
        for d in (self._sec, self._rejected):
            for k in [k for k in d if k < cutoff]:
                del d[k]

    def record_stored(self, line: str, latency_ms: float, direction: str | None = None, qty: int = 0, at: float | None = None) -> None:
        t = self._now(at)
        b = self._sec[t][line]
        b.stored += 1
        b.lat.append(max(0.0, latency_ms))
        if direction == "in":
            b.in_qty += qty
        elif direction == "out":
            b.out_qty += qty
        self._prune(t)

    def record_duplicate(self, line: str, at: float | None = None) -> None:
        self._sec[self._now(at)][line].duplicates += 1

    def record_rejected(self, at: float | None = None) -> None:
        self._rejected[self._now(at)] += 1

    def snapshot(self, seconds: int = 300, step: int = 1, line: str | None = None, now: float | None = None) -> dict:
        end = self._now(now)
        start = end - seconds + 1
        first_key = (start // step) * step
        keys = list(range(first_key, (end // step) * step + 1, step))
        series, all_lat = [], []
        tot = {"stored": 0, "duplicates": 0, "rejected": 0, "in": 0, "out": 0}
        first_data_t = None
        for k in keys:
            row = {"stored": 0, "duplicates": 0, "rejected": 0, "in": 0, "out": 0}
            lat: list[float] = []
            lines: dict[str, dict[str, int]] = {}
            for t in range(max(k, start), min(k + step - 1, end) + 1):
                for ln, b in self._sec.get(t, {}).items():
                    if line and ln != line:
                        continue
                    row["stored"] += b.stored
                    row["duplicates"] += b.duplicates
                    row["in"] += b.in_qty
                    row["out"] += b.out_qty
                    lat.extend(b.lat)
                    f = lines.setdefault(ln, {"in": 0, "out": 0})
                    f["in"] += b.in_qty
                    f["out"] += b.out_qty
                if not line:
                    row["rejected"] += self._rejected.get(t, 0)
                if first_data_t is None and (row["stored"] or row["duplicates"] or row["rejected"]):
                    first_data_t = t
            row["received"] = row["stored"] + row["duplicates"] + row["rejected"]
            hi = min(k + step - 1, end)
            win: list[float] = []
            for t in range(hi - max(LATENCY_WINDOW_SECONDS, step) + 1, hi + 1):
                for ln, b in self._sec.get(t, {}).items():
                    if not line or ln == line:
                        win.extend(b.lat)
            series.append({"t": k, **row, "p50": percentile(win, 50), "p95": percentile(win, 95), "lines": lines})
            for key in tot:
                tot[key] += row[key]
            all_lat.extend(lat)
        received = tot["stored"] + tot["duplicates"] + tot["rejected"]
        span = seconds if first_data_t is None else min(seconds, end - first_data_t + 1)
        return {
            "now": end,
            "window_seconds": seconds,
            "step": step,
            "line": line,
            "series": series,
            "summary": {
                "received": received,
                "stored": tot["stored"],
                "duplicates": tot["duplicates"],
                "rejected": tot["rejected"],
                "dup_rate": (tot["duplicates"] / received) if received else 0.0,
                "per_second": received / span if span else 0.0,
                "p50": percentile(all_lat, 50),
                "p95": percentile(all_lat, 95),
                "in": tot["in"],
                "out": tot["out"],
            },
        }
