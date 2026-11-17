export type DeviceKind = "amr" | "rfid_gate" | "qr_scanner" | "unknown";

export interface Device {
  id: string;
  line: string;
  device: string;
  kind: DeviceKind;
  state: string;
  x: number | null;
  y: number | null;
  battery: number | null;
  last_seen: string;
}

export interface FlowEvent {
  event_id: string;
  line: string;
  device: string;
  type: "position" | "status" | "tag_read" | "scan";
  ts: string;
  payload: Record<string, unknown>;
}

export interface InventoryItem {
  sku: string;
  inbound: number;
  outbound: number;
  on_hand: number;
  last_movement: string;
}

export interface Inventory {
  items: InventoryItem[];
  totals: { inbound: number; outbound: number; on_hand: number };
}

export const EMPTY_INVENTORY: Inventory = { items: [], totals: { inbound: 0, outbound: 0, on_hand: 0 } };


export const MAP_W = 100;
export const MAP_H = 60;
export const ONLINE_TTL_MS = 20_000;

export function isOnline(d: Device, now = Date.now()): boolean {
  return now - Date.parse(d.last_seen) <= ONLINE_TTL_MS;
}
