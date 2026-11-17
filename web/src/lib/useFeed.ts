"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { apiBase, wakeTimeoutMs } from "./config";
import { DemoEngine, DemoSimulator } from "./demoSim";
import { MetricsSnapshot } from "./metrics";
import { initialState, reduce, SourceState, StatusInfo } from "./sourceMachine";
import { Device, EMPTY_INVENTORY, FlowEvent, Inventory } from "./types";

const MAX_EVENTS = 600;

export interface FeedParams { line: string | null; rangeSeconds: number }

export interface Feed {
  source: SourceState;
  wakeStartedAt: number;
  devices: Device[];
  events: FlowEvent[];
  inventory: Inventory;
  metrics: MetricsSnapshot | null;
  brokerConnected: boolean | null; // null = unknown (simulation)
  serverStatus: StatusInfo | null; // latest /api/status (wake panel and top bar)
  lastUpdate: number | null;
  retry: () => void;
  chooseSim: () => void;
}

const stepFor = (range: number) => Math.max(1, Math.round(range / 300));

export function useFeed(params: FeedParams): Feed {
  const base = apiBase();
  const [source, dispatch] = useReducer(reduce, base !== "", (b) => initialState(b));
  const [attempt, setAttempt] = useState(0);
  const [wakeStartedAt, setWakeStartedAt] = useState(() => Date.now());
  const [devices, setDevices] = useState<Record<string, Device>>({});
  const [events, setEvents] = useState<FlowEvent[]>([]);
  const [inventory, setInventory] = useState<Inventory>(EMPTY_INVENTORY);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [brokerConnected, setBroker] = useState<boolean | null>(null);
  const [serverStatus, setServerStatus] = useState<StatusInfo | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const engineRef = useRef<DemoEngine | null>(null);
  const refreshRef = useRef<() => void>(() => {});

  const retry = useCallback(() => {
    setWakeStartedAt(Date.now());
    setAttempt((a) => a + 1);
    dispatch({ type: "retry" });
  }, []);
  const chooseSim = useCallback(() => dispatch({ type: "choose_sim" }), []);

  // Recompute/refetch immediately when the filters change.
  useEffect(() => { refreshRef.current(); }, [params.line, params.rangeSeconds]);

  const phase = source.phase;
  const wantBackend = phase === "waking" || phase === "live" || phase === "reconnecting";

  // ---- real server ----
  useEffect(() => {
    if (!wantBackend) return;
    const ctl = new AbortController();
    let ws: WebSocket | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let gotData = false;

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const get = async <T,>(path: string, timeout = 5000): Promise<T> => {
      const t = AbortSignal.timeout(timeout);
      const res = await fetch(base + path, { signal: AbortSignal.any([ctl.signal, t]) });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    };

    const refresh = async () => {
      const { line, rangeSeconds } = paramsRef.current;
      const q = line ? `&line=${encodeURIComponent(line)}` : "";
      try {
        const [m, inv] = await Promise.all([
          get<MetricsSnapshot>(`/api/metrics?seconds=${rangeSeconds}&step=${stepFor(rangeSeconds)}${q}`),
          get<Inventory>(`/api/inventory${line ? `?line=${encodeURIComponent(line)}` : ""}`),
        ]);
        if (stopped) return;
        setMetrics(m); setInventory(inv); setLastUpdate(Date.now());
        if (!gotData) { gotData = true; dispatch({ type: "data" }); }
      } catch { /* the websocket close handler drives reconnection */ }
    };
    refreshRef.current = refresh;

    const connectWs = () => {
      ws = new WebSocket(base.replace(/^http/, "ws") + "/ws");
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.kind === "snapshot") {
          setDevices(Object.fromEntries((msg.devices as Device[]).map((d) => [d.id, d])));
        } else if (msg.kind === "event") {
          const d = msg.device as Device;
          setDevices((prev) => ({ ...prev, [d.id]: d }));
          setEvents((prev) => [msg.event as FlowEvent, ...prev].slice(0, MAX_EVENTS));
        }
      };
      ws.onopen = async () => {
        try { setEvents(await get<FlowEvent[]>("/api/events?limit=200")); } catch { /* live pushes fill it */ }
        await refresh();
        poll = setInterval(refresh, 1000);
      };
      ws.onclose = () => {
        if (stopped) return;
        if (poll) clearInterval(poll);
        gotData = false;
        dispatch({ type: "ws_closed" });
        void loop(); // probe again, then reopen
      };
      ws.onerror = () => ws?.close();
    };

    const loop = async () => {
      // First call of every session: /api/status answers at once, even while the host is still starting.
      // Poll every 2 s until the server reports "ready", then switch to the WebSocket.
      while (!stopped) {
        try {
          const st = await get<StatusInfo>("/api/status", 8000);
          if (stopped) return;
          setServerStatus(st); setBroker(st.checks.mqtt === "ok");
          dispatch({ type: "status", state: st.state });
          if (st.state === "ready") { connectWs(); return; }
        } catch {
          if (stopped) return;
          dispatch({ type: "status", state: "unreachable" });
        }
        await sleep(2000);
      }
    };

    setDevices({}); setEvents([]); setMetrics(null); setInventory(EMPTY_INVENTORY); setServerStatus(null);
    // After connecting, refresh the status summary every 30 s (top-bar dot).
    const statusTimer = setInterval(async () => {
      try { const st = await get<StatusInfo>("/api/status"); setServerStatus(st); setBroker(st.checks.mqtt === "ok"); } catch { /* ws close handles loss */ }
    }, 30_000);
    if (phase === "waking") {
      timeoutTimer = setTimeout(() => { if (!gotData) dispatch({ type: "wake_timeout" }); }, wakeTimeoutMs());
    }
    void loop();
    return () => {
      stopped = true; ctl.abort();
      if (poll) clearInterval(poll);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      clearInterval(statusTimer);
      ws?.close();
    };
    // phase "live"/"reconnecting" re-run only when the effect is re-keyed by attempt or wantBackend flips
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantBackend, attempt, base]);

  // ---- browser simulation (only when chosen, or when there is no backend) ----
  useEffect(() => {
    if (phase !== "sim") return;
    const sim = new DemoSimulator(42);
    const engine = new DemoEngine();
    engineRef.current = engine;
    const t0 = Date.now() - 300_000; // pre-warm 5 minutes so every range has data on first paint
    const history: FlowEvent[] = [];
    for (let i = 0; i < 300; i++) {
      const t = t0 + i * 1000;
      for (const m of sim.tick(1, new Date(t))) {
        const r = engine.ingest(m, t / 1000);
        if (r && r.event.type !== "position") history.push(r.event);
      }
    }
    setEvents(history.slice(-MAX_EVENTS).reverse());
    const snap = () => {
      const { line, rangeSeconds } = paramsRef.current;
      setDevices(Object.fromEntries(engine.devices));
      setInventory(engine.inventory(line));
      setMetrics(engine.metrics.snapshot(rangeSeconds, stepFor(rangeSeconds), line));
      setBroker(null);
      setLastUpdate(Date.now());
    };
    refreshRef.current = snap;
    snap();
    const id = setInterval(() => {
      const fresh: FlowEvent[] = [];
      const nowMs = Date.now();
      for (const m of sim.tick(1, new Date(nowMs))) {
        const r = engine.ingest(m, nowMs / 1000);
        if (r) fresh.push(r.event);
      }
      setEvents((prev) => [...fresh.reverse(), ...prev].slice(0, MAX_EVENTS));
      snap();
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  const lineDevices = Object.values(devices).filter((d) => !params.line || d.line === params.line);
  const lineEvents = params.line ? events.filter((e) => e.line === params.line) : events;
  return { source, wakeStartedAt, devices: lineDevices, events: lineEvents, inventory, metrics, brokerConnected, serverStatus, lastUpdate, retry, chooseSim };
}
