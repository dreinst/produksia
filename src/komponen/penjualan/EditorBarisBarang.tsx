"use client";

import { useState } from "react";

type OpsiBarang = { id: string; kode: string; nama: string; hargaBawaan: number; hargaMinimum?: number };
type Row = { barangId: string; jumlah: number; harga: number };
type Props = {
  daftarBarang: OpsiBarang[];
  /** false = harga terkunci mengikuti harga bawaan (pengguna tanpa hak "harga.nego") */
  bolehNego?: boolean;
  /** true untuk Pemilik/Superadmin: boleh di bawah harga minimum barang */
  bolehBawahMinimum?: boolean;
};

const rupiah = (n: number) => n.toLocaleString("id-ID");

export default function EditorBarisBarang({ daftarBarang, bolehNego = true, bolehBawahMinimum = true }: Props) {
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
            <th className="w-40">Harga</th>
            <th className="w-32">Subtotal</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {isian.map((barisIsian, i) => {
            const barang = daftarBarang.find((it) => it.id === barisIsian.barangId);
            const minimum = barang?.hargaMinimum ?? 0;
            const diBawahBawaan = Boolean(barang) && barisIsian.harga < (barang?.hargaBawaan ?? 0);
            const diBawahMinimum = minimum > 0 && barisIsian.harga < minimum;
            return (
              <tr key={i}>
                <td>
                  <select
                    className="isian isian-kecil"
                    value={barisIsian.barangId}
                    onChange={(e) => {
                      const pilih = daftarBarang.find((it) => it.id === e.target.value);
                      ubahBaris(i, { barangId: e.target.value, harga: pilih ? pilih.hargaBawaan : barisIsian.harga });
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
                    className={`isian isian-kecil ${!bolehNego ? "bg-slate-50 text-slate-500" : ""}`}
                    value={barisIsian.harga}
                    readOnly={!bolehNego}
                    title={!bolehNego ? "Harga mengikuti harga jual barang. Nego harga perlu hak dari Pemilik." : undefined}
                    onChange={(e) => bolehNego && ubahBaris(i, { harga: Number(e.target.value) })}
                  />
                  {bolehNego && barang && (
                    <div className={`text-xs mt-1 ${diBawahMinimum && !bolehBawahMinimum ? "text-rose-600" : diBawahMinimum ? "text-amber-600" : "text-slate-400"}`}>
                      {diBawahMinimum
                        ? bolehBawahMinimum
                          ? `Di bawah harga minimum ${rupiah(minimum)}`
                          : `Di bawah harga minimum ${rupiah(minimum)}. Hanya Pemilik/Superadmin yang boleh.`
                        : diBawahBawaan
                          ? `Nego dari ${rupiah(barang.hargaBawaan)}${minimum > 0 ? `, minimum ${rupiah(minimum)}` : ""}`
                          : minimum > 0
                            ? `Boleh nego sampai ${rupiah(minimum)}`
                            : ""}
                    </div>
                  )}
                </td>
                <td>{rupiah(barisIsian.jumlah * barisIsian.harga)}</td>
                <td>
                  <button type="button" onClick={() => hapusBaris(i)} className="tombol-tautan-bahaya">
                    Hapus
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div></div>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <button type="button" onClick={tambahBaris} className="tombol-tautan">
          + Tambah baris
        </button>
        {!bolehNego && <span className="text-xs text-slate-500">Harga mengikuti harga jual barang. Untuk nego harga, minta hak dari Pemilik.</span>}
      </div>
      <div className="text-right font-medium">Total: {rupiah(total)}</div>
    </div>
  );
}
