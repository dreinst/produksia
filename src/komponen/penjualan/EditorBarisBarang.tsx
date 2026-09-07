"use client";

import { useState } from "react";

type OpsiBarang = { id: string; kode: string; nama: string; hargaBawaan: number };
type Row = { barangId: string; jumlah: number; harga: number };

export default function EditorBarisBarang({ daftarBarang }: { daftarBarang: OpsiBarang[] }) {
  const [isian, setIsian] = useState<Row[]>([{ barangId: "", jumlah: 1, harga: 0 }]);

  function ubahBaris(index: number, patch: Partial<Row>) {
    setIsian((sebelumnya) => sebelumnya.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function tambahBaris() {
    setIsian((sebelumnya) => [...sebelumnya, { barangId: "", jumlah: 1, harga: 0 }]);
  }

  function hapusBaris(index: number) {
    setIsian((sebelumnya) => sebelumnya.filter((_, i) => i !== index));
  }

  const total = isian.reduce((jumlahkan, r) => jumlahkan + r.jumlah * r.harga, 0);

  return (
    <div className="md:col-span-2 space-y-2">
      <input type="hidden" name="baris" value={JSON.stringify(isian)} />
      <div className="kartu kartu-tabel"><div className="bungkus-tabel">
        <table className="tabel-polos min-w-[36rem]">
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
          {isian.map((barisIsian, i) => (
            <tr key={i}>
              <td>
                <select
                  className="isian isian-kecil"
                  value={barisIsian.barangId}
                  onChange={(e) => {
                    const barang = daftarBarang.find((it) => it.id === e.target.value);
                    ubahBaris(i, {
                      barangId: e.target.value,
                      harga: barang ? barang.hargaBawaan : barisIsian.harga,
                    });
                  }}
                >
                  <option value="">-</option>
                  {daftarBarang.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.kode} - {it.nama}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="isian isian-kecil"
                  value={barisIsian.jumlah}
                  onChange={(e) => ubahBaris(i, { jumlah: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="isian isian-kecil"
                  value={barisIsian.harga}
                  onChange={(e) => ubahBaris(i, { harga: Number(e.target.value) })}
                />
              </td>
              <td>{(barisIsian.jumlah * barisIsian.harga).toLocaleString("id-ID")}</td>
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
      <div className="text-right font-medium">Total: {total.toLocaleString("id-ID")}</div>
    </div>
  );
}
