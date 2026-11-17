// Browser-side twin of simulator/sim (Python) + the API's ingest rules.
// Same topic convention (factory/{line}/{device}/{event}), same payload envelope
// ({event_id, ts, ...}), same idempotency key, so the UI cannot tell the difference.
import type { Device, FlowEvent, Inventory } from "./types.ts";

export interface Msg {
  topic: string;
  payload: Record<string, unknown> & { event_id: string; ts: string };
}

const SKUS = ["SKU-1001", "SKU-1002", "SKU-2001", "SKU-3050", "SKU-4400"];
const CHARGER: [number, number] = [6, 6];

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T,>(r: Rng, xs: T[]): T => xs[Math.floor(r() * xs.length)];

export function makeMsg(line: string, device: string, event: string, data: object, now: Date, r: Rng): Msg {
  const id = Array.from({ length: 4 }, () => Math.floor(r() * 2 ** 32).toString(16).padStart(8, "0")).join("");
  return { topic: `factory/${line}/${device}/${event}`, payload: { event_id: id, ts: now.toISOString(), ...data } as Msg["payload"] };
}

interface Sim {
  tick(dt: number, now: Date): Msg[];
}

class Amr implements Sim {
  x: number; y: number; idx: number; battery: number;
  state = "idle"; pause = 0; errorLeft = 0; heading = 0; lastState = ""; sinceStatus = 99;
  constructor(public line: string, public name: string, public route: [number, number][], idx: number, private r: Rng) {
    this.idx = idx;
    [this.x, this.y] = route[idx];
    this.battery = 40 + r() * 60;
  }
  tick(dt: number, now: Date): Msg[] {
    this.sinceStatus += dt;
    this.advance(dt);
    const out = [makeMsg(this.line, this.name, "position",
      { x: +this.x.toFixed(2), y: +this.y.toFixed(2), heading: +this.heading.toFixed(1) }, now, this.r)];
    if (this.state !== this.lastState || this.sinceStatus >= 5) {
      out.push(makeMsg(this.line, this.name, "status", { state: this.state, battery: +this.battery.toFixed(1) }, now, this.r));
      this.lastState = this.state; this.sinceStatus = 0;
    }
    return out;
  }
  private advance(dt: number) {
    if (this.state === "error") { this.errorLeft -= dt; if (this.errorLeft <= 0) this.state = "idle"; return; }
    if (this.state === "charging") {
      this.battery = Math.min(100, this.battery + 12 * dt);
      if (this.battery >= 95) this.state = "idle";
      return;
    }
    if (this.r() < 0.02 * dt) { this.state = "error"; this.errorLeft = 8; return; }
    const target = this.battery < 20 && !(this.x === CHARGER[0] && this.y === CHARGER[1]) ? CHARGER : this.route[this.idx];
    if (this.pause > 0) { this.pause -= dt; this.state = this.pause > 0 ? "idle" : "moving"; return; }
    const dx = target[0] - this.x, dy = target[1] - this.y, dist = Math.hypot(dx, dy), step = 6 * dt;
    this.state = "moving";
    this.battery = Math.max(0, this.battery - 0.35 * dt);
    if (dist <= step) {
      [this.x, this.y] = target;
      if (target === CHARGER) this.state = "charging";
      else { this.idx = (this.idx + 1) % this.route.length; this.pause = 1 + this.r() * 2; }
    } else {
      this.x += (dx / dist) * step; this.y += (dy / dist) * step;
      this.heading = (Math.atan2(dy, dx) * 180) / Math.PI;
    }
  }
}

class Fixed implements Sim {
  since = 99;
  constructor(public line: string, public name: string, public pos: [number, number], protected r: Rng) {}
  tick(dt: number, now: Date): Msg[] {
    this.since += dt;
    const out: Msg[] = [];
    if (this.since >= 10) {
      out.push(makeMsg(this.line, this.name, "position", { x: this.pos[0], y: this.pos[1] }, now, this.r));
      out.push(makeMsg(this.line, this.name, "status", { state: "active" }, now, this.r));
      this.since = 0;
    }
    return out.concat(this.read(dt, now));
  }
  protected read(_dt: number, _now: Date): Msg[] { return []; }
}

class Gate extends Fixed {
  constructor(line: string, name: string, private direction: "in" | "out", pos: [number, number], r: Rng) { super(line, name, pos, r); }
  protected read(dt: number, now: Date): Msg[] {
    if (this.r() >= 0.35 * dt) return [];
    return [makeMsg(this.line, this.name, "tag_read", {
      tag_id: "E200" + Math.floor(this.r() * 2 ** 32).toString(16).toUpperCase().padStart(8, "0"),
      sku: pick(this.r, SKUS), direction: this.direction, qty: pick(this.r, [1, 1, 1, 2, 5]),
      rssi: +(-70 + this.r() * 30).toFixed(1),
    }, now, this.r)];
  }
}

