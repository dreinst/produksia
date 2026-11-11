import "dotenv/config";
// Skrip ini memanggil aksi, pustaka, dan halaman beranda di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { db } from "../src/lib/db";
import type { Prisma } from "../src/prisma-klien/client";
import { D, jumlahkan, type Desimal } from "../src/lib/uang";
import { PERUSAHAAN_UTAMA } from "../src/lib/perusahaan";
import { bacaPeriode, hitungLabaRugi, hitungNeraca, saldoAkunPeriode } from "../src/lib/laporan";
import { hitungArusKas } from "../src/lib/arusKas";
import { labaRugiKas } from "../src/lib/basisKas";
import { ringkasanPendapatan } from "../src/lib/laporanPendapatan";
import { hitungLaporanPrive } from "../src/lib/laporanPrive";
import { laporanHutang, laporanPerubahanModal, laporanPiutang, type LaporanUmur } from "../src/lib/laporanRekanan";
import { lupakanKonsistensiTersimpan, periksaKonsistensiPerusahaan, periksaSinkron, TABEL_ENTITAS_BERKAS, type HasilKonsistensi, type HasilSinkron, type KodeKonsistensi } from "../src/lib/sinkron";
import { DAFTAR_JENIS } from "../src/lib/berkas";
import { buatPesananPembelian, buatPenerimaanBarang, buatFakturPembelian, buatPembayaranPembelian } from "../src/lib/aksi/pembelian";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import { buatJurnalManual, buatKasKeluar, buatKasMasuk } from "../src/lib/aksi/jurnal";
import { buatPrive } from "../src/lib/aksi/prive";
import { buatFaktur, buatPesanan } from "../src/lib/aksi/penjualan";
import { hapusDokumen, type JenisDokumen } from "../src/lib/aksi/hapusDokumen";
import Beranda from "../src/app/(aplikasi)/page";
import AngkaBergerak from "../src/komponen/ui/AngkaBergerak";
import ButirKonsistensi from "../src/komponen/beranda/ButirIntegritas";
import { aturPersetujuan, formulir, jalankan, pastikan } from "./bantuan";

/*
 * Uji laporan per perusahaan dan konsistensi perusahaan (P14, D1 §4.6, §4.8, §4.9, §9.1 kasus 24 sampai 28).
 * Data perusahaan uji UJILP dibuat lewat aksi P13 (penyesuaian, pembelian, kas, jurnal manual, prive) dan jurnal
 * langsung, ditambah pesanan dan faktur jasa yang dibuat lewat aksi penjualan lama (masih di utama sampai P23) lalu
 * dipindah ke perusahaan uji beserta jurnalnya. Diuji:
 * - kasus 24: Neraca, Arus Kas, dan Σ debit = Σ kredit seimbang per perusahaan;
 * - kasus 25: saldo setiap akun gabungan = jumlah per perusahaan;
 * - setiap fungsi laporan: gabungan = jumlah per perusahaan, tanpa opsi = opsi kosong, angka utama tidak berubah oleh
 *   data perusahaan lain, dan angka perusahaan uji sesuai data;
 * - kasus 26 dan 27: periksaSinkron perusahaan uji cocok dan utama tidak berubah;
 * - kasus 28: periksaKonsistensiPerusahaan nol pada data bersih, dan setiap kode menemukan pelanggaran yang dibuat
 *   sengaja di transaksi yang dibatalkan;
 * - kartu Integritas beranda: butir konsistensi hanya di gabungan, ikut merah bila ada pelanggaran.
 * Data uji dihapus di awal dan akhir (juga saat galat); periksaSinkron(db) sama dengan sebelum uji.
 */

const KODE = "UJILP";
const awalUji = new Date();
/** Nomor dokumen yang dibuat atau dihapus selama uji; lognya dibersihkan di akhir. */
const nomorLog: string[] = [];
const json = (x: unknown) => JSON.stringify(x);

/** Menjalankan fn dengan UJI_PERUSAHAAN dan UJI_PERAN sementara; "semua" = gabungan. */
async function dengan<T>(isian: { perusahaan?: string; peran?: string }, fn: () => Promise<T>): Promise<T> {
  const lama = { perusahaan: process.env.UJI_PERUSAHAAN, peran: process.env.UJI_PERAN };
  const atur = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  atur("UJI_PERUSAHAAN", isian.perusahaan);
  atur("UJI_PERAN", isian.peran);
  try {
    return await fn();
  } finally {
    atur("UJI_PERUSAHAAN", lama.perusahaan);
    atur("UJI_PERAN", lama.peran);
  }
}

class Batal extends Error {}
/** Menjalankan fn di dalam transaksi lalu membatalkannya; mengembalikan hasil fn (perubahan tidak tersimpan). */
async function dalamTxBatal<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let hasil: T | undefined;
  try {
    await db.$transaction(async (tx) => {
      hasil = await fn(tx);
      throw new Batal();
    }, { timeout: 30_000 });
  } catch (e) {
    if (!(e instanceof Batal)) throw e;
  }
  return hasil as T;
}

