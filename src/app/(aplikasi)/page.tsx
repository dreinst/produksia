import { redirect } from "next/navigation";
import { wajibMasuk } from "@/lib/otentikasi";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import { periksaSinkron } from "@/lib/sinkron";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import Link from "next/link";
import { db } from "@/lib/db";
import Ikon from "@/komponen/ui/Ikon";
import AngkaBergerak from "@/komponen/ui/AngkaBergerak";
import { Suspense } from "react";
import PanelTren, { KerangkaTren } from "@/komponen/beranda/PanelTren";
import ButirKonsistensi, { ButirIntegritas, ButirKonsistensiMemuat } from "@/komponen/beranda/ButirIntegritas";
import { NomorDokumen, LencanaStatus } from "@/komponen/ui/Lencana";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { daftarPerusahaan, lingkupPerusahaan } from "@/lib/perusahaan";
import { akunDalamLingkup, muatDataBerandaKeuangan, urutkanAkunKas } from "@/lib/berandaKeuangan";
import { kalimatIntegritas, pilihTab, tabBeranda } from "@/lib/beranda";
import TabBeranda from "@/komponen/beranda/TabBeranda";
import DasborModul from "@/komponen/beranda/DasborModul";
import BerandaKosong from "@/komponen/beranda/BerandaKosong";

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const NORMAL_DEBIT = new Set(["ASET", "BEBAN"]);

type Terbaru = {
  nomor: string;
  tanggal: Date;
  siapa: string;
  jumlah: number | null;
  status: string;
  perusahaan: { kode: string; nama: string; warna: string | null };
  aksi?: { label: string; href: string; ikon: string };
};

