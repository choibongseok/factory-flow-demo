import type { Phase, StatusInfo } from "./sourceMachine.ts";

export type NodeId = "sim" | "mq" | "api" | "pg" | "ws" | "ui";
export type NodeState = "ok" | "wait" | "bad";

const fromCheck = (v: string | undefined): NodeState => (v === "ok" || v === "running" ? "ok" : v === "error" || v === "stopped" ? "bad" : "wait");

/**
 * Status of each service node.
 * - browser simulation: everything is the in-browser engine, so all healthy
 * - waking: a server that is still starting is "wait", never "bad"; "bad" only for what /api/status reports as failed
 * - reconnecting: the connection was lost after being up, so the server-side nodes are "bad"
 * - live: follows /api/status checks
 */
export function topologyStates(phase: Phase, status: StatusInfo | null): Record<NodeId, NodeState> {
  if (phase === "sim") return { sim: "ok", mq: "ok", api: "ok", pg: "ok", ws: "ok", ui: "ok" };
  if (phase === "reconnecting") return { sim: "bad", mq: "bad", api: "bad", pg: "bad", ws: "bad", ui: "ok" };
  const c = status?.checks;
  if (phase === "live") {
    return { sim: fromCheck(c?.simulator ?? "running"), mq: fromCheck(c?.mqtt ?? "ok"), api: "ok", pg: fromCheck(c?.db ?? "ok"), ws: "ok", ui: "ok" };
  }
  // waking / timeout
  const bad = (v: string | undefined): NodeState => (v === "error" || v === "stopped" ? "bad" : "wait");
  return { sim: bad(c?.simulator), mq: bad(c?.mqtt), api: "wait", pg: bad(c?.db), ws: "wait", ui: "ok" };
}
