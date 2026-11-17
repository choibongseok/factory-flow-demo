import { fmtNum } from "@/lib/format";
import { Inventory } from "@/lib/types";

export function InventoryPanel({ inventory }: { inventory: Inventory }) {
  const { totals, items } = inventory;
  return (
    <section className="panel" aria-label="입출고 현황">
      <h3>입출고 현황 <span className="muted">· RFID 게이트 통과 수량 기준, 기초재고 미반영</span></h3>
      <table>
        <thead><tr><th>SKU</th><th>입고</th><th>출고</th><th>순증감 (입고−출고)</th></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.sku} data-testid="inv-row"><td>{i.sku}</td><td>{fmtNum(i.inbound)}</td><td>{fmtNum(i.outbound)}</td>
              <td className={i.on_hand < 0 ? "neg" : ""}><b>{i.on_hand > 0 ? "+" : ""}{fmtNum(i.on_hand)}</b></td></tr>
          ))}
          {items.length === 0 && <tr><td colSpan={4} className="muted">집계 대기 중…</td></tr>}
        </tbody>
        {items.length > 0 && (
          <tfoot><tr><td>합계</td><td>{fmtNum(totals.inbound)}</td><td>{fmtNum(totals.outbound)}</td><td><b>{totals.on_hand > 0 ? "+" : ""}{fmtNum(totals.on_hand)}</b></td></tr></tfoot>
        )}
      </table>
    </section>
  );
}
