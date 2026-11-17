import { useState } from "react";
import { FlowEvent } from "@/lib/types";

const TYPES = ["status", "tag_read", "scan", "position"] as const;
const LABEL: Record<string, string> = { status: "상태", tag_read: "RFID", scan: "QR", position: "위치" };

function summary(e: FlowEvent): string {
  const p = e.payload as Record<string, string | number>;
  switch (e.type) {
    case "tag_read": return `${p.direction === "in" ? "입고" : "출고"} ${p.sku} x${p.qty ?? 1} (${p.tag_id})`;
    case "scan": return `${p.code} ${p.result === "ok" ? "OK" : "FAIL"}`;
    case "status": return `${p.state}${p.battery != null ? ` · 배터리 ${p.battery}%` : ""}`;
    default: return `(${Number(p.x).toFixed(1)}, ${Number(p.y).toFixed(1)})`;
  }
}

export function EventStream({ events }: { events: FlowEvent[] }) {
  const [shown, setShown] = useState<Set<string>>(new Set(["status", "tag_read", "scan"]));
  const toggle = (t: string) => setShown((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; });
  const rows = events.filter((e) => shown.has(e.type)).slice(0, 40);
  return (
    <section className="panel stream">
      <h3>실시간 이벤트 <span className="muted">· 최근 {rows.length}건</span></h3>
      <div className="chips">
        {TYPES.map((t) => (
          <button key={t} className={shown.has(t) ? "chip on" : "chip"} onClick={() => toggle(t)}>{LABEL[t]}</button>
        ))}
      </div>
      <ul>
        {rows.map((e) => (
          <li key={e.event_id} className={`t-${e.type} ${e.type === "scan" && e.payload.result === "fail" ? "fail" : ""}`}>
            <time>{new Date(e.ts).toLocaleTimeString("en-GB")}</time>
            <b>{LABEL[e.type]}</b>
            <span className="dev">{e.line}/{e.device}</span>
            <span>{summary(e)}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="muted">이벤트 대기 중…</li>}
      </ul>
    </section>
  );
}
