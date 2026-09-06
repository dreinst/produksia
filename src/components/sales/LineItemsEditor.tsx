"use client";

import { useState } from "react";

type ItemOption = { id: string; code: string; name: string; defaultPrice: number };
type Row = { itemId: string; qty: number; price: number };

export default function LineItemsEditor({ items }: { items: ItemOption[] }) {
  const [rows, setRows] = useState<Row[]>([{ itemId: "", qty: 1, price: 0 }]);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { itemId: "", qty: 1, price: 0 }]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  const total = rows.reduce((sum, r) => sum + r.qty * r.price, 0);

  return (
    <div className="md:col-span-2 space-y-2">
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />
      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <table className="w-full text-sm min-w-[36rem]">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="pb-1">Barang</th>
            <th className="pb-1 w-24">Qty</th>
            <th className="pb-1 w-32">Harga</th>
            <th className="pb-1 w-32">Subtotal</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="pr-2 py-1">
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={row.itemId}
                  onChange={(e) => {
                    const item = items.find((it) => it.id === e.target.value);
                    updateRow(i, {
                      itemId: e.target.value,
                      price: item ? item.defaultPrice : row.price,
                    });
                  }}
                >
                  <option value="">-</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.code} - {it.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="pr-2 py-1">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="border rounded px-2 py-1 w-full"
                  value={row.qty}
                  onChange={(e) => updateRow(i, { qty: Number(e.target.value) })}
                />
              </td>
              <td className="pr-2 py-1">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="border rounded px-2 py-1 w-full"
                  value={row.price}
                  onChange={(e) => updateRow(i, { price: Number(e.target.value) })}
                />
              </td>
              <td className="pr-2 py-1">{(row.qty * row.price).toLocaleString("id-ID")}</td>
              <td className="py-1">
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="text-red-600 text-xs hover:underline"
                >
                  Hapus
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      <button type="button" onClick={addRow} className="text-sm text-blue-600 hover:underline">
        + Tambah baris
      </button>
      <div className="text-right font-medium">Total: {total.toLocaleString("id-ID")}</div>
    </div>
  );
}
