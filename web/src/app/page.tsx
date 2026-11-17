"use client";
import { useEffect, useState } from "react";
import { EventStream } from "@/components/EventStream";
import { FloorMap, Legend } from "@/components/FloorMap";
import { InventoryPanel } from "@/components/InventoryPanel";
import { DEMO_MODE, useFeed } from "@/lib/useFeed";
import { isOnline } from "@/lib/types";

const CONN_LABEL = { connecting: "연결 중…", live: "실시간 연결", offline: "연결 끊김 · 재시도 중", demo: "브라우저 시뮬레이터" } as const;

export default function Page() {
  const { conn, devices, events, inventory } = useFeed();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const lines = [...new Set(devices.map((d) => d.line))].sort();
  const amrs = devices.filter((d) => d.kind === "amr");
  const errors = devices.filter((d) => d.state === "error" && isOnline(d, now)).length;

  return (
    <main>
      {DEMO_MODE && (
        <div className="banner">
          정적 데모 모드 — 전체 스택은 <code>docker compose up</code>
          <a href="https://github.com/choibongseok/factory-flow-demo">GitHub</a>
        </div>
      )}
      <header>
        <h1>Factory Flow <span className="muted">물류 관제</span></h1>
        <div className="status">
          <span className={`dot ${conn}`} />{CONN_LABEL[conn]}
          <span className="pill">AMR {amrs.filter((d) => isOnline(d, now)).length}/{amrs.length}</span>
          <span className={errors ? "pill bad" : "pill"}>오류 {errors}</span>
        </div>
      </header>
      <div className="grid">
        <div className="maps">
          {lines.map((l) => <FloorMap key={l} line={l} devices={devices} now={now} />)}
          {lines.length === 0 && <section className="panel muted">장비 데이터 대기 중…</section>}
          <Legend />
        </div>
        <EventStream events={events} />
        <InventoryPanel inventory={inventory} />
      </div>
    </main>
  );
}
