"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Charts } from "@/components/Charts";
import { EventTail } from "@/components/EventTail";
import { HexMap } from "@/components/HexMap";
import { InventoryPanel } from "@/components/InventoryPanel";
import { KpiRow } from "@/components/Kpis";
import { Topology } from "@/components/Topology";
import { TopBar } from "@/components/TopBar";
import { WakePanel } from "@/components/WakePanel";
import { apiBase, DEMO_MODE } from "@/lib/config";
import { Feed, useFeed } from "@/lib/useFeed";

export default function Page() {
  const [line, setLine] = useState<string | null>(null);
  const [range, setRange] = useState(300);
  const [paused, setPaused] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const hasBackend = apiBase() !== "";

  const feed = useFeed({ line, rangeSeconds: range });
  const frozen = useRef<{ feed: Feed; now: number } | null>(null);
  if (!paused) frozen.current = null;
  if (paused && !frozen.current) frozen.current = { feed, now };
  const view = paused && frozen.current ? frozen.current.feed : feed;
  const viewNow = paused && frozen.current ? frozen.current.now : now;

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ff-theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
      else if (window.matchMedia("(prefers-color-scheme: light)").matches) setTheme("light");
    } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("ff-theme", theme); } catch { /* ignore */ }
  }, [theme]);

  const changeLine = useCallback((l: string | null) => { setLine(l); setPaused(false); setSelected(null); }, []);
  const changeRange = useCallback((s: number) => { setRange(s); setPaused(false); }, []);

  const lines = [...new Set(["line-a", "line-b", ...feed.devices.map((d) => d.line)])].sort();
  const phase = feed.source.phase;
  const showWake = phase === "waking" || phase === "timeout";

  return (
    <main>
      {DEMO_MODE && (
        <div className="banner" data-testid="mode-banner">
          {hasBackend
            ? <>GitHub Pages 프론트 + 무료 티어 서버 — 전체 스택은 <code>docker compose up</code></>
            : <>정적 데모 모드 — 전체 스택은 <code>docker compose up</code></>}
          <a href="https://github.com/choibongseok/factory-flow-demo">GitHub</a>
        </div>
      )}
      <TopBar
        lines={lines} line={line} onLine={changeLine} range={range} onRange={changeRange}
        paused={paused} onPause={() => setPaused((p) => !p)}
        lastUpdate={view.lastUpdate} source={feed.source} status={feed.serverStatus}
        theme={theme} onTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        hasBackend={hasBackend} onReconnect={feed.retry}
      />
      <div className="frame">
        {showWake && <WakePanel source={feed.source} startedAt={feed.wakeStartedAt} status={feed.serverStatus} onRetry={feed.retry} onSim={feed.chooseSim} />}
        <div className={showWake ? "dash dim" : "dash"} aria-hidden={showWake} inert={showWake}>
          <KpiRow metrics={view.metrics} devices={view.devices} now={viewNow} />
          <Charts metrics={view.metrics} line={line} theme={theme} />
          <div className="two-col">
            <HexMap devices={view.devices} now={viewNow} selected={selected} onSelect={setSelected} />
            <Topology metrics={view.metrics} source={feed.source} status={feed.serverStatus} />
          </div>
          <EventTail events={view.events} deviceFilter={selected} onDeviceFilter={setSelected} paused={paused} />
          <InventoryPanel inventory={view.inventory} />
        </div>
      </div>
    </main>
  );
}
