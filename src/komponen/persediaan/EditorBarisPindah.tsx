"use client";

import { useState } from "react";

type OpsiGudang = { id: string; kode: string; nama: string };
type OpsiBarang = { id: string; kode: string; nama: string; satuan: string };
/** stok[gudangId][barangId] = jumlah saat ini */
type PetaStok = Record<string, Record<string, number>>;
type Baris = { barangId: string; jumlah: number };

/** Pemilih gudang asal/tujuan + baris barang untuk Pindah Barang; stok kedua gudang tampil langsung. */
export default function EditorBarisPindah({ daftarGudang, daftarBarang, petaStok }: { daftarGudang: OpsiGudang[]; daftarBarang: OpsiBarang[]; petaStok: PetaStok }) {
  const [asalId, setAsalId] = useState(daftarGudang[0]?.id ?? "");
  const [tujuanId, setTujuanId] = useState(daftarGudang.find((g) => g.id !== daftarGudang[0]?.id)?.id ?? "");
  const [isian, setIsian] = useState<Baris[]>([{ barangId: "", jumlah: 0 }]);
  const stokDi = (gudangId: string, barangId: string) => petaStok[gudangId]?.[barangId] ?? 0;
  const ubah = (i: number, patch: Partial<Baris>) => setIsian((s) => s.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const namaGudang = (id: string) => daftarGudang.find((g) => g.id === id)?.nama ?? "";
  const semuaValid = asalId && tujuanId && asalId !== tujuanId && isian.some((r) => r.barangId && r.jumlah > 0) && isian.every((r) => !r.barangId || r.jumlah <= stokDi(asalId, r.barangId));

  return (
    <>
      <input type="hidden" name="baris" value={JSON.stringify(isian)} />
      <div className="bidang">
        <label className="label" htmlFor="gudangAsalId">Gudang asal *</label>
        <select id="gudangAsalId" name="gudangAsalId" required className="isian" value={asalId} onChange={(e) => setAsalId(e.target.value)}>
          {daftarGudang.map((g) => (
            <option key={g.id} value={g.id}>{g.kode} - {g.nama}</option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="gudangTujuanId">Gudang tujuan *</label>
        <select id="gudangTujuanId" name="gudangTujuanId" required className="isian" value={tujuanId} onChange={(e) => setTujuanId(e.target.value)}>
          <option value="">-</option>
          {daftarGudang.filter((g) => g.id !== asalId).map((g) => (
            <option key={g.id} value={g.id}>{g.kode} - {g.nama}</option>
          ))}
        </select>
        {asalId && tujuanId && asalId === tujuanId && <span className="petunjuk text-rose-600">Gudang asal dan tujuan harus berbeda</span>}
      </div>
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor="keterangan">Keterangan</label>
        <input id="keterangan" name="keterangan" className="isian" placeholder="mis. Kirim perlengkapan ke gudang venue" />
      </div>

      <div className="md:col-span-2 space-y-2">
        <div className="kartu kartu-tabel">
          <div className="bungkus-tabel">
            <table className="tabel-polos min-w-[40rem]">
              <thead>
                <tr>
                  <th>Barang</th>
                  <th className="w-32 text-right">Stok di {namaGudang(asalId) || "asal"}</th>
                  <th className="w-32">Jumlah pindah</th>
                  <th className="w-32 text-right">Stok di {namaGudang(tujuanId) || "tujuan"}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {isian.map((r, i) => {
                  const barang = daftarBarang.find((b) => b.id === r.barangId);
                  const diAsal = r.barangId ? stokDi(asalId, r.barangId) : 0;
                  const diTujuan = r.barangId && tujuanId ? stokDi(tujuanId, r.barangId) : 0;
                  const lebih = r.barangId && r.jumlah > diAsal;
                  return (
                    <tr key={i}>
                      <td>
                        <select className="isian isian-kecil" value={r.barangId} onChange={(e) => ubah(i, { barangId: e.target.value, jumlah: 0 })} aria-label={`Barang baris ${i + 1}`}>
                          <option value="">-</option>
                          {daftarBarang.map((b) => (
                            <option key={b.id} value={b.id}>{b.kode} - {b.nama}</option>
                          ))}
                        </select>
                      </td>
                      <td className="text-right angka text-slate-500">{r.barangId ? `${diAsal.toLocaleString("id-ID")} ${barang?.satuan ?? ""}` : "-"}</td>
                      <td>
                        <input type="number" min={0} max={diAsal} step="0.01" className={`isian isian-kecil ${lebih ? "border-rose-400" : ""}`} value={r.jumlah} onChange={(e) => ubah(i, { jumlah: Number(e.target.value) })} aria-label={`Jumlah pindah baris ${i + 1}`} />
                        {lebih && <span className="petunjuk text-rose-600">Melebihi stok gudang asal</span>}
                      </td>
                      <td className="text-right angka text-slate-500">
                        {r.barangId ? (
                          <>
                            {diTujuan.toLocaleString("id-ID")} <span className="text-emerald-700">→ {(diTujuan + r.jumlah).toLocaleString("id-ID")}</span>
                          </>
                        ) : "-"}
                      </td>
                      <td>
                        <button type="button" onClick={() => setIsian((s) => s.filter((_, idx) => idx !== i))} className="tombol-tautan-bahaya">Hapus</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setIsian((s) => [...s, { barangId: "", jumlah: 0 }])} className="tombol-tautan">+ Tambah baris</button>
          <span className={`text-xs ${semuaValid ? "text-emerald-700" : "text-slate-500"}`}>{semuaValid ? "Siap dipindahkan" : "Isi gudang tujuan dan minimal satu baris ≤ stok asal"}</span>
        </div>
      </div>
    </>
  );
}
