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
      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <table className="w-full text-sm min-w-[36rem]">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="pb-1">Barang</th>
            <th className="pb-1 w-24">Qty Dibeli</th>
            <th className="pb-1 w-28">Qty Retur</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.itemId}>
              <td className="py-1">{l.itemLabel}</td>
              <td className="py-1">{l.qty}</td>
              <td className="py-1">
                <input
                  type="number"
                  min={0}
                  max={l.qty}
                  step="0.01"
                  className="border rounded px-2 py-1 w-full"
                  value={rows[i].qty}
                  onChange={(e) => updateQty(i, Number(e.target.value))}
                />
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}
