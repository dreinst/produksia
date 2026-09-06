"use client";

import { useState } from "react";

type OrderLine = {
  id: string;
  itemId: string;
  itemLabel: string;
  qty: number;
  qtyShipped: number;
};

export default function OrderLinesPicker({ lines }: { lines: OrderLine[] }) {
  const initial = lines.map((l) => ({
    orderLineId: l.id,
    itemId: l.itemId,
    qty: Math.max(Number(l.qty) - Number(l.qtyShipped), 0),
  }));
  const [rows, setRows] = useState(initial);

  function updateQty(index: number, qty: number) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, qty } : r)));
  }

  return (
    <div className="md:col-span-2 space-y-2">
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />
      <div className="card card-table"><div className="table-wrap">
        <table className="tbl-plain min-w-[36rem]">
        <thead>
          <tr>
            <th>Barang</th>
            <th className="w-28">Sisa Pesanan</th>
            <th className="w-28">Kuantitas Kirim</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const remaining = Number(l.qty) - Number(l.qtyShipped);
            return (
              <tr key={l.id}>
                <td>{l.itemLabel}</td>
                <td>{remaining}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={remaining}
                    step="0.01"
                    className="input input-sm"
                    value={rows[i].qty}
                    onChange={(e) => updateQty(i, Number(e.target.value))}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
