"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

type OpsiBarang = { id: string; kode: string; nama: string; satuan: string; warna: string | null; tersedia: number };
type Baris = { barangId: string; jumlah: number };

/** Baris barang yang dibawa keluar; hidden "baris" = JSON [{ barangId, jumlah }]. Tersedia = stok gudang dikurangi yang sedang di luar. */
export default function EditorBarisPeminjaman({ daftarBarang }: { daftarBarang: OpsiBarang[] }) {
  const [isian, setIsian] = useState<Baris[]>([{ barangId: "", jumlah: 0 }]);
  const ubah = (i: number, patch: Partial<Baris>) => setIsian((s) => s.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const hapus = (i: number) => setIsian((s) => s.filter((_, idx) => idx !== i));
  const cari = (id: string) => daftarBarang.find((b) => b.id === id);
  const ganda = (i: number) => !!isian[i].barangId && isian.some((r, idx) => idx !== i && r.barangId === isian[i].barangId);
  const lebih = (r: Baris) => !!r.barangId && r.jumlah > (cari(r.barangId)?.tersedia ?? 0);
  const siap = isian.some((r) => r.barangId && r.jumlah > 0) && isian.every((r, i) => !r.barangId || (r.jumlah > 0 && !lebih(r) && !ganda(i)));

  const opsiBarang = daftarBarang.map((b) => (
    <option key={b.id} value={b.id}>
      {b.kode} - {b.nama}
    </option>
  ));
  const infoBarang = (r: Baris) => {
    const b = cari(r.barangId);
    if (!b) return "-";
    return `${b.tersedia.toLocaleString("id-ID")} ${b.satuan}${b.warna ? `, ${b.warna}` : ""}`;
  };
  const peringatan = (r: Baris, i: number) =>
    ganda(i) ? <span className="petunjuk text-rose-600">Barang sudah ada di baris lain</span> : lebih(r) ? <span className="petunjuk text-rose-600">Melebihi yang tersedia</span> : null;

  return (
    <div className="space-y-2">
      <input type="hidden" name="baris" value={JSON.stringify(isian)} />

      {/* Mobile (< md): satu kartu per baris */}
      <div className="md:hidden space-y-3">
        {isian.map((r, i) => (
          <div key={i} className="kartu space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="bidang flex-1">
                <label className="label text-xs" htmlFor={`barang-pinjam-${i}`}>Barang</label>
                <select id={`barang-pinjam-${i}`} className="isian w-full min-h-11" value={r.barangId} onChange={(e) => ubah(i, { barangId: e.target.value, jumlah: 0 })}>
                  <option value="">-</option>
                  {opsiBarang}
                </select>
              </div>
              <button type="button" onClick={() => hapus(i)} className="tombol-tautan-bahaya mt-6 shrink-0 min-h-11">Hapus</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-slate-500">Tersedia</div>
                <div className="angka text-slate-700">{infoBarang(r)}</div>
              </div>
              <div className="bidang">
                <label className="label text-xs" htmlFor={`jumlah-pinjam-${i}`}>Jumlah keluar</label>
                <input
                  id={`jumlah-pinjam-${i}`}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  className={`isian w-full min-h-11 ${lebih(r) ? "border-rose-400" : ""}`}
                  value={r.jumlah}
                  onChange={(e) => ubah(i, { jumlah: Number(e.target.value) })}
                />
                {peringatan(r, i)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop (md+): tabel */}
      <div className="hidden md:block kartu kartu-tabel">
        <div className="bungkus-tabel">
          <table className="tabel-polos min-w-[36rem]">
            <thead>
              <tr>
                <th>Barang</th>
                <th className="w-40 text-right">Tersedia</th>
                <th className="w-32">Jumlah keluar</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {isian.map((r, i) => (
                <tr key={i}>
                  <td>
                    <select className="isian isian-kecil" value={r.barangId} onChange={(e) => ubah(i, { barangId: e.target.value, jumlah: 0 })} aria-label={`Barang baris ${i + 1}`}>
                      <option value="">-</option>
                      {opsiBarang}
                    </select>
                  </td>
                  <td className="text-right angka text-slate-500 text-xs">{infoBarang(r)}</td>
                  <td>
                    <input type="number" min={0} step="0.01" className={`isian isian-kecil ${lebih(r) ? "border-rose-400" : ""}`} value={r.jumlah} onChange={(e) => ubah(i, { jumlah: Number(e.target.value) })} aria-label={`Jumlah keluar baris ${i + 1}`} />
                    {peringatan(r, i)}
                  </td>
                  <td>
                    <button type="button" onClick={() => hapus(i)} className="tombol-tautan-bahaya">Hapus</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setIsian((s) => [...s, { barangId: "", jumlah: 0 }])} className="tombol-tautan min-h-11">+ Tambah baris</button>
        <span className={`text-xs ${siap ? "text-emerald-700" : "text-slate-500"}`}>{siap ? "Siap dicatat" : "Isi minimal satu baris, tidak melebihi yang tersedia"}</span>
      </div>
    </div>
  );
}

/** Pilihan gudang pada form Ambil: berganti gudang memuat ulang halaman agar angka tersedia mengikuti gudang itu. */
export function PemilihGudang({ daftarGudang, gudangId }: { daftarGudang: { id: string; kode: string; nama: string }[]; gudangId: string }) {
  const router = useRouter();
  const paramCari = useSearchParams();
  // State lokal supaya pilihan tidak membalik ke nilai lama selama halaman dimuat ulang.
  const [nilai, setNilai] = useState(gudangId);
  const ganti = (id: string) => {
    setNilai(id);
    const p = new URLSearchParams(paramCari);
    p.set("gudang", id);
    router.replace(`?${p}`);
  };
  return (
    <select id="gudangId" name="gudangId" required className="isian min-h-11" value={nilai} onChange={(e) => ganti(e.target.value)}>
      {daftarGudang.map((g) => (
        <option key={g.id} value={g.id}>
          {g.kode} - {g.nama}
        </option>
      ))}
    </select>
  );
}

type BarisKembali = { barangId: string; kode: string; nama: string; satuan: string; sisa: number };

/** Isian jumlah yang kembali sekarang per baris (bawaan = sisa); hidden "baris" = JSON [{ barangId, jumlahKembali }]. */
export function EditorKembali({ baris }: { baris: BarisKembali[] }) {
  const [isian, setIsian] = useState(baris.map((b) => ({ barangId: b.barangId, jumlahKembali: b.sisa })));
  return (
    <div className="space-y-2">
      <input type="hidden" name="baris" value={JSON.stringify(isian)} />
      {baris.map((b, i) => (
        <div key={b.barangId} className="flex items-center gap-3">
          <label className="flex-1 text-sm min-w-0" htmlFor={`kembali-${b.barangId}`}>
            <span className="mono">{b.kode}</span> <span className="text-slate-700">{b.nama}</span>
            <span className="block text-xs text-slate-500">sisa {b.sisa.toLocaleString("id-ID")} {b.satuan}</span>
          </label>
          <input
            id={`kembali-${b.barangId}`}
            type="number"
            min={0}
            max={b.sisa}
            step="0.01"
            inputMode="decimal"
            className={`isian w-28 min-h-11 ${isian[i].jumlahKembali > b.sisa ? "border-rose-400" : ""}`}
            value={isian[i].jumlahKembali}
            onChange={(e) => setIsian((s) => s.map((r, idx) => (idx === i ? { ...r, jumlahKembali: Number(e.target.value) } : r)))}
          />
        </div>
      ))}
    </div>
  );
}
