"use client";

import { useState } from "react";

/**
 * `id` (opsional, retur penjualan): id baris faktur. Bila ada, JSON memakai `barisFakturId` dan `sisa` menjadi batas
 * isian; tanpa `id` (retur pembelian) perilaku lama per barangId.
 */
type BarisFakturOpsi = { id?: string; barangId: string; labelBarang: string; jumlah: number; sisa?: number };

export default function PemilihBarisRetur({ daftarBaris }: { daftarBaris: BarisFakturOpsi[] }) {
  const [isian, setIsian] = useState(daftarBaris.map((l) => (l.id ? { barisFakturId: l.id, jumlah: 0 } : { barangId: l.barangId, jumlah: 0 })));
  const adaSisa = daftarBaris.some((l) => l.sisa !== undefined);

  function ubahJumlah(index: number, jumlah: number) {
    setIsian((sebelumnya) => sebelumnya.map((r, i) => (i === index ? { ...r, jumlah } : r)));
  }

  return (
    <div className="md:col-span-2 space-y-2">
      <input type="hidden" name="baris" value={JSON.stringify(isian)} />
      <div className="kartu kartu-tabel"><div className="bungkus-tabel">
        <table className="tabel-polos min-w-[36rem]">
        <thead>
          <tr>
            <th>Barang</th>
            <th className="w-24">Kuantitas Dibeli</th>
            {adaSisa && <th className="w-24">Sisa Bisa Diretur</th>}
            <th className="w-28">Kuantitas Retur</th>
          </tr>
        </thead>
        <tbody>
          {daftarBaris.map((l, i) => (
            <tr key={l.id ?? l.barangId}>
              <td>{l.labelBarang}</td>
              <td>{l.jumlah}</td>
              {adaSisa && <td>{l.sisa ?? "-"}</td>}
              <td>
                <input
                  type="number"
                  min={0}
                  max={l.sisa ?? l.jumlah}
                  step="0.01"
                  className="isian isian-kecil"
                  value={isian[i].jumlah}
                  onChange={(e) => ubahJumlah(i, Number(e.target.value))}
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
