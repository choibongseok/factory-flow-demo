// Which data source the dashboard is showing, as a pure state machine (unit-tested).
//
//  waking       the real server is being contacted (a free-tier host may need up to ~1 minute)
//  live         connected to the real server
//  reconnecting live connection dropped, retrying
//  timeout      no answer within the wake timeout; the user decides: retry, or view the browser simulation
//  sim          browser simulation (only when the user chose it, or when no backend is configured)

export type Phase = "waking" | "live" | "reconnecting" | "timeout" | "sim";
export type Stage = "wait_server" | "starting" | "ready" | "degraded";
export type ServerState = "unreachable" | "starting" | "ready" | "degraded";
export interface SourceState { phase: Phase; stage: Stage }

export type SourceEvent =
  | { type: "status"; state: ServerState }
  | { type: "data" }
  | { type: "ws_closed" }
  | { type: "wake_timeout" }
  | { type: "retry" }
  | { type: "choose_sim" };

export function initialState(hasBackend: boolean): SourceState {
  return hasBackend ? { phase: "waking", stage: "wait_server" } : { phase: "sim", stage: "wait_server" };
}

export function reduce(s: SourceState, e: SourceEvent): SourceState {
  switch (e.type) {
    case "status":
      return s.phase === "waking" ? { phase: "waking", stage: e.state === "unreachable" ? "wait_server" : e.state } : s;
    case "data":
      return s.phase === "waking" || s.phase === "reconnecting" ? { phase: "live", stage: "wait_server" } : s;
    case "ws_closed":
      return s.phase === "live" ? { phase: "reconnecting", stage: "wait_server" } : s.phase === "waking" ? { phase: "waking", stage: "wait_server" } : s;
    case "wake_timeout":
      return s.phase === "waking" ? { phase: "timeout", stage: "wait_server" } : s;
    case "retry":
      return s.phase === "timeout" || s.phase === "sim" ? { phase: "waking", stage: "wait_server" } : s;
    case "choose_sim":
      return s.phase === "timeout" || s.phase === "waking" ? { phase: "sim", stage: "wait_server" } : s;
  }
}

export const STAGE_LABEL: Record<Stage, string> = {
  wait_server: "서버 응답 대기",
  starting: "서버 켜짐 · DB·MQTT 연결 중",
  ready: "데이터 수신 시작",
  degraded: "서버 이상",
};
export const STAGES: Stage[] = ["wait_server", "starting", "ready"];

export interface StatusInfo {
  state: "starting" | "ready" | "degraded";
  version: string;
  uptime_s: number;
  checks: {
    db: "ok" | "pending" | "error";
    mqtt: "ok" | "pending" | "error";
    simulator: "running" | "pending" | "stopped";
    ingest: { last_event_age_s: number | null; events_per_s: number };
  };
}

/** Checks that are not healthy, for the "what is failing" list. */
export function failingChecks(s: StatusInfo): string[] {
  const out: string[] = [];
  if (s.checks.db !== "ok") out.push(`DB: ${s.checks.db}`);
  if (s.checks.mqtt !== "ok") out.push(`MQTT: ${s.checks.mqtt}`);
  if (s.checks.simulator !== "running") out.push(`시뮬레이터: ${s.checks.simulator}`);
  return out;
}

export type BadgeTone = "ok" | "warn" | "bad" | "sim";
export interface SourceBadge { key: "waking" | "live" | "reconnecting" | "degraded" | "sim"; label: string; tone: BadgeTone }

/** Data-source badge: green "실시간 서버" only once the server is connected and healthy. */
export function sourceBadge(phase: Phase, serverState: StatusInfo["state"] | null = null): SourceBadge {
  switch (phase) {
    case "sim": return { key: "sim", label: "브라우저 시뮬레이션", tone: "sim" };
    case "waking": return { key: "waking", label: "서버 켜는 중", tone: "warn" };
    case "timeout": return { key: "waking", label: "서버 응답 없음", tone: "warn" };
    case "reconnecting": return { key: "reconnecting", label: "서버 재연결 중", tone: "bad" };
    case "live":
      return serverState === "degraded" ? { key: "degraded", label: "서버 이상", tone: "bad" } : { key: "live", label: "실시간 서버", tone: "ok" };
  }
}
