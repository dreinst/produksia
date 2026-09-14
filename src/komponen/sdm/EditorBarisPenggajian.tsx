"use client";

import { useState } from "react";

type OpsiKaryawan = { id: string; kode: string; nama: string; jabatan: string | null; gajiPokok: number; tunjangan: number };
type Baris = { karyawanId: string; gajiPokok: number; tunjangan: number; potongan: number; keteranganPotongan: string };

const rupiah = (n: number) => n.toLocaleString("id-ID");

/**
 * Baris Proses Gaji: satu baris per karyawan yang diikutkan, terisi awal dari komponen gaji bawaan
 * data induk (bisa disesuaikan untuk bulan ini). Karyawan yang tidak dibayar bulan ini tinggal dihapus barisnya.
 */
export default function EditorBarisPenggajian({ daftarKaryawan }: { daftarKaryawan: OpsiKaryawan[] }) {
  const [isian, setIsian] = useState<Baris[]>(
    daftarKaryawan.map((k) => ({ karyawanId: k.id, gajiPokok: k.gajiPokok, tunjangan: k.tunjangan, potongan: 0, keteranganPotongan: "" })),
  );

  function ubah(i: number, patch: Partial<Baris>) {
    setIsian((s) => s.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function tambahBaris() {
    const sisa = daftarKaryawan.find((k) => !isian.some((r) => r.karyawanId === k.id));
    if (!sisa) return;
    setIsian((s) => [...s, { karyawanId: sisa.id, gajiPokok: sisa.gajiPokok, tunjangan: sisa.tunjangan, potongan: 0, keteranganPotongan: "" }]);
  }

  const total = isian.reduce(
    (acc, r) => ({
      pokok: acc.pokok + r.gajiPokok,
      tunjangan: acc.tunjangan + r.tunjangan,
      potongan: acc.potongan + r.potongan,
      dibayar: acc.dibayar + Math.max(0, r.gajiPokok + r.tunjangan - r.potongan),
    }),
    { pokok: 0, tunjangan: 0, potongan: 0, dibayar: 0 },
  );

  return (
    <div className="md:col-span-2 space-y-2">
      <input type="hidden" name="baris" value={JSON.stringify(isian)} />
      <div className="kartu kartu-tabel">
        <div className="bungkus-tabel">
          <table className="tabel-polos min-w-[52rem]">
            <thead>
              <tr>
                <th>Karyawan</th>
                <th className="w-32 text-right">Gaji pokok</th>
                <th className="w-32 text-right">Tunjangan</th>
                <th className="w-32 text-right">Potongan</th>
                <th className="w-40">Keterangan potongan</th>
                <th className="w-32 text-right">Diterima</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {isian.map((r, i) => {
                const diterima = Math.max(0, r.gajiPokok + r.tunjangan - r.potongan);
                const kurang = r.gajiPokok + r.tunjangan - r.potongan < 0;
                return (
                  <tr key={i}>
                    <td>
                      <select
                        className="isian isian-kecil"
                        value={r.karyawanId}
                        onChange={(e) => {
                          const pilih = daftarKaryawan.find((x) => x.id === e.target.value);
                          ubah(i, { karyawanId: e.target.value, gajiPokok: pilih?.gajiPokok ?? 0, tunjangan: pilih?.tunjangan ?? 0 });
                        }}
                      >
                        {daftarKaryawan
                          .filter((x) => x.id === r.karyawanId || !isian.some((row) => row.karyawanId === x.id))
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.kode} - {x.nama}
                              {x.jabatan ? ` (${x.jabatan})` : ""}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td><input type="number" min={0} step="0.01" className="isian isian-kecil text-right" value={r.gajiPokok} onChange={(e) => ubah(i, { gajiPokok: Number(e.target.value) })} /></td>
                    <td><input type="number" min={0} step="0.01" className="isian isian-kecil text-right" value={r.tunjangan} onChange={(e) => ubah(i, { tunjangan: Number(e.target.value) })} /></td>
                    <td><input type="number" min={0} step="0.01" className="isian isian-kecil text-right" value={r.potongan} onChange={(e) => ubah(i, { potongan: Number(e.target.value) })} /></td>
                    <td><input type="text" className="isian isian-kecil" placeholder="mis. BPJS, PPh 21" value={r.keteranganPotongan} onChange={(e) => ubah(i, { keteranganPotongan: e.target.value })} disabled={r.potongan <= 0} /></td>
                    <td className={`text-right angka font-semibold ${kurang ? "text-rose-700" : "text-slate-900"}`}>{kurang ? "tidak valid" : rupiah(diterima)}</td>
                    <td>
                      <button type="button" onClick={() => setIsian((s) => s.filter((_, idx) => idx !== i))} className="tombol-tautan-bahaya">
                        Hapus
                      </button>
                    </td>
                  </tr>
                );
              })}
              {isian.length === 0 && (
                <tr>
                  <td colSpan={7} className="kosong">Tidak ada karyawan aktif. Tambahkan dulu di Data Induk → Karyawan.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td>Total ({isian.length} karyawan)</td>
                <td className="text-right angka">{rupiah(total.pokok)}</td>
                <td className="text-right angka">{rupiah(total.tunjangan)}</td>
                <td className="text-right angka">{rupiah(total.potongan)}</td>
                <td />
                <td className="text-right angka">{rupiah(total.dibayar)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      {isian.length < daftarKaryawan.length && (
        <button type="button" onClick={tambahBaris} className="tombol-tautan">
          + Tambah karyawan
        </button>
      )}
    </div>
  );
}
