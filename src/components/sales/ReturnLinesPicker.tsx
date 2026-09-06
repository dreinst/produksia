"use client";

import { useState } from "react";

type InvoiceLine = { itemId: string; itemLabel: string; qty: number };

export default function ReturnLinesPicker({ lines }: { lines: InvoiceLine[] }) {
  const [rows, setRows] = useState(lines.map((l) => ({ itemId: l.itemId, qty: 0 })));

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
            <th className="w-24">Qty Dibeli</th>
            <th className="w-28">Qty Retur</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.itemId}>
              <td>{l.itemLabel}</td>
              <td>{l.qty}</td>
              <td>
                <input
                  type="number"
                  min={0}
                  max={l.qty}
                  step="0.01"
                  className="input input-sm"
                  value={rows[i].qty}
                  onChange={(e) => updateQty(i, Number(e.target.value))}
                />
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
