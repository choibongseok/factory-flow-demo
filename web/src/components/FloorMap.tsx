import { Device, MAP_H, MAP_W, isOnline } from "@/lib/types";

const COLORS: Record<string, string> = {
  moving: "#3ddc97", idle: "#8ea0b8", charging: "#ffb454", error: "#ff5c6c", active: "#5ec8ff", unknown: "#5a6678",
};

function Marker({ d, now }: { d: Device; now: number }) {
  if (d.x == null || d.y == null) return null;
  const online = isOnline(d, now);
  const color = online ? COLORS[d.state] ?? COLORS.unknown : "#3b4556";
  const label = d.device;
  return (
    <g className="marker" style={{ transform: `translate(${d.x}px, ${d.y}px)`, opacity: online ? 1 : 0.5 }}>
      {d.kind === "amr" && <circle r={2.6} fill={color} stroke="#0b1220" strokeWidth={0.5} />}
      {d.kind === "rfid_gate" && <rect x={-2.2} y={-4} width={4.4} height={8} rx={0.8} fill="none" stroke={color} strokeWidth={0.9} />}
      {d.kind === "qr_scanner" && <rect x={-2} y={-2} width={4} height={4} transform="rotate(45)" fill={color} />}
      <text y={d.kind === "rfid_gate" ? 7.4 : -4.2} textAnchor="middle" fontSize={2.6} fill="#c9d4e5">{label}</text>
    </g>
  );
}

export function FloorMap({ line, devices, now }: { line: string; devices: Device[]; now: number }) {
  const mine = devices.filter((d) => d.line === line);
  return (
    <section className="panel">
      <h3>{line} <span className="muted">· 장비 {mine.length}대 · 온라인 {mine.filter((d) => isOnline(d, now)).length}</span></h3>
      <svg viewBox={`-4 -4 ${MAP_W + 8} ${MAP_H + 8}`} className="map" role="img" aria-label={`${line} 장비 위치`}>
        <defs>
          <pattern id={`g-${line}`} width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0H0V10" fill="none" stroke="#1b2740" strokeWidth="0.3" />
          </pattern>
        </defs>
        <rect width={MAP_W} height={MAP_H} fill={`url(#g-${line})`} stroke="#2a3a5c" strokeWidth={0.5} />
        <rect x={2} y={2} width={8} height={8} fill="none" stroke="#ffb45466" strokeDasharray="1 1" strokeWidth={0.4} />
        <text x={3} y={13} fontSize={2.2} fill="#ffb454aa">충전소</text>
        {mine.map((d) => <Marker key={d.id} d={d} now={now} />)}
      </svg>
    </section>
  );
}

export function Legend() {
  return (
    <div className="legend">
      {Object.entries({ moving: "이동", idle: "대기", charging: "충전", error: "오류", active: "게이트/스캐너" }).map(([k, v]) => (
        <span key={k}><i style={{ background: COLORS[k] }} />{v}</span>
      ))}
    </div>
  );
}
