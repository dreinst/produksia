"use client";

import { useState } from "react";

type BarisFakturOpsi = { barangId: string; labelBarang: string; jumlah: number };

export default function PemilihBarisRetur({ daftarBaris }: { daftarBaris: BarisFakturOpsi[] }) {
  const [isian, setIsian] = useState(daftarBaris.map((l) => ({ barangId: l.barangId, jumlah: 0 })));

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
            <th className="w-28">Kuantitas Retur</th>
          </tr>
        </thead>
        <tbody>
          {daftarBaris.map((l, i) => (
            <tr key={l.barangId}>
              <td>{l.labelBarang}</td>
              <td>{l.jumlah}</td>
              <td>
                <input
                  type="number"
                  min={0}
                  max={l.jumlah}
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
