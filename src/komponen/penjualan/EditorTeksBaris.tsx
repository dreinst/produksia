"use client";

import { useState } from "react";
import Ikon from "@/komponen/ui/Ikon";

/*
 * Editor teks baris untuk halaman Ubah tampilan penawaran, pesanan, dan faktur (D2 §7.2). Hanya kolom tampilan yang
 * diubah: nama tampil, deskripsi, satuan, keterangan, seksi (mode event), dan urutan. Jumlah, harga, dan barang tidak
 * pernah ikut terkirim. Isian tersembunyi `baris` berisi JSON [{ id, nama, deskripsi, satuan, keterangan, urutan,
 * bagian? }] untuk semua baris (bacaBarisTampilan); nama yang tidak berubah tidak diperiksa hak nego di server.
 */

export type BarisTeksAwal = {
  id: string;
  /** label katalog, mis. "JSA-001 - Sound system" */
  label: string;
  /** nama dan satuan katalog untuk placeholder (kosong = memakai katalog) */
  namaKatalog: string;
  satuanKatalog: string;
  nama: string;
  deskripsi: string;
  satuan: string;
  keterangan: string;
  bagian: string;
};

export default function EditorTeksBaris({
  baris: awal,
  event,
  bolehNego,
  daftarSeksi = [],
}: {
  baris: readonly BarisTeksAwal[];
  /** mode event: kolom seksi tampil dan ikut terkirim */
  event: boolean;
  /** tanpa hak nego harga, nama tampil baca saja (mengganti nama butuh harga.nego, D2 §7.4) */
  bolehNego: boolean;
  daftarSeksi?: readonly string[];
}) {
  const [baris, setBaris] = useState<BarisTeksAwal[]>(() => [...awal]);
  const ubah = (i: number, patch: Partial<BarisTeksAwal>) => setBaris((s) => s.map((b, k) => (k === i ? { ...b, ...patch } : b)));
  const pindah = (i: number, arah: -1 | 1) =>
    setBaris((s) => {
      const j = i + arah;
      if (j < 0 || j >= s.length) return s;
      const salin = [...s];
      [salin[i], salin[j]] = [salin[j], salin[i]];
      return salin;
    });
  const kiriman = baris.map((b, i) => ({
    id: b.id,
    nama: b.nama,
    deskripsi: b.deskripsi,
    satuan: b.satuan,
    keterangan: b.keterangan,
    urutan: i,
    ...(event ? { bagian: b.bagian } : {}),
  }));

  if (baris.length === 0) return <p className="redup text-sm">Dokumen ini tidak punya baris.</p>;

  return (
    <div className="space-y-2">
      <input type="hidden" name="baris" value={JSON.stringify(kiriman)} />
      {event && (
        <datalist id="daftar-seksi-tampilan">
          {daftarSeksi.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      <div className="bungkus-tabel">
        <table className={`tabel-polos ${event ? "min-w-[60rem]" : "min-w-[52rem]"}`}>
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th>Barang / nama tampil</th>
              <th className="w-28">Satuan</th>
              {event && <th className="w-40">Seksi</th>}
              <th className="w-48">Keterangan</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {baris.map((b, i) => (
              <tr key={b.id} className="align-top">
                <td className="mono text-slate-400 pt-3">{i + 1}</td>
                <td className="space-y-1">
                  <div className="text-xs text-slate-500">{b.label}</div>
                  <input
                    className={`isian isian-kecil ${bolehNego ? "" : "bg-slate-50 text-slate-500"}`}
                    value={b.nama}
                    maxLength={200}
                    readOnly={!bolehNego}
                    placeholder={b.namaKatalog}
                    title={bolehNego ? undefined : "Mengganti nama barang butuh hak nego harga"}
                    onChange={(e) => ubah(i, { nama: e.target.value })}
                    aria-label={`Nama tampil baris ${i + 1}`}
                  />
                  <textarea
                    className="isian isian-kecil"
                    rows={3}
                    maxLength={3000}
                    value={b.deskripsi}
                    placeholder="Satu poin per baris: - butir, -- sub-butir, **tebal**"
                    onChange={(e) => ubah(i, { deskripsi: e.target.value })}
                    aria-label={`Deskripsi baris ${i + 1}`}
                  />
                </td>
                <td>
                  <input className="isian isian-kecil" maxLength={20} value={b.satuan} placeholder={b.satuanKatalog} onChange={(e) => ubah(i, { satuan: e.target.value })} aria-label={`Satuan baris ${i + 1}`} />
                </td>
                {event && (
                  <td>
                    <input className="isian isian-kecil" list="daftar-seksi-tampilan" maxLength={80} value={b.bagian} onChange={(e) => ubah(i, { bagian: e.target.value })} aria-label={`Seksi baris ${i + 1}`} />
                  </td>
                )}
                <td>
                  <input className="isian isian-kecil" maxLength={300} value={b.keterangan} onChange={(e) => ubah(i, { keterangan: e.target.value })} aria-label={`Keterangan baris ${i + 1}`} />
                </td>
                <td className="whitespace-nowrap">
                  <button type="button" onClick={() => pindah(i, -1)} disabled={i === 0} className="tombol-tautan" title="Naik" aria-label={`Naikkan baris ${i + 1}`}>
                    <Ikon nama="arrow_upward" className="!text-[16px]" />
                  </button>
                  <button type="button" onClick={() => pindah(i, 1)} disabled={i === baris.length - 1} className="tombol-tautan" title="Turun" aria-label={`Turunkan baris ${i + 1}`}>
                    <Ikon nama="arrow_downward" className="!text-[16px]" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="petunjuk">
        Nama tampil, satuan, dan keterangan kosong memakai data katalog. Jumlah dan harga tidak berubah di sini.
        {!bolehNego && " Mengganti nama tampil butuh hak nego harga."}
      </p>
    </div>
  );
}