/** Menjalankan komponen server (termasuk async) secara rekursif dan mengumpulkan teksnya. */
async function render(node: ReactNode): Promise<string> {
  const teks: string[] = [];
  const jalan = async (n: ReactNode | Promise<ReactNode>): Promise<void> => {
    const v = await n;
    if (v === null || v === undefined || typeof v === "boolean") return;
    if (typeof v === "string" || typeof v === "number") return void teks.push(String(v));
    if (Array.isArray(v)) {
      for (const x of v) await jalan(x);
      return;
    }
    if (!isValidElement(v)) return;
    const el = v as ReactElement<Record<string, unknown>>;
    if (el.type === Link) return jalan(el.props.children as ReactNode);
    if (el.type === AngkaBergerak) return void teks.push(`Rp ${Number(el.props.nilai).toLocaleString("id-ID")}`);
    if (typeof el.type === "function") return jalan((el.type as (p: unknown) => ReactNode | Promise<ReactNode>)(el.props));
    return jalan(el.props.children as ReactNode);
  };
  await jalan(node);
  return teks.join("");
}
function potong(teks: string, dari: string, sampai: string): string {
  const i = teks.indexOf(dari);
  if (i < 0) return "";
  const j = teks.indexOf(sampai, i + dari.length);
  return teks.slice(i, j < 0 ? undefined : j);
}
const integritas = (peran: string, perusahaan: string) =>
  dengan({ perusahaan, peran }, async () => potong(await render(await Beranda({ searchParams: Promise.resolve({ tab: "keuangan" }) })), "Integritas & Sinkronisasi", "PostgreSQL 18"));

const BUTIR = ["persediaan", "piutang", "hutang", "barangBelumDitagih", "barangTerkirim", "uangMuka"] as const;
const semuaCocok = (s: HasilSinkron) => s.seimbang && BUTIR.every((b) => s[b].sinkron);
const jumlahDari = <T,>(daftar: T[], ambil: (x: T) => Desimal) => jumlahkan(daftar.map(ambil));
const ringkasUmur = (l: LaporanUmur) => ({ total: l.total.toFixed(2), jumlahFaktur: l.jumlahFaktur, perKeranjang: l.perKeranjang.map((x) => x.toFixed(2)) });

async function hapusSemua(jenis: JenisDokumen, daftar: { id: string; nomor: string }[]) {
  for (const d of daftar) {
    nomorLog.push(d.nomor);
    await jalankan(`hapus ${d.nomor}`, () => hapusDokumen(jenis, d.id));
  }
}

async function bersihkanData() {
  const pt = await db.perusahaan.findUnique({ where: { kode: KODE }, select: { id: true } });
  const barangUji = (await db.barang.findMany({ where: { kode: { startsWith: `${KODE}-` } }, select: { id: true } })).map((b) => b.id);
  const akunUji = (await db.akun.findMany({ where: { kode: { startsWith: `${KODE}-` } }, select: { id: true } })).map((a) => a.id);
  const pemasok = { pemasok: { kode: { startsWith: `${KODE}-` } } };
  const pelanggan = { pelanggan: { kode: { startsWith: `${KODE}-` } } };
  const urut = { orderBy: { nomor: "desc" as const }, select: { id: true, nomor: true } };
  await hapusSemua("pembayaran", await db.pembayaranPembelian.findMany({ where: pemasok, ...urut }));
  await hapusSemua("fakturPembelian", await db.fakturPembelian.findMany({ where: pemasok, ...urut }));
  await hapusSemua("penerimaanBarang", await db.penerimaanBarang.findMany({ where: { pesanan: pemasok }, ...urut }));
  await hapusSemua("pesananPembelian", await db.pesananPembelian.findMany({ where: pemasok, ...urut }));
  await hapusSemua("faktur", await db.fakturPenjualan.findMany({ where: pelanggan, ...urut }));
  await hapusSemua("pesanan", await db.pesananPenjualan.findMany({ where: pelanggan, ...urut }));
  await hapusSemua("prive", await db.prive.findMany({ where: { akunKasId: { in: akunUji } }, ...urut }));
  await hapusSemua("jurnal", await db.jurnal.findMany({ where: { sumber: { in: ["MANUAL", "KAS_MASUK", "KAS_KELUAR"] }, baris: { some: { akunId: { in: akunUji } } } }, ...urut }));
  await hapusSemua("penyesuaian", await db.penyesuaianPersediaan.findMany({ where: { baris: { some: { barangId: { in: barangUji } } } }, ...urut }));
  await db.stokBarang.deleteMany({ where: { barangId: { in: barangUji } } });
  await db.barang.deleteMany({ where: { id: { in: barangUji } } });
  await db.gudang.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  await db.pemasok.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  await db.pelanggan.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  if (pt) {
    await db.pengaturanPerusahaan.deleteMany({ where: { perusahaanId: pt.id } });
    await db.perusahaan.delete({ where: { id: pt.id } });
  }
  await db.logAktivitas.deleteMany({ where: { OR: [{ nomor: { startsWith: `${KODE}-` } }, { nomor: { in: nomorLog }, waktu: { gte: awalUji } }] } });
}

