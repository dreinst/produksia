"use client";

import { useState } from "react";
import PemilihFoto from "@/komponen/ui/PemilihFoto";

type OpsiGudang = { id: string; kode: string; nama: string; tersedia: number };

/**
 * Kartu di dalam kartu Foto Barang (halaman Ubah Barang): Gudang lapor rusak langsung saat lagi
 * mengecek stok, tanpa pindah ke halaman Laporan Kerusakan Barang. barangId sudah tetap (dari
 * halaman ini), jadi cuma perlu gudang, jumlah, keterangan, dan foto. Hidden "baris" dibangun di sini
 * supaya bentuknya sama persis dengan yang dibaca buatLaporanKerusakan (src/lib/aksi/kerusakan.ts).
 */
export default function FormLaporKerusakanInline({ barangId, daftarGudang }: { barangId: string; daftarGudang: OpsiGudang[] }) {
  const [gudangId, setGudangId] = useState(daftarGudang[0]?.id ?? "");
  const [jumlah, setJumlah] = useState(0);
  const tersedia = daftarGudang.find((g) => g.id === gudangId)?.tersedia ?? 0;
  const lebih = jumlah > tersedia;

  return (
    <>
      <input type="hidden" name="gudangId" value={gudangId} />
      <input type="hidden" name="baris" value={JSON.stringify([{ barangId, jumlah }])} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {daftarGudang.length > 1 ? (
          <div className="bidang">
            <label className="label" htmlFor="kerusakan-gudang">Gudang *</label>
            <select id="kerusakan-gudang" className="isian min-h-11" value={gudangId} onChange={(e) => setGudangId(e.target.value)}>
              {daftarGudang.map((g) => (
                <option key={g.id} value={g.id}>{g.kode} - {g.nama}</option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="bidang">
          <label className="label" htmlFor="kerusakan-jumlah">Jumlah rusak * (tersedia {tersedia.toLocaleString("id-ID")})</label>
          <input
            id="kerusakan-jumlah"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className={`isian min-h-11 ${lebih ? "border-rose-400" : ""}`}
            value={jumlah}
            onChange={(e) => setJumlah(Number(e.target.value))}
          />
          {lebih && <span className="petunjuk text-rose-600">Melebihi stok yang tersedia</span>}
        </div>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="kerusakan-keterangan">Jenis / penyebab kerusakan</label>
        <input id="kerusakan-keterangan" name="keterangan" className="isian min-h-11" placeholder="mis. Basah kehujanan, jatuh saat loading" />
      </div>
      <div className="bidang">
        <span className="label">Foto bukti kondisi rusak *</span>
        <PemilihFoto name="foto" maksimal={3} wajib label="Ambil foto barang rusak" />
      </div>
      <button type="submit" disabled={!gudangId || jumlah <= 0 || lebih} className="tombol tombol-utama w-full sm:w-auto min-h-11">
        Lapor rusak
      </button>
    </>
  );
}
