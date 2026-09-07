"use client";

import { useState } from "react";

type OpsiAkun = { id: string; kode: string; nama: string };
type Row = { akunId: string; debit: number; kredit: number; keterangan: string };

export default function EditorBarisJurnal({ daftarAkun }: { daftarAkun: OpsiAkun[] }) {
  const [isian, setIsian] = useState<Row[]>([
    { akunId: "", debit: 0, kredit: 0, keterangan: "" },
    { akunId: "", debit: 0, kredit: 0, keterangan: "" },
  ]);

  function ubahBaris(index: number, patch: Partial<Row>) {
    setIsian((sebelumnya) => sebelumnya.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function tambahBaris() {
    setIsian((sebelumnya) => [...sebelumnya, { akunId: "", debit: 0, kredit: 0, keterangan: "" }]);
  }

  function hapusBaris(index: number) {
    setIsian((sebelumnya) => sebelumnya.filter((_, i) => i !== index));
  }

  const totalDebit = isian.reduce((s, r) => s + r.debit, 0);
  const totalKredit = isian.reduce((s, r) => s + r.kredit, 0);
  const seimbang = totalDebit === totalKredit && totalDebit > 0;

  return (
    <div className="md:col-span-2 space-y-2">
      <input type="hidden" name="baris" value={JSON.stringify(isian)} />
      <div className="kartu kartu-tabel"><div className="bungkus-tabel">
        <table className="tabel-polos min-w-[36rem]">
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
          {isian.map((barisIsian, i) => (
            <tr key={i}>
              <td>
                <select
                  className="isian isian-kecil"
                  value={barisIsian.akunId}
                  onChange={(e) => ubahBaris(i, { akunId: e.target.value })}
                >
                  <option value="">-</option>
                  {daftarAkun.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.kode} - {a.nama}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="text"
                  className="isian isian-kecil"
                  value={barisIsian.keterangan}
                  onChange={(e) => ubahBaris(i, { keterangan: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="isian isian-kecil"
                  value={barisIsian.debit}
                  onChange={(e) => ubahBaris(i, { debit: Number(e.target.value), kredit: 0 })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="isian isian-kecil"
                  value={barisIsian.kredit}
                  onChange={(e) => ubahBaris(i, { kredit: Number(e.target.value), debit: 0 })}
                />
              </td>
              <td>
                <button
                  type="button"
                  onClick={() => hapusBaris(i)}
                  className="tombol-tautan-bahaya"
                >
                  Hapus
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div></div>
      <button type="button" onClick={tambahBaris} className="tombol-tautan">
        + Tambah baris
      </button>
      <div className={`text-right text-sm font-medium ${seimbang ? "text-green-600" : "text-red-600"}`}>
        Total Debit: {totalDebit.toLocaleString("id-ID")} &middot; Total Kredit: {totalKredit.toLocaleString("id-ID")}
        {!seimbang && " (belum seimbang)"}
      </div>
    </div>
  );
}
