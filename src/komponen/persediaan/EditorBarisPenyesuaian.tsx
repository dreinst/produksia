"use client";

import { useState } from "react";

type OpsiBarang = { id: string; kode: string; nama: string; satuan: string; hargaBeli: number };
/** stok[gudangId][barangId] = jumlah saat ini */
type PetaStok = Record<string, Record<string, number>>;
type Baris = { barangId: string; jumlahSesudah: number; hargaSatuan: string };

export default function EditorBarisPenyesuaian({ daftarBarang, petaStok, gudangId }: { daftarBarang: OpsiBarang[]; petaStok: PetaStok; gudangId: string }) {
  const [isian, setIsian] = useState<Baris[]>([{ barangId: "", jumlahSesudah: 0, hargaSatuan: "" }]);
  const stokDi = (barangId: string) => petaStok[gudangId]?.[barangId] ?? 0;

  function ubah(i: number, patch: Partial<Baris>) {
    setIsian((s) => s.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const ringkasan = isian
    .filter((r) => r.barangId)
    .map((r) => {
      const barang = daftarBarang.find((b) => b.id === r.barangId)!;
      const sebelum = stokDi(r.barangId);
      const selisih = r.jumlahSesudah - sebelum;
      const harga = selisih > 0 && Number(r.hargaSatuan) > 0 ? Number(r.hargaSatuan) : barang.hargaBeli;
      return { selisih, nilai: selisih * harga };
    });
  const totalNilai = ringkasan.reduce((s, r) => s + r.nilai, 0);

  return (
    <div className="md:col-span-2 space-y-2">
      <input type="hidden" name="baris" value={JSON.stringify(isian)} />
      <div className="kartu kartu-tabel">
        <div className="bungkus-tabel">
          <table className="tabel-polos min-w-[40rem]">
            <thead>
              <tr>
                <th>Barang</th>
                <th className="w-28 text-right">Stok sekarang</th>
                <th className="w-32">Jumlah sesudah</th>
                <th className="w-28 text-right">Selisih</th>
                <th className="w-36">Harga pokok satuan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {isian.map((r, i) => {
                const barang = daftarBarang.find((b) => b.id === r.barangId);
                const sebelum = r.barangId ? stokDi(r.barangId) : 0;
                const selisih = r.barangId ? r.jumlahSesudah - sebelum : 0;
                return (
                  <tr key={i}>
                    <td>
                      <select
                        className="isian isian-kecil"
                        value={r.barangId}
                        onChange={(e) => {
                          const b = daftarBarang.find((x) => x.id === e.target.value);
                          ubah(i, { barangId: e.target.value, jumlahSesudah: b ? stokDi(b.id) : 0, hargaSatuan: b && b.hargaBeli > 0 ? String(b.hargaBeli) : "" });
                        }}
                      >
                        <option value="">-</option>
                        {daftarBarang.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.kode} - {b.nama}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-right angka text-slate-500">
                      {r.barangId ? `${sebelum.toLocaleString("id-ID")} ${barang?.satuan ?? ""}` : "-"}
                    </td>
                    <td>
                      <input type="number" min={0} step="0.01" className="isian isian-kecil" value={r.jumlahSesudah} onChange={(e) => ubah(i, { jumlahSesudah: Number(e.target.value) })} />
                    </td>
                    <td className={`text-right angka font-semibold ${selisih > 0 ? "text-emerald-700" : selisih < 0 ? "text-rose-700" : "text-slate-400"}`}>
                      {selisih > 0 ? "+" : ""}
                      {selisih.toLocaleString("id-ID")}
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="isian isian-kecil"
                        placeholder={barang ? String(barang.hargaBeli) : ""}
                        value={r.hargaSatuan}
                        disabled={selisih <= 0}
                        title={selisih <= 0 ? "Pengurangan selalu memakai harga pokok rata-rata saat ini" : "Harga pokok barang yang masuk (untuk saldo awal)"}
                        onChange={(e) => ubah(i, { hargaSatuan: e.target.value })}
                      />
                    </td>
                    <td>
                      <button type="button" onClick={() => setIsian((s) => s.filter((_, idx) => idx !== i))} className="tombol-tautan-bahaya">
                        Hapus
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setIsian((s) => [...s, { barangId: "", jumlahSesudah: 0, hargaSatuan: "" }])} className="tombol-tautan">
          + Tambah baris
        </button>
        <div className="text-sm">
          Nilai penyesuaian:{" "}
          <span className={`angka font-semibold ${totalNilai >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{totalNilai.toLocaleString("id-ID")}</span>
        </div>
      </div>
    </div>
  );
}
