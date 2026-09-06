"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import Ikon from "@/komponen/ui/Ikon";
import { NomorDokumen, LencanaStatus } from "@/komponen/ui/Lencana";
import type { StatusFormulir } from "@/lib/statusFormulir";

export type BarisPenyusun = {
  id: string;
  barangId: string;
  kode: string;
  nama: string;
  satuan: string;
  jumlahDipesan: number;
  sisa: number;
  harga: number;
  hargaBeli: number;
};

export type PropsPenyusun = {
  mode: "penjualan" | "pembelian";
  aksi: (sebelumnya: StatusFormulir, dataFormulir: FormData) => Promise<StatusFormulir>;
  tautanKembali: string;
  tautanDaftar: string;
  nomorBerikut: string;
  tanggal: string;
  jatuhTempo: string;
  pesanan: { id: string; nomor: string; tanggal: string; status: string };
  rekanan: { kode: string; nama: string };
  daftarBaris: BarisPenyusun[];
  /** dokumen tahap sebelumnya: SJ (penjualan) atau TB (pembelian) */
  dokumenSebelumnya: { nomor: string; tanggal: string }[];
  pemetaan: null | {
    akunLawan: string; // Piutang (penjualan) / Utang (pembelian)
    pendapatanAtauPersediaan: string; // Pendapatan (penjualan) / Persediaan (pembelian)
    hpp?: string;
    persediaan?: string;
  };
};

