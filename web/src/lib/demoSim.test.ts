import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoEngine, DemoSimulator } from "./demoSim.ts";

test("topics follow factory/{line}/{device}/{event} and payload carries event_id + ts", () => {
  const sim = new DemoSimulator(1);
  const msgs = sim.tick(1, new Date());
  assert.ok(msgs.length > 0);
  for (const m of msgs) {
    assert.match(m.topic, /^factory\/line-[a-z]\/[a-z0-9-]+\/(position|status|tag_read|scan)$/);
    assert.match(m.payload.event_id, /^[0-9a-f]{32}$/);
    assert.ok(!Number.isNaN(Date.parse(m.payload.ts)));
  }
});

test("engine ignores redelivered event_id and keeps inventory consistent", () => {
  const sim = new DemoSimulator(3, 1, 1, 0.5); // 50% duplicate rate
  const eng = new DemoEngine();
  const now = Date.now();
  let delivered = 0;
  for (let i = 0; i < 300; i++) for (const m of sim.tick(1, new Date(now + i * 1000))) { delivered++; eng.ingest(m); }
  assert.ok(eng.duplicates > 0);
  assert.equal(eng.seen.size + eng.duplicates, delivered);
  const inv = eng.inventory();
  assert.equal(inv.totals.on_hand, inv.totals.inbound - inv.totals.outbound);
  assert.ok(inv.totals.inbound > 0 && inv.totals.outbound > 0);
});

test("same seed gives the same stream shape", () => {
  const run = () => new DemoSimulator(9).tick(1, new Date(0)).map((m) => m.topic);
  assert.deepEqual(run(), run());
});
