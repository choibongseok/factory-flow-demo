import { test } from "node:test";
import assert from "node:assert/strict";
import { MetricsStore, percentile, recentRate } from "./metrics.ts";

const store = () => new MetricsStore(600, () => 1000);

test("percentile uses nearest rank and handles empty input", () => {
  assert.equal(percentile([], 95), null);
  assert.equal(percentile([7], 50), 7);
  const v = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(v, 50), 50);
  assert.equal(percentile(v, 95), 95);
  assert.equal(percentile([3, 1, 2], 50), 2);
});

test("events 1 ms apart across a second boundary land in different 1 s buckets", () => {
  const m = store();
  m.recordStored("line-a", 5, undefined, 0, 100.999);
  m.recordStored("line-a", 5, undefined, 0, 101.0);
  const by = Object.fromEntries(m.snapshot(10, 1, null, 105).series.map((r) => [r.t, r.stored]));
  assert.equal(by[100], 1);
  assert.equal(by[101], 1);
});

test("5 s step buckets split exactly at the multiple of five", () => {
  const m = store();
  m.recordStored("line-a", 5, undefined, 0, 104.9);
  m.recordStored("line-a", 5, undefined, 0, 105.0);
  const by = Object.fromEntries(m.snapshot(20, 5, null, 110).series.map((r) => [r.t, r.stored]));
  assert.equal(by[100], 1);
  assert.equal(by[105], 1);
});

test("duplicate rate is duplicates over everything received", () => {
  const m = store();
  for (let i = 0; i < 3; i++) m.recordStored("line-a", 1, undefined, 0, 990 + i);
  m.recordDuplicate("line-a", 993);
  m.recordRejected(994);
  const s = m.snapshot(60, 1, null, 1000).summary;
  assert.deepEqual([s.stored, s.duplicates, s.rejected, s.received], [3, 1, 1, 5]);
  assert.equal(s.dup_rate, 0.2);
});

test("line filter drops other lines and rejected messages", () => {
  const m = store();
  m.recordStored("line-a", 1, undefined, 0, 995);
  m.recordStored("line-b", 1, undefined, 0, 995);
  m.recordDuplicate("line-b", 996);
  m.recordRejected(996);
  const a = m.snapshot(30, 1, "line-a", 1000).summary;
  assert.deepEqual([a.stored, a.duplicates, a.rejected], [1, 0, 0]);
  assert.equal(m.snapshot(30, 1, null, 1000).summary.received, 4);
});

test("summary p50/p95 are computed over all latencies, not averaged per bucket", () => {
  const m = store();
  for (let i = 0; i < 100; i++) m.recordStored("line-a", i + 1, undefined, 0, 900 + i * 0.5);
  const s = m.snapshot(120, 10, null, 1000).summary;
  assert.equal(s.p50, 50);
  assert.equal(s.p95, 95);
});

test("empty buckets have null latency and zero counts", () => {
  const s = store().snapshot(10, 1, null, 1000);
  assert.equal(s.series.length, 10);
  assert.ok(s.series.every((r) => r.received === 0 && r.p95 === null));
  assert.equal(s.summary.per_second, 0);
});

test("tag_read quantities are summed per line and direction", () => {
  const m = store();
  m.recordStored("line-a", 1, "in", 5, 998);
  m.recordStored("line-a", 1, "out", 2, 998);
  m.recordStored("line-b", 1, "in", 1, 999);
  const s = m.snapshot(5, 1, null, 1000);
  assert.deepEqual([s.summary.in, s.summary.out], [6, 2]);
  const a = s.series.find((r) => r.lines["line-a"])!;
  assert.deepEqual(a.lines["line-a"], { in: 5, out: 2 });
});

test("buckets older than the retention window are pruned", () => {
  let now = 1000;
  const m = new MetricsStore(60, () => now);
  m.recordStored("line-a", 1);
  now = 1200;
  m.recordStored("line-a", 1);
  assert.equal(m.bucketCount, 1);
});

test("per-second rate divides by the elapsed span, not the whole window", () => {
  const m = store();
  for (let t = 991; t <= 1000; t++) m.recordStored("line-a", 1, undefined, 0, t);
  assert.equal(m.snapshot(300, 1, null, 1000).summary.per_second, 1);
});

test("recentRate averages only the most recent seconds of a snapshot", () => {
  const m = store();
  for (let t = 900; t <= 1000; t++) m.recordStored("line-a", 1, undefined, 0, t);
  for (let t = 996; t <= 1000; t++) m.recordStored("line-a", 1, undefined, 0, t); // burst in the last 5 s
  const snap = m.snapshot(300, 1, null, 1000);
  assert.equal(recentRate(snap, (r) => r.received, 10), 1.5);
});

test("series latency percentiles use a 5 s moving window instead of single-second needles", () => {
  const m = store();
  m.recordStored("line-a", 900, undefined, 0, 100);
  for (let t = 101; t <= 110; t++) m.recordStored("line-a", 10, undefined, 0, t);
  const by = Object.fromEntries(m.snapshot(20, 1, null, 110).series.map((r) => [r.t, r.p95]));
  assert.equal(by[100], 900);
  assert.equal(by[104], 900);
  assert.equal(by[105], 10);
  assert.equal(by[99], null);
});
