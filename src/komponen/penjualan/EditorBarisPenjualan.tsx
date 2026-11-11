"use client";

import { Fragment } from "react";
import Ikon from "@/komponen/ui/Ikon";
import { angkaKlien, nilaiBarisKlien, subtotalKlien } from "@/lib/hitungDokumenKlien";

/*
 * Editor baris penawaran dan pesanan penjualan (D2 §7.4). Dikendalikan PenyusunDokumenPenjualan (baris ikut ringkasan
 * dan rencana termin). Barang JASA-LAIN tidak ada di daftar (disaring halaman); baris bebas dikirim dengan barangId
 * kosong dan nama. Mode standar menyembunyikan frekuensi dan seksi (server memaksa frekuensi 1). EditorBarisBarang
 * lama tetap dipakai pembelian.
 */

export type OpsiBarangPenjualan = { id: string; kode: string; nama: string; satuan: string; deskripsi: string | null; hargaBawaan: number; hargaMinimum: number };
export type BarisEditor = {
  kunci: number;
  /** "" = belum dipilih, BEBAS = item bebas tanpa katalog, selain itu id barang */
  barangId: string;
  nama: string;
  deskripsi: string;
  jumlah: string;
  satuan: string;
  frekuensi: string;
  satuanFrekuensi: string;
  harga: string;
  bagian: string;
  keterangan: string;
};

export const BEBAS = "__bebas";
let urutKunci = 0;
export const kunciBarisBaru = () => ++urutKunci;
export const barisKosong = (): BarisEditor => ({ kunci: kunciBarisBaru(), barangId: "", nama: "", deskripsi: "", jumlah: "1", satuan: "", frekuensi: "", satuanFrekuensi: "", harga: "0", bagian: "", keterangan: "" });

/** Baris yang dipakai server: punya barang atau nama, dan jumlah > 0 (uraiBarisDokumen membuang sisanya diam-diam). */
export function barisDipakai(b: BarisEditor): boolean {
  const adaBarang = b.barangId !== "" && b.barangId !== BEBAS;
  return (adaBarang || b.nama.trim() !== "") && angkaKlien(b.jumlah) > 0;
}

/** Isian JSON `baris` (bentuk D2 §3.3). Frekuensi dan seksi hanya di mode event. */
export function barisKiriman(daftar: readonly BarisEditor[], event: boolean) {
  return daftar.map((b) => {
    const isi: Record<string, string> = {
      barangId: b.barangId === BEBAS ? "" : b.barangId,
      jumlah: b.jumlah,
      harga: b.harga,
    };
    for (const k of ["nama", "deskripsi", "satuan", "keterangan"] as const) if (b[k].trim()) isi[k] = b[k];
    if (event) for (const k of ["frekuensi", "satuanFrekuensi", "bagian"] as const) if (b[k].trim()) isi[k] = b[k];
    return isi;
  });
}

const rupiah = (n: number) => n.toLocaleString("id-ID");

