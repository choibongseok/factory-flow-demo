import { useEffect, useRef, useState } from "react";
import { fmtNum } from "@/lib/format";
import { MetricsSnapshot, recentRate } from "@/lib/metrics";
import { Device, isOnline } from "@/lib/types";
import { Sparkline } from "./Sparkline";

function useHistory(value: number, size = 90): number[] {
  const [h, setH] = useState<number[]>([]);
  const ref = useRef(value);
  ref.current = value;
  useEffect(() => {
    const id = setInterval(() => setH((p) => [...p, ref.current].slice(-size)), 1000);
    return () => clearInterval(id);
  }, [size]);
  return h;
}

interface Tile { id: string; label: string; value: string; unit: string; spark: (number | null)[]; color: string; status?: "bad"; hint?: string }

export function KpiRow({ metrics, devices, now }: { metrics: MetricsSnapshot | null; devices: Device[]; now: number }) {
  const online = devices.filter((d) => isOnline(d, now)).length;
  const errors = devices.filter((d) => isOnline(d, now) && d.state === "error").length;
  const onlineHist = useHistory(online);
  const errHist = useHistory(errors);

  const step = metrics?.step ?? 1;
  const rows = metrics?.series ?? [];
  const lastOf = (pick: (r: (typeof rows)[number]) => number | null) => { for (let i = rows.length - 1; i >= 0; i--) { const v = pick(rows[i]); if (v != null) return v; } return null; };
  const p95Now = lastOf((r) => r.p95), p50Now = lastOf((r) => r.p50); // same 5 s moving window as the chart
  const rate = metrics ? recentRate(metrics, (r) => r.received) : 0;
  const tiles: Tile[] = [
    { id: "rate", label: "초당 메시지", value: fmtNum(rate, 1), unit: "msg/s", color: "var(--c-cyan)", spark: rows.map((r) => r.received / step), hint: "최근 10초 수신" },
    { id: "p95", label: "저장 지연 p95", value: fmtNum(p95Now, 0), unit: "ms", color: "var(--c-amber)", spark: rows.map((r) => r.p95), hint: `p50 ${fmtNum(p50Now, 0)} ms · 최근 5초 창` },
    { id: "dup", label: "중복 차단률", value: fmtNum((metrics?.summary.dup_rate ?? 0) * 100, 1), unit: "%", color: "var(--c-purple)", spark: rows.map((r) => (r.received ? (r.duplicates / r.received) * 100 : 0)), hint: `${fmtNum(metrics?.summary.duplicates)}건 차단` },
    { id: "online", label: "온라인 장비", value: `${online}/${devices.length}`, unit: "대", color: "var(--c-green)", spark: onlineHist },
    { id: "error", label: "오류 장비", value: String(errors), unit: "대", color: errors ? "var(--c-red)" : "var(--c-green)", spark: errHist, status: errors ? "bad" : undefined },
  ];
  return (
    <section className="kpis" aria-label="핵심 지표">
      {tiles.map((t) => (
        <article key={t.id} className={`kpi ${t.status ?? ""}`} data-testid="kpi-tile" data-kpi={t.id}>
          <header>{t.label}{t.status === "bad" && <b className="warn" aria-label="주의"> ▲</b>}</header>
          <div className="kpi-value"><span data-testid={`kpi-${t.id}-value`}>{t.value}</span><small>{t.unit}</small></div>
          <Sparkline values={t.spark} color={t.color} />
          <footer>{t.hint ?? " "}</footer>
        </article>
      ))}
    </section>
  );
}
