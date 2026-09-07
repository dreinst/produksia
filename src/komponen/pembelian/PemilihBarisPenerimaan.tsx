"use client";

import { useState } from "react";

type BarisPesananOpsi = {
  id: string;
  barangId: string;
  labelBarang: string;
  jumlah: number;
  jumlahDiterima: number;
};

export default function PemilihBarisPenerimaan({ daftarBaris }: { daftarBaris: BarisPesananOpsi[] }) {
  const awal = daftarBaris.map((l) => ({
    barisPesananId: l.id,
    barangId: l.barangId,
    jumlah: Math.max(Number(l.jumlah) - Number(l.jumlahDiterima), 0),
  }));
  const [isian, setIsian] = useState(awal);

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
            <th className="w-28">Sisa Pesanan</th>
            <th className="w-28">Kuantitas Terima</th>
          </tr>
        </thead>
        <tbody>
          {daftarBaris.map((l, i) => {
            const sisa = Number(l.jumlah) - Number(l.jumlahDiterima);
            return (
              <tr key={l.id}>
                <td>{l.labelBarang}</td>
                <td>{sisa}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={sisa}
                    step="0.01"
                    className="isian isian-kecil"
                    value={isian[i].jumlah}
                    onChange={(e) => ubahJumlah(i, Number(e.target.value))}
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
