export function Sparkline({ values, color = "var(--c-cyan)" }: { values: (number | null)[]; color?: string }) {
  const vals: number[] = [];
  let prev = 0;
  for (const v of values) { prev = v ?? prev; vals.push(prev); }
  if (vals.length < 2) return <svg className="spark" viewBox="0 0 100 24" aria-hidden />;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * 100).toFixed(2)},${(22 - ((v - min) / span) * 20).toFixed(2)}`);
  return (
    <svg className="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden>
      <polygon points={`0,24 ${pts.join(" ")} 100,24`} fill={color} opacity={0.14} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
