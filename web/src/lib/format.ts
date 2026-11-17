import { Device, FlowEvent, isOnline } from "./types";

export const STATE_LABEL: Record<string, string> = {
  moving: "이동", idle: "대기", charging: "충전", error: "오류", active: "가동", unknown: "미확인",
};
export const TYPE_LABEL: Record<string, string> = { status: "STATUS", tag_read: "RFID", scan: "SCAN", position: "POS" };
export const KIND_GLYPH: Record<string, string> = { amr: "A", rfid_gate: "G", qr_scanner: "Q", unknown: "?" };
export const KIND_LABEL: Record<string, string> = { amr: "AMR", rfid_gate: "RFID 게이트", qr_scanner: "QR 스캐너", unknown: "기타" };

export function stateOf(d: Device, now: number): string {
  return isOnline(d, now) ? d.state : "offline";
}

export function eventSummary(e: FlowEvent): string {
  const p = e.payload as Record<string, string | number>;
  switch (e.type) {
    case "tag_read": return `dir=${p.direction} sku=${p.sku} qty=${p.qty ?? 1} tag=${p.tag_id}`;
    case "scan": return `code=${p.code} result=${p.result}`;
    case "status": return `state=${p.state}${p.battery != null ? ` battery=${p.battery}%` : ""}`;
    default: return `x=${Number(p.x).toFixed(1)} y=${Number(p.y).toFixed(1)}`;
  }
}

export function eventTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB") + "." + String(d.getMilliseconds()).padStart(3, "0");
}

export const fmtNum = (v: number | null | undefined, digits = 0) =>
  v == null || Number.isNaN(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