const format = (n: number) => n.toLocaleString("id-ID");
const tanggalId = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export default function PenyusunFaktur(p: PropsPenyusun) {
  const adalahPenjualan = p.mode === "penjualan";
  const [status, aksiFormulir, sedangProses] = useActionState(p.aksi, { galat: null });
  const [isian, setIsian] = useState(p.daftarBaris.map((b) => ({ barangId: b.barangId, jumlah: b.sisa, harga: b.harga })));

  const hitung = useMemo(() => {
    const subtotal = isian.reduce((s, r) => s + r.jumlah * r.harga, 0);
    const hargaPokok = isian.reduce((s, r, i) => s + r.jumlah * p.daftarBaris[i].hargaBeli, 0);
    const jumlahValid = isian.every((r, i) => r.jumlah >= 0 && r.jumlah <= p.daftarBaris[i].sisa) && isian.some((r) => r.jumlah > 0);
    return { subtotal, hargaPokok, jumlahValid, banyakBaris: isian.filter((r) => r.jumlah > 0).length };
  }, [isian, p.daftarBaris]);

  const ubahJumlah = (i: number, jumlah: number) => setIsian((sebelumnya) => sebelumnya.map((r, k) => (k === i ? { ...r, jumlah } : r)));

  const teks = adalahPenjualan
    ? { judul: "Buat Faktur Penjualan (FJ)", modul: "Penjualan", daftar: "Faktur Penjualan", rekanan: "Pelanggan", akunLawan: "Akun Piutang", sebelumnya: "Surat Jalan (SJ)", kirim: "Terbitkan Faktur & Jurnal", alur: "PSJ → SJ → FJ", catatanStok: "Stok dipotong saat Pengiriman (SJ), bukan saat faktur" }
    : { judul: "Buat Faktur Pembelian (FB)", modul: "Pembelian", daftar: "Faktur Pembelian", rekanan: "Pemasok", akunLawan: "Akun Utang", sebelumnya: "Penerimaan Barang (TB)", kirim: "Terbitkan Faktur & Jurnal", alur: "PSB → TB → FB", catatanStok: "Stok bertambah saat Penerimaan Barang (TB), bukan saat faktur" };

  const barisJurnalPratinjau = adalahPenjualan
    ? [
        { akun: p.pemetaan?.akunLawan ?? "Piutang Usaha", catatan: "Tagihan bruto pelanggan", debit: hitung.subtotal, kredit: 0 },
        { akun: p.pemetaan?.hpp ?? "HPP", catatan: "Harga pokok terjual (Σ jumlah × harga beli)", debit: hitung.hargaPokok, kredit: 0 },
        { akun: p.pemetaan?.pendapatanAtauPersediaan ?? "Pendapatan Penjualan", catatan: "Pendapatan diakui", debit: 0, kredit: hitung.subtotal },
        { akun: p.pemetaan?.persediaan ?? "Persediaan", catatan: "Pengurangan nilai persediaan", debit: 0, kredit: hitung.hargaPokok },
      ].filter((r) => r.debit > 0 || r.kredit > 0 || hitung.subtotal === 0)
    : [
        { akun: p.pemetaan?.pendapatanAtauPersediaan ?? "Persediaan", catatan: "Penambahan nilai persediaan", debit: hitung.subtotal, kredit: 0 },
        { akun: p.pemetaan?.akunLawan ?? "Utang Usaha", catatan: "Kewajiban ke pemasok", debit: 0, kredit: hitung.subtotal },
      ];
  const totalDebit = barisJurnalPratinjau.reduce((s, r) => s + r.debit, 0);
  const totalKredit = barisJurnalPratinjau.reduce((s, r) => s + r.kredit, 0);

  const pengaman = [
    { ok: hitung.jumlahValid, teks: "Semua kuantitas valid (≤ sisa pesanan, minimal 1 baris > 0)" },
    { ok: !!p.pemetaan, teks: p.pemetaan ? "Pemetaan akun terpasang (5 peran akun)" : "Pemetaan akun belum diatur — buka Buku Besar › Pemetaan Akun" },
    { ok: true, teks: teks.catatanStok },
  ];
  const bisaKirim = hitung.jumlahValid && !!p.pemetaan && !sedangProses;

  return (
    <form
      action={aksiFormulir}
      id="formulir-faktur"
      className="space-y-4"
      aria-busy={sedangProses}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && bisaKirim) (e.currentTarget as HTMLFormElement).requestSubmit();
      }}
    >
      <input type="hidden" name="pesananId" value={p.pesanan.id} />
      <input type="hidden" name="baris" value={JSON.stringify(isian)} />

      {/* Kepala halaman */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="min-w-0">
          <nav className="flex items-center gap-1 text-xs text-slate-500 mb-1" aria-label="Jejak halaman">
            <span>{teks.modul}</span>
            <Ikon nama="chevron_right" className="!text-[14px] text-slate-400" />
            <Link href={p.tautanDaftar} className="hover:text-slate-900">{teks.daftar}</Link>
            <Ikon nama="chevron_right" className="!text-[14px] text-slate-400" />
            <span className="font-semibold text-slate-800">Buat Faktur Baru</span>
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="judul-halaman">{teks.judul}</h1>
            <span className="lencana lencana-amber">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> Draf (belum dicatat)
            </span>
            <span className="lencana lencana-slate">
              <Ikon nama="link" className="!text-[14px] text-blue-600" /> Ref Pesanan: <span className="mono">{p.pesanan.nomor}</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start lg:self-center">
          <Link href={p.tautanKembali} className="tombol tombol-garis tombol-kecil">
            <Ikon nama="close" className="!text-[16px]" /> Batal
          </Link>
          <button type="submit" disabled={!bisaKirim} className="tombol tombol-utama tombol-kecil group">
            <Ikon nama="check_circle" className="!text-[16px] text-emerald-400" />
            {sedangProses ? "Memproses…" : teks.kirim}
            <kbd className="hidden sm:inline-block bg-white/15 px-1 rounded font-mono text-[10px]">Ctrl+Enter</kbd>
          </button>
        </div>
      </div>

      {status.galat && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {status.galat}
        </div>
      )}

      <fieldset disabled={sedangProses} className="contents">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Kiri */}
          <div className="lg:col-span-8 flex flex-col gap-4">
            <section className="kartu">
              <div className="kepala-kartu">
                <div className="flex items-center gap-2">
                  <Ikon nama="receipt_long" className="!text-[20px] text-blue-600" />
                  <h2 className="judul-kartu !text-[15px]">Informasi Dokumen &amp; Rekanan</h2>
                </div>
                <span className="petunjuk uppercase">Metode: Akrual • Rp</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bidang">
                  <label className="label"><span>No. Faktur</span><span className="petunjuk text-blue-600">Otomatis</span></label>
                  <div className="relative">
                    <input readOnly value={p.nomorBerikut} className="isian isian-kecil mono" />
                    <Ikon nama="lock" className="absolute right-2 top-1.5 !text-[16px] text-slate-400" />
                  </div>
                </div>
                <div className="bidang">
                  <label className="label">Tanggal Transaksi</label>
                  <input readOnly type="date" value={p.tanggal} className="isian isian-kecil" />
                </div>
                <div className="bidang">
                  <label className="label"><span>Jatuh Tempo</span><span className="petunjuk">14 hari</span></label>
                  <input readOnly type="date" value={p.jatuhTempo} className="isian isian-kecil" />
                </div>
                <div className="bidang sm:col-span-2">
                  <label className="label">
                    <span>{teks.rekanan}</span>
                    <span className="petunjuk text-emerald-600 flex items-center gap-0.5"><Ikon nama="verified" className="!text-[14px]" /> dari pesanan</span>
                  </label>
                  <input readOnly value={`${p.rekanan.kode} • ${p.rekanan.nama}`} className="isian isian-kecil" />
                </div>
                <div className="bidang">
                  <label className="label"><span>{teks.akunLawan}</span><span className="petunjuk">Peta Akun</span></label>
                  <div className="relative">
                    <input readOnly value={p.pemetaan?.akunLawan ?? "Belum dipetakan"} className={`isian isian-kecil ${p.pemetaan ? "" : "!text-rose-600"}`} />
                    <Ikon nama="hub" className="absolute right-2 top-1.5 !text-[16px] text-slate-400" />
                  </div>
                </div>
              </div>
            </section>

            <section className="kartu kartu-tabel">
              <div className="kepala-kartu">
                <div className="flex flex-wrap items-center gap-2">
                  <Ikon nama="format_list_bulleted" className="!text-[20px] text-blue-600" />
                  <h2 className="judul-kartu !text-[15px]">Daftar Barang &amp; Jasa Terfaktur</h2>
                  <span className="lencana lencana-slate">{hitung.banyakBaris} baris</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsian(p.daftarBaris.map((b) => ({ barangId: b.barangId, jumlah: b.sisa, harga: b.harga })))}
                  className="tombol tombol-lembut tombol-kecil text-blue-600"
                >
                  <Ikon nama="inventory_2" className="!text-[16px]" /> Isi semua sisa pesanan
                </button>
              </div>
              <div className="bungkus-tabel">
                <table className="tabel min-w-[38rem]">
                  <thead>
                    <tr>
                      <th className="w-8 text-center">#</th>
                      <th>Kode &amp; Nama Barang / Jasa</th>
                      <th className="text-right">Sisa / Pesanan</th>
                      <th className="text-right w-24">Kuantitas Faktur</th>
                      <th className="text-center w-14">Satuan</th>
                      <th className="text-right w-24">Harga</th>
                      <th className="text-right w-28">Total (Rp)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.daftarBaris.map((b, i) => {
                      const r = isian[i];
                      const salah = r.jumlah < 0 || r.jumlah > b.sisa;
                      return (
                        <tr key={b.id}>
                          <td className="text-center mono text-slate-400">{i + 1}</td>
                          <td>
                            <div className="text-[13px] font-semibold text-slate-900">{b.nama}</div>
                            <div className="mono text-slate-500">{b.kode}</div>
                          </td>
                          <td className="text-right angka whitespace-nowrap">
                            {format(b.sisa)} <span className="text-slate-400">/ {format(b.jumlahDipesan)}</span>
                          </td>
                          <td className="text-right">
                            <input
                              type="number"
                              min={0}
                              max={b.sisa}
                              step="0.01"
                              value={r.jumlah}
                              onChange={(e) => ubahJumlah(i, Number(e.target.value))}
                              className={`isian isian-kecil w-20 text-right angka ${salah ? "!border-rose-500" : ""}`}
                              aria-invalid={salah}
                            />
                          </td>
                          <td className="text-center mono text-slate-500">{b.satuan}</td>
                          <td className="text-right angka">{format(b.harga)}</td>
                          <td className="text-right angka font-semibold text-slate-900">{format(r.jumlah * r.harga)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={6} className="text-right text-xs uppercase tracking-wider text-slate-500">Subtotal</td>
                      <td className="text-right angka">{format(hitung.subtotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            <section className="kartu">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2">
                  <Ikon nama="alt_route" className="!text-[18px] text-blue-600" />
                  Alur Terhubung ({teks.alur})
                </h3>
                <span className="petunjuk text-emerald-600">Tautan dokumen tervalidasi</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="ubin flex flex-col gap-1">
                  <span className="petunjuk">1. Pesanan</span>
                  <NomorDokumen nomor={p.pesanan.nomor} />
                  <span className="text-[11px] text-slate-500">{tanggalId(p.pesanan.tanggal)} · <LencanaStatus status={p.pesanan.status} /></span>
                </div>
                <div className="ubin flex flex-col gap-1">
                  <span className="petunjuk">2. {teks.sebelumnya}</span>
                  {p.dokumenSebelumnya.length ? (
                    p.dokumenSebelumnya.map((d) => (
                      <span key={d.nomor} className="flex items-center gap-2 text-[12px]">
                        <NomorDokumen nomor={d.nomor} /> <span className="text-slate-400">{tanggalId(d.tanggal)}</span>
                      </span>
                    ))
                  ) : (
                    <span className="text-[12px] text-amber-600 font-medium">Belum ada — faktur boleh mendahului</span>
                  )}
                </div>
                <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-200 flex flex-col gap-1">
                  <span className="petunjuk text-blue-700">3. Faktur (tahap ini)</span>
                  <span className="mono font-bold text-slate-900">{p.nomorBerikut}</span>
                  <span className="text-[11px] text-blue-700">Sedang dibuat</span>
                </div>
              </div>
            </section>
          </div>

          {/* Kanan */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <section className="kartu">
              <div className="kepala-kartu">
                <div className="flex items-center gap-2">
                  <Ikon nama="calculate" className="!text-[20px] text-blue-600" />
                  <h2 className="judul-kartu !text-[15px]">Ringkasan Finansial</h2>
                </div>
                <span className="lencana lencana-slate">Tanpa PPN</span>
              </div>
              <div className="flex flex-col gap-2 text-[13px]">
                <div className="flex justify-between text-slate-500"><span>Subtotal ({hitung.banyakBaris} baris)</span><span className="angka text-slate-900">Rp {format(hitung.subtotal)}</span></div>
                <div className="flex justify-between text-slate-500"><span>Diskon</span><span className="angka text-slate-400">—</span></div>
                <div className="flex justify-between text-slate-500 pt-1 border-t border-dashed border-slate-200"><span className="font-semibold text-slate-900">Dasar Pengenaan Pajak</span><span className="angka font-semibold text-slate-900">Rp {format(hitung.subtotal)}</span></div>
                <div className="flex justify-between text-slate-500"><span>PPN</span><span className="angka text-slate-400">tidak diterapkan</span></div>
                <div className="mt-3 p-3 rounded-lg bg-blue-50/60 border border-blue-100 flex flex-col gap-1">
                  <div className="flex justify-between items-baseline">
                    <span className="teks-label">Total Nilai Tagihan</span>
                    <span className="petunjuk font-bold text-blue-600">Rp</span>
                  </div>
                  <div className="font-mono text-xl font-bold tracking-tight text-slate-900">Rp {format(hitung.subtotal)}</div>
                </div>
              </div>
            </section>

            <section className="kartu">
              <div className="flex items-start justify-between pb-2 mb-2 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Ikon nama="balance" className="!text-[18px] text-blue-600" />
                    <h3 className="text-[13px] font-semibold text-slate-900">Pratinjau Jurnal Otomatis</h3>
                  </div>
                  <span className="petunjuk">Dicatat bersama faktur dalam 1 transaksi</span>
                </div>
                <span className={`lencana ${totalDebit === totalKredit ? "lencana-emerald" : "lencana-rose"}`}>
                  <Ikon nama="done_all" className="!text-[14px]" /> {totalDebit === totalKredit ? "Seimbang" : "Tidak seimbang"}
                </span>
              </div>
              <div className="rounded border border-slate-200 overflow-hidden">
                <table className="tabel-polos text-[11px]">
                  <thead>
                    <tr>
                      <th>Akun</th>
                      <th className="text-right">Debit</th>
                      <th className="text-right">Kredit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {barisJurnalPratinjau.map((r) => (
                      <tr key={r.akun + r.catatan}>
                        <td>
                          <div className="font-semibold text-slate-900">{r.akun}</div>
                          <div className="text-[10px] text-slate-500">{r.catatan}</div>
                        </td>
                        <td className="text-right angka text-emerald-600">{r.debit ? format(r.debit) : "-"}</td>
                        <td className="text-right angka text-rose-600">{r.kredit ? format(r.kredit) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-bold">
                      <td>Total (Σ)</td>
                      <td className="text-right angka text-emerald-600">{format(totalDebit)}</td>
                      <td className="text-right angka text-rose-600">{format(totalKredit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            <section className="kartu">
              <h3 className="text-[13px] font-semibold text-slate-900 flex items-center gap-1.5 mb-3">
                <Ikon nama="shield" className="!text-[18px] text-blue-600" /> Pengaman &amp; Validasi
              </h3>
              <div className="space-y-2 text-[13px]">
                {pengaman.map((g) => (
                  <div key={g.teks} className="flex items-start gap-2 text-slate-700">
                    <Ikon nama={g.ok ? "check_circle" : "cancel"} className={`!text-[18px] mt-px ${g.ok ? "text-emerald-500" : "text-rose-500"}`} />
                    <span>{g.teks}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
