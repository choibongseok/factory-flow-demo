import type { Page, Route } from "@playwright/test";

export const BASE = "http://mock.test";
const CORS = { "access-control-allow-origin": "*", "content-type": "application/json", "cache-control": "no-store" };
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, headers: CORS, body: JSON.stringify(body) });

type Check = "ok" | "pending" | "error";
export interface MockStatus { state: "starting" | "ready" | "degraded"; db: Check; mqtt: Check; simulator: "running" | "pending" | "stopped" }

export const STARTING: MockStatus = { state: "starting", db: "ok", mqtt: "pending", simulator: "pending" };
export const READY: MockStatus = { state: "ready", db: "ok", mqtt: "ok", simulator: "running" };
export const DEGRADED: MockStatus = { state: "degraded", db: "ok", mqtt: "error", simulator: "pending" };

const statusBody = (s: MockStatus) => ({
  state: s.state, version: "test", uptime_s: 12,
  checks: { db: s.db, mqtt: s.mqtt, simulator: s.simulator, ingest: { last_event_age_s: 0.4, events_per_s: 38 } },
});

const now = () => Math.floor(Date.now() / 1000);
const metrics = () => {
  const end = now();
  const series = Array.from({ length: 30 }, (_, i) => ({
    t: end - 29 + i, stored: 8, duplicates: 1, rejected: 0, received: 9, in: 2, out: 1, p50: 12, p95: 40,
    lines: { "line-a": { in: 1, out: 1 }, "line-b": { in: 1, out: 0 } },
  }));
  return { now: end, window_seconds: 300, step: 1, line: null, series, summary: { received: 270, stored: 240, duplicates: 30, rejected: 0, dup_rate: 0.111, per_second: 9, p50: 12, p95: 40, in: 60, out: 30 } };
};
const DEVICES = ["amr-01", "gate-in-01"].map((d) => ({
  id: `line-a/${d}`, line: "line-a", device: d, kind: d.startsWith("amr") ? "amr" : "rfid_gate", state: "moving", x: 10, y: 10, battery: 80,
  last_seen: new Date().toISOString(), online: true,
}));

export interface Mock {
  /** Status returned by /api/status; a function gets the 1-based call number (return null for a 503). */
  status: MockStatus | null | ((call: number) => MockStatus | null);
  statusCalls: number;
  wsConnections: number;
  /** Close the current websocket from the server side. */
  dropSocket: () => void;
}

/** Points the page at a fake backend. Must be called before page.goto. */
export async function mockBackend(page: Page, init: Pick<Mock, "status">, opts: { wakeTimeoutMs?: number } = {}): Promise<Mock> {
  const mock: Mock = { status: init.status, statusCalls: 0, wsConnections: 0, dropSocket: () => {} };
  await page.addInitScript(({ base, wake }) => {
    (window as unknown as { __FF: unknown }).__FF = { apiBase: base, wakeTimeoutMs: wake };
  }, { base: BASE, wake: opts.wakeTimeoutMs ?? 90_000 });

  await page.route(`${BASE}/api/status`, (route) => {
    mock.statusCalls++;
    const s = typeof mock.status === "function" ? mock.status(mock.statusCalls) : mock.status;
    return s ? json(route, statusBody(s)) : json(route, { error: "waking" }, 503);
  });
  await page.route(`${BASE}/api/metrics*`, (route) => json(route, metrics()));
  await page.route(`${BASE}/api/inventory*`, (route) =>
    json(route, { items: [{ sku: "SKU-9", inbound: 5, outbound: 2, on_hand: 3, last_movement: new Date().toISOString() }], totals: { inbound: 5, outbound: 2, on_hand: 3 } }));
  await page.route(`${BASE}/api/events*`, (route) => json(route, []));
  await page.routeWebSocket(`ws://mock.test/ws`, (ws) => {
    mock.wsConnections++;
    ws.send(JSON.stringify({ kind: "snapshot", devices: DEVICES }));
    const id = setInterval(() => {
      const ts = new Date().toISOString();
      ws.send(JSON.stringify({
        kind: "event",
        event: { event_id: `e${Math.random()}`, line: "line-a", device: "amr-01", type: "status", ts, payload: { state: "moving", battery: 80 } },
        device: { ...DEVICES[0], last_seen: ts },
      }));
    }, 500);
    mock.dropSocket = () => ws.close();
    ws.onClose(() => clearInterval(id));
  });
  return mock;
}
