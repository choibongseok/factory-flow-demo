import { test } from "node:test";
import assert from "node:assert/strict";
import { topologyStates } from "./topology.ts";
import type { StatusInfo } from "./sourceMachine.ts";

const status = (db: string, mqtt: string, simulator: string): StatusInfo => ({
  state: "starting", version: "x", uptime_s: 1,
  checks: { db, mqtt, simulator, ingest: { last_event_age_s: null, events_per_s: 0 } } as StatusInfo["checks"],
});

test("while the server is waking the server-side nodes are waiting, not failed", () => {
  for (const phase of ["waking", "timeout"] as const) {
    const s = topologyStates(phase, status("pending", "pending", "pending"));
    assert.deepEqual(Object.values(s).filter((v) => v === "bad"), []);
    assert.equal(s.api, "wait");
    assert.equal(s.ui, "ok");
  }
});

test("a degraded status marks only the failing checks as bad", () => {
  const s = topologyStates("waking", status("ok", "error", "pending"));
  assert.equal(s.mq, "bad");
  assert.equal(s.pg, "wait");
});

test("browser simulation shows every node healthy", () => {
  assert.ok(Object.values(topologyStates("sim", null)).every((v) => v === "ok"));
});

test("a connection lost after being live marks the server-side nodes as bad", () => {
  const s = topologyStates("reconnecting", null);
  assert.deepEqual([s.api, s.pg, s.ws, s.ui], ["bad", "bad", "bad", "ok"]);
});

test("live nodes follow the status checks", () => {
  const s = topologyStates("live", status("ok", "ok", "running"));
  assert.ok(Object.values(s).every((v) => v === "ok"));
  assert.equal(topologyStates("live", status("error", "ok", "running")).pg, "bad");
});
