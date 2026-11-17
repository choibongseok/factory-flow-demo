import math
import random
from dataclasses import dataclass, field

from .events import Message, make_message

MAP_W, MAP_H = 100.0, 60.0
CHARGER = (6.0, 6.0)
SKUS = ["SKU-1001", "SKU-1002", "SKU-2001", "SKU-3050", "SKU-4400"]


@dataclass
class Amr:
    line: str
    name: str
    route: list[tuple[float, float]]
    rng: random.Random
    speed: float = 6.0  # map units / second
    x: float = 0.0
    y: float = 0.0
    battery: float = 100.0
    state: str = "idle"
    idx: int = 0
    pause: float = 0.0
    error_left: float = 0.0
    _last_state: str = ""
    _since_status: float = 99.0
    heading: float = 0.0

    def __post_init__(self):
        self.x, self.y = self.route[0]

    def tick(self, dt: float) -> list[Message]:
        out: list[Message] = []
        self._since_status += dt
        self._advance(dt)
        out.append(make_message(self.line, self.name, "position",
                                {"x": round(self.x, 2), "y": round(self.y, 2), "heading": round(self.heading, 1)}))
        if self.state != self._last_state or self._since_status >= 5:
            out.append(make_message(self.line, self.name, "status",
                                    {"state": self.state, "battery": round(self.battery, 1)}))
            self._last_state, self._since_status = self.state, 0.0
        return out

    def _advance(self, dt: float) -> None:
        if self.state == "error":
            self.error_left -= dt
            if self.error_left <= 0:
                self.state = "idle"
            return
        if self.state == "charging":
            self.battery = min(100.0, self.battery + 12 * dt)
            if self.battery >= 95:
                self.state = "idle"
            return
        if self.rng.random() < 0.002 * dt * 10:
            self.state, self.error_left = "error", 8.0
            return
        if self.battery < 20 and (self.x, self.y) != CHARGER:
            target = CHARGER
        else:
            target = self.route[self.idx]
        if self.pause > 0:
            self.pause -= dt
            self.state = "idle" if self.pause > 0 else "moving"
            return
        dx, dy = target[0] - self.x, target[1] - self.y
        dist = math.hypot(dx, dy)
        step = self.speed * dt
        self.state = "moving"
        self.battery = max(0.0, self.battery - 0.35 * dt)
        if dist <= step:
            self.x, self.y = target
            if target == CHARGER:
                self.state = "charging"
            else:
                self.idx = (self.idx + 1) % len(self.route)
                self.pause = self.rng.uniform(1.0, 3.0)
        else:
            self.x += dx / dist * step
            self.y += dy / dist * step
            self.heading = math.degrees(math.atan2(dy, dx))


@dataclass
class Gate:
    """RFID gate: reads a tag now and then, stamps direction in/out."""

    line: str
    name: str
    direction: str
    pos: tuple[float, float]
    rng: random.Random
    rate: float = 0.35  # reads per second
    _since_pos: float = 99.0

    def tick(self, dt: float) -> list[Message]:
        out: list[Message] = []
        self._since_pos += dt
        if self._since_pos >= 10:
            out.append(make_message(self.line, self.name, "position", {"x": self.pos[0], "y": self.pos[1]}))
            out.append(make_message(self.line, self.name, "status", {"state": "active"}))
            self._since_pos = 0.0
        if self.rng.random() < self.rate * dt:
            out.append(make_message(self.line, self.name, "tag_read", {
                "tag_id": f"E200{self.rng.randrange(16**8):08X}",
                "sku": self.rng.choice(SKUS),
                "direction": self.direction,
                "qty": self.rng.choice([1, 1, 1, 2, 5]),
                "rssi": round(self.rng.uniform(-70, -40), 1),
            }))
        return out


@dataclass
class Scanner:
    line: str
    name: str
    pos: tuple[float, float]
    rng: random.Random
    rate: float = 0.25
    _since_pos: float = 99.0

    def tick(self, dt: float) -> list[Message]:
        out: list[Message] = []
        self._since_pos += dt
        if self._since_pos >= 10:
            out.append(make_message(self.line, self.name, "position", {"x": self.pos[0], "y": self.pos[1]}))
            out.append(make_message(self.line, self.name, "status", {"state": "active"}))
            self._since_pos = 0.0
        if self.rng.random() < self.rate * dt:
            ok = self.rng.random() > 0.08
            out.append(make_message(self.line, self.name, "scan", {
                "code": f"QR-{self.rng.randrange(10**6):06d}", "result": "ok" if ok else "fail",
            }))
        return out


@dataclass
class Fleet:
    devices: list = field(default_factory=list)

    def tick(self, dt: float) -> list[Message]:
        return [m for d in self.devices for m in d.tick(dt)]


def build_fleet(lines: int, amrs_per_line: int, seed: int | None) -> Fleet:
    rng = random.Random(seed)
    fleet = Fleet()
    loops = [
        [(10, 30), (25, 10), (75, 10), (90, 30), (75, 50), (25, 50)],
        [(10, 10), (90, 10), (90, 50), (10, 50)],
        [(20, 30), (50, 15), (80, 30), (50, 45)],
    ]
    for li in range(lines):
        line = f"line-{chr(ord('a') + li)}"
        for ai in range(amrs_per_line):
            route = loops[ai % len(loops)]
            amr = Amr(line, f"amr-{ai + 1:02d}", route, random.Random(rng.random()))
            amr.idx = (ai * 2) % len(route)
            amr.x, amr.y = route[amr.idx]
            amr.battery = rng.uniform(40, 100)
            fleet.devices.append(amr)
        fleet.devices.append(Gate(line, "gate-in-01", "in", (4.0, 30.0), random.Random(rng.random())))
        fleet.devices.append(Gate(line, "gate-out-01", "out", (96.0, 30.0), random.Random(rng.random())))
        fleet.devices.append(Scanner(line, "scanner-01", (50.0, 30.0), random.Random(rng.random())))
    return fleet
