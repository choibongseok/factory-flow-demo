"use client";
import { useEffect, useRef, useState } from "react";
import { DemoEngine, DemoSimulator } from "./demoSim";
import { Connection, Device, EMPTY_INVENTORY, FlowEvent, Inventory } from "./types";

export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "static";
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WS = API.replace(/^http/, "ws") + "/ws";
const MAX_EVENTS = 80;

export interface Feed {
  conn: Connection;
  devices: Device[];
  events: FlowEvent[];
  inventory: Inventory;
}

export function useFeed(): Feed {
  const [conn, setConn] = useState<Connection>(DEMO_MODE ? "demo" : "connecting");
  const [devices, setDevices] = useState<Record<string, Device>>({});
  const [events, setEvents] = useState<FlowEvent[]>([]);
  const [inventory, setInventory] = useState<Inventory>(EMPTY_INVENTORY);
  const invTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (DEMO_MODE) return runDemo(setDevices, setEvents, setInventory);
    return runLive(setConn, setDevices, setEvents, setInventory, invTimer);
  }, []);

  return { conn, devices: Object.values(devices), events, inventory };
}

type Setters = [
  React.Dispatch<React.SetStateAction<Record<string, Device>>>,
  React.Dispatch<React.SetStateAction<FlowEvent[]>>,
  React.Dispatch<React.SetStateAction<Inventory>>,
];

function runDemo(...[setDevices, setEvents, setInventory]: Setters) {
  const sim = new DemoSimulator(42);
  const engine = new DemoEngine();
  // Pre-warm 90 s of history so the screen is populated on first paint.
  const t0 = Date.now() - 90_000;
  const history: FlowEvent[] = [];
  for (let i = 0; i < 90; i++) {
    for (const m of sim.tick(1, new Date(t0 + i * 1000))) {
      const r = engine.ingest(m);
      if (r && r.event.type !== "position") history.push(r.event);
    }
  }
  const snap = () => {
    setDevices(Object.fromEntries(engine.devices));
    setInventory(engine.inventory());
  };
  setEvents(history.slice(-MAX_EVENTS).reverse());
  snap();

  const id = setInterval(() => {
    const fresh: FlowEvent[] = [];
    for (const m of sim.tick(1, new Date())) {
      const r = engine.ingest(m);
      if (r) fresh.push(r.event);
    }
    setEvents((prev) => [...fresh.reverse(), ...prev].slice(0, MAX_EVENTS));
    snap();
  }, 1000);
  return () => clearInterval(id);
}

function runLive(
  setConn: (c: Connection) => void,
  setDevices: Setters[0],
  setEvents: Setters[1],
  setInventory: Setters[2],
  invTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
) {
  let ws: WebSocket | null = null;
  let stopped = false;
  let backoff = 1000;
  let retry: ReturnType<typeof setTimeout>;

  const get = async <T,>(path: string): Promise<T> => (await fetch(API + path)).json();
  const refreshInventory = () => {
    if (invTimer.current) return; // throttle: at most one fetch per second
    invTimer.current = setTimeout(async () => {
      invTimer.current = null;
      try { setInventory(await get<Inventory>("/api/inventory")); } catch { /* next event retries */ }
    }, 1000);
  };

  const connect = () => {
    setConn("connecting");
    ws = new WebSocket(WS);
    ws.onopen = async () => {
      backoff = 1000;
      setConn("live");
      try {
        const evs = await get<FlowEvent[]>("/api/events?limit=60&type=status");
        const all = await get<FlowEvent[]>("/api/events?limit=60");
        setEvents(all.length ? all : evs);
        setInventory(await get<Inventory>("/api/inventory"));
      } catch { /* snapshot over WS still fills the map */ }
    };
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.kind === "snapshot") {
        setDevices(Object.fromEntries((msg.devices as Device[]).map((d) => [d.id, d])));
      } else if (msg.kind === "event") {
        const d = msg.device as Device;
        setDevices((prev) => ({ ...prev, [d.id]: d }));
        setEvents((prev) => [msg.event as FlowEvent, ...prev].slice(0, MAX_EVENTS));
        if (msg.event.type === "tag_read") refreshInventory();
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      setConn("offline");
      retry = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 15000);
    };
    ws.onerror = () => ws?.close();
  };
  connect();
  return () => { stopped = true; clearTimeout(retry); ws?.close(); };
}