/** Hasil semua fungsi laporan untuk satu lingkup (undefined = tanpa argumen perusahaan, perilaku lama). */
async function semuaLaporan(perusahaanId: string | undefined, periode: ReturnType<typeof bacaPeriode>) {
  const o = perusahaanId ? { perusahaanId } : undefined;
  const sebelum = new Date(periode.dari.getTime() - 1);
  const [neraca, neracaAwal, arus, pendapatan, prive, piutang, hutang, labaRugi, kas] = await Promise.all([
    o ? hitungNeraca(db, periode.sampai, periode.sampaiTeks, o) : hitungNeraca(db, periode.sampai, periode.sampaiTeks),
    o ? hitungNeraca(db, sebelum, periode.dariTeks, o) : hitungNeraca(db, sebelum, periode.dariTeks),
    o ? hitungArusKas(db, periode, o) : hitungArusKas(db, periode),
    o ? ringkasanPendapatan(db, periode, o) : ringkasanPendapatan(db, periode),
    o ? hitungLaporanPrive(db, periode.dari, periode.sampai, perusahaanId) : hitungLaporanPrive(db, periode.dari, periode.sampai),
    o ? laporanPiutang(db, periode.sampai, perusahaanId) : laporanPiutang(db, periode.sampai),
    o ? laporanHutang(db, periode.sampai, perusahaanId) : laporanHutang(db, periode.sampai),
    o ? hitungLabaRugi(db, periode, o) : hitungLabaRugi(db, periode),
    o ? labaRugiKas(db, periode, o) : labaRugiKas(db, periode),
  ]);
  const modal = o
    ? await laporanPerubahanModal(db, periode.dari, periode.sampai, labaRugi.labaBersih, neracaAwal.totalEkuitas, neraca.totalEkuitas, perusahaanId)
    : await laporanPerubahanModal(db, periode.dari, periode.sampai, labaRugi.labaBersih, neracaAwal.totalEkuitas, neraca.totalEkuitas);
  return { neraca, arus, pendapatan, prive, piutang, hutang, labaRugi, kas, modal };
}
type Laporan = Awaited<ReturnType<typeof semuaLaporan>>;

/** Angka pokok tiap laporan, untuk penjumlahan per perusahaan. */
function angkaPokok(l: Laporan): Record<string, Desimal> {
  return {
    "neraca.totalAset": l.neraca.totalAset,
    "neraca.totalKewajiban": l.neraca.totalKewajiban,
    "neraca.totalEkuitasAkun": l.neraca.totalEkuitasAkun,
    "neraca.labaDitahan": l.neraca.labaDitahan,
    "neraca.labaBerjalan": l.neraca.labaBerjalan,
    "neraca.totalPasiva": l.neraca.totalPasiva,
    "arus.kasAwal": l.arus.kasAwal,
    "arus.totalOperasi": l.arus.totalOperasi,
    "arus.totalInvestasi": l.arus.totalInvestasi,
    "arus.totalPendanaan": l.arus.totalPendanaan,
    "arus.kasAkhirBukuBesar": l.arus.kasAkhirBukuBesar,
    "arus.jumlahJurnal": D(l.arus.jumlahJurnal),
    "pendapatan.total": l.pendapatan.total,
    "pendapatan.jumlahFaktur": D(l.pendapatan.jumlahFaktur),
    "prive.total": D(l.prive.total),
    "prive.jumlah": D(l.prive.rincian.length),
    "piutang.total": l.piutang.total,
    "piutang.jumlahFaktur": D(l.piutang.jumlahFaktur),
    ...Object.fromEntries(l.piutang.perKeranjang.map((x, i) => [`piutang.keranjang${i}`, x])),
    "hutang.total": l.hutang.total,
    "hutang.jumlahFaktur": D(l.hutang.jumlahFaktur),
    ...Object.fromEntries(l.hutang.perKeranjang.map((x, i) => [`hutang.keranjang${i}`, x])),
    "labaRugi.labaBersih": l.labaRugi.labaBersih,
    "kas.surplus": l.kas.surplus,
    "modal.setoranModal": l.modal.setoranModal,
    "modal.prive": l.modal.prive,
    "modal.lainnya": l.modal.lainnya,
  };
}

