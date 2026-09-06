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
      <div className="card card-table"><div className="table-wrap">
        <table className="tbl-plain min-w-[36rem]">
        <thead>
          <tr>
            <th>Barang</th>
            <th className="w-24">Kuantitas</th>
            <th className="w-32">Harga</th>
            <th className="w-32">Subtotal</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <select
                  className="input input-sm"
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
              <td>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="input input-sm"
                  value={row.qty}
                  onChange={(e) => updateRow(i, { qty: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="input input-sm"
                  value={row.price}
                  onChange={(e) => updateRow(i, { price: Number(e.target.value) })}
                />
              </td>
              <td>{(row.qty * row.price).toLocaleString("id-ID")}</td>
              <td>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="btn-link-danger"
                >
                  Hapus
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div></div>
      <button type="button" onClick={addRow} className="btn-link">
        + Tambah baris
      </button>
      <div className="text-right font-medium">Total: {total.toLocaleString("id-ID")}</div>
    </div>
  );
}
