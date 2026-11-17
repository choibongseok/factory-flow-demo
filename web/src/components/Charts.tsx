import { fmtNum } from "@/lib/format";
import { MetricsSnapshot } from "@/lib/metrics";
import { ChartSeries, TimeChart } from "./TimeChart";

function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <ul className="legend-inline">
      {items.map((i) => <li key={i.label}><i style={{ background: i.color }} />{i.label}{i.value && <b>{i.value}</b>}</li>)}
    </ul>
  );
}

export function Charts({ metrics, line, theme }: { metrics: MetricsSnapshot | null; line: string | null; theme: string }) {
  const rows = metrics?.series ?? [];
  const step = metrics?.step ?? 1;
  const x = rows.map((r) => r.t);
  const last = rows[rows.length - 2] ?? rows[rows.length - 1]; // newest bucket may still be filling

  // 1) received = stored + duplicates (+ rejected), stacked, msg/s
  const stored = rows.map((r) => r.stored / step);
  const mid = rows.map((r) => (r.stored + r.duplicates) / step);
  const total = rows.map((r) => r.received / step);
  const s1: ChartSeries[] = [
    { label: "거부", color: "var(--c-red)", fill: true },
    { label: "중복", color: "var(--c-purple)", fill: true },
    { label: "저장", color: "var(--c-cyan)", fill: true },
  ];

  // 2) latency
  const s2: ChartSeries[] = [{ label: "p50", color: "var(--c-green)" }, { label: "p95", color: "var(--c-amber)" }];

  // 3) goods throughput per ~10 buckets: per line when "all", in/out when one line is selected
  const group = Math.max(1, Math.round(rows.length / 30));
  const gx: number[] = [], gIn: Record<string, number[]> = {}, gOut: number[] = [];
  const lineNames = [...new Set(rows.flatMap((r) => Object.keys(r.lines)))].sort();
  for (let i = 0; i < rows.length; i += group) {
    const chunk = rows.slice(i, i + group);
    gx.push(chunk[0].t);
    for (const ln of lineNames) (gIn[ln] ??= []).push(chunk.reduce((a, r) => a + (r.lines[ln]?.in ?? 0) + (r.lines[ln]?.out ?? 0), 0));
    gOut.push(chunk.reduce((a, r) => a + r.out, 0));
  }
  const gTotalIn = rows.length ? (() => { const out: number[] = []; for (let i = 0; i < rows.length; i += group) out.push(rows.slice(i, i + group).reduce((a, r) => a + r.in, 0)); return out; })() : [];
  const perLine = !line;
  const palette = ["var(--c-cyan)", "var(--c-purple)", "var(--c-amber)"];
  const s3: ChartSeries[] = perLine
    ? lineNames.map((ln, i) => ({ label: ln, color: palette[i % 3], bars: true })).reverse()
    : [{ label: "출고", color: "var(--c-amber)", bars: true }, { label: "입고", color: "var(--c-cyan)", bars: true }];
  let d3: number[][];
  if (perLine) {
    // stacked: draw cumulative values, largest first
    const names = lineNames;
    d3 = names.map((_, idx) => gx.map((_, j) => names.slice(0, idx + 1).reduce((a, n) => a + (gIn[n]?.[j] ?? 0), 0))).reverse();
  } else {
    d3 = [gTotalIn.map((v, j) => v + (gOut[j] ?? 0)), gTotalIn];
  }

  return (
    <section className="charts" aria-label="시계열 차트">
      <article className="panel">
        <h3>MQTT 수신 · 저장 · 중복 <span className="muted">msg/s</span></h3>
        <Legend items={[
          { label: "저장", color: "var(--c-cyan)", value: fmtNum(last ? last.stored / step : 0, 1) },
          { label: "중복", color: "var(--c-purple)", value: fmtNum(last ? last.duplicates / step : 0, 1) },
          { label: "거부", color: "var(--c-red)", value: fmtNum(last ? last.rejected / step : 0, 1) },
        ]} />
        <TimeChart x={x} series={s1} data={[total, mid, stored]} theme={theme} />
      </article>
      <article className="panel">
        <h3>처리 지연 <span className="muted">ms, 이벤트 시각 → 저장 · 5초 이동 창</span></h3>
        <Legend items={[
          { label: "p50", color: "var(--c-green)", value: fmtNum([...rows].reverse().find((r) => r.p50 != null)?.p50, 0) },
          { label: "p95", color: "var(--c-amber)", value: fmtNum([...rows].reverse().find((r) => r.p95 != null)?.p95, 0) },
        ]} />
        <TimeChart x={x} series={s2} data={[rows.map((r) => r.p50), rows.map((r) => r.p95)]} theme={theme} />
      </article>
      <article className="panel">
        <h3>입출고 처리량 <span className="muted">{perLine ? "라인별 수량" : `${line} 입고/출고 수량`}</span></h3>
        <Legend items={s3.slice().reverse().map((s) => ({ label: s.label, color: s.color.replace(/^var\((.*)\)$/, "var($1)") }))} />
        <TimeChart x={gx} series={s3} data={d3} theme={theme} />
      </article>
    </section>
  );
}