export default function EditorBarisPenjualan({
  baris,
  ubahSemua,
  event,
  daftarBarang,
  daftarSeksi,
  bolehNego,
  bolehBawahMinimum,
}: {
  baris: BarisEditor[];
  ubahSemua: (fn: (s: BarisEditor[]) => BarisEditor[]) => void;
  event: boolean;
  daftarBarang: readonly OpsiBarangPenjualan[];
  daftarSeksi: readonly string[];
  bolehNego: boolean;
  bolehBawahMinimum: boolean;
}) {
  const ubah = (i: number, patch: Partial<BarisEditor>) => ubahSemua((s) => s.map((b, k) => (k === i ? { ...b, ...patch } : b)));
  const pindah = (i: number, arah: -1 | 1) =>
    ubahSemua((s) => {
      const j = i + arah;
      if (j < 0 || j >= s.length) return s;
      const salin = [...s];
      [salin[i], salin[j]] = [salin[j], salin[i]];
      return salin;
    });
  const kelompokkan = () =>
    ubahSemua((s) => {
      const indeks = (seksi: string) => {
        const t = seksi.trim();
        if (!t) return Number.MAX_SAFE_INTEGER;
        const k = daftarSeksi.findIndex((x) => x.toLocaleLowerCase("id-ID") === t.toLocaleLowerCase("id-ID"));
        // seksi di luar daftar: sesudah seksi daftar, berkelompok menurut kemunculan pertama
        return k >= 0 ? k : daftarSeksi.length + s.findIndex((b) => b.bagian.trim().toLocaleLowerCase("id-ID") === t.toLocaleLowerCase("id-ID"));
      };
      return s.map((b, i) => ({ b, i, k: indeks(b.bagian) })).sort((x, y) => x.k - y.k || x.i - y.i).map((x) => x.b);
    });

  // subtotal per kelompok seksi berdampingan (mode event), ditampilkan di bawah baris terakhir kelompok
  const kunciSeksi = (b: BarisEditor) => b.bagian.trim().toLocaleLowerCase("id-ID");
  const subtotalSeksi = (i: number) => {
    const kelompok: BarisEditor[] = [];
    for (let k = i; k >= 0 && kunciSeksi(baris[k]) === kunciSeksi(baris[i]); k--) if (barisDipakai(baris[k])) kelompok.push(baris[k]);
    return subtotalKlien(kelompok);
  };
  const kolom = event ? 10 : 8;

  return (
    <div className="md:col-span-2 space-y-2">
      {event && (
        <datalist id="daftar-seksi">
          {daftarSeksi.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      <div className="kartu kartu-tabel">
        <div className="bungkus-tabel">
          <table className={`tabel-polos ${event ? "min-w-[72rem]" : "min-w-[56rem]"}`}>
            <thead>
              <tr>
                <th className="w-8">#</th>
                <th>Barang / nama tampil</th>
                <th className="w-28">Qty</th>
                {event && <th className="w-28">Frek</th>}
                {event && <th className="w-40">Seksi</th>}
                <th className="w-40">Harga</th>
                <th className="w-40">Keterangan</th>
                <th className="w-32 text-right">Jumlah</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {baris.map((b, i) => {
                const barang = daftarBarang.find((x) => x.id === b.barangId);
                const harga = angkaKlien(b.harga);
                const minimum = barang?.hargaMinimum ?? 0;
                const diBawahBawaan = Boolean(barang) && harga < (barang?.hargaBawaan ?? 0);
                const diBawahMinimum = minimum > 0 && harga < minimum;
                const hargaTerkunci = !bolehNego && b.barangId !== BEBAS;
                const akhirKelompok = event && b.bagian.trim() !== "" && (i === baris.length - 1 || kunciSeksi(baris[i + 1]) !== kunciSeksi(b));
                return (
                  <Fragment key={b.kunci}>
                    <tr className="align-top">
                      <td className="mono text-slate-400 pt-3">{i + 1}</td>
                      <td className="space-y-1">
                        <select
                          className="isian isian-kecil"
                          value={b.barangId}
                          aria-label={`Barang baris ${i + 1}`}
                          onChange={(e) => {
                            const pilih = daftarBarang.find((x) => x.id === e.target.value);
                            ubah(i, {
                              barangId: e.target.value,
                              harga: pilih ? String(pilih.hargaBawaan) : b.harga,
                              deskripsi: pilih && !b.deskripsi.trim() ? (pilih.deskripsi ?? "") : b.deskripsi,
                            });
                          }}
                        >
                          <option value="">-</option>
                          <option value={BEBAS} disabled={!bolehNego} title={!bolehNego ? "Item bebas butuh hak nego harga" : undefined}>
                            Item bebas (tanpa katalog)
                          </option>
                          {daftarBarang.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.kode} - {x.nama}
                            </option>
                          ))}
                        </select>
                        <input
                          className={`isian isian-kecil ${!bolehNego && b.barangId !== BEBAS ? "bg-slate-50 text-slate-500" : ""}`}
                          value={b.nama}
                          maxLength={200}
                          readOnly={!bolehNego && b.barangId !== BEBAS}
                          placeholder={barang?.nama ?? (b.barangId === BEBAS ? "Nama item" : "Nama tampil")}
                          title={!bolehNego ? "Mengganti nama barang butuh hak nego harga" : undefined}
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
                      <td className="space-y-1">
                        <input type="number" min={0} step="0.01" className="isian isian-kecil" value={b.jumlah} onChange={(e) => ubah(i, { jumlah: e.target.value })} aria-label={`Qty baris ${i + 1}`} />
                        <input className="isian isian-kecil" maxLength={20} value={b.satuan} placeholder={barang?.satuan ?? "satuan"} onChange={(e) => ubah(i, { satuan: e.target.value })} aria-label={`Satuan baris ${i + 1}`} />
                      </td>
                      {event && (
                        <td className="space-y-1">
                          <input type="number" min={0} step="0.01" className="isian isian-kecil" value={b.frekuensi} placeholder="1" onChange={(e) => ubah(i, { frekuensi: e.target.value })} aria-label={`Frekuensi baris ${i + 1}`} />
                          <input className="isian isian-kecil" maxLength={20} value={b.satuanFrekuensi} placeholder="malam, hari, event, kali" onChange={(e) => ubah(i, { satuanFrekuensi: e.target.value })} aria-label={`Satuan frekuensi baris ${i + 1}`} />
                        </td>
                      )}
                      {event && (
                        <td>
                          <input className="isian isian-kecil" list="daftar-seksi" maxLength={80} value={b.bagian} onChange={(e) => ubah(i, { bagian: e.target.value })} aria-label={`Seksi baris ${i + 1}`} />
                        </td>
                      )}
                      <td>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={`isian isian-kecil ${hargaTerkunci ? "bg-slate-50 text-slate-500" : ""}`}
                          value={b.harga}
                          readOnly={hargaTerkunci}
                          title={hargaTerkunci ? "Harga mengikuti harga jual barang. Nego harga perlu hak dari Pemilik." : undefined}
                          onChange={(e) => !hargaTerkunci && ubah(i, { harga: e.target.value })}
                          aria-label={`Harga baris ${i + 1}`}
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
                      <td>
                        <input className="isian isian-kecil" maxLength={300} value={b.keterangan} onChange={(e) => ubah(i, { keterangan: e.target.value })} aria-label={`Keterangan baris ${i + 1}`} />
                      </td>
                      <td className="text-right angka pt-3">{barisDipakai(b) ? rupiah(nilaiBarisKlien({ jumlah: b.jumlah, harga: b.harga, frekuensi: event ? b.frekuensi : undefined })) : "-"}</td>
                      <td className="whitespace-nowrap">
                        <button type="button" onClick={() => pindah(i, -1)} disabled={i === 0} className="tombol-tautan" title="Naik" aria-label={`Naikkan baris ${i + 1}`}>
                          <Ikon nama="arrow_upward" className="!text-[16px]" />
                        </button>
                        <button type="button" onClick={() => pindah(i, 1)} disabled={i === baris.length - 1} className="tombol-tautan" title="Turun" aria-label={`Turunkan baris ${i + 1}`}>
                          <Ikon nama="arrow_downward" className="!text-[16px]" />
                        </button>
                        <button type="button" onClick={() => ubahSemua((s) => s.filter((_, k) => k !== i))} className="tombol-tautan-bahaya">
                          Hapus
                        </button>
                      </td>
                    </tr>
                    {akhirKelompok && (
                      <tr>
                        <td colSpan={kolom - 2} className="text-right text-xs text-slate-500">
                          Total {b.bagian.trim()}
                        </td>
                        <td className="text-right angka text-xs font-semibold">{rupiah(subtotalSeksi(i))}</td>
                        <td />
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={() => ubahSemua((s) => [...s, barisKosong()])} className="tombol-tautan">
            + Tambah baris
          </button>
          {event && baris.length > 1 && (
            <button type="button" onClick={kelompokkan} className="tombol-tautan">
              <Ikon nama="format_list_bulleted" className="!text-[16px]" /> Kelompokkan per seksi
            </button>
          )}
        </div>
        {!bolehNego && <span className="text-xs text-slate-500">Harga mengikuti harga jual barang. Untuk nego harga, minta hak dari Pemilik.</span>}
      </div>
      {event ? (
        <p className="petunjuk">Baris dengan seksi yang sama dicetak di bawah satu judul, jadi letakkan berdekatan.</p>
      ) : (
        <p className="petunjuk">Mode standar: frekuensi dihitung 1 dan seksi tidak dipakai.</p>
      )}
    </div>
  );
}