export default async function Beranda({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibMasuk();
  // Gudang murni input/output stok; Beranda (ringkasan keuangan) di luar fokusnya (permintaan pemilik).
  if (pengguna.peran === "GUDANG") redirect("/data-induk/barang");
  // Kru/Guest cuma punya hak Peminjaman Barang; Beranda tidak berguna baginya dan haknya tidak cukup untuk memuat data di halaman ini.
  if (pengguna.peran === "KRU" || pengguna.peran === "GUEST") redirect("/persediaan/peminjaman");
  const boleh = (hak: Hak) => punyaHak(pengguna, hak);
  // Beranda per tab (D7 §3.5): tab ditentukan hak. Tab keuangan hanya bagi pemegang beranda-keuangan.lihat
  // (bawaan Admin, Kasir, Pemilik, Superadmin). Tab lain kembali lebih awal, sebelum kueri keuangan dijalankan.
  const daftarTab = tabBeranda(pengguna);
  const tab = pilihTab(daftarTab, (await searchParams).tab);
  if (tab === null) return <BerandaKosong pengguna={pengguna} />;
  if (tab !== "keuangan") return <DasborModul tab={tab} daftarTab={daftarTab} pengguna={pengguna} />;
  const now = new Date();
  const labelPeriode = now.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  // Lingkup perusahaan (D1 §3.2): gabungan = angka persis seperti sebelum multi perusahaan;
  // satu perusahaan = dokumen, jurnal, stok, dan akun kas disaring perusahaanId.
  const lingkup = await lingkupPerusahaan();
  const lingkupId = lingkup.perusahaanId;
  const gabungan = lingkupId === null;

  const {
    fakturJualBelumLunas,
    fakturBeliBelumLunas,
    daftarAkun,
    agregatAkun,
    daftarStok,
    jumlahBarang,
    daftarAset,
    penawaranDraf,
    pesananAktif,
    pengirimanBulanIni,
    penerimaanBulanIni,
    fakturTerbaru,
    pesananTerbaru,
    penerimaanTerbaru,
    pengirimanTerbaru,
    fakturBeliTerbaru,
    pembayaranTerbaru,
  } = await muatDataBerandaKeuangan(lingkupId, now);

  const [sinkron, pengaturan, permintaanLupa, perusahaanAktif] = await Promise.all([
    // Integritas per lingkup (D1 §4.9): gabungan memanggil periksaSinkron persis seperti sebelumnya
    gabungan ? periksaSinkron(db) : periksaSinkron(db, { perusahaanId: lingkupId }),
    ambilPengaturanPerusahaan(db),
    boleh("pengguna.kelola") ? db.permintaanAturUlang.count({ where: { status: { in: ["MENUNGGU", "TAUTAN"] } } }) : Promise.resolve(0),
    // hanya untuk kalimat Integritas: instalasi satu perusahaan memakai kalimat lama
    gabungan ? Promise.resolve([]) : daftarPerusahaan(),
  ]);

  // ---- KPI 1: Piutang ----
  const barisPiutang = fakturJualBelumLunas.map((i) => ({
    sisa: Number(i.total) - Number(i.uangMuka) - i.penerimaan.reduce((s, r) => s + Number(r.jumlah) + Number(r.potonganPajak), 0) - i.retur.reduce((s, r) => s + Number(r.total), 0),
    overdue: !!i.jatuhTempo && i.jatuhTempo < now,
  }));
  const ar = barisPiutang.reduce((s, r) => s + r.sisa, 0);
  const piutangLewatTempo = barisPiutang.filter((r) => r.overdue).reduce((s, r) => s + r.sisa, 0);

  // ---- KPI 2: Utang ----
  const barisUtang = fakturBeliBelumLunas.map((i) => ({
    sisa: Number(i.total) - i.pembayaran.reduce((s, p) => s + Number(p.jumlah) + Number(p.potonganPajak), 0) - i.retur.reduce((s, r) => s + Number(r.total), 0),
    overdue: !!i.jatuhTempo && i.jatuhTempo < now,
  }));
  const ap = barisUtang.reduce((s, r) => s + r.sisa, 0);
  const jumlahUtangLewatTempo = barisUtang.filter((r) => r.overdue).length;

  // ---- Saldo per akun & KPI 3: Kas & Bank (akun ASET bernama kas/bank) ----
  const jumlahPerAkun = new Map(agregatAkun.map((g) => [g.akunId, { debit: Number(g._sum.debit ?? 0), kredit: Number(g._sum.kredit ?? 0) }]));
  const saldoAkun = daftarAkun.map((a) => {
    const { debit, kredit } = jumlahPerAkun.get(a.id) ?? { debit: 0, kredit: 0 };
    return { ...a, debit, kredit, balance: NORMAL_DEBIT.has(a.jenis) ? debit - kredit : kredit - debit };
  });
  // akun bertanda kas/bank; kalau belum ada yang ditandai, tebak dari nama
  // dalam lingkup satu perusahaan hanya akun kas milik perusahaan itu atau bersama
  const bertanda = saldoAkun.filter((a) => a.kasBank && !a.kelompok && akunDalamLingkup(a, lingkupId));
  const akunKas = bertanda.length > 0 ? bertanda : saldoAkun.filter((a) => a.jenis === "ASET" && !a.kelompok && akunDalamLingkup(a, lingkupId) && /\b(kas|bank)\b/i.test(a.nama));
  const kas = akunKas.reduce((s, a) => s + a.balance, 0);
  // rincian kartu: di lingkup satu perusahaan rekening milik perusahaan itu tampil lebih dulu
  const akunKasTampil = urutkanAkunKas(akunKas, lingkupId);

  // ---- KPI 4: Persediaan ----
  const nilaiPersediaan = daftarStok.reduce((s, st) => s + Number(st.jumlah) * Number(st.barang.hargaBeli), 0);
  const diBawahMinimum = daftarStok.filter((st) => Number(st.barang.stokMinimum) > 0 && Number(st.jumlah) < Number(st.barang.stokMinimum));
  const perGudang = Object.values(
    daftarStok.reduce<Record<string, { nama: string; nilai: number }>>((acc, st) => {
      const k = st.gudangId;
      acc[k] ??= { nama: st.gudang.nama, nilai: 0 };
      acc[k].nilai += Number(st.jumlah) * Number(st.barang.hargaBeli);
      return acc;
    }, {}),
  )
    .sort((a, b) => b.nilai - a.nilai)
    .slice(0, 2);

  // ---- Neraca saldo cepat ----
  const totalDebit = saldoAkun.reduce((s, a) => s + a.debit, 0);
  const totalKredit = saldoAkun.reduce((s, a) => s + a.kredit, 0);
  const jumlahJenis = (t: string) => saldoAkun.filter((a) => a.jenis === t).reduce((s, a) => s + a.balance, 0);
  const labaBerjalan = jumlahJenis("PENDAPATAN") - jumlahJenis("BEBAN");
  const seimbang = Math.abs(totalDebit - totalKredit) < 0.005;

  // ---- Alur dokumen ----
  const totalPenawaran = penawaranDraf.reduce((s, q) => s + Number(q.total), 0);
  const totalPesanan = pesananAktif.reduce((s, o) => s + Number(o.total), 0);
  const totalPenerimaan = penerimaanBulanIni.reduce((s, r) => s + Number(r.jumlah), 0);

  // ---- Peringatan stok: rasio jumlah / min terendah ----
  const peringatan = daftarStok
    .filter((st) => Number(st.barang.stokMinimum) > 0)
    .map((st) => ({ st, ratio: Number(st.jumlah) / Number(st.barang.stokMinimum) }))
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 3);

  // ---- Penyusutan bulan ini ----
  const kunciPeriode = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const periode = new Date(`${kunciPeriode}-01T00:00:00.000Z`);
  const penyusutanBulanan = daftarAset.reduce((s, a) => s + (Number(a.hargaPerolehan) - Number(a.nilaiSisa)) / a.umurBulan, 0);
  const penyusutanTercatat = daftarAset.length > 0 && daftarAset.every((a) => a.penyusutan.some((d) => d.periode.getTime() === periode.getTime()));

  // ---- Transaksi terbaru (gabungan) ----
  const terbaru: Terbaru[] = [
    ...fakturTerbaru.map((d) => ({
      nomor: d.nomor, tanggal: d.tanggal, siapa: d.pelanggan.nama, jumlah: Number(d.total), status: d.status, perusahaan: d.perusahaan,
      aksi: d.status !== "LUNAS" && boleh("penerimaan.buat") ? { label: "Terima bayar", href: `/penjualan/penerimaan/baru?fakturId=${d.id}`, ikon: "payments" } : undefined,
    })),
    ...pesananTerbaru.map((d) => {
      const terkirimSemua = d.baris.every((l) => Number(l.jumlahTerkirim) >= Number(l.jumlah));
      return {
        nomor: d.nomor, tanggal: d.tanggal, siapa: d.pelanggan.nama, jumlah: Number(d.total), status: d.status, perusahaan: d.perusahaan,
        aksi: !terkirimSemua && boleh("pengiriman.buat") ? { label: "Buat SJ", href: `/penjualan/pengiriman/baru?pesananId=${d.id}`, ikon: "local_shipping" } : undefined,
      };
    }),
    ...penerimaanTerbaru.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, siapa: d.pelanggan.nama, jumlah: Number(d.jumlah), status: "TERCATAT", perusahaan: d.perusahaan })),
    ...pengirimanTerbaru.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, siapa: d.pesanan.pelanggan.nama, jumlah: null, status: d.status, perusahaan: d.perusahaan })),
    ...fakturBeliTerbaru.map((d) => ({
      nomor: d.nomor, tanggal: d.tanggal, siapa: d.pemasok.nama, jumlah: Number(d.total), status: d.status, perusahaan: d.perusahaan,
      aksi: d.status !== "LUNAS" && boleh("pembayaran.buat") ? { label: "Bayar", href: `/pembelian/pembayaran/baru?fakturId=${d.id}`, ikon: "payments" } : undefined,
    })),
    ...pembayaranTerbaru.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, siapa: d.pemasok.nama, jumlah: Number(d.jumlah), status: "TERCATAT", perusahaan: d.perusahaan })),
  ]
    .sort((a, b) => b.tanggal.getTime() - a.tanggal.getTime())
    .slice(0, 8);

  const aksiCepat = [
    { href: "/penjualan/pesanan", label: "+ Faktur (FJ)", ikon: "receipt_long", warna: "text-blue-600", hak: "faktur.buat" as Hak },
    { href: "/penjualan/pesanan", label: "+ Pengiriman (SJ)", ikon: "local_shipping", warna: "text-slate-600", hak: "pengiriman.buat" as Hak },
    { href: "/penjualan/faktur", label: "+ Penerimaan (TRM)", ikon: "payments", warna: "text-emerald-600", hak: "penerimaan.buat" as Hak },
    { href: "/kas-bank/masuk", label: "Kas Masuk / Keluar", ikon: "swap_horiz", warna: "text-indigo-600", hak: "kas-masuk.buat" as Hak },
    { href: "/buku-besar/jurnal/baru", label: "+ Jurnal Umum (JU)", ikon: "edit_note", warna: "text-slate-600", hak: "jurnal.buat" as Hak },
  ].filter((q) => boleh(q.hak));

  const tahapan = [
    { kode: "PNW", tanda: "Tahap 1", judul: "Penawaran", nilai: `${penawaranDraf.length} Dokumen`, sub: `Perkiraan ${rp(totalPenawaran)}`, catatan: "Belum memengaruhi buku", titik: "bg-slate-300", nada: "" },
    { kode: "PSJ", tanda: "Tahap 2", judul: "Pesanan Penjualan", nilai: `${pesananAktif.length} Pesanan Aktif`, sub: rp(totalPesanan), catatan: "Reservasi stok", titik: "bg-amber-400", nada: "text-amber-600" },
    { kode: "SJ", tanda: "Fisik Keluar", judul: "Surat Jalan (SJ)", nilai: `${pengirimanBulanIni} Pengiriman`, sub: labelPeriode, catatan: "Kuantitas stok berkurang", titik: "bg-blue-500", nada: "text-blue-700", sorot: true },
    { kode: "FJ", tanda: "Tahap 4", judul: "Faktur Penjualan", nilai: `${fakturJualBelumLunas.length} Faktur Aktif`, sub: `${rp(ar)} Piutang`, catatan: "Jurnal otomatis terbit", titik: "bg-emerald-500", nada: "text-emerald-600" },
    { kode: "TRM", tanda: "Lunas", judul: "Penerimaan Kas", nilai: rp(totalPenerimaan), sub: `${penerimaanBulanIni.length} Transaksi Masuk`, catatan: "Piutang lunas", titik: "bg-emerald-500", nada: "text-emerald-600" },
  ];

  return (
    <div className="space-y-7">
      {daftarTab.length > 1 && <TabBeranda daftar={daftarTab} aktif="keuangan" />}
      {permintaanLupa > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex flex-wrap items-center justify-between gap-2">
          <span><strong>{permintaanLupa} permintaan lupa kata sandi</strong> menunggu ditangani.</span>
          <Link href="/pengaturan/pengguna" className="tombol tombol-kecil tombol-utama">Buka Pengguna</Link>
        </div>
      )}
      {/* Hero */}
      <div className="kartu space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5 mb-1.5 text-xs text-slate-500">
              <span className="lencana lencana-emerald">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Transaksi atomik aktif
              </span>
              <span className="text-slate-400">•</span>
              <span>
                Tahun Buku: <strong className="text-slate-700 font-medium">{pengaturan.tahunBuku}</strong>
              </span>
              <span className="text-slate-400">•</span>
              <span>
                Periode: <strong className="text-slate-700 font-medium">{labelPeriode}</strong>
              </span>
              <span className="text-slate-400">•</span>
              <span>
                Mata Uang: <strong className="text-slate-700 font-medium">Rupiah (Rp)</strong>
              </span>
            </div>
            <h1 className="judul-halaman">Ringkasan Keuangan &amp; Operasional</h1>
            <p className="subjudul-halaman">Ringkasan keuangan dan operasional hari ini.</p>
          </div>
          {boleh("buku-besar.lihat") && (
            <Link href="/buku-besar/neraca-saldo" className="tombol tombol-lembut self-start md:self-center">
              <Ikon nama="balance" className="!text-[18px] text-slate-500" />
              Cek Neraca Saldo
            </Link>
          )}
        </div>
        <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 teks-label">
            <Ikon nama="bolt" className="!text-[18px] text-slate-400" />
            Aksi Cepat
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {aksiCepat.map((q) => (
              <Link key={q.label} href={q.href} className="tombol tombol-lembut tombol-kecil font-medium">
                <Ikon nama={q.ikon} className={`!text-[18px] ${q.warna}`} />
                {q.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Ringkasan angka */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Ringkasan
          judul="Piutang Usaha"
          ikon="receipt_long"
          lencana={{ teks: `${fakturJualBelumLunas.length} Faktur`, cls: fakturJualBelumLunas.length ? "lencana-amber" : "lencana-emerald" }}
          nilai={ar}
          catatan="Faktur penjualan belum lunas"
          isian={[
            { k: "Lancar", v: rp(ar - piutangLewatTempo) },
            { k: "Lewat jatuh tempo", v: rp(piutangLewatTempo), cls: piutangLewatTempo > 0 ? "text-rose-600" : "" },
          ]}
        />
        <Ringkasan
          judul="Utang Usaha"
          ikon="request_quote"
          lencana={{ teks: jumlahUtangLewatTempo ? `${jumlahUtangLewatTempo} Faktur Tempo` : `${fakturBeliBelumLunas.length} Faktur`, cls: jumlahUtangLewatTempo ? "lencana-amber" : "lencana-slate" }}
          nilai={ap}
          catatan="Faktur pembelian belum lunas"
          isian={[
            { k: "Faktur aktif", v: `${fakturBeliBelumLunas.length}` },
            { k: "Lewat jatuh tempo", v: `${jumlahUtangLewatTempo}`, cls: jumlahUtangLewatTempo ? "text-rose-600" : "" },
          ]}
        />
        <Ringkasan
          judul="Kas & Bank Tersedia"
          ikon="account_balance"
          lencana={{ teks: `${akunKas.length} Akun`, cls: "lencana-blue" }}
          nilai={kas}
          catatan={akunKasTampil.map((a) => a.nama).join(" + ") || "Belum ada akun kas/bank"}
          isian={akunKasTampil.slice(0, 2).map((a) => ({ k: a.nama, v: rp(a.balance) }))}
        />
        <Ringkasan
          judul="Nilai Persediaan"
          ikon="inventory_2"
          lencana={{ teks: `${jumlahBarang} Barang`, cls: "lencana-slate" }}
          nilai={nilaiPersediaan}
          catatan="Σ jumlah × harga pokok, semua gudang"
          isian={[
            ...perGudang.map((w) => ({ k: w.nama, v: rp(w.nilai) })),
            ...(diBawahMinimum.length ? [{ k: "Di bawah stok minimum", v: `${diBawahMinimum.length} Barang`, cls: "text-amber-600" }] : []),
          ].slice(0, 2)}
        />
      </div>

      {/* Alur dokumen */}
      <div className="kartu">
        <div className="kepala-kartu">
          <div>
            <h2 className="judul-kartu">Alur Transaksi &amp; Dokumen Terintegrasi</h2>
            <p className="kartu-subjudul">Alur penjualan: pesanan, surat jalan, faktur, penerimaan.</p>
          </div>
          <span className="text-xs text-slate-500 font-medium bg-slate-50 px-3 py-1 rounded-lg border border-slate-100 whitespace-nowrap">
            Stok terpotong di SJ • Jurnal di FJ &amp; TRM
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          {tahapan.map((s) => (
            <div key={s.kode} className={`ubin-alur p-3.5 rounded-xl border ${s.sorot ? "bg-blue-50/40 border-blue-100" : "bg-slate-50/70 border-slate-100"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-bold font-mono ${s.sorot ? "text-blue-700" : "text-slate-700"}`}>{s.kode}</span>
                <span className={`text-[11px] ${s.sorot ? "font-semibold text-blue-600" : "text-slate-400"}`}>{s.tanda}</span>
              </div>
              <div className="text-xs font-semibold text-slate-900">{s.judul}</div>
              <div className="text-sm font-bold text-slate-800 mt-1 angka">{s.nilai}</div>
              <div className="text-[11px] text-slate-400 mt-0.5 angka">{s.sub}</div>
              <div className={`text-[10px] mt-3 flex items-center gap-1 ${s.nada || "text-slate-400"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${s.titik}`} /> {s.catatan}
              </div>
            </div>
          ))}
        </div>
      </div>

      {boleh("buku-besar.lihat") && (
        <Suspense key={lingkupId ?? "semua"} fallback={<KerangkaTren />}>
          <PanelTren tahun={pengaturan.tahunBuku} perusahaanId={lingkupId} />
        </Suspense>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 daftarBarang-awal">
        {/* Kiri */}
        <div className="lg:col-span-8 space-y-7">
          <div className="kartu kartu-tabel">
            <div className="kepala-kartu">
              <div>
                <h2 className="judul-kartu">Transaksi Terbaru &amp; Status</h2>
                <p className="kartu-subjudul">Gabungan faktur, pesanan, pengiriman, penerimaan, dan pembayaran terakhir</p>
              </div>
              <Link href="/cari?q=2026" className="tombol tombol-lembut tombol-kecil">
                <Ikon nama="search" className="!text-[16px]" /> Cari dokumen
              </Link>
            </div>
            <div className="bungkus-tabel">
              <table className="tabel min-w-[40rem]">
                <thead>
                  <tr>
                    <th>No Dokumen</th>
                    {gabungan && <th>Perusahaan</th>}
                    <th>Tanggal</th>
                    <th>Rekanan</th>
                    <th className="text-right">Nilai</th>
                    <th className="text-center">Status</th>
                    <th className="text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {terbaru.map((r) => (
                    <tr key={r.nomor}>
                      <td><NomorDokumen nomor={r.nomor} /></td>
                      {gabungan && <td><LencanaPerusahaan kode={r.perusahaan.kode} warna={r.perusahaan.warna} nama={r.perusahaan.nama} /></td>}
                      <td className="text-slate-500 whitespace-nowrap">{r.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                      <td className="font-medium text-slate-900">{r.siapa}</td>
                      <td className="text-right angka font-semibold text-slate-900">{r.jumlah === null ? "-" : r.jumlah.toLocaleString("id-ID")}</td>
                      <td className="text-center"><LencanaStatus status={r.status} /></td>
                      <td className="text-center">
                        {r.aksi ? (
                          <Link href={r.aksi.href} title={r.aksi.label} className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700">
                            <Ikon nama={r.aksi.ikon} className="!text-[18px]" />
                            <span className="text-[11px] font-semibold">{r.aksi.label}</span>
                          </Link>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {terbaru.length === 0 && (
                    <tr>
                      <td colSpan={gabungan ? 7 : 6} className="kosong">Belum ada transaksi.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="kartu space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="judul-kartu">Buku Besar &amp; Neraca Saldo Cepat</h2>
                <p className="kartu-subjudul">Total debit dan kredit seluruh jurnal</p>
              </div>
              <span className={`lencana ${seimbang ? "lencana-emerald" : "lencana-rose"}`}>
                <Ikon nama={seimbang ? "check_circle" : "error"} className="!text-[14px]" />
                {seimbang ? "Seimbang (Σ Debit = Σ Kredit)" : "Tidak seimbang. Periksa jurnal"}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="ubin">
                <div className="text-xs font-medium text-slate-500">Total Aset (1-xxxx)</div>
                <div className="text-lg font-bold text-slate-900 mt-1 angka">{rp(jumlahJenis("ASET"))}</div>
                <div className="text-[11px] text-emerald-600 mt-1 font-medium">Posisi normal: Debit</div>
              </div>
              <div className="ubin">
                <div className="text-xs font-medium text-slate-500">Total Kewajiban (2-xxxx)</div>
                <div className="text-lg font-bold text-slate-900 mt-1 angka">{rp(jumlahJenis("KEWAJIBAN"))}</div>
                <div className="text-[11px] text-slate-500 mt-1 font-medium">Posisi normal: Kredit</div>
              </div>
              <div className="ubin">
                <div className="text-xs font-medium text-slate-500">Modal + Laba Berjalan</div>
                <div className="text-lg font-bold text-slate-900 mt-1 angka">{rp(jumlahJenis("MODAL") + labaBerjalan)}</div>
                <div className={`text-[11px] mt-1 font-medium ${labaBerjalan >= 0 ? "text-blue-600" : "text-rose-600"}`}>
                  Laba berjalan {rp(labaBerjalan)}
                </div>
              </div>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/60 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <span className="text-xs font-semibold text-slate-800">Total Mutasi Buku Besar</span>
                <p className="text-[11px] text-slate-500 mt-0.5">Seluruh ayat jurnal (manual, kas, penjualan, pembelian, penyusutan).</p>
              </div>
              <div className="flex items-center gap-6 bg-white px-5 py-2.5 rounded-lg border border-slate-200/60">
                <div>
                  <span className="block teks-label">Total Debit</span>
                  <span className="text-sm font-bold text-slate-900 angka">{rp(totalDebit)}</span>
                </div>
                <div className="w-px h-7 bg-slate-200" />
                <div>
                  <span className="block teks-label">Total Kredit</span>
                  <span className="text-sm font-bold text-slate-900 angka">{rp(totalKredit)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Kanan */}
        <div className="lg:col-span-4 space-y-7">
          <div className="kartu space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Peringatan Stok Minimum</h3>
                <p className="text-xs text-slate-500 mt-0.5">Barang mendekati / di bawah ambang</p>
              </div>
              <span className={`lencana ${diBawahMinimum.length ? "lencana-rose" : "lencana-emerald"}`}>
                {diBawahMinimum.length ? `${diBawahMinimum.length} Perlu Reorder` : "Aman"}
              </span>
            </div>
            <div className="space-y-3">
              {peringatan.map(({ st, ratio }) => {
                const nada = ratio < 1 ? "rose" : ratio < 1.5 ? "amber" : "emerald";
                const wrap = nada === "rose" ? "bg-rose-50/40 border-rose-100/70" : nada === "amber" ? "bg-amber-50/40 border-amber-100/70" : "bg-slate-50/70 border-slate-100";
                const bar = nada === "rose" ? "bg-rose-500" : nada === "amber" ? "bg-amber-500" : "bg-emerald-500";
                const txt = nada === "rose" ? "text-rose-600" : nada === "amber" ? "text-amber-600" : "text-emerald-600";
                const diff = Number(st.jumlah) - Number(st.barang.stokMinimum);
                return (
                  <div key={`${st.barangId}-${st.gudangId}`} className={`p-3 rounded-xl border space-y-2 ${wrap}`}>
                    <div className="flex justify-between daftarBarang-awal gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">{st.barang.nama}</div>
                        <div className="text-[11px] text-slate-400 font-medium">{st.gudang.nama}</div>
                      </div>
                      <span className={`text-[11px] font-semibold angka whitespace-nowrap ${txt}`}>
                        {Number(st.jumlah).toLocaleString("id-ID")} {st.barang.satuan}
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div className={`${bar} h-full rounded-full`} style={{ width: `${Math.min(100, Math.round((ratio / 2) * 100))}%` }} />
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Min: {Number(st.barang.stokMinimum).toLocaleString("id-ID")} {st.barang.satuan}</span>
                      <span className={`font-medium ${txt}`}>{diff >= 0 ? `+${diff.toLocaleString("id-ID")} di atas min` : `Defisit ${diff.toLocaleString("id-ID")}`}</span>
                    </div>
                  </div>
                );
              })}
              {peringatan.length === 0 && <p className="text-sm text-slate-400">Belum ada barang dengan stok minimum.</p>}
            </div>
            {boleh("pesanan-pembelian.buat") && (
              <Link href="/pembelian/pesanan/baru" className="tombol tombol-utama w-full">
                <Ikon nama="shopping_cart" className="!text-[18px]" /> + Buat Pesanan Pembelian (PSB)
              </Link>
            )}
          </div>

          <div className="kartu space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Penyusutan Aset Tetap</h3>
                <p className="text-xs text-slate-500 mt-0.5">Garis lurus (straight-baris) per bulan</p>
              </div>
              <span className="lencana lencana-slate">{now.toLocaleDateString("id-ID", { month: "short", year: "numeric" })}</span>
            </div>
            <div className="ubin space-y-2 text-xs">
              <div className="flex justify-between items-center text-slate-500">
                <span>Status periode ini</span>
                <span className={`font-semibold ${penyusutanTercatat ? "text-emerald-600" : "text-amber-600"}`}>{daftarAset.length === 0 ? "Belum ada aset" : penyusutanTercatat ? "Sudah dicatat" : "Belum dicatat"}</span>
              </div>
              <div className="flex justify-between items-center text-slate-500">
                <span>Estimasi beban bulan ini</span>
                <span className="font-bold text-slate-900 angka">{rp(Math.round(penyusutanBulanan))}</span>
              </div>
              <div className="flex justify-between items-center text-slate-500">
                <span>Aset aktif</span>
                <span className="font-medium text-slate-800">{daftarAset.length} Unit</span>
              </div>
            </div>
            {boleh("aset.lihat") && (
              <Link href="/aset-tetap/penyusutan" className={`tombol w-full ${penyusutanTercatat ? "tombol-garis" : "tombol-aksen"}`}>
                <Ikon nama={penyusutanTercatat ? "check_circle" : "play_arrow"} className="!text-[18px]" />
                {penyusutanTercatat || !boleh("penyusutan.buat") ? "Lihat Riwayat Penyusutan" : "Catat Jurnal Penyusutan (JU-PNY)"}
              </Link>
            )}
          </div>

          <div className="panel-navy rounded-2xl text-slate-300 p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-white">
              <Ikon nama="verified_user" className="!text-[22px] text-blue-400" />
              <h3 className="text-sm font-bold">Integritas &amp; Sinkronisasi</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {kalimatIntegritas({ perusahaanId: lingkupId, nama: lingkup.perusahaan?.nama ?? null }, perusahaanAktif.map((p) => p.id))}
            </p>
            <div className="space-y-3 text-xs">
              {[
                { t: "Jurnal seimbang", ok: sinkron.seimbang, d: `Σ debit ${rp(Number(sinkron.totalDebit))} · Σ kredit ${rp(Number(sinkron.totalKredit))}` },
                { t: "Persediaan = stok fisik × harga pokok", ok: sinkron.persediaan.sinkron, d: `Buku besar ${rp(Number(sinkron.persediaan.bukuBesar))} · stok ${rp(Number(sinkron.persediaan.dokumen))}` },
                { t: "Piutang = sisa faktur penjualan", ok: sinkron.piutang.sinkron, d: `Buku besar ${rp(Number(sinkron.piutang.bukuBesar))} · dokumen ${rp(Number(sinkron.piutang.dokumen))}` },
                { t: "Hutang = sisa faktur pembelian", ok: sinkron.hutang.sinkron, d: `Buku besar ${rp(Number(sinkron.hutang.bukuBesar))} · dokumen ${rp(Number(sinkron.hutang.dokumen))}` },
                { t: "Barang diterima belum ditagih", ok: sinkron.barangBelumDitagih.sinkron, d: `Buku besar ${rp(Number(sinkron.barangBelumDitagih.bukuBesar))} · TB belum difaktur ${rp(Number(sinkron.barangBelumDitagih.dokumen))}` },
                { t: "Barang terkirim belum ditagih", ok: sinkron.barangTerkirim.sinkron, d: `Buku besar ${rp(Number(sinkron.barangTerkirim.bukuBesar))} · SJ belum difaktur ${rp(Number(sinkron.barangTerkirim.dokumen))}` },
                { t: "Uang muka pelanggan = DP belum dipakai", ok: sinkron.uangMuka.sinkron, d: `Buku besar ${rp(Number(sinkron.uangMuka.bukuBesar))} · DP belum dipakai ${rp(Number(sinkron.uangMuka.dokumen))}` },
                { t: "Hutang mitra proyek = talangan − pengembalian modal", ok: sinkron.hutangMitra.sinkron, d: `Buku besar ${rp(Number(sinkron.hutangMitra.bukuBesar))} · talangan belum dikembalikan ${rp(Number(sinkron.hutangMitra.dokumen))}` },
              ].map(({ t, ok, d }) => (
                <ButirIntegritas key={t} t={t} ok={ok} d={d} />
              ))}
              {/* gabungan juga memeriksa bahwa jurnal, dokumen, dan rujukannya tidak tercampur antar perusahaan (D1 §8.4);
                  kuerinya berat, jadi dimuat terpisah dan disimpan 60 detik (tinjauan P14 S1) */}
              {gabungan && (
                <Suspense fallback={<ButirKonsistensiMemuat />}>
                  <ButirKonsistensi />
                </Suspense>
              )}
              <ButirIntegritas t="DB constraint CHECK (jumlah ≥ 0)" ok d="PostgreSQL menolak stok negatif walau dua pengiriman terjadi bersamaan." />
            </div>
            <div className="pt-3 border-t border-slate-800 flex justify-between items-center text-[11px] text-slate-400 font-mono">
              <span>PostgreSQL 18 • Prisma 7</span>
              <span className={seimbang ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>{seimbang ? "Buku besar seimbang" : "Buku besar tidak seimbang"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Ringkasan({
  judul,
  lencana,
  nilai,
  ikon,
  catatan,
  isian,
}: {
  judul: string;
  lencana: { teks: string; cls: string };
  nilai: number;
  ikon: string;
  catatan: string;
  isian: { k: string; v: string; cls?: string }[];
}) {
  return (
    <div className="kartu kartu-statistik p-5 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-3 gap-2">
          <span className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <span className="ubin-ikon"><Ikon nama={ikon} className="!text-[16px]" /></span>
            {judul}
          </span>
          <span className={`lencana ${lencana.cls}`}>{lencana.teks}</span>
        </div>
        <div className="font-heading text-2xl font-bold tracking-tight text-slate-900 angka"><AngkaBergerak nilai={nilai} /></div>
        <div className="text-[11px] text-slate-400 mt-1 font-mono truncate">{catatan}</div>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-100 text-xs space-y-1.5">
        {isian.map((r) => (
          <div key={r.k} className="flex justify-between items-center gap-2 text-slate-600">
            <span className="text-[11px] truncate">{r.k}</span>
            <span className={`font-medium angka whitespace-nowrap ${r.cls ?? "text-slate-800"}`}>{r.v}</span>
          </div>
        ))}
        {isian.length === 0 && <div className="text-[11px] text-slate-400">-</div>}
      </div>
    </div>
  );
}