class Scanner extends Fixed {
  protected read(dt: number, now: Date): Msg[] {
    if (this.r() >= 0.25 * dt) return [];
    return [makeMsg(this.line, this.name, "scan", {
      code: "QR-" + String(Math.floor(this.r() * 1e6)).padStart(6, "0"),
      result: this.r() > 0.08 ? "ok" : "fail",
    }, now, this.r)];
  }
}

const LOOPS: [number, number][][] = [
  [[10, 30], [25, 10], [75, 10], [90, 30], [75, 50], [25, 50]],
  [[10, 10], [90, 10], [90, 50], [10, 50]],
];

export class DemoSimulator {
  private devices: Sim[] = [];
  constructor(seed = 42, lines = 2, amrsPerLine = 2, private dupRate = 0.03) {
    const r = mulberry32(seed);
    this.dupRng = mulberry32(seed + 1);
    for (let li = 0; li < lines; li++) {
      const line = `line-${String.fromCharCode(97 + li)}`;
      for (let ai = 0; ai < amrsPerLine; ai++) {
        const route = LOOPS[ai % LOOPS.length];
        this.devices.push(new Amr(line, `amr-${String(ai + 1).padStart(2, "0")}`, route, (ai * 2) % route.length, mulberry32(Math.floor(r() * 2 ** 31))));
      }
      this.devices.push(new Gate(line, "gate-in-01", "in", [4, 30], mulberry32(Math.floor(r() * 2 ** 31))));
      this.devices.push(new Gate(line, "gate-out-01", "out", [96, 30], mulberry32(Math.floor(r() * 2 ** 31))));
      this.devices.push(new Scanner(line, "scanner-01", [50, 30], mulberry32(Math.floor(r() * 2 ** 31))));
    }
  }
  private dupRng: Rng;
  tick(dt: number, now: Date): Msg[] {
    const out: Msg[] = [];
    for (const d of this.devices) for (const m of d.tick(dt, now)) {
      out.push(m);
      if (this.dupRng() < this.dupRate) out.push(m); // redelivery, same event_id
    }
    return out;
  }
}

export function deviceKind(name: string): Device["kind"] {
  const n = name.toLowerCase();
  return n.startsWith("amr") ? "amr" : n.startsWith("gate") ? "rfid_gate" : n.startsWith("scan") ? "qr_scanner" : "unknown";
}

/** Same rules as api/app/service.py: dedupe by event_id, newest-wins device state, SKU movement totals. */
export class DemoEngine {
  seen = new Set<string>();
  devices = new Map<string, Device>();
  private sku = new Map<string, { inbound: number; outbound: number; last: string }>();
  duplicates = 0;

  ingest(m: Msg): { event: FlowEvent; device: Device } | null {
    const [, line, device, type] = m.topic.split("/");
    const { event_id, ts, ...data } = m.payload;
    if (this.seen.has(event_id)) { this.duplicates++; return null; }
    this.seen.add(event_id);
    const id = `${line}/${device}`;
    let dev = this.devices.get(id);
    if (!dev) { dev = { id, line, device, kind: deviceKind(device), state: "unknown", x: null, y: null, battery: null, last_seen: ts }; }
    else dev = { ...dev };
    if (ts >= dev.last_seen) {
      dev.last_seen = ts;
      if (type === "position") { dev.x = data.x as number; dev.y = data.y as number; }
      else if (type === "status") { dev.state = data.state as string; dev.battery = (data.battery as number | undefined) ?? dev.battery; }
      else if (dev.state === "unknown") dev.state = "active";
    }
    this.devices.set(id, dev);
    if (type === "tag_read") {
      const s = this.sku.get(data.sku as string) ?? { inbound: 0, outbound: 0, last: ts };
      s[data.direction === "in" ? "inbound" : "outbound"] += (data.qty as number) ?? 1;
      s.last = ts;
      this.sku.set(data.sku as string, s);
    }
    return { event: { event_id, line, device, type: type as FlowEvent["type"], ts, payload: data }, device: dev };
  }

  inventory(): Inventory {
    const items = [...this.sku.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([sku, s]) => ({
      sku, inbound: s.inbound, outbound: s.outbound, on_hand: s.inbound - s.outbound, last_movement: s.last,
    }));
    const sum = (k: "inbound" | "outbound" | "on_hand") => items.reduce((a, i) => a + i[k], 0);
    return { items, totals: { inbound: sum("inbound"), outbound: sum("outbound"), on_hand: sum("on_hand") } };
  }
}
