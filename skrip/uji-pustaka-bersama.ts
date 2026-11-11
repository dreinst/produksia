import "dotenv/config";
// Skrip ini memanggil pustaka di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { db } from "../src/lib/db";
import { D, jumlahkan, kali, uang } from "../src/lib/uang";
import { SEMUA_HAK } from "../src/lib/hakAkses";
import { JenisDokumenCetak } from "../src/prisma-klien/enums";
import { kepalaDisposisi as kepalaDisposisiBerkas } from "../src/lib/tipeBerkas";
import { bobotBaris, nilaiBaris, subtotalBaris } from "../src/lib/nilaiBaris";
import {
  JENIS_CETAK_KE_NOMOR,
  JENIS_NOMOR_CETAK,
  MAKS_LOMPAT_NOMOR_CETAK,
  alokasiNomorCetak,
  bacaFormatNomor,
  bacaNomorCetakManual,
  isiPola,
  nomorCetakTerpakai,
  periksaPola,
  periodeReset,
  setelNomorTerakhir,
  NOMOR_TERAKHIR_MAKS,
} from "../src/lib/nomorCetak";
import { HAK_CETAK_PENJUALAN, JENIS_CETAK_PENJUALAN, jenisCetakPenjualanSah } from "../src/lib/cetak/tipe";
import {
  bersihkanTeks,
  bulanRomawi,
  desimalDokumen,
  formatAngka,
  formatJumlah,
  formatRupiah,
  formatTanggalPanjang,
  formatTanggalPendek,
  kepalaDisposisi,
  namaBerkasAman,
  rentangTanggalTeks,
} from "../src/lib/cetak/format";
import { terbilangRupiah } from "../src/lib/cetak/terbilang";
import { harusDitolak, pastikan } from "./bantuan";

/*
 * Uji pustaka hitung bersama (P08): nilaiBaris/bobotBaris/subtotalBaris (D2 §3.2, §9.2 kasus 1, 2) dengan angka
 * contoh D'Pro dan HKA, nomor cetak (D2 §3.7, §9.2 kasus 9, 10, ditambah alokasi di basis data: bersamaan, reset,
 * deret bersama, lompat bentrok, nomor manual, format nonaktif), format dan terbilang cetak (D3 §3.4), serta
 * keamanan impor berkas yang dipakai komponen klien. Data basis data memakai perusahaan uji berkode UJPB1 yang
 * dihapus beserta FormatNomor, PenghitungNomor, penawaran, dan pelanggannya di awal dan di akhir.
 */

const KODE_PT = "UJPB1";
const KODE_PLG = "UJPB-PLG";

async function bersihkanData() {
  const pt = await db.perusahaan.findUnique({ where: { kode: KODE_PT }, select: { id: true } });
  if (pt) {
    await db.penawaranPenjualan.deleteMany({ where: { perusahaanId: pt.id } });
    await db.penghitungNomor.deleteMany({ where: { perusahaanId: pt.id } });
    await db.formatNomor.deleteMany({ where: { perusahaanId: pt.id } });
    await db.perusahaan.delete({ where: { id: pt.id } });
  }
  await db.pelanggan.deleteMany({ where: { kode: KODE_PLG } });
}

