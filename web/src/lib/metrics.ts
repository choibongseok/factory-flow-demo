// Per-second metrics, aggregated on read. Mirrors api/app/metrics.py (same bucket and percentile rules),
// so the static demo and the live API return the same snapshot shape.

export interface SeriesRow {
  t: number;
  stored: number;
  duplicates: number;
  rejected: number;
  received: number;
  in: number;
  out: number;
  p50: number | null;
  p95: number | null;
  lines: Record<string, { in: number; out: number }>;
}

export interface MetricsSummary {
  received: number;
  stored: number;
  duplicates: number;
  rejected: number;
  dup_rate: number;
  per_second: number;
  p50: number | null;
  p95: number | null;
  in: number;
  out: number;
}

export interface MetricsSnapshot {
  now: number;
  window_seconds: number;
  step: number;
  line: string | null;
  series: SeriesRow[];
  summary: MetricsSummary;
}

export const LATENCY_WINDOW_SECONDS = 5; // series p50/p95 use a moving window this long

/** Nearest-rank percentile; null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
}

interface LineBucket { stored: number; duplicates: number; inQty: number; outQty: number; lat: number[] }
const newBucket = (): LineBucket => ({ stored: 0, duplicates: 0, inQty: 0, outQty: 0, lat: [] });

export class MetricsStore {
  private sec = new Map<number, Map<string, LineBucket>>();
  private rejected = new Map<number, number>();

  constructor(private retention = 3600, private clock: () => number = () => Date.now() / 1000) {}

  private now(at?: number) { return Math.floor(at ?? this.clock()); }

  private bucket(t: number, line: string): LineBucket {
    let m = this.sec.get(t);
    if (!m) this.sec.set(t, (m = new Map()));
    let b = m.get(line);
    if (!b) m.set(line, (b = newBucket()));
    return b;
  }

  private prune(now: number) {
    const cutoff = now - this.retention;
    for (const k of [...this.sec.keys()]) if (k < cutoff) this.sec.delete(k);
    for (const k of [...this.rejected.keys()]) if (k < cutoff) this.rejected.delete(k);
  }

  get bucketCount() { return this.sec.size; }

  recordStored(line: string, latencyMs: number, direction?: "in" | "out", qty = 0, at?: number) {
    const t = this.now(at);
    const b = this.bucket(t, line);
    b.stored++;
    b.lat.push(Math.max(0, latencyMs));
    if (direction === "in") b.inQty += qty;
    else if (direction === "out") b.outQty += qty;
    this.prune(t);
  }

  recordDuplicate(line: string, at?: number) { this.bucket(this.now(at), line).duplicates++; }

  recordRejected(at?: number) { const t = this.now(at); this.rejected.set(t, (this.rejected.get(t) ?? 0) + 1); }

  snapshot(seconds = 300, step = 1, line: string | null = null, now?: number): MetricsSnapshot {
    const end = this.now(now);
    const start = end - seconds + 1;
    const series: SeriesRow[] = [];
    const allLat: number[] = [];
    const tot = { stored: 0, duplicates: 0, rejected: 0, in: 0, out: 0 };
    let firstDataT: number | null = null;
    for (let k = Math.floor(start / step) * step; k <= Math.floor(end / step) * step; k += step) {
      const row = { stored: 0, duplicates: 0, rejected: 0, in: 0, out: 0 };
      const lat: number[] = [];
      const lines: SeriesRow["lines"] = {};
      for (let t = Math.max(k, start); t <= Math.min(k + step - 1, end); t++) {
        for (const [ln, b] of this.sec.get(t) ?? []) {
          if (line && ln !== line) continue;
          row.stored += b.stored; row.duplicates += b.duplicates; row.in += b.inQty; row.out += b.outQty;
          lat.push(...b.lat);
          const f = (lines[ln] ??= { in: 0, out: 0 });
          f.in += b.inQty; f.out += b.outQty;
        }
        if (!line) row.rejected += this.rejected.get(t) ?? 0;
        if (firstDataT === null && (row.stored || row.duplicates || row.rejected)) firstDataT = t;
      }
      const hi = Math.min(k + step - 1, end);
      const win: number[] = [];
      for (let t = hi - Math.max(LATENCY_WINDOW_SECONDS, step) + 1; t <= hi; t++) {
        for (const [ln, b] of this.sec.get(t) ?? []) if (!line || ln === line) win.push(...b.lat);
      }
      series.push({ t: k, ...row, received: row.stored + row.duplicates + row.rejected, p50: percentile(win, 50), p95: percentile(win, 95), lines });
      for (const key of Object.keys(tot) as (keyof typeof tot)[]) tot[key] += row[key];
      allLat.push(...lat);
    }
    const received = tot.stored + tot.duplicates + tot.rejected;
    const span = firstDataT === null ? seconds : Math.min(seconds, end - firstDataT + 1);
    return {
      now: end, window_seconds: seconds, step, line, series,
      summary: {
        received, stored: tot.stored, duplicates: tot.duplicates, rejected: tot.rejected,
        dup_rate: received ? tot.duplicates / received : 0,
        per_second: span ? received / span : 0,
        p50: percentile(allLat, 50), p95: percentile(allLat, 95), in: tot.in, out: tot.out,
      },
    };
  }
}

/** Events per second over the most recent `secs` seconds of a snapshot. */
export function recentRate(snap: MetricsSnapshot, pick: (r: SeriesRow) => number, secs = 10): number {
  const rows = snap.series.filter((r) => r.t + snap.step > snap.now - secs + 1);
  const total = rows.reduce((a, r) => a + pick(r), 0);
  const span = Math.min(secs, snap.window_seconds);
  return span ? total / span : 0;
}
