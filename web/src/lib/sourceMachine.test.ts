import { test } from "node:test";
import assert from "node:assert/strict";
import { failingChecks, initialState, reduce, sourceBadge } from "./sourceMachine.ts";
import type { StatusInfo } from "./sourceMachine.ts";
import { WAKE_TIMEOUT_MS, wakeTimeoutMs } from "./config.ts";

const run = (s: ReturnType<typeof initialState>, ...evs: Parameters<typeof reduce>[1][]) => evs.reduce(reduce, s);

test("without a backend the browser simulation starts directly; with one it starts waking", () => {
  assert.equal(initialState(false).phase, "sim");
  assert.deepEqual(initialState(true), { phase: "waking", stage: "wait_server" });
});

test("wake stages advance: unreachable -> starting -> ready, then data makes it live", () => {
  let s = initialState(true);
  s = run(s, { type: "status", state: "unreachable" });
  assert.equal(s.stage, "wait_server");
  s = run(s, { type: "status", state: "starting" });
  assert.deepEqual(s, { phase: "waking", stage: "starting" });
  s = run(s, { type: "status", state: "ready" });
  assert.deepEqual(s, { phase: "waking", stage: "ready" });
  assert.equal(run(s, { type: "data" }).phase, "live");
});

test("a degraded server keeps the panel up with the degraded stage and can recover", () => {
  let s = run(initialState(true), { type: "status", state: "degraded" });
  assert.deepEqual(s, { phase: "waking", stage: "degraded" });
  s = run(s, { type: "status", state: "ready" });
  assert.equal(s.stage, "ready");
});

test("no answer within the timeout ends in timeout; retry goes back to waking", () => {
  let s = run(initialState(true), { type: "wake_timeout" });
  assert.equal(s.phase, "timeout");
  s = run(s, { type: "retry" });
  assert.deepEqual(s, { phase: "waking", stage: "wait_server" });
});

test("the simulation is only entered by an explicit choice, and the user can go back", () => {
  assert.equal(run(initialState(true), { type: "wake_timeout" }, { type: "choose_sim" }).phase, "sim");
  assert.equal(run(initialState(true), { type: "wake_timeout" }).phase, "timeout"); // never silently "sim"
  assert.equal(run(initialState(true), { type: "wake_timeout" }, { type: "choose_sim" }, { type: "retry" }).phase, "waking");
});

test("a dropped live connection goes to reconnecting and returns to live on data", () => {
  const live = run(initialState(true), { type: "data" });
  const re = run(live, { type: "ws_closed" });
  assert.equal(re.phase, "reconnecting");
  assert.equal(run(re, { type: "status", state: "starting" }).phase, "reconnecting");
  assert.equal(run(re, { type: "data" }).phase, "live");
});

test("a websocket close while still waking does not leave the wake phase", () => {
  assert.equal(run(initialState(true), { type: "status", state: "ready" }, { type: "ws_closed" }).stage, "wait_server");
});

test("late timeout events are ignored once live", () => {
  assert.equal(run(initialState(true), { type: "data" }, { type: "wake_timeout" }).phase, "live");
});

test("failingChecks lists only the unhealthy checks", () => {
  const st: StatusInfo = {
    state: "degraded", version: "x", uptime_s: 3,
    checks: { db: "ok", mqtt: "error", simulator: "pending", ingest: { last_event_age_s: null, events_per_s: 0 } },
  };
  assert.deepEqual(failingChecks(st), ["MQTT: error", "시뮬레이터: pending"]);
});

test("wake timeout defaults to 90 seconds", () => {
  assert.equal(WAKE_TIMEOUT_MS, 90_000);
  assert.equal(wakeTimeoutMs(), 90_000);
});

test("the source badge is green only when the server is connected and healthy", () => {
  assert.deepEqual([sourceBadge("waking").label, sourceBadge("waking").tone], ["서버 켜는 중", "warn"]);
  assert.equal(sourceBadge("timeout").tone, "warn");
  assert.equal(sourceBadge("live", "ready").tone, "ok");
  assert.equal(sourceBadge("live", "ready").label, "실시간 서버");
  assert.equal(sourceBadge("live", "degraded").tone, "bad");
  assert.equal(sourceBadge("reconnecting").tone, "bad");
  assert.equal(sourceBadge("sim").key, "sim");
});
