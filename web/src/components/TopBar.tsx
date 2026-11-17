import { SourceState, sourceBadge, StatusInfo } from "@/lib/sourceMachine";

export const RANGES = [{ label: "5분", s: 300 }, { label: "15분", s: 900 }, { label: "1시간", s: 3600 }];

export function TopBar(p: {
  lines: string[]; line: string | null; onLine: (l: string | null) => void;
  range: number; onRange: (s: number) => void;
  paused: boolean; onPause: () => void;
  lastUpdate: number | null; source: SourceState; status: StatusInfo | null;
  theme: "dark" | "light"; onTheme: () => void; hasBackend: boolean; onReconnect: () => void;
}) {
  const sim = p.source.phase === "sim";
  const badge = sourceBadge(p.source.phase, p.status?.state ?? null);
  const st = p.status?.state;
  const dot = !p.status || sim ? null : st === "ready" ? { c: "ok", t: "서버 정상" } : st === "starting" ? { c: "warn", t: "서버 시작 중" } : { c: "bad", t: "서버 이상" };
  return (
    <>
      <div className="topbar" role="toolbar" aria-label="대시보드 제어">
        <h1>Factory Flow <span className="muted">물류 관제</span></h1>
        <div className="seg" role="radiogroup" aria-label="라인 필터" data-testid="line-filter">
          {[null, ...p.lines].map((l) => (
            <button key={l ?? "all"} role="radio" aria-checked={p.line === l} onClick={() => p.onLine(l)}>{l ?? "전체"}</button>
          ))}
        </div>
        <div className="seg" role="radiogroup" aria-label="시간 범위" data-testid="range-filter">
          {RANGES.map((r) => (
            <button key={r.s} role="radio" aria-checked={p.range === r.s} onClick={() => p.onRange(r.s)}>{r.label}</button>
          ))}
        </div>
        <button className="btn" data-testid="pause-btn" aria-pressed={p.paused} onClick={p.onPause}>
          {p.paused ? "▶ 재개" : "⏸ 일시정지"}
        </button>
        <span className="spacer" />
        <span className="badge" data-testid="source-badge" data-source={badge.key} title="데이터 출처">
          <i className={`dot ${badge.tone === "ok" ? "live" : badge.tone}`} />{badge.label}
        </span>
        {dot && p.source.phase === "live" && <span className={`badge status-${dot.c}`} data-testid="server-dot" title={`v${p.status?.version} · uptime ${p.status?.uptime_s}s`}>
          {dot.c === "ok" ? "●" : dot.c === "warn" ? "◐" : "✕"} {dot.t}
        </span>}
        <span className="muted updated" data-testid="last-updated">
          {p.paused ? "일시정지됨" : "마지막 갱신"} {p.lastUpdate ? new Date(p.lastUpdate).toLocaleTimeString("en-GB") : "—"}
        </span>
        <button className="btn" data-testid="theme-btn" onClick={p.onTheme} aria-label={p.theme === "dark" ? "라이트 테마로 전환" : "다크 테마로 전환"}>
          {p.theme === "dark" ? "☀ 라이트" : "☾ 다크"}
        </button>
      </div>
      {p.source.phase === "reconnecting" && (
        <div className="notice bad" role="status" data-testid="reconnect-banner">서버 연결 끊김, 다시 연결하는 중…</div>
      )}
      {sim && p.hasBackend && (
        <div className="notice" role="status" data-testid="sim-notice">
          브라우저 시뮬레이션을 표시 중입니다. 실제 서버 데이터가 아닙니다.
          <button className="btn" onClick={p.onReconnect}>서버에 다시 연결</button>
        </div>
      )}
    </>
  );
}
