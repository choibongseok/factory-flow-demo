import { useEffect, useState } from "react";
import { failingChecks, STAGE_LABEL, STAGES, SourceState, StatusInfo } from "@/lib/sourceMachine";

const mark = (v: string) => (v === "ok" || v === "running" ? "✓" : v === "error" || v === "stopped" ? "✕" : "…");

export function WakePanel({ source, startedAt, status, onRetry, onSim }: {
  source: SourceState; startedAt: number; status: StatusInfo | null; onRetry: () => void; onSim: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id); }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));

  if (source.phase === "timeout") {
    return (
      <div className="wake" role="alertdialog" aria-labelledby="wake-title" data-testid="wake-panel" data-phase="timeout">
        <h2 id="wake-title">서버가 아직 켜지지 않았습니다</h2>
        <p>무료 티어 서버가 {elapsed}초 안에 응답하지 않았습니다. 다시 시도하거나, 브라우저 시뮬레이션으로 화면을 볼 수 있습니다.</p>
        <div className="wake-actions">
          <button className="btn primary" onClick={onRetry}>다시 시도</button>
          <button className="btn" onClick={onSim}>브라우저 시뮬레이션으로 보기</button>
        </div>
      </div>
    );
  }
  const degraded = source.stage === "degraded";
  const idx = STAGES.indexOf(source.stage);
  return (
    <div className="wake" role="status" aria-live="polite" data-testid="wake-panel" data-phase="waking" data-stage={source.stage}>
      <h2>{degraded ? "서버에 문제가 있습니다" : "무료 티어 서버 켜는 중…"}</h2>
      <p>Render 무료 플랜은 15분 동안 접속이 없으면 잠듭니다. 보통 1분 안에 켜집니다.</p>
      <p className="wake-timer">경과 <b data-testid="wake-elapsed">{elapsed}</b>초</p>
      <ol className="steps">
        {STAGES.map((st, i) => (
          <li key={st} aria-current={!degraded && i === idx ? "step" : undefined} className={!degraded && i < idx ? "done" : !degraded && i === idx ? "cur" : ""}>
            <span>{!degraded && i < idx ? "✓" : i + 1}</span>{STAGE_LABEL[st]}
          </li>
        ))}
      </ol>
      {status && (source.stage === "starting" || degraded) && (
        <ul className="checks" data-testid="wake-checks">
          <li>{mark(status.checks.db)} DB <em>{status.checks.db}</em></li>
          <li>{mark(status.checks.mqtt)} MQTT <em>{status.checks.mqtt}</em></li>
          <li>{mark(status.checks.simulator)} 시뮬레이터 <em>{status.checks.simulator}</em></li>
        </ul>
      )}
      {degraded && status && <p className="bad-text">실패한 항목: {failingChecks(status).join(", ") || "—"}</p>}
      <div className="wake-actions">
        {degraded && <button className="btn primary" onClick={onRetry}>다시 시도</button>}
      </div>
    </div>
  );
}