async function main() {
  await bersihkanData();
  aturPersetujuan(false);
  const awalHakAksesPeran = await db.hakAksesPeran.count();
  const jumlahJurnalAwal = await db.jurnal.count();
  const periode = bacaPeriode({});
  const sinkronAwal = await periksaSinkron(db);
  pastikan(sinkronAwal.seimbang, "buku besar seimbang sebelum uji");

  console.log("=== 1. Tanpa opsi = opsi kosong, dan konsistensi pada data bersih ===");
  const lamaGabungan = await semuaLaporan(undefined, periode);
  pastikan(json(lamaGabungan.neraca) === json(await hitungNeraca(db, periode.sampai, periode.sampaiTeks, {})) && json(lamaGabungan.neraca) === json(await hitungNeraca(db, periode.sampai, periode.sampaiTeks, { perusahaanId: null })), "hitungNeraca tanpa opsi = opsi kosong = perusahaan null");
  pastikan(json(lamaGabungan.arus) === json(await hitungArusKas(db, periode, {})) && json(lamaGabungan.arus) === json(await hitungArusKas(db, periode, { perusahaanId: null })), "hitungArusKas tanpa opsi = opsi kosong = perusahaan null");
  pastikan(json(lamaGabungan.pendapatan) === json(await ringkasanPendapatan(db, periode, {})), "ringkasanPendapatan tanpa opsi = opsi kosong");
  pastikan(json(lamaGabungan.prive) === json(await hitungLaporanPrive(db, periode.dari, periode.sampai, null)), "hitungLaporanPrive tanpa perusahaan = null");
  pastikan(json(lamaGabungan.piutang) === json(await laporanPiutang(db, periode.sampai, null)) && json(lamaGabungan.hutang) === json(await laporanHutang(db, periode.sampai, undefined)), "laporanPiutang dan laporanHutang tanpa perusahaan = null/undefined");
  pastikan(
    json(lamaGabungan.modal) === json(await laporanPerubahanModal(db, periode.dari, periode.sampai, lamaGabungan.labaRugi.labaBersih, lamaGabungan.modal.ekuitasAwal, lamaGabungan.neraca.totalEkuitas, null)),
    "laporanPerubahanModal tanpa perusahaan = null",
  );
  pastikan(lamaGabungan.piutang.kelompok.every((k) => k.faktur.every((f) => typeof f.perusahaanId === "string")), "baris umur piutang membawa perusahaanId faktur (lencana di gabungan)");
  const lamaUtama = await semuaLaporan(PERUSAHAAN_UTAMA, periode);
  const sinkronUtamaAwal = await periksaSinkron(db, { perusahaanId: PERUSAHAAN_UTAMA });
  const konsistensiAwal = await periksaKonsistensiPerusahaan(db);
  pastikan(konsistensiAwal.konsisten && konsistensiAwal.total === 0 && konsistensiAwal.rincian.length === 10, `periksaKonsistensiPerusahaan pada data bersih: 0 pelanggaran di 10 kode (${konsistensiAwal.rincian.map((r) => `${r.kode} ${r.jumlah}`).join(", ")})`);
  pastikan(json(konsistensiAwal) === json(await periksaKonsistensiPerusahaan()), "periksaKonsistensiPerusahaan tanpa klien memakai db");
  const jenisTanpaTabel = DAFTAR_JENIS.filter((j) => !TABEL_ENTITAS_BERKAS[j]);
  pastikan(jenisTanpaTabel.length === 0, `setiap jenis lampiran berkas punya tabel entitas di pemeriksaan konsistensi (${jenisTanpaTabel.join(", ") || "lengkap"})`);

  console.log("=== 2. Data perusahaan uji lewat aksi P13 dan jurnal langsung ===");
  const pt = await db.perusahaan.create({ data: { kode: KODE, nama: "PT Uji Laporan Perusahaan", urutan: 95 } });
  const U = pt.id;
  const akunBaru = (kode: string, nama: string, jenis: "ASET" | "BEBAN" | "MODAL" | "PENDAPATAN", perusahaanId: string | null, kasBank = false) =>
    db.akun.create({ data: { kode: `${KODE}-${kode}`, nama, jenis, kasBank, perusahaanId } });
  const kasU = await akunBaru("KAS-U", "Kas Uji Laporan", "ASET", U, true);
  const modalB = await akunBaru("MODAL", "Modal Uji Laporan", "MODAL", null);
  const priveB = await akunBaru("PRIVE", "Prive Uji Laporan", "MODAL", null);
  const pendapatanB = await akunBaru("PDPT", "Pendapatan Uji Laporan", "PENDAPATAN", null);
  const bebanB = await akunBaru("BEBAN", "Beban Uji Laporan", "BEBAN", null);
  const gudangU = await db.gudang.create({ data: { kode: `${KODE}-WH-U`, nama: "Gudang Uji Laporan", perusahaanId: U } });
  const barangU = await db.barang.create({ data: { kode: `${KODE}-BRG-U`, nama: "Barang Uji Laporan", jenis: "BARANG", satuan: "pcs", hargaBeli: 10_000, hargaJual: 15_000, perusahaanId: U } });
  const jasaB = await db.barang.create({ data: { kode: `${KODE}-JSA`, nama: "Jasa Uji Laporan", jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 1_000_000, perusahaanId: null } });
  const pemasok = await db.pemasok.create({ data: { kode: `${KODE}-SUP`, nama: "Pemasok Uji Laporan" } });
  const pelanggan = await db.pelanggan.create({ data: { kode: `${KODE}-CUST`, nama: "Pelanggan Uji Laporan" } });

  await dengan({ perusahaan: U }, () => jalankan("PS saldo awal 10 @ 10.000", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudangU.id, akunLawanId: modalB.id, baris: [{ barangId: barangU.id, jumlahSesudah: 10, hargaSatuan: 10_000 }] }))));
  await dengan({ perusahaan: U }, () => jalankan("KM 500.000", () => buatKasMasuk(formulir({ akunKasId: kasU.id, akunLawanId: pendapatanB.id, jumlah: 500_000, keterangan: `${KODE} KM` }))));
  await dengan({ perusahaan: U }, () => jalankan("KK 120.000", () => buatKasKeluar(formulir({ akunKasId: kasU.id, akunLawanId: bebanB.id, jumlah: 120_000, keterangan: `${KODE} KK` }))));
  await dengan({ perusahaan: U }, () => jalankan("JU 30.000", () => buatJurnalManual(formulir({ keterangan: `${KODE} JU`, baris: [{ akunId: kasU.id, debit: 30_000, kredit: 0 }, { akunId: pendapatanB.id, debit: 0, kredit: 30_000 }] }))));
  await dengan({ perusahaan: U }, () => jalankan("Prive 75.000", () => buatPrive(formulir({ pemilikNama: "Pemilik Uji Laporan", akunKasId: kasU.id, akunPriveId: priveB.id, jumlah: 75_000, keterangan: `${KODE} prive` }))));
  await dengan({ perusahaan: U }, () => jalankan("PSB 20 @ 9.000", () => buatPesananPembelian(formulir({ pemasokId: pemasok.id, baris: [{ barangId: barangU.id, jumlah: 20, harga: 9_000 }] }))));
  const psb = await db.pesananPembelian.findFirstOrThrow({ where: { pemasokId: pemasok.id }, include: { baris: true } });
  await jalankan("TB 20", () => buatPenerimaanBarang(formulir({ pesananId: psb.id, gudangId: gudangU.id, baris: [{ barisPesananId: psb.baris[0].id, barangId: barangU.id, jumlah: 20 }] })));
  const tb = await db.penerimaanBarang.findFirstOrThrow({ where: { pesananId: psb.id } });
  await jalankan("FB 20", () => buatFakturPembelian(formulir({ pesananId: psb.id, baris: [{ barangId: barangU.id, jumlah: 20, harga: 9_000 }] })));
  const fb = await db.fakturPembelian.findFirstOrThrow({ where: { pesananId: psb.id } });
  await jalankan("BYR 100.000", () => buatPembayaranPembelian(formulir({ fakturId: fb.id, akunId: kasU.id, jumlah: 100_000 })));
  const byr = await db.pembayaranPembelian.findFirstOrThrow({ where: { fakturId: fb.id } });
  // penjualan masih lewat aksi lama (P23): dibuat di utama dengan jasa bersama, lalu dipindah ke perusahaan uji bersama jurnalnya
  await jalankan("PSJ jasa 1.000.000", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: jasaB.id, jumlah: 1, harga: 1_000_000 }] })));
  const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id } });
  await jalankan("FJ jasa 1.000.000", () => buatFaktur(formulir({ pesananId: psj.id, baris: [{ barangId: jasaB.id, jumlah: 1, harga: 1_000_000 }] })));
  const fjAwal = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id } });
  await db.$transaction([
    db.pesananPenjualan.update({ where: { id: psj.id }, data: { perusahaanId: U } }),
    db.fakturPenjualan.update({ where: { id: fjAwal.id }, data: { perusahaanId: U } }),
    db.jurnal.update({ where: { id: fjAwal.jurnalId! }, data: { perusahaanId: U } }),
  ]);
  const fj = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fjAwal.id }, include: { jurnal: { include: { baris: true } } } });
  nomorLog.push(psb.nomor, tb.nomor, fb.nomor, byr.nomor, psj.nomor, fj.nomor);
  const jurnalU = await db.jurnal.findMany({ where: { perusahaanId: U }, select: { nomor: true, sumber: true } });
  nomorLog.push(...jurnalU.map((j) => j.nomor));
  pastikan(jurnalU.length === 9, `perusahaan uji punya 9 jurnal: PS, KM, KK, JU, PRV, TB, FB, BYR, FJ (${jurnalU.map((j) => j.nomor).join(", ")})`);

  const semuaPerusahaan = await db.perusahaan.findMany({ select: { id: true, kode: true }, orderBy: [{ urutan: "asc" }, { nama: "asc" }] });
  pastikan(semuaPerusahaan.some((p) => p.id === U) && semuaPerusahaan.some((p) => p.id === PERUSAHAAN_UTAMA), `penjumlahan memakai ${semuaPerusahaan.length} perusahaan, termasuk utama dan perusahaan uji`);

  console.log("=== 3. Kasus 24: laporan tiap perusahaan seimbang ===");
  for (const id of [PERUSAHAAN_UTAMA, U]) {
    const label = id === U ? "perusahaan uji" : "utama";
    const n = await hitungNeraca(db, periode.sampai, periode.sampaiTeks, { perusahaanId: id });
    pastikan(n.seimbang, `Neraca ${label} seimbang (aset ${n.totalAset}, pasiva ${n.totalPasiva})`);
    const a = await hitungArusKas(db, periode, { perusahaanId: id });
    pastikan(a.cocok, `Arus Kas ${label} cocok dengan buku besar (${a.kasAkhir} = ${a.kasAkhirBukuBesar})`);
    const s = await saldoAkunPeriode(db, null, periode.sampai, false, { perusahaanId: id });
    pastikan(jumlahDari(s, (x) => x.debit).equals(jumlahDari(s, (x) => x.kredit)), `Σ debit = Σ kredit ${label}`);
  }

  console.log("=== 4. Kasus 25: saldo setiap akun gabungan = jumlah per perusahaan ===");
  const saldoGab = await saldoAkunPeriode(db, periode.dari, periode.sampai, true);
  const saldoPer = await Promise.all(semuaPerusahaan.map((p) => saldoAkunPeriode(db, periode.dari, periode.sampai, true, { perusahaanId: p.id })));
  const akunBeda = saldoGab.filter((a, i) => !a.debit.equals(jumlahDari(saldoPer, (s) => s[i].debit)) || !a.kredit.equals(jumlahDari(saldoPer, (s) => s[i].kredit)));
  pastikan(akunBeda.length === 0 && saldoPer.every((s) => s.length === saldoGab.length && s.every((a, i) => a.id === saldoGab[i].id)), `${saldoGab.length} akun: debit dan kredit gabungan = jumlah per perusahaan (${akunBeda.map((a) => a.kode).join(", ") || "semua sama"})`);

  console.log("=== 5. Setiap fungsi laporan: gabungan = jumlah per perusahaan, utama tidak berubah ===");
  const gab = await semuaLaporan(undefined, periode);
  const per = await Promise.all(semuaPerusahaan.map((p) => semuaLaporan(p.id, periode)));
  const angkaGab = angkaPokok(gab);
  const angkaPer = per.map(angkaPokok);
  for (const k of Object.keys(angkaGab)) {
    const jumlah = jumlahDari(angkaPer, (a) => a[k]);
    pastikan(angkaGab[k].equals(jumlah), `${k}: gabungan ${angkaGab[k]} = jumlah per perusahaan ${jumlah}`);
  }
  const lapU = per[semuaPerusahaan.findIndex((p) => p.id === U)];
  const lapUtama = per[semuaPerusahaan.findIndex((p) => p.id === PERUSAHAAN_UTAMA)];
  for (const k of Object.keys(lamaUtama) as (keyof Laporan)[]) {
    pastikan(json(lapUtama[k]) === json(lamaUtama[k]), `${k} utama identik dengan sebelum data perusahaan uji`);
  }
  // angka perusahaan uji
  pastikan(sama(lapU.prive.total, 75_000) && lapU.prive.rincian.length === 1 && lapU.prive.perPemilik[0]?.pemilikNama === "Pemilik Uji Laporan", "laporan prive perusahaan uji: satu prive 75.000");
  pastikan(sama(lapU.hutang.total, D(fb.total).minus(100_000)) && lapU.hutang.jumlahFaktur === 1 && lapU.hutang.kelompok[0].faktur[0].perusahaanId === U, `laporan hutang perusahaan uji: FB ${fb.nomor} sisa ${D(fb.total).minus(100_000)}, baris umur milik perusahaan uji`);
  pastikan(sama(lapU.piutang.total, fj.total) && lapU.piutang.jumlahFaktur === 1 && lapU.piutang.kelompok[0].faktur[0].perusahaanId === U, `laporan piutang perusahaan uji: FJ ${fj.nomor} ${fj.total}`);
  pastikan(lapUtama.piutang.kelompok.every((k) => k.faktur.every((f) => f.perusahaanId === PERUSAHAAN_UTAMA)) && !lapUtama.piutang.kelompok.some((k) => k.id === pelanggan.id), "laporan piutang utama tanpa faktur perusahaan uji");
  pastikan(sama(lapU.arus.kasAkhirBukuBesar, 235_000) && sama(lapU.arus.kasAwal, 0) && lapU.arus.daftarKas.some((k) => k.id === kasU.id) && !lapUtama.arus.daftarKas.some((k) => k.id === kasU.id), "arus kas perusahaan uji: 500.000 - 120.000 + 30.000 - 75.000 - 100.000 = 235.000; kas perusahaan uji tidak ada di arus kas utama");
  pastikan(sama(lapU.arus.totalOperasi, 310_000) && sama(lapU.arus.totalPendanaan, -75_000), `arus kas perusahaan uji: operasi 310.000, pendanaan (prive) -75.000 (${lapU.arus.totalOperasi}, ${lapU.arus.totalPendanaan})`);
  pastikan(lapU.pendapatan.total.equals(lapU.labaRugi.totalPendapatan) && lapU.pendapatan.jumlahFaktur === 1 && lapU.pendapatan.perPelanggan.some((x) => x.id === pelanggan.id), "ringkasan pendapatan perusahaan uji = pendapatan laba rugi, dengan faktur pelanggan uji");
  pastikan(lapU.pendapatan.perLayanan.some((b) => b.id === pendapatanB.id && sama(b.jumlah, 530_000)), "pendapatan layanan perusahaan uji: akun uji 530.000 (KM + JU)");
  pastikan(sama(lapU.modal.setoranModal, 100_000) && sama(lapU.modal.prive, 75_000) && lapU.modal.cocok, `perubahan modal perusahaan uji: setoran 100.000, prive 75.000, cocok dengan neraca perusahaan itu (${lapU.modal.ekuitasAkhir} = ${lapU.modal.ekuitasAkhirNeraca})`);
  pastikan(per.every((l) => l.modal.cocok === true || l.modal.cocok === false) && lapUtama.modal.cocok === lamaUtama.modal.cocok, "perubahan modal utama: hasil cocok sama dengan sebelum data uji");
  pastikan(lapU.neraca.labaBerjalan.equals(lapU.labaRugi.labaBersih), "laba berjalan neraca perusahaan uji = laba rugi perusahaan uji");
  pastikan(json(ringkasUmur(gab.piutang)) !== json(ringkasUmur(lamaGabungan.piutang)) && gab.piutang.kelompok.some((k) => k.faktur.some((f) => f.perusahaanId === U)), "piutang gabungan memuat faktur perusahaan uji dengan perusahaanId-nya");

  console.log("=== 6. Kasus 26 dan 27: periksaSinkron per perusahaan ===");
  const sinkronU = await periksaSinkron(db, { perusahaanId: U });
  pastikan(semuaCocok(sinkronU), `kasus 26: perusahaan uji seimbang dan semua butir cocok (${BUTIR.map((b) => `${b} ${sinkronU[b].bukuBesar}/${sinkronU[b].dokumen}`).join(", ")})`);
  // nilai stok dokumen memakai harga rata-rata 2 desimal (30 @ 9.333,33), jadi yang tepat 280.000 adalah buku besarnya
  pastikan(sinkronU.persediaan.bukuBesar.equals(D(280_000)) && sinkronU.hutang.dokumen.equals(D(fb.total).minus(100_000)) && sinkronU.piutang.dokumen.equals(D(fj.total)), `perusahaan uji: persediaan buku besar 280.000 (stok ${sinkronU.persediaan.dokumen}), hutang sisa FB, piutang FJ`);
  const sinkronUtama = await periksaSinkron(db, { perusahaanId: PERUSAHAAN_UTAMA });
  pastikan(BUTIR.every((b) => sinkronUtama[b].bukuBesar.equals(sinkronUtamaAwal[b].bukuBesar) && sinkronUtama[b].dokumen.equals(sinkronUtamaAwal[b].dokumen)), "kasus 27: keenam butir utama sama persis dengan sebelum data perusahaan uji");
  const sinkronGab = await periksaSinkron(db);
  pastikan(semuaCocok(sinkronGab), "gabungan tetap cocok");

  console.log("=== 7. Kasus 28: konsistensi perusahaan ===");
  const konsistensiData = await periksaKonsistensiPerusahaan(db);
  pastikan(konsistensiData.konsisten && konsistensiData.total === 0, `kasus 28: data perusahaan uji konsisten (${konsistensiData.total})`);
  const cekPelanggaran = async (label: string, harap: Partial<Record<KodeKonsistensi, number>>, ubah: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    const h: HasilKonsistensi = await dalamTxBatal(async (tx) => {
      await ubah(tx);
      return periksaKonsistensiPerusahaan(tx);
    });
    const salah = h.rincian.filter((r) => r.jumlah !== (harap[r.kode] ?? 0));
    const total = Object.values(harap).reduce((s, x) => s + (x ?? 0), 0);
    pastikan(salah.length === 0 && !h.konsisten && h.total === total, `${label}: ${Object.entries(harap).map(([k, v]) => `${k} ${v}`).join(", ")} (${h.rincian.filter((r) => r.jumlah > 0).map((r) => `${r.kode} ${r.jumlah}`).join(", ")})`);
  };
  await cekPelanggaran("jurnal FB pindah ke utama", { JURNAL_DOKUMEN: 1 }, (tx) => tx.jurnal.update({ where: { id: fb.jurnalId! }, data: { perusahaanId: PERUSAHAAN_UTAMA } }));
  await cekPelanggaran("PSB pindah ke utama", { ANAK_INDUK: 2, BARANG_BARIS: 1 }, (tx) => tx.pesananPembelian.update({ where: { id: psb.id }, data: { perusahaanId: PERUSAHAAN_UTAMA } }));
  await cekPelanggaran("baris jurnal KM memakai akun milik utama", { AKUN_JURNAL: 1 }, async (tx) => {
    const akunUt = await tx.akun.create({ data: { kode: `${KODE}-PDPT-UT`, nama: "Pendapatan Uji Laporan Utama", jenis: "PENDAPATAN", perusahaanId: PERUSAHAAN_UTAMA } });
    const km = await tx.jurnal.findFirstOrThrow({ where: { keterangan: `${KODE} KM` }, include: { baris: true } });
    await tx.barisJurnal.update({ where: { id: km.baris.find((b) => b.akunId === pendapatanB.id)!.id }, data: { akunId: akunUt.id } });
  });
  // tinjauan P14 R4: akun di kepala dokumen, termasuk draf yang belum berjurnal
  await cekPelanggaran("draf KM perusahaan uji dengan akun lawan milik utama", { AKUN_DOKUMEN: 1 }, async (tx) => {
    const akunUt = await tx.akun.create({ data: { kode: `${KODE}-PDPT-UT`, nama: "Pendapatan Uji Laporan Utama", jenis: "PENDAPATAN", perusahaanId: PERUSAHAAN_UTAMA } });
    await tx.dokumenKas.create({ data: { nomor: `${KODE}-KM-DRAF`, jenis: "MASUK", akunKasId: kasU.id, akunLawanId: akunUt.id, jumlah: 1, dibuatOleh: "Uji", perusahaanId: U } });
  });
  await cekPelanggaran("prive perusahaan uji memakai kas milik utama", { AKUN_DOKUMEN: 1 }, async (tx) => {
    const kasUt = await tx.akun.create({ data: { kode: `${KODE}-KAS-UT`, nama: "Kas Uji Laporan Utama", jenis: "ASET", kasBank: true, perusahaanId: PERUSAHAAN_UTAMA } });
    await tx.prive.updateMany({ where: { perusahaanId: U }, data: { akunKasId: kasUt.id } });
  });
  await cekPelanggaran("gudang perusahaan uji menjadi milik utama", { GUDANG_DOKUMEN: 2, STOK_GUDANG: 1 }, (tx) => tx.gudang.update({ where: { id: gudangU.id }, data: { perusahaanId: PERUSAHAAN_UTAMA } }));
  await cekPelanggaran("barang perusahaan uji menjadi milik utama", { BARANG_BARIS: 4, STOK_GUDANG: 1 }, (tx) => tx.barang.update({ where: { id: barangU.id }, data: { perusahaanId: PERUSAHAAN_UTAMA } }));
  await cekPelanggaran("jurnal manual memakai proyek utama", { PROYEK_DOKUMEN: 1 }, async (tx) => {
    const proyekUt = await tx.proyek.create({ data: { kode: `${KODE}-PRJ-UT`, nama: "Event Uji Laporan Utama", perusahaanId: PERUSAHAAN_UTAMA } });
    await tx.jurnal.updateMany({ where: { keterangan: `${KODE} JU` }, data: { proyekId: proyekUt.id } });
  });
  const barisGaji = await db.barisPenggajian.findFirst({ where: { penggajian: { perusahaanId: PERUSAHAAN_UTAMA } }, select: { karyawanId: true } });
  if (barisGaji) {
    const n = await db.barisPenggajian.count({ where: { karyawanId: barisGaji.karyawanId } });
    await cekPelanggaran("karyawan yang sudah digaji utama dipindah ke perusahaan uji", { KARYAWAN_GAJI: n }, (tx) => tx.karyawan.update({ where: { id: barisGaji.karyawanId }, data: { perusahaanId: U } }));
  } else {
    console.log("[lewati] tidak ada penggajian utama di basis data ini");
  }
  await cekPelanggaran("lampiran FB tersimpan di utama", { BERKAS_ENTITAS: 1 }, (tx) =>
    tx.berkas.create({ data: { perusahaanId: PERUSAHAAN_UTAMA, namaBerkas: "uji.pdf", tipeMime: "application/pdf", ukuran: 1, sha256: "0".repeat(64), jenisEntitas: "faktur-pembelian", entitasId: fb.id, diunggahOlehNama: "Uji" } }),
  );
  pastikan((await periksaKonsistensiPerusahaan(db)).total === 0, "semua pelanggaran sengaja sudah dibatalkan");

  console.log("=== 8. Kartu Integritas beranda ===");
  const BUTIR_KONSISTENSI = "Data tiap perusahaan tidak tercampur";
  lupakanKonsistensiTersimpan();
  const intGab = await integritas("PEMILIK", "semua");
  pastikan(intGab.includes(BUTIR_KONSISTENSI) && intGab.includes("(0 pelanggaran)"), "PEMILIK gabungan: butir konsistensi dengan 0 pelanggaran");
  pastikan(intGab.includes("Jurnal seimbang") && intGab.includes("Uang muka pelanggan = DP belum dipakai"), "PEMILIK gabungan: butir sinkron lama tetap ada");
  pastikan(!(await integritas("PEMILIK", PERUSAHAAN_UTAMA)).includes(BUTIR_KONSISTENSI), "PEMILIK lingkup utama: butir konsistensi tidak tampil");
  pastikan(!(await integritas("PEMILIK", U)).includes(BUTIR_KONSISTENSI), "PEMILIK lingkup perusahaan uji: butir konsistensi tidak tampil");
  const intKasir = await integritas("KASIR", "semua");
  pastikan(intKasir.includes("Jurnal seimbang") && !intKasir.includes(BUTIR_KONSISTENSI), "KASIR yang meminta gabungan tetap berlingkup utama: tanpa butir konsistensi");
  await db.jurnal.update({ where: { id: fb.jurnalId! }, data: { perusahaanId: PERUSAHAAN_UTAMA } });
  let intSalah = "";
  let intTersimpan = "";
  try {
    // tinjauan P14 S1: hasil disimpan 60 detik, jadi pelanggaran baru tampil sesudah simpanan kedaluwarsa
    intTersimpan = await integritas("PEMILIK", "semua");
    lupakanKonsistensiTersimpan();
    intSalah = await integritas("PEMILIK", "semua");
  } finally {
    await db.jurnal.update({ where: { id: fb.jurnalId! }, data: { perusahaanId: U } });
    lupakanKonsistensiTersimpan();
  }
  pastikan(intTersimpan.includes("(0 pelanggaran)"), "beranda gabungan memakai hasil konsistensi yang disimpan (kueri tidak diulang di setiap muat)");
  pastikan(intSalah.includes(BUTIR_KONSISTENSI) && intSalah.includes("Jurnal berbeda perusahaan dengan dokumennya: 1") && !intSalah.includes("(0 pelanggaran)"), "gabungan dengan jurnal FB di perusahaan lain: butir konsistensi menyebut pelanggarannya");
  pastikan((await periksaKonsistensiPerusahaan(db)).konsisten, "jurnal FB dikembalikan: konsisten lagi");
  const butirGagal = await render(
    await ButirKonsistensi({
      periksa: async () => {
        throw new Error("kolom tidak ada");
      },
    }),
  );
  pastikan(butirGagal.includes(BUTIR_KONSISTENSI) && butirGagal.includes("Pemeriksaan gagal") && !butirGagal.includes("kolom tidak ada"), "galat kueri konsistensi tidak menjatuhkan beranda: butir menampilkan pemeriksaan gagal tanpa pesan galat");

  console.log("=== 9. Bersih-bersih ===");
  await bersihkanData();
  pastikan((await db.perusahaan.count({ where: { kode: KODE } })) === 0 && (await db.akun.count({ where: { kode: { startsWith: `${KODE}-` } } })) === 0, "perusahaan dan akun uji terhapus");
  pastikan((await db.jurnal.count()) === jumlahJurnalAwal, "jumlah jurnal kembali ke awal");
  pastikan((await db.hakAksesPeran.count()) === awalHakAksesPeran, "tidak ada baris HakAksesPeran baru");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && json(sinkronAkhir) === json(sinkronAwal), "periksaSinkron sama dengan sebelum uji");
  pastikan(json(await semuaLaporan(undefined, periode)) === json(lamaGabungan), "semua laporan gabungan sama dengan sebelum uji");
  console.log("=== DONE, all laporan perusahaan checks passed ===");
}

const sama = (a: { toString(): string } | null | undefined, b: { toString(): string } | number) => D(a?.toString() ?? 0).equals(D(b.toString()));

main()
  .then(() => process.exit(0))
  .catch(async (galat) => {
    console.error("TEST FAILED", galat);
    await bersihkanData().catch((e) => console.error("bersih-bersih gagal", e));
    process.exit(1);
  });
