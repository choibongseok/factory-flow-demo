import { useState } from "react";
import { KIND_GLYPH, KIND_LABEL, STATE_LABEL, stateOf } from "@/lib/format";
import { Device } from "@/lib/types";

type ColorBy = "state" | "battery";

function colorOf(d: Device, st: string, by: ColorBy): string {
  if (st === "offline") return "var(--c-off)";
  if (by === "battery") {
    if (d.kind !== "amr" || d.battery == null) return "var(--c-off)";
    return d.battery >= 60 ? "var(--c-green)" : d.battery >= 30 ? "var(--c-amber)" : "var(--c-red)";
  }
  return ({ moving: "var(--c-green)", idle: "var(--c-blue)", charging: "var(--c-amber)", error: "var(--c-red)", active: "var(--c-cyan)" } as Record<string, string>)[st] ?? "var(--c-off)";
}

export function HexMap({ devices, now, selected, onSelect }: {
  devices: Device[]; now: number; selected: string | null; onSelect: (id: string | null) => void;
}) {
  const [by, setBy] = useState<ColorBy>("state");
  const [hover, setHover] = useState<Device | null>(null);
  const lines = [...new Set(devices.map((d) => d.line))].sort();
  const info = hover ?? devices.find((d) => d.id === selected) ?? null;
  return (
    <section className="panel hexmap" aria-label="장비 맵">
      <header className="panel-head">
        <h3>장비 맵 <span className="muted">· 타일 클릭 시 이벤트 필터</span></h3>
        <div className="seg" role="group" aria-label="색상 기준">
          {(["state", "battery"] as const).map((v) => (
            <button key={v} aria-pressed={by === v} onClick={() => setBy(v)}>{v === "state" ? "상태" : "배터리"}</button>
          ))}
        </div>
      </header>
      <div className="hex-groups">
        {lines.map((line) => (
          <div key={line} className="hex-group">
            <h4>{line}</h4>
            <div className="hex-row">
              {devices.filter((d) => d.line === line).sort((a, b) => a.device.localeCompare(b.device)).map((d) => {
                const st = stateOf(d, now);
                const c = colorOf(d, st, by);
                return (
                  <button
                    key={d.id}
                    className={`hex ${selected === d.id ? "sel" : ""} ${st === "offline" ? "off" : ""}`}
                    style={{ ["--c" as string]: c }}
                    data-testid="hex-tile" data-device={d.id} data-state={st}
                    aria-pressed={selected === d.id}
                    aria-label={`${d.device} ${KIND_LABEL[d.kind]} ${st === "offline" ? "오프라인" : STATE_LABEL[st] ?? st}`}
                    onClick={() => onSelect(selected === d.id ? null : d.id)}
                    onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(d)} onBlur={() => setHover(null)}
                  >
                    <span className="hex-in">
                      <b>{st === "error" ? "!" : KIND_GLYPH[d.kind]}</b>
                      <small>{st === "offline" ? "끊김" : STATE_LABEL[st] ?? st}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {lines.length === 0 && <p className="muted">장비 데이터 대기 중…</p>}
      </div>
      <p className="hex-info" aria-live="polite" data-testid="hex-info">
        {info ? (
          <>
            <b>{info.id}</b> · {KIND_LABEL[info.kind]} · {stateOf(info, now) === "offline" ? "오프라인" : STATE_LABEL[info.state] ?? info.state}
            {info.battery != null && <> · 배터리 {info.battery.toFixed(0)}%</>}
            {info.x != null && <> · 위치 ({info.x.toFixed(1)}, {info.y?.toFixed(1)})</>}
            {" "}· 마지막 {Math.max(0, Math.round((now - Date.parse(info.last_seen)) / 1000))}초 전
          </>
        ) : <span className="muted">타일에 마우스를 올리면 상세가 표시됩니다.</span>}
      </p>
    </section>
  );
}
