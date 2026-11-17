import { Inventory } from "@/lib/types";

export function InventoryPanel({ inventory }: { inventory: Inventory }) {
  const { totals, items } = inventory;
  return (
    <section className="panel">
      <h3>입출고 현황 <span className="muted">· RFID 게이트 기준, 기초재고 미반영</span></h3>
      <div className="kpis">
        <div><small>입고</small><b className="in">{totals.inbound}</b></div>
        <div><small>출고</small><b className="out">{totals.outbound}</b></div>
        <div><small>순증감 (입고-출고)</small><b>{totals.on_hand}</b></div>
      </div>
      <table>
        <thead><tr><th>SKU</th><th>입고</th><th>출고</th><th>순증감</th></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.sku}><td>{i.sku}</td><td>{i.inbound}</td><td>{i.outbound}</td><td><b>{i.on_hand}</b></td></tr>
          ))}
          {items.length === 0 && <tr><td colSpan={4} className="muted">집계 대기 중…</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
