"use client";

import { useState } from "react";

type AccountOption = { id: string; code: string; name: string };
type Row = { accountId: string; debit: number; credit: number; description: string };

export default function JournalLinesEditor({ accounts }: { accounts: AccountOption[] }) {
  const [rows, setRows] = useState<Row[]>([
    { accountId: "", debit: 0, credit: 0, description: "" },
    { accountId: "", debit: 0, credit: 0, description: "" },
  ]);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { accountId: "", debit: 0, credit: 0, description: "" }]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0;

  return (
    <div className="md:col-span-2 space-y-2">
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />
      <div className="card card-table"><div className="table-wrap">
        <table className="tbl-plain min-w-[36rem]">
        <thead>
          <tr>
            <th>Akun</th>
            <th>Keterangan</th>
            <th className="w-32">Debit</th>
            <th className="w-32">Kredit</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <select
                  className="input input-sm"
                  value={row.accountId}
                  onChange={(e) => updateRow(i, { accountId: e.target.value })}
                >
                  <option value="">-</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="text"
                  className="input input-sm"
                  value={row.description}
                  onChange={(e) => updateRow(i, { description: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="input input-sm"
                  value={row.debit}
                  onChange={(e) => updateRow(i, { debit: Number(e.target.value), credit: 0 })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="input input-sm"
                  value={row.credit}
                  onChange={(e) => updateRow(i, { credit: Number(e.target.value), debit: 0 })}
                />
              </td>
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
      <div className={`text-right text-sm font-medium ${balanced ? "text-green-600" : "text-red-600"}`}>
        Total Debit: {totalDebit.toLocaleString("id-ID")} &middot; Total Kredit: {totalCredit.toLocaleString("id-ID")}
        {!balanced && " (belum balance)"}
      </div>
    </div>
  );
}
