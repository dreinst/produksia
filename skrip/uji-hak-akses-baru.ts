import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import {
  DAFTAR_PERAN, DOKUMEN_HAK, HAK_ADMIN_BARU, HAK_BAWAAN, HAK_LAIN, HAK_TERTINGGI_SAJA, KETERANGAN_PERAN, LABEL_PERAN,
  PERAN_DAPAT_DIATUR, SEMUA_HAK, hitungHak, hitungHakPengguna, kunciSebelumPeleburan, labelHak, labelPeranPengguna,
  modulTerlihat, peranEfektif, peranTertinggi, punyaHak, type Hak, type PenggunaSesi,
} from "../src/lib/hakAkses";
import { barisMatriks, bacaMatriksFormulir, kotakMatriks } from "../src/lib/matriksHakAkses";
import { simpanHakAkses, pulihkanHakBawaan } from "../src/lib/aksi/hakAkses";
import { penggunaSaatIni, wajibHakAksi } from "../src/lib/otentikasi";
import type { PeranPengguna } from "../src/prisma-klien/enums";
import { jalankan, formulir, sebagai } from "./bantuan";

/*
 * Kunci hak sesudah peleburan HKA (desain HAK.md): 171 kunci, bawaan eksplisit sepuluh peran, bagian lama
 * ADMIN beku + HAK_ADMIN_BARU, matriks Pengaturan › Hak Akses yang merender dan memproses semua aksi, dan
 * peran tambahan per pengguna. Suite ini berjalan tepat sebelum uji-hak-akses.ts (urut abjad), jadi semua
 * baris HakAksesPeran dihapus di blok finally. Pemeriksa lokal melempar galat (bukan process.exit) supaya
 * blok finally tetap berjalan saat gagal.
 */