/** Pembangkit acak berbenih (mulberry32) supaya 1.000 pasangan uji sama di setiap putaran. */
function acakBerbenih(benih: number) {
  let a = benih >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tgl = (iso: string) => new Date(iso);

async function main() {
  await bersihkanData();
  const awalHakAksesPeran = await db.hakAksesPeran.count();
  const awalFormat = await db.formatNomor.count();
  const awalPenghitung = await db.penghitungNomor.count();

  console.log("=== 1. nilaiBaris dan bobotBaris (D2 §9.2 kasus 1, 2) ===");
  const acak = acakBerbenih(20261111);
  let beda = 0;
  for (let i = 0; i < 1000; i++) {
    const jumlah = (1 + Math.floor(acak() * 1_000_000)) / 100; // 0,01 sampai 10.000
    const harga = Math.floor(acak() * 10_000_000_001) / 100; // 0 sampai 100.000.000
    const j = jumlah.toFixed(2);
    const h = harga.toFixed(2);
    const acuan = kali(j, h);
    const cocok =
      nilaiBaris({ jumlah: j, harga: h }).equals(acuan) &&
      nilaiBaris({ jumlah: j, harga: h, frekuensi: 1 }).equals(acuan) &&
      nilaiBaris({ jumlah: j, harga: h, frekuensi: null }).equals(acuan) &&
      bobotBaris({ jumlah: j, harga: h }).equals(D(j).mul(h));
    if (!cocok) beda++;
  }
  pastikan(beda === 0, `1.000 pasangan acak: nilaiBaris = kali(jumlah, harga) untuk frekuensi kosong/1/null, bobotBaris = D(jumlah).mul(harga) (beda ${beda})`);
  pastikan(nilaiBaris({ jumlah: 3, harga: "0.1" }).toFixed(2) === "0.30", "nilaiBaris 3 x 0,1 = 0,30");
  pastikan(nilaiBaris({ jumlah: "0.33", frekuensi: "0.33", harga: 1 }).toFixed(2) === "0.11", "nilaiBaris 0,33 x 0,33 x 1 = 0,11 (satu kali pembulatan)");
  pastikan(bobotBaris({ jumlah: "0.33", frekuensi: "0.33", harga: 1 }).toString() === "0.1089", "bobotBaris tanpa pembulatan = 0,1089");
  pastikan(nilaiBaris({ jumlah: 2, frekuensi: 3, harga: "100000" }).toFixed(2) === "600000.00", "frekuensi ikut dikalikan: 2 x 3 x 100.000 = 600.000");
  pastikan(nilaiBaris({ jumlah: 2, frekuensi: "", harga: "100000" }).toFixed(2) === "200000.00" && bobotBaris({ jumlah: 2, frekuensi: "", harga: 5 }).toString() === "10", "frekuensi string kosong (isian formulir) = 1 (perbaikan tinjauan P08 butir 11)");
  pastikan(nilaiBaris({ jumlah: "0.005", harga: 1 }).toFixed(2) === "0.01" && nilaiBaris({ jumlah: "-0.005", harga: 1 }).toFixed(2) === "-0.01", "pembulatan half-up sama dengan uang() (0,005 jadi 0,01)");
  pastikan(nilaiBaris({ jumlah: null, harga: 5 }).isZero() && subtotalBaris([]).isZero(), "jumlah kosong = 0, subtotal daftar kosong = 0");
  let galatAngka = "";
  try {
    nilaiBaris({ jumlah: "abc", harga: 1 });
  } catch (galat) {
    galatAngka = (galat as Error).message;
  }
  pastikan(galatAngka === "Angka tidak valid: abc", `angka tidak sah ditolak dengan pesan uang.ts: ${galatAngka}`);
  pastikan(nilaiBaris({ jumlah: 1, harga: 1 }).constructor === D(0).constructor, "Decimal nilaiBaris sekelas dengan Decimal server (uang.ts)");

  console.log("=== 2. Angka contoh D'Pro dan HKA dari subtotalBaris ===");
  // Invoice D'Pro 071/DPRO-INV2/IX/2026 (spec/10 §4.3): lima baris berjumlah 1, fee nominal 7.316.660
  const invoiceDpro = [29_990_900, 5_850_000, 7_815_000, 5_400_000, 24_110_700].map((harga) => ({ jumlah: 1, harga }));
  const totalInvoice = subtotalBaris(invoiceDpro);
  pastikan(totalInvoice.toFixed(2) === "73166600.00", `invoice D'Pro: subtotal ${totalInvoice.toFixed(2)} = 73.166.600`);
  const feeInvoice = uang(totalInvoice.mul(10).div(100));
  pastikan(feeInvoice.toFixed(2) === "7316660.00" && totalInvoice.plus(feeInvoice).toFixed(2) === "80483260.00", "invoice D'Pro: fee 10% = 7.316.660, grand total 80.483.260");
  // Proposal D'Pro 064/DPRO/P1/VIII/2026 (spec/10 §4.3): 12 baris persis, baris 3 frekuensi 5
  const proposalDpro = [
    [25, 3, 650_000],
    [3, 3, 550_000],
    [53, 5, 60_000],
    [55, 6, 15_000],
    [1, 4, 3_500_000],
    [1, 4, 1_300_000],
    [53, 1, 250_000],
    [1, 1, 7_000_000],
    [1, 1, 12_000_000],
    [53, 1, 130_000],
    [53, 1, 125_000],
    [1, 1, 20_000_000],
  ].map(([jumlah, frekuensi, harga]) => ({ jumlah, frekuensi, harga }));
  const nilaiProposal = proposalDpro.map((b) => nilaiBaris(b).toNumber());
  pastikan(nilaiProposal.join() === "48750000,4950000,15900000,4950000,14000000,5200000,13250000,7000000,12000000,6890000,6625000,20000000", "proposal D'Pro: nilai tiap baris sama dengan kolom amount");
  const subtotalProposal = subtotalBaris(proposalDpro);
  pastikan(subtotalProposal.toFixed(2) === "159515000.00" && subtotalProposal.minus(890_000).toFixed(2) === "158625000.00", "proposal D'Pro: total biaya langsung 159.515.000, setelah diskon 890.000 = 158.625.000");
  // HKA "Nawasena" (spec/02 §4): subtotal 65.500.000, fee 10%, PPN 11% dari DPP. Rincian baris uji HKA tidak ada
  // di arsip, jadi empat baris event di bawah ini rekaan yang berjumlah 65.500.000.
  const nawasena = [
    { jumlah: 1, frekuensi: 1, harga: 25_000_000 },
    { jumlah: 10, frekuensi: 2, harga: 750_000 },
    { jumlah: 100, frekuensi: 3, harga: 50_000 },
    { jumlah: 1, frekuensi: 1, harga: 10_500_000 },
  ];
  const subNawasena = subtotalBaris(nawasena);
  const feeNawasena = uang(subNawasena.mul(10).div(100));
  const dppNawasena = uang(subNawasena.plus(feeNawasena));
  const ppnNawasena = uang(dppNawasena.mul(11).div(100));
  const totalNawasena = uang(dppNawasena.plus(ppnNawasena));
  pastikan(subNawasena.toFixed(2) === "65500000.00" && feeNawasena.toFixed(2) === "6550000.00" && ppnNawasena.toFixed(2) === "7925500.00" && totalNawasena.toFixed(2) === "79975500.00", "HKA Nawasena: subtotal 65.500.000, fee 6.550.000, PPN 7.925.500, total 79.975.500");
  pastikan(subtotalBaris(invoiceDpro).equals(jumlahkan(invoiceDpro.map((b) => kali(b.jumlah, b.harga)))), "subtotalBaris = jumlahkan(kali) untuk baris tanpa frekuensi");

  console.log("=== 3. Nomor cetak: isiPola dan periode (D2 §9.2 kasus 9) ===");
  const isian = (nilai: number, tanggal: Date, ekstra: Partial<{ prefiks: string; kode: string; digit: number }> = {}) => ({ nilai, tanggal, prefiks: "", kode: "", digit: 4, ...ekstra });
  pastikan(isiPola("{SEQ3}/{KODE}-INV2/{ROMAN}/{YYYY}", isian(71, tgl("2026-09-21T05:00:00Z"), { kode: "DPRO" })) === "071/DPRO-INV2/IX/2026", "pola invoice D'Pro = 071/DPRO-INV2/IX/2026");
  pastikan(isiPola("{SEQ2}.EVO-ISA/{PREFIX}/{ROMAN}/{YYYY}", isian(1, tgl("2026-08-15T05:00:00Z"), { prefiks: "INV" })) === "01.EVO-ISA/INV/VIII/2026", "pola Evoked = 01.EVO-ISA/INV/VIII/2026");
  pastikan(isiPola("TQ-{YY}{MM}-{SEQ2}", isian(1, tgl("2026-11-11T05:00:00Z"))) === "TQ-2611-01", "pola HKA = TQ-2611-01");
  pastikan(isiPola("{SEQ3}", isian(12345, tgl("2026-11-11T05:00:00Z"))) === "12345" && isiPola("{SEQ}", isian(7, tgl("2026-11-11T05:00:00Z"))) === "0007", "{SEQ3} tidak memotong 12345; {SEQ} digit 4 = 0007");
  pastikan(isiPola("{KODE}-{KODE}-{SEQ}", isian(5, tgl("2026-11-11T05:00:00Z"), { kode: "A", digit: 3 })) === "A-A-005", "token yang muncul dua kali diganti semua");
  const malamTahunBaru = tgl("2026-12-31T16:30:00Z"); // 23.30 WIB 31 Des
  const pagiTahunBaru = tgl("2026-12-31T17:30:00Z"); // 00.30 WIB 1 Jan
  pastikan(isiPola("{ROMAN}/{YYYY}", isian(1, malamTahunBaru)) === "XII/2026" && periodeReset("TAHUNAN", malamTahunBaru) === "2026", "23.30 WIB 31 Des: XII/2026, periode 2026");
  pastikan(isiPola("{ROMAN}/{YYYY}", isian(1, pagiTahunBaru)) === "I/2027" && periodeReset("TAHUNAN", pagiTahunBaru) === "2027" && periodeReset("BULANAN", pagiTahunBaru) === "2027-01", "00.30 WIB 1 Jan: I/2027, periode 2027 dan 2027-01");
  pastikan(periodeReset("TIDAK_PERNAH", pagiTahunBaru) === "-", "TIDAK_PERNAH: periode -");

  console.log("=== 4. Validasi pola dan format (D2 §9.2 kasus 10) ===");
  pastikan(periksaPola("  {SEQ3}/{YYYY}  ", "TAHUNAN") === "{SEQ3}/{YYYY}", "pola sah dipangkas");
  await harusDitolak("pola tanpa {SEQ}", async () => periksaPola("INV/{YYYY}", "TAHUNAN"), "Pola nomor harus 3-60 karakter dan memuat {SEQ}, {SEQ2}, atau {SEQ3}");
  await harusDitolak("pola 61 karakter", async () => periksaPola(`{SEQ}/{YYYY}/${"X".repeat(48)}`, "TAHUNAN"), "Pola nomor harus 3-60 karakter");
  pastikan(periksaPola(`{SEQ}/{YYYY}/${"X".repeat(47)}`, "TAHUNAN").length === 60, "pola 60 karakter diterima");
  await harusDitolak("pola 2 karakter", async () => periksaPola("{S", "TIDAK_PERNAH"), "Pola nomor harus 3-60 karakter");
  await harusDitolak("token {XX}", async () => periksaPola("{SEQ}/{XX}/{YYYY}", "TAHUNAN"), "Token {XX} tidak dikenal");
  await harusDitolak("token huruf kecil", async () => periksaPola("{seq}/{YYYY}", "TAHUNAN"), "Token {seq} tidak dikenal");
  await harusDitolak("TAHUNAN tanpa tahun", async () => periksaPola("INV-{SEQ}", "TAHUNAN"), "reset tahunan wajib memuat {YYYY} atau {YY}");
  await harusDitolak("BULANAN tanpa bulan", async () => periksaPola("INV-{YYYY}-{SEQ}", "BULANAN"), "reset bulanan wajib memuat tahun");
  await harusDitolak("BULANAN tanpa tahun", async () => periksaPola("INV-{MM}-{SEQ}", "BULANAN"), "reset bulanan wajib memuat tahun");
  pastikan(periksaPola("INV-{YY}{ROMAN}-{SEQ}", "BULANAN") === "INV-{YY}{ROMAN}-{SEQ}" && periksaPola("INV-{SEQ}", "TIDAK_PERNAH") === "INV-{SEQ}", "BULANAN dengan {YY}{ROMAN} dan TIDAK_PERNAH tanpa tahun diterima");
  const fmt = bacaFormatNomor({ jenis: "faktur", pola: " {SEQ3}/{KODE}/{YYYY} ", prefiks: "inv", kode: "dpro-2", digit: "", kunciDeret: "", reset: "" });
  pastikan(fmt.prefiks === "INV" && fmt.kode === "DPRO-2" && fmt.digit === 4 && fmt.kunciDeret === "faktur" && fmt.reset === "TAHUNAN" && fmt.pola === "{SEQ3}/{KODE}/{YYYY}", "bacaFormatNomor: huruf besar, bawaan digit 4, kunci deret = jenis, reset TAHUNAN");
  pastikan(bacaFormatNomor({ jenis: "kwitansi", pola: "KW-{SEQ}", digit: 8, reset: "TIDAK_PERNAH", kunciDeret: "surat-1" }).digit === 8, "digit 8 (angka) diterima");
  await harusDitolak("prefiks IN/V", async () => bacaFormatNomor({ jenis: "faktur", pola: "{SEQ}/{YYYY}", prefiks: "IN/V" }), "Prefiks hanya huruf/angka, maksimal 8");
  await harusDitolak("prefiks 9 karakter", async () => bacaFormatNomor({ jenis: "faktur", pola: "{SEQ}/{YYYY}", prefiks: "ABCDEFGHI" }), "Prefiks hanya huruf/angka, maksimal 8");
  await harusDitolak("kode 13 karakter", async () => bacaFormatNomor({ jenis: "faktur", pola: "{SEQ}/{YYYY}", kode: "ABCDEFGHIJKLM" }), "Kode hanya huruf/angka/tanda hubung, maksimal 12");
  await harusDitolak("digit 2", async () => bacaFormatNomor({ jenis: "faktur", pola: "{SEQ}/{YYYY}", digit: "2" }), "Digit urut harus bilangan bulat 3-8");
  await harusDitolak("digit 9", async () => bacaFormatNomor({ jenis: "faktur", pola: "{SEQ}/{YYYY}", digit: 9 }), "Digit urut harus bilangan bulat 3-8");
  await harusDitolak("digit pecahan", async () => bacaFormatNomor({ jenis: "faktur", pola: "{SEQ}/{YYYY}", digit: "4.5" }), "Digit urut harus bilangan bulat 3-8");
  await harusDitolak("kunci deret huruf besar", async () => bacaFormatNomor({ jenis: "faktur", pola: "{SEQ}/{YYYY}", kunciDeret: "Surat" }), "Kunci deret hanya huruf kecil");
  await harusDitolak("jenis pesanan", async () => bacaFormatNomor({ jenis: "pesanan", pola: "{SEQ}/{YYYY}" }), "Jenis nomor cetak tidak dikenal");
  await harusDitolak("reset asing", async () => bacaFormatNomor({ jenis: "faktur", pola: "{SEQ}/{YYYY}", reset: "MINGGUAN" }), "Jenis reset nomor tidak dikenal");

  console.log("=== 5. Peta jenis cetak dan hak cetak ===");
  const enumCetak = Object.values(JenisDokumenCetak);
  pastikan(enumCetak.length === 5 && enumCetak.every((e) => (JENIS_NOMOR_CETAK as readonly string[]).includes(JENIS_CETAK_KE_NOMOR[e])) && new Set(enumCetak.map((e) => JENIS_CETAK_KE_NOMOR[e])).size === 5, "JENIS_CETAK_KE_NOMOR memetakan kelima enum JenisDokumenCetak ke lima jenis nomor yang berbeda");
  pastikan(JENIS_CETAK_KE_NOMOR.KWITANSI_DP === "kwitansi-dp" && JENIS_CETAK_KE_NOMOR.TAGIHAN_TERMIN === "tagihan-termin", "KWITANSI_DP dan TAGIHAN_TERMIN ke kebab");
  pastikan([...JENIS_CETAK_PENJUALAN].sort().join() === [...JENIS_NOMOR_CETAK].sort().join() && jenisCetakPenjualanSah("faktur") && !jenisCetakPenjualanSah("pesanan"), "jenis cetak penjualan = jenis nomor cetak");
  pastikan(JSON.stringify(HAK_CETAK_PENJUALAN) === JSON.stringify({ penawaran: "penawaran.lihat", faktur: "faktur.lihat", kwitansi: "penerimaan.lihat", "kwitansi-dp": "uang-muka.lihat", "tagihan-termin": "pesanan.lihat" }) && Object.values(HAK_CETAK_PENJUALAN).every((h) => SEMUA_HAK.includes(h)), "HAK_CETAK_PENJUALAN sesuai D2 §6.3 dan ada di SEMUA_HAK");

  console.log("=== 6. Alokasi nomor cetak di basis data ===");
  const pt = await db.perusahaan.create({ data: { kode: KODE_PT, nama: "PT Uji Pustaka Bersama", urutan: 95 } });
  const sep2026 = tgl("2026-09-21T05:00:00Z");
  const alokasi = (jenis: (typeof JENIS_NOMOR_CETAK)[number], tanggal: Date) => db.$transaction((tx) => alokasiNomorCetak(tx, { perusahaanId: pt.id, jenis, tanggal }));
  const nilaiPenghitung = async (kunciDeret: string, periode: string) =>
    (await db.penghitungNomor.findUnique({ where: { perusahaanId_kunciDeret_periode: { perusahaanId: pt.id, kunciDeret, periode } } }))?.nilai ?? null;
  pastikan((await alokasi("faktur", sep2026)) === null && (await db.penghitungNomor.count({ where: { perusahaanId: pt.id } })) === 0, "tanpa format: null dan penghitung tidak dibuat");
  await db.formatNomor.create({ data: { perusahaanId: pt.id, jenis: "faktur", pola: "{SEQ3}/{KODE}-INV2/{ROMAN}/{YYYY}", kode: "DPRO", kunciDeret: "surat-ujpb", aktif: false } });
  pastikan((await alokasi("faktur", sep2026)) === null && (await db.penghitungNomor.count({ where: { perusahaanId: pt.id } })) === 0, "format nonaktif: null");
  await db.formatNomor.update({ where: { perusahaanId_jenis: { perusahaanId: pt.id, jenis: "faktur" } }, data: { aktif: true } });
  pastikan((await alokasi("faktur", sep2026)) === "001/DPRO-INV2/IX/2026", "alokasi pertama 001/DPRO-INV2/IX/2026");
  await setelNomorTerakhir(db, { perusahaanId: pt.id, kunciDeret: "surat-ujpb", reset: "TAHUNAN", nilai: 70, tanggal: sep2026 });
  pastikan((await alokasi("faktur", sep2026)) === "071/DPRO-INV2/IX/2026", "setelNomorTerakhir 70: alokasi berikut 071/DPRO-INV2/IX/2026");
  await harusDitolak("nomor terakhir mundur", () => setelNomorTerakhir(db, { perusahaanId: pt.id, kunciDeret: "surat-ujpb", reset: "TAHUNAN", nilai: 10, tanggal: sep2026 }), "Nomor terakhir tidak boleh lebih kecil dari penghitung sekarang (71)");
  await harusDitolak("nomor terakhir negatif", () => setelNomorTerakhir(db, { perusahaanId: pt.id, kunciDeret: "surat-ujpb", reset: "TAHUNAN", nilai: -1 }), "Nomor terakhir harus bilangan bulat 0 atau lebih");
  await setelNomorTerakhir(db, { perusahaanId: pt.id, kunciDeret: "surat-ujpb", reset: "TAHUNAN", nilai: 71, tanggal: sep2026 });
  pastikan((await nilaiPenghitung("surat-ujpb", "2026")) === 71, "nomor terakhir sama dengan penghitung diterima tanpa perubahan");
  // deret bersama: penawaran dengan kunci deret yang sama melanjutkan urutan faktur
  await db.formatNomor.create({ data: { perusahaanId: pt.id, jenis: "penawaran", pola: "{SEQ3}/{KODE}/P1/{ROMAN}/{YYYY}", kunciDeret: "surat-ujpb" } });
  pastikan((await alokasi("penawaran", sep2026)) === `072/${KODE_PT}/P1/IX/2026`, "deret bersama: penawaran 072, kode kosong = kode perusahaan");
  // reset tahunan
  pastikan((await alokasi("faktur", tgl("2027-01-05T05:00:00Z"))) === "001/DPRO-INV2/I/2027" && (await nilaiPenghitung("surat-ujpb", "2026")) === 72, "reset tahunan: Januari 2027 mulai dari 001, penghitung 2026 tetap 72");
  pastikan((await alokasi("faktur", pagiTahunBaru)) === "002/DPRO-INV2/I/2027" && (await alokasi("faktur", malamTahunBaru)) === "073/DPRO-INV2/XII/2026", "tanggal di batas tahun memakai zona waktu (00.30 WIB ke 2027, 23.30 WIB ke 2026)");
  // reset bulanan
  await db.formatNomor.create({ data: { perusahaanId: pt.id, jenis: "kwitansi", pola: "KW-{YY}{MM}-{SEQ2}", kunciDeret: "kw-ujpb", reset: "BULANAN" } });
  const kwNov = [await alokasi("kwitansi", tgl("2026-11-02T05:00:00Z")), await alokasi("kwitansi", tgl("2026-11-30T05:00:00Z"))];
  pastikan(kwNov.join() === "KW-2611-01,KW-2611-02" && (await alokasi("kwitansi", tgl("2026-12-01T05:00:00Z"))) === "KW-2612-01", "reset bulanan: November 01, 02; Desember mulai 01");
  pastikan((await nilaiPenghitung("kw-ujpb", "2026-11")) === 2 && (await nilaiPenghitung("kw-ujpb", "2026-12")) === 1, "penghitung bulanan berperiode YYYY-MM");
  // tidak pernah reset
  await db.formatNomor.create({ data: { perusahaanId: pt.id, jenis: "tagihan-termin", pola: "TG-{SEQ}", kunciDeret: "tg-ujpb", reset: "TIDAK_PERNAH" } });
  pastikan((await alokasi("tagihan-termin", sep2026)) === "TG-0001" && (await alokasi("tagihan-termin", tgl("2028-03-01T05:00:00Z"))) === "TG-0002" && (await nilaiPenghitung("tg-ujpb", "-")) === 2, "TIDAK_PERNAH: urut berlanjut lintas tahun, periode -");
  // bersamaan: lima transaksi serentak mendapat nomor berbeda
  const sebelumSerentak = (await nilaiPenghitung("surat-ujpb", "2026"))!;
  const serentak = await Promise.all(Array.from({ length: 5 }, () => alokasi("faktur", sep2026)));
  pastikan(new Set(serentak).size === 5 && serentak.every((n) => !!n && /^0\d\d\/DPRO-INV2\/IX\/2026$/.test(n)), `lima alokasi serentak berbeda: ${serentak.join(", ")}`);
  pastikan((await nilaiPenghitung("surat-ujpb", "2026")) === sebelumSerentak + 5, "penghitung naik tepat 5");
  // alokasi di transaksi yang batal tidak memakan nomor
  await db
    .$transaction(async (tx) => {
      await alokasiNomorCetak(tx, { perusahaanId: pt.id, jenis: "faktur", tanggal: sep2026 });
      throw new Error("batal uji");
    })
    .catch(() => undefined);
  pastikan((await nilaiPenghitung("surat-ujpb", "2026")) === sebelumSerentak + 5, "transaksi dokumen yang batal ikut membatalkan kenaikan penghitung");

  console.log("=== 7. Nomor manual dan lompat bentrok ===");
  const plg = await db.pelanggan.create({ data: { kode: KODE_PLG, nama: "Pelanggan Uji Pustaka Bersama" } });
  const berikut = sebelumSerentak + 6;
  const nomorBentrok = `${String(berikut).padStart(3, "0")}/${KODE_PT}/P1/IX/2026`;
  const pnw = await db.penawaranPenjualan.create({ data: { nomor: `${KODE_PLG}-PNW-1`, pelangganId: plg.id, perusahaanId: pt.id, nomorCetak: nomorBentrok } });
  pastikan(await nomorCetakTerpakai(db, "penawaran", pt.id, nomorBentrok), "nomorCetakTerpakai: nomor penawaran manual terdeteksi");
  pastikan(!(await nomorCetakTerpakai(db, "penawaran", pt.id, nomorBentrok, pnw.id)) && !(await nomorCetakTerpakai(db, "faktur", pt.id, nomorBentrok)) && !(await nomorCetakTerpakai(db, "penawaran", "utama", nomorBentrok)), "nomorCetakTerpakai: kecuali dokumen sendiri, jenis lain, dan perusahaan lain tidak bentrok");
  const lompat = await alokasi("penawaran", sep2026);
  pastikan(lompat === `${String(berikut + 1).padStart(3, "0")}/${KODE_PT}/P1/IX/2026` && (await nilaiPenghitung("surat-ujpb", "2026")) === berikut + 1, `alokasi melompati nomor yang sudah dipakai: ${lompat}`);
  await db.penghitungNomor.update({ where: { perusahaanId_kunciDeret_periode: { perusahaanId: pt.id, kunciDeret: "surat-ujpb", periode: "2026" } }, data: { nilai: berikut - 1 } });
  const pnw2 = await db.penawaranPenjualan.create({ data: { nomor: `${KODE_PLG}-PNW-2`, pelangganId: plg.id, perusahaanId: pt.id, nomorCetak: `${String(berikut + 1).padStart(3, "0")}/${KODE_PT}/P1/IX/2026` } });
  const lompatDua = await alokasi("penawaran", sep2026);
  pastikan(lompatDua === `${String(berikut + 2).padStart(3, "0")}/${KODE_PT}/P1/IX/2026`, `dua nomor berurutan terpakai: dilompati dua kali (${lompatDua})`);
  // perbaikan tinjauan P08 butir 1: 20 nomor manual berurutan di atas penghitung dilompati sekaligus, penghitung ikut naik
  const kunciSurat = { perusahaanId_kunciDeret_periode: { perusahaanId: pt.id, kunciDeret: "surat-ujpb", periode: "2026" } };
  await db.penghitungNomor.update({ where: kunciSurat, data: { nilai: 900 } });
  for (let n = 901; n <= 920; n++) await db.penawaranPenjualan.create({ data: { nomor: `${KODE_PLG}-PNW-${n}`, pelangganId: plg.id, perusahaanId: pt.id, nomorCetak: `${n}/${KODE_PT}/P1/IX/2026` } });
  const lewatiDuaPuluh = await alokasi("penawaran", sep2026);
  pastikan(lewatiDuaPuluh === `921/${KODE_PT}/P1/IX/2026` && (await nilaiPenghitung("surat-ujpb", "2026")) === 921, `20 nomor manual terpakai: alokasi otomatis 921 dan penghitung 921 (${lewatiDuaPuluh})`);
  pastikan((await alokasi("penawaran", sep2026)) === `922/${KODE_PT}/P1/IX/2026`, "alokasi berikutnya langsung 922 tanpa menabrak nomor manual lagi");
  // blok kedua lompatan: 600 nomor terpakai di atas penghitung (lebih dari satu blok 500)
  await db.penghitungNomor.update({ where: kunciSurat, data: { nilai: 1000 } });
  await db.penawaranPenjualan.createMany({ data: Array.from({ length: 600 }, (_, i) => ({ nomor: `${KODE_PLG}-PNW-${1001 + i}`, pelangganId: plg.id, perusahaanId: pt.id, nomorCetak: `${1001 + i}/${KODE_PT}/P1/IX/2026` })) });
  pastikan((await alokasi("penawaran", sep2026)) === `1601/${KODE_PT}/P1/IX/2026` && (await nilaiPenghitung("surat-ujpb", "2026")) === 1601, "600 nomor terpakai: alokasi 1601 dan penghitung 1601");
  // tidak ada nomor bebas dalam batas (di sini batas nilai kolom penghitung): galat menyebut nomor bentrok, penghitung tetap
  const nilaiMaks = 2_147_483_647;
  await db.penghitungNomor.update({ where: kunciSurat, data: { nilai: nilaiMaks - 1 } });
  await db.penawaranPenjualan.create({ data: { nomor: `${KODE_PLG}-PNW-MAKS`, pelangganId: plg.id, perusahaanId: pt.id, nomorCetak: `${nilaiMaks}/${KODE_PT}/P1/IX/2026` } });
  await harusDitolak("semua nomor dalam batas terpakai", () => alokasi("penawaran", sep2026), `Nomor cetak ${nilaiMaks}/${KODE_PT}/P1/IX/2026 sampai ${nilaiMaks}/${KODE_PT}/P1/IX/2026 sudah dipakai semua. Setel Nomor terakhir`);
  pastikan((await nilaiPenghitung("surat-ujpb", "2026")) === nilaiMaks - 1, "alokasi gagal: transaksi batal, penghitung kembali ke nilai semula");
  pastikan(MAKS_LOMPAT_NOMOR_CETAK === 10_000, "batas lompatan 10.000 nomor");
  // perbaikan tinjauan P10 butir 8: penghitung tepat di batas kolom int memberi pesan, bukan galat Postgres mentah,
  // dan setelNomorTerakhir menolak nilai di atas NOMOR_TERAKHIR_MAKS
  await db.penghitungNomor.update({ where: kunciSurat, data: { nilai: nilaiMaks } });
  await harusDitolak("penghitung di batas kolom int", () => alokasi("penawaran", sep2026), "Penghitung nomor cetak sudah mencapai batas tertinggi. Ganti kunci deret");
  pastikan((await nilaiPenghitung("surat-ujpb", "2026")) === nilaiMaks, "penghitung di batas tidak berubah");
  await db.penghitungNomor.update({ where: kunciSurat, data: { nilai: 900 } });
  pastikan(NOMOR_TERAKHIR_MAKS === 999_999_999, "NOMOR_TERAKHIR_MAKS 999.999.999");
  await harusDitolak("nomor terakhir di atas batas", () => setelNomorTerakhir(db, { perusahaanId: pt.id, kunciDeret: "surat-ujpb", reset: "TAHUNAN", nilai: NOMOR_TERAKHIR_MAKS + 1, tanggal: sep2026 }), "Nomor terakhir paling besar 999.999.999");
  await setelNomorTerakhir(db, { perusahaanId: pt.id, kunciDeret: "surat-ujpb", reset: "TAHUNAN", nilai: NOMOR_TERAKHIR_MAKS, tanggal: sep2026 });
  pastikan((await nilaiPenghitung("surat-ujpb", "2026")) === NOMOR_TERAKHIR_MAKS, "nomor terakhir tepat di batas diterima");
  // perbaikan tinjauan P08 butir 9: TypeScript menolak db biasa (tsc di CI gagal bila baris berikut tidak lagi galat)
  const alokasiDenganDbBiasa = () =>
    // @ts-expect-error alokasiNomorCetak hanya menerima klien transaksi, bukan db biasa
    alokasiNomorCetak(db, { perusahaanId: pt.id, jenis: "penawaran", tanggal: sep2026 });
  pastikan(typeof alokasiDenganDbBiasa === "function", "alokasiNomorCetak bertipe klien transaksi");
  await db.penghitungNomor.update({ where: kunciSurat, data: { nilai: 900 } });
  pastikan((await bacaNomorCetakManual(db, { jenis: "penawaran", perusahaanId: pt.id, isian: "   " })) === null && (await bacaNomorCetakManual(db, { jenis: "penawaran", perusahaanId: pt.id, isian: null })) === null, "nomor manual kosong: null (pakai alokasi otomatis)");
  pastikan((await bacaNomorCetakManual(db, { jenis: "penawaran", perusahaanId: pt.id, isian: "  064/DPRO/P1/VIII/2026 " })) === "064/DPRO/P1/VIII/2026", "nomor manual baru dipangkas dan diterima");
  pastikan((await nilaiPenghitung("surat-ujpb", "2026")) === 900, "nomor manual tidak menaikkan penghitung");
  await harusDitolak("nomor manual terpakai", () => bacaNomorCetakManual(db, { jenis: "penawaran", perusahaanId: pt.id, isian: nomorBentrok }), `Nomor cetak ${nomorBentrok} sudah dipakai dokumen lain`);
  pastikan((await bacaNomorCetakManual(db, { jenis: "penawaran", perusahaanId: pt.id, isian: nomorBentrok, kecualiId: pnw.id })) === nomorBentrok, "nomor manual milik dokumen sendiri (ubah) diterima");
  await harusDitolak("nomor manual 61 karakter", () => bacaNomorCetakManual(db, { jenis: "penawaran", perusahaanId: pt.id, isian: "N".repeat(61) }), "Nomor cetak paling panjang 60 karakter");
  await harusDitolak("nomor manual berkarakter kendali", () => bacaNomorCetakManual(db, { jenis: "penawaran", perusahaanId: pt.id, isian: "A\nB" }), "karakter yang tidak diizinkan");
  // perbaikan tinjauan P08 butir 7: karakter format dan kendali C1 ditolak, nomor dinormalkan NFC
  for (const [label, isian] of [["lebar nol", "071/DPRO\u200B"], ["RLO", "071/\u202EORPD"], ["BOM di tengah (BOM di tepi dipangkas trim)", "07\uFEFF1"], ["kendali C1", "071\u0085"], ["pemisah baris Unicode", "071\u2028A"]] as const) {
    await harusDitolak(`nomor manual dengan ${label}`, () => bacaNomorCetakManual(db, { jenis: "penawaran", perusahaanId: pt.id, isian }), "karakter yang tidak diizinkan");
  }
  const nomorNfc = "N\u00e9-071/2026";
  pastikan((await bacaNomorCetakManual(db, { jenis: "penawaran", perusahaanId: pt.id, isian: "Ne\u0301-071/2026" })) === nomorNfc, "nomor manual NFD disimpan sebagai NFC");
  await db.penawaranPenjualan.create({ data: { nomor: `${KODE_PLG}-PNW-NFC`, pelangganId: plg.id, perusahaanId: pt.id, nomorCetak: nomorNfc } });
  await harusDitolak("nomor manual NFD yang sama dengan nomor NFC terpakai", () => bacaNomorCetakManual(db, { jenis: "penawaran", perusahaanId: pt.id, isian: "Ne\u0301-071/2026" }), `Nomor cetak ${nomorNfc} sudah dipakai dokumen lain`);
  pastikan(pnw2.nomorCetak !== null, "penawaran uji kedua tersimpan");

  console.log("=== 8. Format angka dan tanggal (D3 §3.4) ===");
  const harapanAngka: [number | string, "TITIK" | "KOMA", 0 | 2, string][] = [
    [80483260, "KOMA", 0, "80,483,260"],
    [80483260, "TITIK", 0, "80.483.260"],
    [73166600, "KOMA", 0, "73,166,600"],
    [7316660, "KOMA", 0, "7,316,660"],
    [159515000, "KOMA", 0, "159,515,000"],
    [890000, "KOMA", 0, "890,000"],
    [158625000, "KOMA", 0, "158,625,000"],
    [3625000, "KOMA", 0, "3,625,000"],
    [1234.5, "TITIK", 2, "1.234,50"],
    [1234.5, "KOMA", 2, "1,234.50"],
    [-90000, "TITIK", 0, "-90.000"],
    [0, "TITIK", 0, "0"],
    [999, "TITIK", 0, "999"],
    ["135802.37", "TITIK", 2, "135.802,37"],
    ["1000000000000000", "KOMA", 0, "1,000,000,000,000,000"],
  ];
  for (const [nilai, gaya, des, harapan] of harapanAngka) pastikan(formatAngka(nilai, gaya, des) === harapan, `formatAngka(${nilai}, ${gaya}, ${des}) = ${harapan}`);
  pastikan(formatAngka(D("80483260.00"), "KOMA", 0) === "80,483,260", "formatAngka menerima Decimal server");
  pastikan(formatRupiah(12650000, "TITIK", 0) === "Rp 12.650.000" && formatRupiah(500000, "TITIK", 0, { akhiran: ",-" }) === "Rp 500.000,-" && formatRupiah(-90000, "TITIK", 0) === "-Rp 90.000", "formatRupiah: awalan, akhiran Bonanova, negatif -Rp");
  pastikan(desimalDokumen([80483260, 7316660, "159515000.00"]) === 0 && desimalDokumen([80483260, "135802.37"]) === 2 && desimalDokumen([]) === 0, "desimalDokumen 0 untuk data contoh, 2 bila ada 135.802,37");
  pastikan(formatJumlah(6) === "6" && formatJumlah(1.5, "TITIK") === "1,5" && formatJumlah(1.5, "KOMA") === "1.5" && formatJumlah("2.50") === "2,5" && formatJumlah(1500) === "1500", "formatJumlah seperti %g");
  const sep21 = tgl("2026-09-21T05:00:00Z");
  pastikan(formatTanggalPanjang(sep21) === "21 September 2026" && formatTanggalPendek(sep21) === "21/09/2026" && bulanRomawi(sep21) === "IX", "tanggal panjang, pendek, romawi");
  pastikan(formatTanggalPanjang(pagiTahunBaru) === "1 Januari 2027" && formatTanggalPendek(malamTahunBaru) === "31/12/2026" && bulanRomawi(pagiTahunBaru) === "I", "tanggal mengikuti ZONA_WAKTU, bukan UTC");
  pastikan(rentangTanggalTeks(tgl("2026-08-27T05:00:00Z"), tgl("2026-08-30T05:00:00Z")) === "27-30 Agustus 2026", "rentang sama bulan");
  pastikan(rentangTanggalTeks(tgl("2026-08-30T05:00:00Z"), tgl("2026-09-02T05:00:00Z")) === "30 Agustus - 2 September 2026", "rentang beda bulan");
  pastikan(rentangTanggalTeks(tgl("2026-12-30T05:00:00Z"), tgl("2027-01-02T05:00:00Z")) === "30 Desember 2026 - 2 Januari 2027", "rentang beda tahun");
  pastikan(rentangTanggalTeks(sep21, sep21) === "21 September 2026" && rentangTanggalTeks(tgl("2026-08-30T05:00:00Z"), tgl("2026-08-27T05:00:00Z")) === "27-30 Agustus 2026", "rentang satu hari dan masukan terbalik");

  console.log("=== 9. Terbilang (D3 §3.4) ===");
  const harapanTerbilang: [number | string, string][] = [
    [80483260, "DELAPAN PULUH JUTA EMPAT RATUS DELAPAN PULUH TIGA RIBU DUA RATUS ENAM PULUH RUPIAH"],
    [159515000, "SERATUS LIMA PULUH SEMBILAN JUTA LIMA RATUS LIMA BELAS RIBU RUPIAH"],
    [158625000, "SERATUS LIMA PULUH DELAPAN JUTA ENAM RATUS DUA PULUH LIMA RIBU RUPIAH"],
    [79975500, "TUJUH PULUH SEMBILAN JUTA SEMBILAN RATUS TUJUH PULUH LIMA RIBU LIMA RATUS RUPIAH"],
    [0, "NOL RUPIAH"],
    [1000, "SERIBU RUPIAH"],
    [11000, "SEBELAS RIBU RUPIAH"],
    [100000, "SERATUS RIBU RUPIAH"],
    [1000000, "SATU JUTA RUPIAH"],
    [1001000, "SATU JUTA SERIBU RUPIAH"],
    [1100000, "SATU JUTA SERATUS RIBU RUPIAH"],
    [999999999, "SEMBILAN RATUS SEMBILAN PULUH SEMBILAN JUTA SEMBILAN RATUS SEMBILAN PULUH SEMBILAN RIBU SEMBILAN RATUS SEMBILAN PULUH SEMBILAN RUPIAH"],
    ["1000000000000", "SATU TRILIUN RUPIAH"],
    ["135802.37", "SERATUS TIGA PULUH LIMA RIBU DELAPAN RATUS DUA RUPIAH TIGA PULUH TUJUH SEN"],
    ["0.50", "LIMA PULUH SEN"],
    ["1000000000000000", "1000000000000000 RUPIAH"],
    [11, "SEBELAS RUPIAH"],
    [12, "DUA BELAS RUPIAH"],
    [110, "SERATUS SEPULUH RUPIAH"],
    [2000000000, "DUA MILIAR RUPIAH"],
  ];
  for (const [nilai, harapan] of harapanTerbilang) pastikan(terbilangRupiah(nilai) === harapan, `terbilang ${nilai}: ${harapan}`);
  const harapanJudul: [number, string][] = [
    [44340000, "Empat Puluh Empat Juta Tiga Ratus Empat Puluh Ribu Rupiah"],
    [531000, "Lima Ratus Tiga Puluh Satu Ribu Rupiah"],
    [12650000, "Dua Belas Juta Enam Ratus Lima Puluh Ribu Rupiah"],
    [500000, "Lima Ratus Ribu Rupiah"],
    [8261539, "Delapan Juta Dua Ratus Enam Puluh Satu Ribu Lima Ratus Tiga Puluh Sembilan Rupiah"],
  ];
  for (const [nilai, harapan] of harapanJudul) pastikan(terbilangRupiah(nilai, "JUDUL") === harapan, `terbilang JUDUL ${nilai}: ${harapan}`);
  pastikan(terbilangRupiah(D("80483260.00")) === harapanTerbilang[0][1], "terbilang menerima Decimal server");
  await harusDitolak("terbilang negatif", async () => terbilangRupiah(-1), "tidak menerima nilai negatif");
  // perbaikan tinjauan P08 butir 14: masukan tidak sah memakai pesan yang sama dengan D(); tanda diperiksa setelah pembulatan
  await harusDitolak("terbilang bukan angka", async () => terbilangRupiah("abc"), "Angka tidak valid: abc");
  await harusDitolak("terbilang string kosong", async () => terbilangRupiah(""), "Angka tidak valid: ");
  await harusDitolak("terbilang -0,005 (dibulatkan -0,01)", async () => terbilangRupiah("-0.005"), "tidak menerima nilai negatif");
  pastikan(terbilangRupiah("-0.001") === "NOL RUPIAH" && terbilangRupiah(-0.004, "JUDUL") === "Nol Rupiah", "negatif yang dibulatkan menjadi nol: NOL RUPIAH");

  console.log("=== 10. Nama berkas, teks, dan Content-Disposition ===");
  pastikan(namaBerkasAman("Invoice", "071/DPRO-INV2/IX/2026", false) === "Invoice 071-DPRO-INV2-IX-2026.pdf", "namaBerkasAman contoh D3");
  pastikan(namaBerkasAman("Invoice", "071/DPRO-INV2/IX/2026", true) === "Invoice 071-DPRO-INV2-IX-2026 (DRAF).pdf", "draf berakhiran (DRAF).pdf");
  const berbahaya = namaBerkasAman("Kwitansi", 'a\\b:c*d?e"f<g>h|i\u0000j\u202Ek\u200Bl\nm', false);
  pastikan(berbahaya === "Kwitansi a-b-c-d-e-f-g-h-ijklm.pdf", `karakter berbahaya diganti atau dibuang: ${berbahaya}`);
  const namaPanjang = namaBerkasAman("Penawaran", "x".repeat(300), false);
  pastikan(namaPanjang.length === 124 && namaPanjang.endsWith(".pdf"), `nama dipotong 120 karakter lalu .pdf (panjang ${namaPanjang.length})`);
  const namaEmoji = namaBerkasAman("a".repeat(118), "\u{1F600}", false);
  pastikan(namaEmoji.isWellFormed() && namaEmoji === `${"a".repeat(118)}.pdf`, "emoji di batas 120 tidak terbelah");
  pastikan(namaBerkasAman("", "", false) === "Dokumen.pdf" && namaBerkasAman("Invoice", "  ..  ", false) === "Invoice.pdf", "nama kosong atau hanya titik dirapikan");
  pastikan(bersihkanTeks("Tes ✓", (k) => k < 0x2000) === "Tes ?" && bersihkanTeks("Tes ✓") === "Tes ✓", "bersihkanTeks: tanpa glyph jadi ? bila pemeriksa diberikan");
  pastikan(bersihkanTeks("a\tb\r\nc\rd\u0000e\u0085f\ng") === "a b\nc\ndef\ng", "bersihkanTeks: tab jadi spasi, CRLF dan CR jadi LF, kendali C0/C1 dibuang");
  pastikan(bersihkanTeks(null) === "" && bersihkanTeks("é") === "é", "bersihkanTeks: null jadi kosong, NFC");
  pastikan(kepalaDisposisi === kepalaDisposisiBerkas && kepalaDisposisi("attachment", "Invoice 071.pdf") === "attachment; filename=\"Invoice 071.pdf\"; filename*=UTF-8''Invoice%20071.pdf", "kepalaDisposisi cetak = fungsi berkas yang sama (F6)");

  console.log("=== 11. Aman untuk komponen klien ===");
  // perbaikan tinjauan P08 butir 12: impor dibaca dari isi berkas utuh (termasuk impor bertingkat baris), lalu impor
  // nilai ke @/lib/* ditelusuri rekursif supaya impor tidak langsung juga diperiksa
  const berkasKlien = ["src/lib/nilaiBaris.ts", "src/lib/cetak/tipe.ts", "src/lib/cetak/format.ts", "src/lib/cetak/terbilang.ts"];
  // perbaikan tinjauan P10 butir 5: modul bawaan Node lain, impor relatif (dinormalkan ke alias @/), import() dinamis,
  // dan require() ikut diperiksa
  const polaTerlarang = /^(?:@\/lib\/db|@\/prisma-klien\/client|@\/lib\/otentikasi|@\/lib\/berkas|@\/lib\/log|node:.*|fs|fs\/promises|path|crypto|os|child_process|stream|net|http|https|zlib|worker_threads)$/;
  const keAlias = (berkas: string, sumber: string) => (sumber.startsWith(".") ? `@/${posix.relative("src", posix.join(posix.dirname(berkas), sumber))}` : sumber);
  const imporBerkas = (isi: string, berkas = "src/lib/x.ts") => [
    ...[...isi.matchAll(/\b(import|export)\s+(type\s+)?(?:[^"';]*?\bfrom\s+)?["']([^"']+)["']/g)].map((m) => ({ jenisTipe: !!m[2], sumber: keAlias(berkas, m[3]) })),
    ...[...isi.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g)].map((m) => ({ jenisTipe: false, sumber: keAlias(berkas, m[1]) })),
  ];
  const keBerkas = (sumber: string) => {
    if (!sumber.startsWith("@/lib/")) return null;
    const dasar = `src/${sumber.slice(2)}`;
    for (const calon of [`${dasar}.ts`, `${dasar}.tsx`, `${dasar}/index.ts`]) {
      try {
        readFileSync(calon);
        return calon;
      } catch {
        // coba calon berikutnya
      }
    }
    return null;
  };
  pastikan(imporBerkas('import {\n  a,\n  b,\n} from "@/lib/db";').some((i) => i.sumber === "@/lib/db"), "penjaga impor menangkap impor bertingkat baris");
  pastikan(imporBerkas('import { db } from "../db";', "src/lib/cetak/format.ts").some((i) => polaTerlarang.test(i.sumber)) && imporBerkas('export * from "./uang";', "src/lib/nilaiBaris.ts")[0]?.sumber === "@/lib/uang", "penjaga impor menormalkan impor relatif ke alias");
  pastikan(imporBerkas('const m = await import("@/lib/db");').some((i) => i.sumber === "@/lib/db" && !i.jenisTipe) && imporBerkas('const fs = require("fs");').some((i) => polaTerlarang.test(i.sumber)), "penjaga impor menangkap import() dinamis dan require()");
  pastikan(["os", "child_process", "stream", "node:os"].every((m) => polaTerlarang.test(m)), "penjaga impor menolak modul bawaan Node lain");
  for (const awal of berkasKlien) {
    const dikunjungi = new Set<string>();
    const antre = [awal];
    const terlarang: string[] = [];
    while (antre.length > 0) {
      const berkas = antre.pop()!;
      if (dikunjungi.has(berkas)) continue;
      dikunjungi.add(berkas);
      for (const { jenisTipe, sumber } of imporBerkas(readFileSync(berkas, "utf8"), berkas)) {
        if (jenisTipe) continue; // impor tipe dihapus saat kompilasi
        if (polaTerlarang.test(sumber) || sumber === "@/lib/uang") terlarang.push(`${berkas}: ${sumber}`);
        const lanjut = keBerkas(sumber);
        if (lanjut) antre.push(lanjut);
      }
    }
    pastikan(terlarang.length === 0, `${awal}: tanpa impor db, klien Prisma server, atau nilai uang.ts, langsung maupun tidak langsung (${terlarang.join(" | ")}; ditelusuri ${dikunjungi.size} berkas)`);
  }

  console.log("=== 12. Bersih-bersih ===");
  await bersihkanData();
  pastikan((await db.perusahaan.count({ where: { kode: KODE_PT } })) === 0 && (await db.pelanggan.count({ where: { kode: KODE_PLG } })) === 0, "perusahaan dan pelanggan uji terhapus");
  pastikan((await db.formatNomor.count()) === awalFormat && (await db.penghitungNomor.count()) === awalPenghitung, "FormatNomor dan PenghitungNomor kembali ke jumlah awal");
  pastikan((await db.hakAksesPeran.count()) === awalHakAksesPeran, "tidak ada baris HakAksesPeran baru");
  console.log("=== DONE, all pustaka bersama checks passed ===");
}

main()
  .catch(async (galat) => {
    console.error(galat);
    await bersihkanData().catch((e) => console.error("bersih-bersih gagal", e));
    process.exit(1);
  })
  .finally(() => db.$disconnect());
