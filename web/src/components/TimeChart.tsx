"use client";
import { useEffect, useRef } from "react";
import "uplot/dist/uPlot.min.css";
import type uPlotType from "uplot";

export interface ChartSeries { label: string; color: string; fill?: boolean; bars?: boolean }

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function TimeChart({ x, series, data, theme, height = 168 }: {
  x: number[]; series: ChartSeries[]; data: (number | null)[][]; theme: string; height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlotType | null>(null);
  const latest = useRef({ x, data });
  latest.current = { x, data };
  const key = JSON.stringify(series) + theme;

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const uPlot = (await import("uplot")).default;
      if (disposed || !box.current) return;
      const muted = cssVar("--muted"), grid = cssVar("--grid");
      const axis = { stroke: muted, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 }, font: "11px var(--font-sans), sans-serif" };
      const colors = series.map((s) => cssVar(s.color.replace(/^var\((.*)\)$/, "$1")));
      const u = new uPlot({
        width: box.current.clientWidth || 300,
        height,
        legend: { show: false },
        cursor: { points: { show: false }, drag: { x: false, y: false } },
        scales: { x: { time: true } }, tzDate: (ts: number) => new Date(ts * 1000),
        axes: [
          { ...axis, values: (_u: unknown, vals: number[]) => vals.map((v) => new Date(v * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })) },
          { ...axis, size: 46 },
        ],
        series: [
          {},
          ...series.map((s, i) => ({
            label: s.label, stroke: colors[i], width: s.bars ? 0 : 1.6, points: { show: false }, spanGaps: true,
            fill: s.fill || s.bars ? colors[i] + (s.bars ? "dd" : "55") : undefined,
            paths: s.bars ? uPlot.paths.bars!({ size: [0.7, 60] }) : undefined,
          })),
        ],
      }, [latest.current.x, ...latest.current.data] as uPlotType.AlignedData, box.current);
      plot.current = u;
      ro = new ResizeObserver(() => box.current && u.setSize({ width: box.current.clientWidth, height }));
      ro.observe(box.current);
    })();
    return () => { disposed = true; ro?.disconnect(); plot.current?.destroy(); plot.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, height]);

  useEffect(() => {
    plot.current?.setData([x, ...data] as uPlotType.AlignedData);
  }, [x, data]);

  return <div ref={box} className="chart" />;
}