function pastikan(kondisi: unknown, pesan: string): asserts kondisi {
  if (!kondisi) throw new Error(`[FAIL] ${pesan}`);
  console.log(`[ok] ${pesan}`);
}
async function harusDitolak(label: string, fn: () => Promise<unknown>, potongan: string) {
  let pesan: string | null = null;
  try {
    await fn();
  } catch (err) {
    pesan = (err as { message?: string })?.message ?? String(err);
  }
  pastikan(pesan !== null && pesan.includes(potongan), `${label} ditolak: "${pesan}"`);
}
async function denganEnv<T>(isian: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const lama = Object.fromEntries(Object.keys(isian).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(isian)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(lama)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

const sesi = (peran: PeranPengguna, hak: readonly Hak[]): PenggunaSesi => ({ id: "x", nama: "Uji", namaPengguna: "uji", email: null, nomorTelepon: null, peran, hak });
const samaHimpunan = (a: readonly string[], b: readonly string[]) => new Set(a).size === new Set(b).size && a.every((x) => b.includes(x));
const samaUrut = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const PERAN_LAMA = ["ADMIN", "KASIR", "GUDANG", "KRU", "GUEST"] as const;
const PREFIKS_UJI = "ujih-";

// Salinan tabel HAK.md §2.1 (kolom: ADMIN KASIR GUDANG KRU GUEST SOSMED IKLAN DESAINER; y = bawaan, - = bukan)
const KOLOM_TABEL: readonly PeranPengguna[] = ["ADMIN", "KASIR", "GUDANG", "KRU", "GUEST", "SOSMED", "IKLAN", "DESAINER"];
const TABEL_BAWAAN: Record<string, string> = {
  "perusahaan-gabungan.lihat": "y-y--yyy",
  "antar-perusahaan.lihat": "y-------",
  "antar-perusahaan.buat": "y-------",
  "antar-perusahaan.hapus": "y-------",
  "penawaran.ubah": "yy------",
  "pesanan.ubah": "yy------",
  "uang-muka.ubah": "yy------",
  "faktur.ubah": "yy------",
  "penerimaan.ubah": "yy------",
  "tanda-tangan-cetak.buat": "y-------",
  "lead.lihat": "y-------",
  "lead.buat": "y-------",
  "lead.ubah": "y-------",
  "lead.hapus": "y-------",
  "pengaturan-crm.ubah": "--------",
  "konten.lihat": "y----yyy",
  "konten.buat": "-----y--",
  "konten.ubah": "-----y--",
  "konten.setujui": "--------",
  "konten.hapus": "-----y--",
  "tugas-desain.lihat": "y----yyy",
  "tugas-desain.buat": "y----yy-",
  "tugas-desain.ubah": "y----y-y",
  "tugas-desain.setujui": "-----y--",
  "tugas-desain.hapus": "--------",
  "kampanye.lihat": "y-----y-",
  "kampanye.buat": "------y-",
  "kampanye.ubah": "------y-",
  "kampanye.hapus": "------y-",
  "proyek.lihat": "yy---yyy",
  "kategori-anggaran.ubah": "y-------",
  "anggaran-proyek.lihat": "y-------",
  "anggaran-proyek.buat": "y-------",
  "anggaran-proyek.ubah": "y-------",
  "anggaran-proyek.hapus": "y-------",
  "bagi-hasil.lihat": "y-------",
  "bagi-hasil.buat": "--------",
  "bagi-hasil.ubah": "--------",
  "bagi-hasil.hapus": "--------",
  "talangan-mitra.lihat": "y-------",
  "talangan-mitra.buat": "y-------",
  "talangan-mitra.setujui": "y-------",
  "talangan-mitra.hapus": "y-------",
  "pembayaran-mitra.lihat": "y-------",
  "pembayaran-mitra.buat": "y-------",
  "pembayaran-mitra.setujui": "--------",
  "pembayaran-mitra.hapus": "--------",
  "berkas.lihat": "y----yyy",
  "berkas.buat": "y----yyy",
  "berkas.ubah": "y----y--",
  "berkas.hapus": "--------",
  "berkas.bagikan": "y----yyy",
  "berkas.akses-penuh": "--------", // HAK_TERTINGGI_SAJA
  "beranda-keuangan.lihat": "yy------",
};

// Salinan daftar literal HAK.md §2.4
const BAWAAN_PERAN_BARU: Record<"SOSMED" | "IKLAN" | "DESAINER", readonly string[]> = {
  SOSMED: ["perusahaan-gabungan.lihat", "proyek.lihat", "konten.lihat", "konten.buat", "konten.ubah", "konten.hapus", "tugas-desain.lihat", "tugas-desain.buat", "tugas-desain.ubah", "tugas-desain.setujui", "berkas.lihat", "berkas.buat", "berkas.ubah", "berkas.bagikan"],
  IKLAN: ["perusahaan-gabungan.lihat", "proyek.lihat", "konten.lihat", "tugas-desain.lihat", "tugas-desain.buat", "kampanye.lihat", "kampanye.buat", "kampanye.ubah", "kampanye.hapus", "berkas.lihat", "berkas.buat", "berkas.bagikan"],
  DESAINER: ["perusahaan-gabungan.lihat", "proyek.lihat", "konten.lihat", "tugas-desain.lihat", "tugas-desain.ubah", "berkas.lihat", "berkas.buat", "berkas.bagikan"],
};

/** Formulir seperti yang dikirim halaman: penanda untuk `peranBertanda` dan kotak tercentang untuk setiap hak efektif yang punya kotak. */
async function formulirHalaman(peranBertanda: readonly PeranPengguna[], ubah: (isian: Map<string, boolean>) => void = () => {}): Promise<FormData> {
  const penyesuaian = await db.hakAksesPeran.findMany();
  const kotak = kotakMatriks();
  const isian = new Map<string, boolean>();
  for (const p of peranBertanda) {
    const efektif = new Set(hitungHak(p, penyesuaian.filter((x) => x.peran === p)));
    for (const h of kotak) isian.set(`${p}|${h}`, efektif.has(h));
  }
  ubah(isian);
  const fd = new FormData();
  for (const p of peranBertanda) fd.append("peranDirender", p);
  for (const [k, v] of isian) if (v) fd.append(k, "on");
  return fd;
}

const jumlahLogHakAkses = (sejak: Date) => db.logAktivitas.count({ where: { waktu: { gte: sejak }, jenis: "Hak Akses" } });

async function main() {
  const kunciBaru = SEMUA_HAK.filter((h) => !kunciSebelumPeleburan(h));

  console.log("=== 1. Struktur ===");
  pastikan(SEMUA_HAK.length === 171, `SEMUA_HAK berisi ${SEMUA_HAK.length} kunci (harus 171; domain yang menambah kunci wajib memperbarui uji ini dan memutuskan bawaannya)`);
  pastikan(SEMUA_HAK.length === DOKUMEN_HAK.reduce((s, d) => s + d.aksi.length, 0) + HAK_LAIN.length, "rumus jumlah: Σ aksi dokumen + HAK_LAIN");
  pastikan(new Set(SEMUA_HAK).size === SEMUA_HAK.length, "tidak ada kunci ganda");
  for (const p of DAFTAR_PERAN) {
    const b = HAK_BAWAAN[p] as readonly string[];
    pastikan(b.every((h) => (SEMUA_HAK as readonly string[]).includes(h)) && new Set(b).size === b.length, `bawaan ${p}: semua kunci terdaftar dan unik (${b.length})`);
  }
  pastikan(kunciBaru.length === 54, `54 kunci baru (${kunciBaru.length})`);
  pastikan(kunciBaru.every((h) => labelHak(h) !== h), "setiap kunci baru punya label");
  pastikan(SEMUA_HAK.every((h) => !/[\u2013\u2014]/.test(labelHak(h))), "tidak ada label hak yang memuat tanda pisah panjang");
  const desainer = sesi("DESAINER", HAK_BAWAAN.DESAINER);
  pastikan(modulTerlihat(desainer, "pemasaran") && modulTerlihat(desainer, "berkas") && !modulTerlihat(desainer, "penjualan"), "Desainer: modul pemasaran dan berkas tampil, penjualan tidak");

  console.log("=== 2. Potret kunci lama ===");
  pastikan(SEMUA_HAK.filter(kunciSebelumPeleburan).length === 117, "117 kunci lolos kunciSebelumPeleburan");
  pastikan(["tutup-buku.lihat", "tutup-buku.hapus", "pph-final.lihat", "pelepasan-aset.lihat"].every((h) => !kunciSebelumPeleburan(h)), "kunci fantom (tutup-buku.lihat dst.) bukan kunci lama");
  pastikan(HAK_ADMIN_BARU.every((h) => !kunciSebelumPeleburan(h)), "semua HAK_ADMIN_BARU adalah kunci baru");

  console.log("=== 3. Tabel bawaan kunci baru ===");
  pastikan(Object.keys(TABEL_BAWAAN).length === 54 && samaHimpunan(Object.keys(TABEL_BAWAAN), kunciBaru), "setiap kunci baru punya keputusan bawaan di tabel (dan sebaliknya)");
  let selSalah = 0;
  for (const [h, baris] of Object.entries(TABEL_BAWAAN)) {
    KOLOM_TABEL.forEach((p, i) => {
      if (punyaHak(p, h as Hak) !== (baris[i] === "y")) {
        selSalah++;
        console.error(`  sel salah: ${p} ${h}`);
      }
    });
  }
  pastikan(selSalah === 0, `bawaan ${KOLOM_TABEL.length} peran × 54 kunci baru sama dengan tabel HAK.md §2.1`);
  const jumlahPerKolom = KOLOM_TABEL.map((_, i) => Object.values(TABEL_BAWAAN).filter((b) => b[i] === "y").length).join(",");
  pastikan(jumlahPerKolom === "37,7,1,0,0,14,12,8", `jumlah kunci baru per peran ${jumlahPerKolom}`);

  console.log("=== 4. ADMIN ===");
  const daftarHitamLama = ["pengaturan.tulis", "pengguna.kelola", "buku-besar.tulis", "hak-akses.kelola", "sdm.lihat", "sdm.tulis", "penggajian.lihat", "penggajian.buat", "penggajian.setujui", "penggajian.hapus"];
  pastikan(SEMUA_HAK.filter(kunciSebelumPeleburan).every((h) => punyaHak("ADMIN", h) === !daftarHitamLama.includes(h)), "kunci lama ADMIN sama dengan rumus daftar hitam lama");
  pastikan(kunciBaru.every((h) => punyaHak("ADMIN", h) === HAK_ADMIN_BARU.includes(h)), "kunci baru ADMIN persis HAK_ADMIN_BARU");
  pastikan(HAK_BAWAAN.ADMIN.length === 144 && HAK_ADMIN_BARU.length === 37, `bawaan ADMIN ${HAK_BAWAAN.ADMIN.length} = 107 lama + ${HAK_ADMIN_BARU.length} baru`);
  const adminPunya: Hak[] = ["faktur.setujui", "peminjaman.hapus", "perusahaan-gabungan.lihat", "antar-perusahaan.buat", "penawaran.ubah", "tanda-tangan-cetak.buat", "lead.hapus", "kategori-anggaran.ubah", "bagi-hasil.lihat", "talangan-mitra.setujui", "pembayaran-mitra.buat", "tugas-desain.ubah", "berkas.bagikan", "beranda-keuangan.lihat"];
  const adminTidak: Hak[] = ["pengaturan-crm.ubah", "konten.setujui", "kampanye.buat", "bagi-hasil.ubah", "pembayaran-mitra.setujui", "pembayaran-mitra.hapus", "berkas.hapus", "berkas.akses-penuh"];
  pastikan(adminPunya.every((h) => punyaHak("ADMIN", h)), `ADMIN punya ${adminPunya.join(", ")}`);
  pastikan(adminTidak.every((h) => !punyaHak("ADMIN", h)), `ADMIN tidak punya ${adminTidak.join(", ")}`);

  console.log("=== 5. Peran lama lain ===");
  const baruDari = (p: PeranPengguna) => (HAK_BAWAAN[p] as readonly string[]).filter((h) => !kunciSebelumPeleburan(h));
  pastikan(samaHimpunan(baruDari("KASIR"), ["beranda-keuangan.lihat", "proyek.lihat", "penawaran.ubah", "pesanan.ubah", "uang-muka.ubah", "faktur.ubah", "penerimaan.ubah"]) && HAK_BAWAAN.KASIR.length === 38, "KASIR: tujuh kunci baru, total 38");
  pastikan(samaUrut(baruDari("GUDANG"), ["perusahaan-gabungan.lihat"]) && HAK_BAWAAN.GUDANG.length === 18, "GUDANG: hanya perusahaan-gabungan.lihat, total 18");
  pastikan(baruDari("KRU").length === 0 && baruDari("GUEST").length === 0 && HAK_BAWAAN.KRU.length === 2 && HAK_BAWAAN.GUEST.length === 2, "KRU dan GUEST tanpa kunci baru, masing-masing 2");
  pastikan(!punyaHak("KASIR", "perusahaan-gabungan.lihat") && !punyaHak("KASIR", "lead.lihat") && !punyaHak("KASIR", "berkas.lihat") && !punyaHak("KASIR", "faktur.setujui"), "KASIR tanpa gabungan, lead, berkas umum, dan setujui faktur");

  console.log("=== 6. Peran baru ===");
  for (const p of ["SOSMED", "IKLAN", "DESAINER"] as const) {
    const b = HAK_BAWAAN[p] as readonly string[];
    pastikan(samaUrut(b, BAWAAN_PERAN_BARU[p]), `${p}: bawaan sama persis dengan daftar HAK.md §2.4 (${b.length})`);
    pastikan(b.every((h) => !kunciSebelumPeleburan(h)), `${p}: tidak memegang kunci lama`);
    pastikan(!b.includes("beranda-keuangan.lihat") && !b.includes("berkas.hapus") && !b.includes("berkas.akses-penuh"), `${p}: tanpa beranda keuangan, hapus berkas, akses penuh berkas`);
    pastikan(LABEL_PERAN[p].length > 0 && KETERANGAN_PERAN[p].length > 0 && DAFTAR_PERAN.includes(p) && PERAN_DAPAT_DIATUR.includes(p) && !peranTertinggi(p), `${p}: berlabel, berketerangan, bisa diatur, bukan tertinggi`);
  }
  pastikan(LABEL_PERAN.SOSMED === "Pengelola Media Sosial" && LABEL_PERAN.IKLAN === "Pengelola Iklan" && LABEL_PERAN.DESAINER === "Desainer", "label tiga peran baru");

  console.log("=== 7. Hak tertinggi ===");
  pastikan(HAK_TERTINGGI_SAJA.includes("berkas.akses-penuh") && HAK_TERTINGGI_SAJA.length === 8, "HAK_TERTINGGI_SAJA memuat berkas.akses-penuh (8 kunci)");
  for (const p of PERAN_DAPAT_DIATUR) pastikan(HAK_TERTINGGI_SAJA.every((h) => !HAK_BAWAAN[p].includes(h)), `${p} tidak membawa kunci tertinggi`);
  pastikan(punyaHak("PEMILIK", "berkas.akses-penuh") && punyaHak("SUPERADMIN", "berkas.akses-penuh"), "Pemilik dan Superadmin punya berkas.akses-penuh");
  await jalankan("simpan matriks dengan ADMIN|berkas.akses-penuh dicentang", async () => simpanHakAkses(await formulirHalaman(["ADMIN"], (m) => m.set("ADMIN|berkas.akses-penuh", true))));
  pastikan((await db.hakAksesPeran.count()) === 0, "berkas.akses-penuh tidak bisa diberikan ke ADMIN lewat formulir");
  await harusDitolak("simpan matriks oleh ADMIN", () => denganEnv({ UJI_PERAN: "ADMIN" }, async () => simpanHakAkses(await formulirHalaman(["ADMIN"]))), "tidak punya hak");
  await harusDitolak("kembalikan bawaan oleh KASIR", () => denganEnv({ UJI_PERAN: "KASIR" }, () => pulihkanHakBawaan()), "tidak punya hak");

  console.log("=== 8. Matriks Hak Akses ===");
  const tanpaTertinggi = SEMUA_HAK.filter((h) => !HAK_TERTINGGI_SAJA.includes(h));
  pastikan(kotakMatriks().length === 163 && samaHimpunan(kotakMatriks(), tanpaTertinggi), "kotakMatriks = SEMUA_HAK tanpa HAK_TERTINGGI_SAJA (163)");
  const selMatriks = barisMatriks().flatMap((k) => k.dokumen.flatMap((d) => d.sel.map((s) => s.hak as string)));
  pastikan(samaHimpunan(selMatriks, DOKUMEN_HAK.flatMap((d) => d.aksi.map((a) => `${d.kode}.${a}`))), "barisMatriks punya sel untuk setiap aksi setiap dokumen");
  pastikan(["faktur.setujui", "peminjaman.setujui", "kerusakan.setujui", "lead.ubah", "tugas-desain.setujui", "talangan-mitra.setujui", "penawaran.ubah"].every((h) => selMatriks.includes(h)), "sel setujui dan ubah dirender (faktur.setujui, lead.ubah, dst.)");
  pastikan(barisMatriks().find((k) => k.modul === "buku-besar")?.dokumen.some((d) => d.kode === "antar-perusahaan") === true, "antar-perusahaan tampil di kelompok Buku Besar");
  const baca = bacaMatriksFormulir(formulir({ "PEMILIK|faktur.buat": "on", "KASIR|faktur.buat": "on", "GUDANG|faktur.buat": "off" }));
  pastikan(samaUrut(baca.peranDiproses, ["KASIR"]), "bacaMatriksFormulir: peran di luar PERAN_DAPAT_DIATUR dan kotak bukan 'on' diabaikan");

  let sejak = new Date();
  await jalankan("simpan formulir UI sungguhan (delapan peran bertanda)", async () => simpanHakAkses(await formulirHalaman(PERAN_DAPAT_DIATUR)));
  pastikan((await db.hakAksesPeran.count()) === 0, "formulir UI tanpa perubahan tidak menyimpan penyesuaian");
  pastikan((await jumlahLogHakAkses(sejak)) === 0, "simpan tanpa perubahan tidak menulis log");
  const tersimpan = await db.hakAksesPeran.findMany();
  const efektif = (p: PeranPengguna) => hitungHak(p, tersimpan.filter((x) => x.peran === p));
  pastikan(efektif("ADMIN").includes("faktur.setujui") && efektif("GUDANG").includes("peminjaman.setujui") && efektif("GUDANG").includes("kerusakan.setujui") && efektif("SOSMED").includes("tugas-desain.setujui"), "hak setujui ADMIN, GUDANG, SOSMED tetap utuh setelah simpan dari halaman");

  sejak = new Date();
  await jalankan("simpan dengan penanda SOSMED saja, konten.hapus dicabut", async () => simpanHakAkses(await formulirHalaman(["SOSMED"], (m) => m.set("SOSMED|konten.hapus", false))));
  const barisSosmed = await db.hakAksesPeran.findMany();
  pastikan(barisSosmed.length === 1 && barisSosmed[0].peran === "SOSMED" && barisSosmed[0].hak === "konten.hapus" && !barisSosmed[0].boleh, "tepat satu baris: SOSMED konten.hapus = tidak");
  pastikan((await jumlahLogHakAkses(sejak)) === 1, "satu log Hak Akses untuk simpan yang mengubah");
  await jalankan("pulihkan bawaan", () => pulihkanHakBawaan());

  await jalankan("simpan dengan penanda DESAINER tanpa kotak", () => simpanHakAkses(formulir({ peranDirender: "DESAINER" })));
  const barisDesainer = await db.hakAksesPeran.findMany();
  pastikan(barisDesainer.length === HAK_BAWAAN.DESAINER.length && barisDesainer.every((b) => b.peran === "DESAINER" && !b.boleh), `penanda tanpa kotak mencabut semua bawaan DESAINER (${barisDesainer.length} baris)`);

  sejak = new Date();
  const isianLama: Record<string, string> = {};
  for (const p of PERAN_LAMA) for (const h of HAK_BAWAAN[p]) isianLama[`${p}|${h}`] = "on";
  await jalankan("simpan formulir gaya lama (tanpa penanda, lima peran lama)", () => simpanHakAkses(formulir(isianLama)));
  pastikan((await db.hakAksesPeran.count()) === HAK_BAWAAN.DESAINER.length && (await db.hakAksesPeran.count({ where: { peran: "DESAINER" } })) === HAK_BAWAAN.DESAINER.length, "formulir tanpa penanda tidak menyentuh peran yang tidak dirender");
  pastikan((await jumlahLogHakAkses(sejak)) === 0, "formulir gaya lama tanpa selisih tidak menulis log");

  await jalankan("pulihkan bawaan", () => pulihkanHakBawaan());
  pastikan((await db.hakAksesPeran.count()) === 0, "pulihkanHakBawaan mengosongkan penyesuaian");

  console.log("=== 9. Peran tambahan ===");
  const adminDesainer = hitungHakPengguna("ADMIN", ["DESAINER"]);
  pastikan(samaUrut(hitungHakPengguna("ADMIN", []), hitungHak("ADMIN")) && samaUrut(hitungHakPengguna("KASIR", []), hitungHak("KASIR")), "tanpa peran tambahan hasilnya sama dengan hitungHak");
  pastikan(HAK_BAWAAN.DESAINER.every((h) => adminDesainer.includes(h)) && HAK_BAWAAN.ADMIN.every((h) => adminDesainer.includes(h)), "ADMIN + DESAINER = gabungan kedua bawaan");
  const kasirDesainer = hitungHakPengguna("KASIR", ["DESAINER"]);
  pastikan(kasirDesainer.includes("tugas-desain.ubah") && kasirDesainer.includes("faktur.buat") && !kasirDesainer.includes("konten.buat"), "KASIR + DESAINER mendapat tugas-desain.ubah tanpa konten.buat");
  pastikan(samaUrut(kasirDesainer, SEMUA_HAK.filter((h) => kasirDesainer.includes(h))), "hasil gabungan terurut menurut SEMUA_HAK");
  pastikan(samaUrut(hitungHakPengguna("KASIR", ["GUDANG", "PEMILIK"]), hitungHak("KASIR")), "peran tambahan di luar SOSMED/IKLAN/DESAINER diabaikan");
  pastikan(samaUrut(hitungHakPengguna("PEMILIK", []), [...SEMUA_HAK]), "peran utama tertinggi tetap penuh");
  pastikan(hitungHakPengguna("ADMIN", ["DESAINER"], [{ peran: "ADMIN", hak: "tugas-desain.ubah", boleh: false }]).includes("tugas-desain.ubah"), "pencabutan di satu peran tidak mencabut hak yang diberikan peran lain");
  pastikan(!hitungHakPengguna("KASIR", ["DESAINER"], [{ peran: "DESAINER", hak: "tugas-desain.ubah", boleh: false }]).includes("tugas-desain.ubah"), "pencabutan di peran tambahan berlaku bila tidak ada peran lain yang memberi");
  pastikan(hitungHakPengguna("KASIR", ["DESAINER"], [{ peran: "KASIR", hak: "konten.buat", boleh: true }]).includes("konten.buat"), "penyesuaian peran utama tetap berlaku");
  pastikan(samaUrut(peranEfektif({ peran: "ADMIN", peranTambahan: ["DESAINER", "DESAINER", "ADMIN", "KASIR"] }), ["ADMIN", "DESAINER"]), "peranEfektif membuang duplikat, peran utama, dan peran tak sah");
  pastikan(labelPeranPengguna({ peran: "ADMIN", peranTambahan: ["DESAINER"] }) === "Admin + Desainer" && labelPeranPengguna({ peran: "KASIR" }) === "Kasir", "labelPeranPengguna");

  const tanpaTambahan = await denganEnv({ UJI_PERAN: "KASIR", UJI_PERAN_TAMBAHAN: undefined }, () => penggunaSaatIni());
  pastikan(tanpaTambahan !== null && samaUrut(tanpaTambahan.hak, hitungHak("KASIR")), "pintu uji UJI_PERAN=KASIR tanpa tambahan sama dengan perilaku lama");
  const denganTambahan = await denganEnv({ UJI_PERAN: "KASIR", UJI_PERAN_TAMBAHAN: "DESAINER,GUDANG" }, () => penggunaSaatIni());
  pastikan(denganTambahan !== null && samaUrut(denganTambahan.peranTambahan ?? [], ["DESAINER"]) && samaUrut(denganTambahan.hak, kasirDesainer), "UJI_PERAN_TAMBAHAN=DESAINER,GUDANG: hanya DESAINER yang dipakai, hak gabungan");
  await denganEnv({ UJI_PERAN: "KASIR", UJI_PERAN_TAMBAHAN: "DESAINER" }, async () => {
    await jalankan("KASIR + DESAINER lolos wajibHakAksi tugas-desain.ubah", () => wajibHakAksi("tugas-desain.ubah"));
    await harusDitolak("KASIR + DESAINER untuk konten.buat", () => wajibHakAksi("konten.buat"), "tidak punya hak");
  });
  await harusDitolak("DESAINER untuk faktur.lihat", () => denganEnv({ UJI_PERAN: "DESAINER" }, () => wajibHakAksi("faktur.lihat")), "tidak punya hak");

  // Penyesuaian dari tabel dibaca untuk peran tambahan juga
  await db.hakAksesPeran.create({ data: { peran: "DESAINER", hak: "tugas-desain.ubah", boleh: false } });
  const kasirDicabut = await denganEnv({ UJI_PERAN: "KASIR", UJI_PERAN_TAMBAHAN: "DESAINER" }, () => penggunaSaatIni());
  pastikan(kasirDicabut !== null && !kasirDicabut.hak.includes("tugas-desain.ubah") && kasirDicabut.hak.includes("tugas-desain.lihat"), "penyesuaian peran tambahan di tabel ikut dibaca pintu uji");
  await db.hakAksesPeran.deleteMany();

  // Pengguna sungguhan dengan peran tambahan
  await db.pengguna.create({ data: { namaPengguna: `${PREFIKS_UJI}admin-desainer`, nama: "Uji Admin Desainer", peran: "ADMIN", peranTambahan: ["DESAINER"], kataSandiHash: "-" } });
  await db.pengguna.create({ data: { namaPengguna: `${PREFIKS_UJI}kasir-desainer`, nama: "Uji Kasir Desainer", peran: "KASIR", peranTambahan: ["DESAINER"], kataSandiHash: "-" } });
  const nyataAdmin = await sebagai(`${PREFIKS_UJI}admin-desainer`, () => penggunaSaatIni());
  pastikan(nyataAdmin !== null && samaUrut(nyataAdmin.peranTambahan ?? [], ["DESAINER"]) && nyataAdmin.hak.includes("tugas-desain.ubah") && nyataAdmin.hak.includes("lead.lihat"), "pengguna nyata ADMIN + DESAINER: peranTambahan terbaca, hak gabungan");
  const nyataKasir = await sebagai(`${PREFIKS_UJI}kasir-desainer`, () => penggunaSaatIni());
  pastikan(nyataKasir !== null && samaUrut(nyataKasir.hak, kasirDesainer), "pengguna nyata KASIR + DESAINER mendapat gabungan hak");
  const tanpaKolom = await db.pengguna.findUniqueOrThrow({ where: { namaPengguna: "admin" }, select: { peranTambahan: true } });
  pastikan(Array.isArray(tanpaKolom.peranTambahan) && tanpaKolom.peranTambahan.length === 0, "pengguna lama berperan tambahan kosong");
}

async function bersihkan(mulaiUji: Date) {
  const uji = await db.pengguna.findMany({ where: { namaPengguna: { startsWith: PREFIKS_UJI } }, select: { id: true } });
  await db.sesi.deleteMany({ where: { penggunaId: { in: uji.map((u) => u.id) } } });
  await db.pengguna.deleteMany({ where: { id: { in: uji.map((u) => u.id) } } });
  await db.hakAksesPeran.deleteMany();
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
}

(async () => {
  const mulaiUji = new Date();
  let gagal: unknown = null;
  try {
    await bersihkan(new Date(8.64e15)); // sisa pengguna uji dari putaran yang terputus (log lama tidak disentuh)
    await main();
  } catch (err) {
    gagal = err;
  } finally {
    await bersihkan(mulaiUji);
  }
  if (gagal) {
    console.error("TEST FAILED", gagal);
    process.exit(1);
  }
  if ((await db.hakAksesPeran.count()) !== 0) {
    console.error("[FAIL] HakAksesPeran tidak kosong setelah bersih-bersih");
    process.exit(1);
  }
  console.log("[ok] HakAksesPeran kosong setelah bersih-bersih");
  console.log("=== DONE, all hak akses baru checks passed ===");
  process.exit(0);
})();
