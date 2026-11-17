import { useMemo, useRef, useState } from "react";
import { eventSummary, eventTime, TYPE_LABEL } from "@/lib/format";
import { FlowEvent } from "@/lib/types";

function countBy<T>(xs: T[], key: (x: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function EventTail({ events, deviceFilter, onDeviceFilter, paused }: {
  events: FlowEvent[]; deviceFilter: string | null; onDeviceFilter: (id: string | null) => void; paused: boolean;
}) {
  const [type, setType] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [localPause, setLocalPause] = useState(false);
  const frozen = useRef<FlowEvent[]>([]);
  if (!localPause) frozen.current = events;
  const base = localPause ? frozen.current : events;
  const newCount = localPause ? Math.max(0, events.filter((e) => e.type !== "position").length - base.filter((e) => e.type !== "position").length) : 0;

  const visible = useMemo(() => base.filter((e) => {
    if (deviceFilter && `${e.line}/${e.device}` !== deviceFilter) return false;
    if (line && e.line !== line) return false;
    if (type ? e.type !== type : e.type === "position") return false; // position is hidden unless picked
    if (q && !`${e.line}/${e.device} ${e.type} ${eventSummary(e)}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [base, deviceFilter, line, type, q]);

  const typeCounts = countBy(base, (e) => e.type);
  const lineCounts = countBy(base, (e) => e.line);
  const devCounts = countBy(base.filter((e) => e.type !== "position"), (e) => `${e.line}/${e.device}`);

  const Facet = ({ title, items, value, set }: { title: string; items: [string, number][]; value: string | null; set: (v: string | null) => void }) => (
    <fieldset className="facet">
      <legend>{title}</legend>
      {items.map(([k, n]) => (
        <button key={k} aria-pressed={value === k} onClick={() => set(value === k ? null : k)}>
          <span>{TYPE_LABEL[k] ?? k}</span><em>{n}</em>
        </button>
      ))}
    </fieldset>
  );

  return (
    <section className="panel tail" aria-label="이벤트 테일">
      <header className="panel-head">
        <h3>실시간 이벤트 <span className="muted">· {visible.length}건 표시 · 위치(POS)는 기본 숨김</span></h3>
        <div className="tail-tools">
          <input type="search" placeholder="검색 (장비, 값…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="이벤트 검색" />
          <button className="btn" aria-pressed={localPause} onClick={() => setLocalPause((p) => !p)}>
            {localPause ? `▶ 재개${newCount ? ` (+${newCount})` : ""}` : "⏸ 테일 정지"}
          </button>
        </div>
      </header>
      <div className="tail-body">
        <aside className="facets">
          <Facet title="종류" items={typeCounts} value={type} set={setType} />
          <Facet title="라인" items={lineCounts} value={line} set={setLine} />
          <Facet title="장비" items={devCounts} value={deviceFilter} set={onDeviceFilter} />
        </aside>
        <ol className="loglines" data-testid="tail" data-paused={paused || localPause}>
          {visible.slice(0, 200).map((e) => (
            <li key={e.event_id} data-testid="tail-row" data-device={`${e.line}/${e.device}`} className={`t-${e.type} ${e.type === "scan" && e.payload.result === "fail" ? "fail" : ""}`}>
              <time>{eventTime(e.ts)}</time>
              <b>{TYPE_LABEL[e.type]}</b>
              <span className="dev">{e.line}/{e.device}</span>
              <span className="msg">{eventSummary(e)}{e.type === "scan" && e.payload.result === "fail" ? " ✕" : ""}</span>
            </li>
          ))}
          {visible.length === 0 && <li className="muted empty">조건에 맞는 이벤트가 없습니다.</li>}
        </ol>
      </div>
    </section>
  );
}
