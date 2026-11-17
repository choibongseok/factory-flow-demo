import { fmtNum } from "@/lib/format";
import { MetricsSnapshot, recentRate } from "@/lib/metrics";
import { SourceState, StatusInfo } from "@/lib/sourceMachine";
import { NodeId, NodeState, topologyStates } from "@/lib/topology";

type Node = { id: NodeId; x: number; y: number; title: string; sub: string };
const STATE_TEXT: Record<NodeState, string> = { ok: "● 정상", wait: "○ 대기", bad: "✕ 이상" };

export function Topology({ metrics, source, status }: {
  metrics: MetricsSnapshot | null; source: SourceState; status: StatusInfo | null;
}) {
  const sim = source.phase === "sim";
  const rx = metrics ? recentRate(metrics, (r) => r.received) : 0;
  const stored = metrics ? recentRate(metrics, (r) => r.stored) : 0;
  const states = topologyStates(source.phase, status);
  const sub = (real: string) => (sim ? "브라우저 시뮬레이션" : real);
  const nodes: Node[] = [
    { id: "sim", x: 10, y: 14, title: "시뮬레이터", sub: sub("Python") },
    { id: "mq", x: 205, y: 14, title: "MQTT 브로커", sub: sub("Mosquitto") },
    { id: "api", x: 400, y: 14, title: "수집 API", sub: sub("FastAPI") },
    { id: "pg", x: 595, y: 14, title: "PostgreSQL", sub: sub("events · devices") },
    { id: "ws", x: 400, y: 98, title: "WebSocket", sub: sub("실시간 푸시") },
    { id: "ui", x: 595, y: 98, title: "관제 화면", sub: "Next.js" },
  ];
  const w = 134, h = 52;
  const edge = (a: string, b: string, label: string, vertical = false) => {
    const A = nodes.find((n) => n.id === a)!, B = nodes.find((n) => n.id === b)!;
    const x1 = vertical ? A.x + w / 2 : A.x + w, y1 = vertical ? A.y + h : A.y + h / 2;
    const x2 = vertical ? B.x + w / 2 : B.x, y2 = vertical ? B.y : B.y + h / 2;
    return (
      <g key={a + b}>
        <line x1={x1} y1={y1} x2={x2 - (vertical ? 0 : 4)} y2={y2 - (vertical ? 4 : 0)} className="edge" markerEnd="url(#arrow)" />
        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - (vertical ? -4 : 6)} textAnchor={vertical ? "start" : "middle"} dx={vertical ? 8 : 0} className="edge-label">{label}</text>
      </g>
    );
  };
  return (
    <section className="panel" aria-label="서비스 토폴로지">
      <h3>서비스 토폴로지 <span className="muted">· 간선 = 최근 10초 처리량</span></h3>
      <div className="topo-wrap"><svg viewBox="0 0 760 160" className="topo" role="img" aria-label="시뮬레이터에서 브로커, API, DB와 관제 화면으로 이어지는 흐름">
        <defs>
          <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8z" className="arrow" /></marker>
        </defs>
        {edge("sim", "mq", `${fmtNum(rx, 1)}/s`)}
        {edge("mq", "api", `${fmtNum(rx, 1)}/s`)}
        {edge("api", "pg", `${fmtNum(stored, 1)}/s`)}
        {edge("api", "ws", `${fmtNum(stored, 1)}/s`, true)}
        {edge("ws", "ui", `${fmtNum(stored, 1)}/s`)}
        {nodes.map((n) => (
          <g key={n.id} transform={`translate(${n.x} ${n.y})`} data-testid="topo-node" data-node={n.id} data-state={states[n.id]}>
            <rect width={w} height={h} rx={8} className="node" />
            <text x={12} y={22} className="node-title">{n.title}</text>
            <text x={12} y={40} className="node-sub">{n.sub}</text>
            <text x={w - 10} y={22} textAnchor="end" className={`node-state ${states[n.id]}`}>{STATE_TEXT[states[n.id]]}</text>
          </g>
        ))}
      </svg></div>
    </section>
  );
}
