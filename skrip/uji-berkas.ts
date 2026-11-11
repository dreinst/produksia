import "dotenv/config";
// Skrip ini memanggil aksi server dan pustaka di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { db } from "../src/lib/db";
import nextConfig from "../next.config";
import { Prisma } from "../src/prisma-klien/client";
import { hashKataSandi } from "../src/lib/kataSandi";
import { penggunaSaatIni } from "../src/lib/otentikasi";
import { SEMUA_HAK, hitungHak, jalurPublik, type Hak, type PenggunaSesi } from "../src/lib/hakAkses";
import { punyaHak } from "../src/lib/hakAkses";
import { syaratLogTerlihat } from "../src/lib/log";
import { potongAman } from "../src/lib/tipeBerkas";
import {
  BATAS_PERMINTAAN_UNGGAH,
  BATAS_UKURAN_BERKAS,
  DAFTAR_JENIS,
  JENIS_CETAK_KE_LAMPIRAN,
  JENIS_LAMPIRAN,
  ambilBerkasTerlihat,
  bacaFormulirTerbatas,
  bacaIsiBerkas,
  bacaTautanPublik,
  bacaUntukDikirim,
  bersihkanNamaBerkas,
  bolehAksesBerkas,
  bolehUnggahSesuatu,
  buangLampiranEntitas,
  buangSatuBerkas,
  buatTautanBagiBerkas,
  cariBerkas,
  catatLogBerkas,
  daftarBerkasAktifEntitas,
  daftarBerkasTerlihat,
  daftarFolderTerlihat,
  deteksiTipe,
  hashTokenBagi,
  kepalaDisposisi,
  periksaTautanPublik,
  ringkasPenyimpanan,
  ruangTersembunyi,
  simpanBerkas,
  sinkronProyekLampiran,
  type JenisLampiran,
  type MasukanBerkas,
} from "../src/lib/berkas";
import {
  buangBerkas,
  bukaPembatasanProyek,
  buatFolderBerkas,
  buatTautanBagi,
  cabutTautanBagi,
  hapusFolderBerkas,
  hapusPermanenBerkas,
  pulihkanBerkas,
  simpanAksesBerkasProyek,
  simpanAksesFolder,
  ubahBerkas,
  ubahFolderBerkas,
} from "../src/lib/aksi/berkas";
import { buatPenawaran } from "../src/lib/aksi/penjualan";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import type { PeranPengguna } from "../src/prisma-klien/client";
import { petaTautanAktif } from "../src/komponen/berkas/LampiranBerkas";
import { readFileSync } from "node:fs";
import { formulir, harusDitolak, jalankan, pastikan, sebagai } from "./bantuan";
import { NextRequest } from "next/server";
import { config as configProxy, proxy } from "../src/proxy";

/*
 * Uji pustaka berkas, aksi berkas, dan jalur publik (P06, D7 §9.2): deteksi tipe, nama, unggah, hak per berkas,
 * pembatasan folder dan proyek, pratinjau/unduh, ubah, buang/pulihkan/hapus permanen, tautan bagi, folder buatan,
 * lampiran yatim, pembantu domain, pencarian, dan log berkas. Semua data berawalan UJIB- (pengguna uji-berkas-),
 * dibersihkan di awal dan di akhir; FolderBerkas dikembalikan ke potret awal.
 */

const P = "UJIB-";
const PENGGUNA_UJI = "uji-berkas-";
const mulaiUji = new Date();

type PotretFolder = { kode: string; nama: string; urutan: number; sistem: boolean; terbatas: boolean; peranBoleh: PeranPengguna[] };
let potret: PotretFolder[] = [];

function sesi(peran: PeranPengguna, hak: readonly Hak[] = hitungHak(peran)): PenggunaSesi {
  return { id: "skrip-uji", nama: "Skrip Uji", namaPengguna: "skrip-uji", email: null, nomorTelepon: null, peran, hak };
}
const PEMILIK = sesi("PEMILIK");
const ADMIN = sesi("ADMIN");
const KASIR = sesi("KASIR");
const SOSMED = sesi("SOSMED");
const IKLAN = sesi("IKLAN");
const DESAINER = sesi("DESAINER");

/** Menjalankan aksi sebagai peran tiruan (UJI_PERAN). PEMILIK = tanpa UJI_PERAN. */
async function sebagaiPeran<T>(peran: PeranPengguna, fn: () => Promise<T>): Promise<T> {
  const lama = process.env.UJI_PERAN;
  if (peran === "PEMILIK") delete process.env.UJI_PERAN;
  else process.env.UJI_PERAN = peran;
  try {
    return await fn();
  } finally {
    if (lama === undefined) delete process.env.UJI_PERAN;
    else process.env.UJI_PERAN = lama;
  }
}

/** FormData dengan nilai ganda (getAll). */
function fdGanda(isian: [string, string][]): FormData {
  const fd = new FormData();
  for (const [k, v] of isian) fd.append(k, v);
  return fd;
}

const teksByte = (t: string) => new TextEncoder().encode(t);
const gabung = (...bagian: (Uint8Array | number[])[]) => {
  const daftar = bagian.map((b) => (b instanceof Uint8Array ? b : new Uint8Array(b)));
  const hasil = new Uint8Array(daftar.reduce((n, b) => n + b.length, 0));
  let i = 0;
  for (const b of daftar) {
    hasil.set(b, i);
    i += b.length;
  }
  return hasil;
};
const ekor = new Array(32).fill(7);
const CONTOH = {
  jpeg: gabung([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], teksByte("JFIF"), ekor),
  png: gabung([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ekor),
  webp: gabung(teksByte("RIFF"), [0x24, 0, 0, 0], teksByte("WEBPVP8 "), ekor),
  gif: gabung(teksByte("GIF89a"), ekor),
  pdf: gabung(teksByte("%PDF-1.4\n"), ekor),
  zip: gabung([0x50, 0x4b, 0x03, 0x04], ekor),
  ole: gabung([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], ekor),
  mp4: gabung([0, 0, 0, 0x18], teksByte("ftypisom"), ekor),
  mov: gabung([0, 0, 0, 0x14], teksByte("ftypqt  "), ekor),
  heic: gabung([0, 0, 0, 0x18], teksByte("ftypheic"), ekor),
  psd: gabung(teksByte("8BPS"), ekor),
  txt: teksByte("halo dunia, catatan uji\n"),
  csv: teksByte("nama,jumlah\nkopi,2\n"),
};
const berkasUji = (nama: string, isi: Uint8Array) => new File([isi as Uint8Array<ArrayBuffer>], nama);

async function unggah(pengguna: PenggunaSesi, nama: string, isi: Uint8Array, opsi: Omit<MasukanBerkas, "berkas"> = {}) {
  return simpanBerkas(db, pengguna, { berkas: berkasUji(nama, isi), ...opsi });
}
async function unggahSukses(pengguna: PenggunaSesi, nama: string, isi: Uint8Array, opsi: Omit<MasukanBerkas, "berkas"> = {}) {
  const h = await unggah(pengguna, nama, isi, opsi);
  if (!h.ok) throw new Error(`unggah ${nama} gagal: ${h.status} ${h.galat}`);
  return h.nilai;
}
async function pastikanGagal(label: string, janji: Promise<Awaited<ReturnType<typeof simpanBerkas>>>, status: number, potongan: string) {
  const h = await janji;
  pastikan(!h.ok && h.status === status && h.galat.includes(potongan), `${label}: ${h.ok ? "LOLOS" : `${h.status} "${h.galat}"`}`);
}

const idTerlihat = async (pengguna: PenggunaSesi, saring: Parameters<typeof daftarBerkasTerlihat>[2] = {}) =>
  new Set((await daftarBerkasTerlihat(db, pengguna, saring)).baris.map((b) => b.id));
const jumlahLog = (entitasId: string, aksi: string) => db.logAktivitas.count({ where: { modul: "berkas", entitasId, aksi } });

async function bersihkanData() {
  const berkas = await db.berkas.findMany({
    where: { OR: [{ namaBerkas: { startsWith: P } }, { folderKode: { startsWith: "KONTRAK_UJIB" } }, { proyek: { kode: { startsWith: P } } }] },
    select: { id: true },
  });
  const ids = berkas.map((b) => b.id);
  if (ids.length) {
    await db.tautanBagiBerkas.deleteMany({ where: { berkasId: { in: ids } } });
    await db.isiBerkas.deleteMany({ where: { berkasId: { in: ids } } });
    await db.berkas.deleteMany({ where: { id: { in: ids } } });
  }
  await db.folderBerkas.deleteMany({ where: { kode: { startsWith: "KONTRAK_UJIB" }, sistem: false } });
  await db.folderBerkas.deleteMany({ where: { kode: { startsWith: "F_UJIB" }, sistem: false } });
  const pelanggan = await db.pelanggan.findMany({ where: { kode: { startsWith: P } }, select: { id: true } });
  const pnw = await db.penawaranPenjualan.findMany({ where: { pelangganId: { in: pelanggan.map((p) => p.id) } }, select: { id: true } });
  await db.barisPenawaranPenjualan.deleteMany({ where: { penawaranId: { in: pnw.map((p) => p.id) } } });
  await db.penawaranPenjualan.deleteMany({ where: { id: { in: pnw.map((p) => p.id) } } });
  await db.konten.deleteMany({ where: { judul: { startsWith: P } } });
  await db.tugasDesain.deleteMany({ where: { judul: { startsWith: P } } });
  await db.kampanye.deleteMany({ where: { nama: { startsWith: P } } });
  await db.kopSurat.deleteMany({ where: { nama: { startsWith: P } } });
  await db.proyek.deleteMany({ where: { kode: { startsWith: P } } });
  await db.pelanggan.deleteMany({ where: { kode: { startsWith: P } } });
  await db.barang.deleteMany({ where: { kode: { startsWith: P } } });
  await db.pengguna.deleteMany({ where: { namaPengguna: { startsWith: PENGGUNA_UJI } } });
  // sisa log putaran yang terhenti di tengah (pastikan langsung keluar tanpa melewati bersih-bersih akhir)
  await db.logAktivitas.deleteMany({ where: { OR: [{ nomor: { startsWith: P } }, { modul: "berkas", nomor: { contains: "UJIB" } }] } });
}

async function pulihkanFolder() {
  if (!potret.length) return;
  const kodePotret = potret.map((f) => f.kode);
  await db.folderBerkas.deleteMany({ where: { kode: { notIn: kodePotret }, berkas: { none: {} } } });
  for (const f of potret) {
    await db.folderBerkas.update({ where: { kode: f.kode }, data: { nama: f.nama, urutan: f.urutan, sistem: f.sistem, terbatas: f.terbatas, peranBoleh: f.peranBoleh } });
  }
}

/**
 * Pencocok matcher proxy memakai fungsi Next yang sama dengan unstable_doesMiddlewareMatch (getMiddlewareMatchers dan
 * getMiddlewareRouteMatcher). Dijalankan di proses node terpisah karena modul analisis Next tidak bisa dimuat sesudah
 * next/headers di proses skrip ini (AsyncLocalStorage tiruan).
 */
function cocokMatcherProxy(matcher: readonly string[]): (jalur: string) => boolean {
  const kode = `
    const { getMiddlewareMatchers } = require("next/dist/build/analysis/get-page-static-info");
    const { getMiddlewareRouteMatcher } = require("next/dist/shared/lib/router/utils/middleware-route-matcher");
    const [matcher, daftar] = JSON.parse(process.argv[process.argv.length - 1]);
    const cocok = getMiddlewareRouteMatcher(getMiddlewareMatchers(matcher, {}));
    process.stdout.write(JSON.stringify(daftar.map((u) => { const x = new URL(u, "http://127.0.0.1"); return cocok(x.pathname, { headers: {}, cookies: {} }, Object.fromEntries(x.searchParams)); })));`;
  const daftar = ["/api/berkas", "/api/berkas/abc", "/api/berkas/abc?unduh=1", "/", "/buku-besar", "/berkas", "/api/berkasx", "/api/notifikasi", "/api/sehat", "/b/token", "/masuk", "/pengaturan/berkas", "/_next/static/x.js", "/logo.png"];
  const hasil = JSON.parse(execFileSync(process.execPath, ["-e", kode, JSON.stringify([matcher, daftar])], { cwd: process.cwd(), encoding: "utf8" })) as boolean[];
  const peta = new Map(daftar.map((u, i) => [u, hasil[i]]));
  return (jalur) => {
    const v = peta.get(jalur);
    if (v === undefined) throw new Error(`jalur ${jalur} tidak ada di daftar cocokMatcherProxy`);
    return v;
  };
}

async function main() {
  await bersihkanData();
  potret = await db.folderBerkas.findMany({ select: { kode: true, nama: true, urutan: true, sistem: true, terbatas: true, peranBoleh: true } });
  const awalHakAksesPeran = await db.hakAksesPeran.count();

  console.log("=== 0. Struktur ===");
  const exp = nextConfig.experimental as { proxyClientMaxBodySize?: string; serverActions?: { bodySizeLimit?: string } };
  pastikan(exp.proxyClientMaxBodySize === undefined && exp.serverActions?.bodySizeLimit === "3mb", "next.config: tanpa proxyClientMaxBodySize (batas bawaan 10 MB), serverActions tetap 3mb");
  // perbaikan tinjauan P06 butir 1: /api/berkas tidak melewati proxy, rute lain tetap
  const lewatProxy = cocokMatcherProxy(configProxy.matcher);
  pastikan(!lewatProxy("/api/berkas") && !lewatProxy("/api/berkas/abc") && !lewatProxy("/api/berkas/abc?unduh=1"), "matcher proxy: /api/berkas dan /api/berkas/[id] dilewati");
  pastikan(["/", "/buku-besar", "/berkas", "/api/berkasx", "/api/notifikasi", "/api/sehat", "/b/token", "/masuk", "/pengaturan/berkas"].every(lewatProxy), "matcher proxy: rute lain (termasuk /api/berkasx dan /berkas) tetap lewat proxy");
  pastikan(!lewatProxy("/_next/static/x.js") && !lewatProxy("/logo.png"), "matcher proxy: aset statis tetap dilewati");
  const alihBukuBesar = proxy(new NextRequest("http://127.0.0.1/buku-besar"));
  pastikan(alihBukuBesar.status === 307 && (alihBukuBesar.headers.get("location") ?? "").includes("/masuk?kembali=%2Fbuku-besar"), "proxy: /buku-besar tanpa sesi dialihkan ke /masuk");
  const apiTanpaSesi = proxy(new NextRequest("http://127.0.0.1/api/notifikasi"));
  pastikan(apiTanpaSesi.status === 401, "proxy: /api/notifikasi tanpa sesi 401");
  pastikan(BATAS_UKURAN_BERKAS === 26_214_400 && BATAS_PERMINTAAN_UNGGAH === 27_262_976, "konstanta batas 25 MB dan batas permintaan");
  pastikan(jalurPublik("/b/abc") && jalurPublik("/b") && jalurPublik("/b/x"), "jalurPublik /b dan /b/... benar");
  pastikan(!jalurPublik("/buku-besar") && !jalurPublik("/berkas") && !jalurPublik("/api/berkas") && !jalurPublik("/bx"), "jalurPublik /buku-besar, /berkas, /api/berkas salah");
  pastikan(["/masuk", "/lupa-kata-sandi", "/atur-ulang/token", "/api/sehat"].every(jalurPublik), "empat jalur publik lama tetap benar");
  const folderSistem = await db.folderBerkas.findMany({ where: { sistem: true }, orderBy: { urutan: "asc" } });
  pastikan(folderSistem.map((f) => f.kode).join(",") === "DOKUMEN,PENAWARAN,FAKTUR,KUITANSI,KEUANGAN,SOSMED,IKLAN,DESAIN,KOP,LAINNYA", "10 folder sistem ada");
  pastikan(["FAKTUR", "KUITANSI"].every((k) => { const f = folderSistem.find((x) => x.kode === k); return f?.terbatas && f.peranBoleh.join(",") === "ADMIN,KASIR"; }), "FAKTUR dan KUITANSI terbatas [ADMIN, KASIR]");
  const kodeFolder = new Set(folderSistem.map((f) => f.kode));
  const harapanJenis = ["penawaran", "pesanan", "uang-muka", "faktur", "penerimaan", "faktur-pembelian", "pembayaran", "kas-masuk", "kas-keluar", "jurnal", "aset", "proyek", "rencana-termin", "konten", "tugas-desain", "hasil-desain", "kampanye", "kop-surat", "talangan-mitra", "pembayaran-mitra", "laporan-keuangan-proyek"];
  pastikan(DAFTAR_JENIS.length === harapanJenis.length && harapanJenis.every((j) => (DAFTAR_JENIS as string[]).includes(j)), "JENIS_LAMPIRAN memuat 21 jenis DESAIN §3.3");
  pastikan(DAFTAR_JENIS.every((k) => { const j: JenisLampiran = JENIS_LAMPIRAN[k]; return [j.hakLihat, ...j.hakUnggah, ...j.hakUbah, ...j.hakHapus].every((h) => SEMUA_HAK.includes(h)); }), "setiap hak di JENIS_LAMPIRAN ada di SEMUA_HAK");
  pastikan(DAFTAR_JENIS.every((k) => { const j: JenisLampiran = JENIS_LAMPIRAN[k]; return kodeFolder.has(j.folderBawaan) && (!j.folderKunci || kodeFolder.has(j.folderKunci)); }), "setiap folderBawaan dan folderKunci ada di FolderBerkas");
  pastikan((["penawaran", "pesanan", "uang-muka", "faktur", "penerimaan"] as const).every((k) => (JENIS_LAMPIRAN[k].hakUnggah as readonly string[]).includes(`${k}.ubah`) && (JENIS_LAMPIRAN[k].hakUbah as readonly string[]).includes(`${k}.ubah`)), "lima dokumen penjualan memuat <kode>.ubah di hakUnggah dan hakUbah");
  pastikan(JENIS_LAMPIRAN.proyek.hakLihat === "proyek.lihat" && JENIS_LAMPIRAN.proyek.hakUnggah.join() === "data-induk.tulis", "jenis proyek: lihat proyek.lihat, ubah data-induk.tulis (HAK.md §7 no. 13)");
  pastikan(JSON.stringify(JENIS_CETAK_KE_LAMPIRAN) === JSON.stringify({ penawaran: "penawaran", faktur: "faktur", kwitansi: "penerimaan", "kwitansi-dp": "uang-muka", "tagihan-termin": "rencana-termin" }), "pemetaan jenis cetak ke jenis lampiran");
  for (const k of DAFTAR_JENIS) pastikan((await JENIS_LAMPIRAN[k].baca(db, "ujib-tidak-ada")) === null, `pembaca ${k}: entitas tidak ada = null`);
  // perbaikan tinjauan P07 butir 1 dan 5 (diperiksa dari sumber karena tidak ada uji peramban): dialog pratinjau lewat
  // portal ke document.body, dan keempat teks sukses D7 §7.10 dipasang sebagai pesan tingkat halaman
  const sumber = (f: string) => readFileSync(`src/${f}`, "utf8");
  pastikan(/createPortal\(\s*<div className="fixed inset-0/.test(sumber("komponen/berkas/DialogPratinjauGambar.tsx")) && sumber("komponen/berkas/DialogPratinjauGambar.tsx").includes("document.body"), "DialogPratinjauGambar: lapisan dialog dipasang lewat createPortal ke document.body");
  const halamanBerkas = sumber("app/(aplikasi)/berkas/page.tsx");
  const lampiran = sumber("komponen/berkas/LampiranBerkas.tsx");
  pastikan(["Berkas dipindah ke Sampah.", "Berkas dipulihkan.", "Berkas dihapus permanen."].every((t) => halamanBerkas.includes(`pesanSuksesHalaman="${t}"`)) && halamanBerkas.includes("<PesanSuksesHalaman />"), "halaman Berkas: teks sukses buang, pulihkan, hapus permanen, dan PesanSuksesHalaman terpasang");
  pastikan(lampiran.includes('pesanSuksesHalaman="Berkas dipindah ke Sampah."') && lampiran.includes("<PesanSuksesHalaman />") && sumber("komponen/berkas/FormulirTautanBagi.tsx").includes('pesanSuksesHalaman="Tautan dicabut."'), "LampiranBerkas dan FormulirTautanBagi: teks sukses buang dan cabut");

  console.log("=== 1. Deteksi tipe ===");
  const harapanTipe: [string, Uint8Array, string, boolean][] = [
    ["a.jpg", CONTOH.jpeg, "image/jpeg", true],
    ["a.JPEG", CONTOH.jpeg, "image/jpeg", true],
    ["a.png", CONTOH.png, "image/png", true],
    ["a.webp", CONTOH.webp, "image/webp", true],
    ["a.gif", CONTOH.gif, "image/gif", true],
    ["a.pdf", CONTOH.pdf, "application/pdf", true],
    ["a.docx", CONTOH.zip, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", false],
    ["a.xlsx", CONTOH.zip, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", false],
    ["a.zip", CONTOH.zip, "application/zip", false],
    ["a.doc", CONTOH.ole, "application/msword", false],
    ["a.mp4", CONTOH.mp4, "video/mp4", false],
    ["a.mov", CONTOH.mov, "video/quicktime", false],
    ["a.heic", CONTOH.heic, "image/heic", false],
    ["a.psd", CONTOH.psd, "image/vnd.adobe.photoshop", false],
    ["a.ai", CONTOH.pdf, "application/postscript", false],
    ["a.txt", CONTOH.txt, "text/plain; charset=utf-8", false],
    ["a.csv", CONTOH.csv, "text/csv; charset=utf-8", false],
  ];
  for (const [nama, isi, mime, inline] of harapanTipe) {
    const h = deteksiTipe(isi, nama);
    pastikan(h.ok && h.tipeMime === mime && h.inline === inline, `${nama}: ${mime}, ${inline ? "inline" : "attachment"}`);
  }
  const ditolak: [string, Uint8Array, string][] = [
    ["gambar.svg", teksByte('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "Jenis berkas .svg tidak didukung"],
    ["halaman.html", teksByte("<html><script>1</script></html>"), "Jenis berkas .html tidak didukung"],
    ["program.exe", gabung(teksByte("MZ"), ekor), "Jenis berkas .exe tidak didukung"],
    ["skrip.sh", teksByte("#!/bin/sh\necho 1\n"), "Jenis berkas .sh tidak didukung"],
    ["palsu.jpg", CONTOH.pdf, "Isi berkas tidak cocok dengan ekstensi .jpg"],
    ["palsu.pdf", CONTOH.jpeg, "Isi berkas tidak cocok dengan ekstensi .pdf"],
    ["biner.txt", gabung(teksByte("ab"), [0], teksByte("cd")), "Isi berkas tidak cocok dengan ekstensi .txt"],
    ["rusak.csv", gabung(teksByte("a,b\n"), [0xff, 0xfe, 0xfd]), "Isi berkas tidak cocok dengan ekstensi .csv"],
    ["skrip.txt", teksByte("#!/bin/sh\n"), "Isi berkas tidak cocok dengan ekstensi .txt"],
    ["program.pdf", gabung(teksByte("MZ"), ekor), "Isi berkas tidak cocok dengan ekstensi .pdf"],
    ["laporan", CONTOH.pdf, "Berkas wajib punya ekstensi"],
  ];
  for (const [nama, isi, pesan] of ditolak) {
    const h = deteksiTipe(isi, nama);
    pastikan(!h.ok && h.galat.includes(pesan), `${nama} ditolak: ${h.ok ? "LOLOS" : h.galat}`);
  }

  console.log("=== 2. Nama berkas ===");
  const jalur = bersihkanNamaBerkas("../../etc/passwd", "txt");
  pastikan(!jalur.includes("/") && !jalur.startsWith(".") && jalur.endsWith(".txt"), `nama jalur dibersihkan: ${jalur}`);
  const aneh = bersihkanNamaBerkas('a"b<c>d|e:f*g?h\\i\u0001j\u007f.pdf', "pdf");
  pastikan(!/["<>|:*?\\\u0000-\u001f\u007f]/.test(aneh) && aneh.endsWith(".pdf"), `karakter terlarang dan kendali dibuang: ${aneh}`);
  const panjang = bersihkanNamaBerkas("x".repeat(300), "pdf");
  pastikan(panjang.length <= 200 && panjang.endsWith(".pdf"), "300 karakter dipotong <= 200 dengan .pdf");
  pastikan(bersihkanNamaBerkas("", "pdf") === "berkas.pdf" && bersihkanNamaBerkas(" ... ", "pdf") === "berkas.pdf", "nama kosong menjadi berkas.pdf");
  pastikan(bersihkanNamaBerkas("laporan.PDF", "pdf") === "laporan.pdf" && bersihkanNamaBerkas("a  b.pdf", "pdf") === "a b.pdf", "laporan.PDF menjadi laporan.pdf, spasi dirapikan");
  const disp = kepalaDisposisi("attachment", "Laporan Mei ç.pdf");
  pastikan(disp.startsWith("attachment;") && disp.includes('filename="Laporan Mei _.pdf"') && disp.includes("filename*=UTF-8''Laporan%20Mei%20%C3%A7.pdf"), `kepala disposisi RFC 5987: ${disp}`);
  pastikan(kepalaDisposisi("inline", 'a"b.pdf').includes('filename="a_b.pdf"'), "tanda kutip di nama ASCII diganti _");
  // perbaikan tinjauan P06 butir 4: pemotongan tidak membelah pasangan surrogate
  const emoji = bersihkanNamaBerkas(`${"a".repeat(195)}\u{1F600}\u{1F600}.pdf`, "pdf");
  pastikan(emoji.isWellFormed() && emoji.length <= 200 && emoji === `${"a".repeat(195)}.pdf`, `emoji di batas 200 dibuang utuh: panjang ${emoji.length}`);
  pastikan(bersihkanNamaBerkas(`${"a".repeat(194)}\u{1F600}.pdf`, "pdf") === `${"a".repeat(194)}\u{1F600}.pdf`, "emoji yang muat tetap utuh");
  let dispSurrogate = "";
  try {
    dispSurrogate = kepalaDisposisi("attachment", "a\ud83d.pdf");
  } catch (galat) {
    dispSurrogate = `GALAT ${galat}`;
  }
  pastikan(dispSurrogate.includes("filename*=UTF-8''a%EF%BF%BD.pdf"), `kepalaDisposisi surrogate tunggal tidak melempar: ${dispSurrogate}`);
  pastikan(potongAman(`${"a".repeat(119)}\u{1F600}`, 120) === "a".repeat(119) && potongAman("abc", 2) === "ab", "potongAman (dipakai potong log) tidak membelah emoji");
  // butir 5: karakter arah teks, lebar nol, BOM, C1, pemisah baris dibuang
  pastikan(bersihkanNamaBerkas("faktur\u202Efdp.zip", "zip") === "fakturfdp.zip", "U+202E (RLO) dibuang");
  const tersamar = bersihkanNamaBerkas("a\u0085b\u200Bc\u2066d\u2069e\uFEFFf\u2028g\u2029h\u200Ei\u00ADj.pdf", "pdf");
  pastikan(tersamar === "abcdefghij.pdf", `C1, lebar nol, isolasi arah, BOM, U+2028/2029, LRM, soft hyphen dibuang: ${tersamar}`);
  pastikan(bersihkanNamaBerkas("Laporan Mei \u00E7 \u4E2D\u6587 \u0627\u0644.pdf", "pdf") === "Laporan Mei \u00E7 \u4E2D\u6587 \u0627\u0644.pdf", "huruf non-Latin dan teks kanan-ke-kiri biasa tetap");

  console.log("=== Data uji ===");
  const pelanggan = await db.pelanggan.create({ data: { kode: `${P}PLG`, nama: "Pelanggan Uji Berkas" } });
  const jasa = await db.barang.create({ data: { kode: `${P}JASA`, nama: "Jasa Uji Berkas", jenis: "JASA", hargaBeli: 0, hargaJual: 100000 } });
  const p1 = await db.proyek.create({ data: { kode: `${P}P1`, nama: "Proyek Uji Berkas 1" } });
  const p2 = await db.proyek.create({ data: { kode: `${P}P2`, nama: "Proyek Uji Berkas 2" } });
  const pTapussa = await db.proyek.create({ data: { kode: `${P}PT`, nama: "Proyek Uji Berkas Tapussa", perusahaanId: "tapussa" } });
  await jalankan("penawaran uji (proyek P1)", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, proyekId: p1.id, baris: [{ barangId: jasa.id, jumlah: 1, harga: 100000 }] })));
  const pnw = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id } });
  const tugas = await db.tugasDesain.create({ data: { judul: `${P}Tugas`, dibuatOlehNama: "Skrip Uji", proyekId: p1.id } });
  const iklanNyata = await db.pengguna.create({ data: { nama: "Iklan Uji Berkas", namaPengguna: `${PENGGUNA_UJI}iklan`, kataSandiHash: await hashKataSandi("rahasia123"), peran: "IKLAN" } });
  await db.pengguna.create({ data: { nama: "Desainer Uji Berkas", namaPengguna: `${PENGGUNA_UJI}desainer`, kataSandiHash: await hashKataSandi("rahasia123"), peran: "DESAINER" } });

  console.log("=== 3. Unggah ditolak ===");
  await pastikanGagal("tanpa berkas", simpanBerkas(db, PEMILIK, { berkas: null }), 400, "Pilih berkas");
  await pastikanGagal("teks bukan berkas", simpanBerkas(db, PEMILIK, { berkas: "bukan berkas" }), 400, "Pilih berkas");
  await pastikanGagal("0 byte", unggah(PEMILIK, `${P}kosong.pdf`, new Uint8Array(0)), 400, "kosong");
  await pastikanGagal("26.214.401 byte", unggah(PEMILIK, `${P}besar.pdf`, new Uint8Array(BATAS_UKURAN_BERKAS + 1)), 413, "Ukuran berkas maksimal 25 MB");
  await pastikanGagal("jenis lampiran tak dikenal", unggah(PEMILIK, `${P}a.pdf`, CONTOH.pdf, { jenisEntitas: "asing", entitasId: "x" }), 400, "Jenis lampiran tidak dikenal");
  await pastikanGagal("lampiran tanpa entitas", unggah(PEMILIK, `${P}a.pdf`, CONTOH.pdf, { jenisEntitas: "penawaran" }), 400, "Data tujuan lampiran wajib diisi");
  await pastikanGagal("entitas tidak ada", unggah(PEMILIK, `${P}a.pdf`, CONTOH.pdf, { jenisEntitas: "penawaran", entitasId: "tidak-ada" }), 404, "Data tujuan lampiran tidak ditemukan");
  await pastikanGagal("folder tak dikenal", unggah(PEMILIK, `${P}a.pdf`, CONTOH.pdf, { folderKode: "ASING" }), 400, "Folder tidak dikenal");
  await pastikanGagal("proyek tidak ada", unggah(PEMILIK, `${P}a.pdf`, CONTOH.pdf, { proyekId: "tidak-ada" }), 404, "Proyek tidak ditemukan");
  await pastikanGagal("proyek perusahaan lain", unggah(PEMILIK, `${P}a.pdf`, CONTOH.pdf, { proyekId: pTapussa.id, perusahaanId: "utama" }), 404, "Proyek tidak ditemukan");
  await pastikanGagal("tag tak dikenal", unggah(PEMILIK, `${P}a.pdf`, CONTOH.pdf, { tag: "ASING" }), 400, "Tag berkas tidak dikenal");
  await pastikanGagal("perusahaan tidak ada", unggah(PEMILIK, `${P}a.pdf`, CONTOH.pdf, { perusahaanId: "pt-tidak-ada" }), 400, "Perusahaan tidak ditemukan");
  await pastikanGagal("KASIR unggahan umum", unggah(KASIR, `${P}a.pdf`, CONTOH.pdf), 403, "tidak punya hak mengunggah");
  await pastikanGagal("DESAINER ke lampiran penawaran", unggah(DESAINER, `${P}a.pdf`, CONTOH.pdf, { jenisEntitas: "penawaran", entitasId: pnw.id }), 403, "tidak punya hak mengunggah");
  await pastikanGagal("SVG", unggah(PEMILIK, `${P}a.svg`, teksByte("<svg/>")), 415, "Jenis berkas .svg tidak didukung");
  await pastikanGagal("isi tidak cocok", unggah(PEMILIK, `${P}a.jpg`, CONTOH.pdf), 415, "tidak cocok");
  pastikan((await db.berkas.count({ where: { namaBerkas: { startsWith: P } } })) === 0, "setelah semua penolakan: tidak ada Berkas UJIB- baru");
  // perbaikan tinjauan P06 butir 6: rute menolak 403 sebelum badan dibaca bila tidak ada tujuan unggah sama sekali
  pastikan([PEMILIK, ADMIN, KASIR, SOSMED, IKLAN, DESAINER].every(bolehUnggahSesuatu) && !bolehUnggahSesuatu(sesi("KRU")) && !bolehUnggahSesuatu(sesi("GUEST")), "bolehUnggahSesuatu: KRU dan GUEST tidak, peran lain ya");
  pastikan(bolehUnggahSesuatu(sesi("KASIR", ["penawaran.lihat", "penawaran.buat"])) && !bolehUnggahSesuatu(sesi("KASIR", ["penawaran.buat"])), "bolehUnggahSesuatu: hak unggah jenis hanya berlaku bersama hak lihatnya");
  // butir 1: aliran badan dipotong di batas
  const fdKecil = new FormData();
  fdKecil.set("folderKode", "LAINNYA");
  fdKecil.set("berkas", berkasUji(`${P}kecil.pdf`, CONTOH.pdf));
  const formKecil = await bacaFormulirTerbatas(new Request("http://127.0.0.1/api/berkas", { method: "POST", body: fdKecil }), BATAS_PERMINTAAN_UNGGAH);
  pastikan(formKecil instanceof FormData && formKecil.get("folderKode") === "LAINNYA" && (formKecil.get("berkas") as File).size === CONTOH.pdf.length, "bacaFormulirTerbatas: formulir di bawah batas terbaca utuh");
  const fdBesar = new FormData();
  fdBesar.set("berkas", berkasUji(`${P}besar.pdf`, new Uint8Array(64 * 1024)));
  pastikan((await bacaFormulirTerbatas(new Request("http://127.0.0.1/api/berkas", { method: "POST", body: fdBesar }), 16 * 1024)) === 413, "bacaFormulirTerbatas: badan melewati batas dipotong, 413");
  pastikan((await bacaFormulirTerbatas(new Request("http://127.0.0.1/api/berkas", { method: "POST", body: "bukan multipart", headers: { "content-type": "multipart/form-data; boundary=x" } }), 1024)) === 400, "bacaFormulirTerbatas: badan rusak 400");
  pastikan((await bacaFormulirTerbatas(new Request("http://127.0.0.1/api/berkas", { method: "POST" }), 1024)) === 400, "bacaFormulirTerbatas: tanpa badan 400");
  // galat Prisma dari pembacaan perusahaan dilempar (jadi 500 di rute), bukan diteruskan ke klien sebagai 400
  const klienPutus = new Proxy(db, {
    get(target, kunci, penerima) {
      if (kunci === "perusahaan") return { findUnique: () => Promise.reject(new Prisma.PrismaClientKnownRequestError("koneksi rahasia putus", { code: "P1001", clientVersion: "uji" })) };
      return Reflect.get(target, kunci, penerima);
    },
  });
  let galatPutus = "";
  try {
    const h = await simpanBerkas(klienPutus, PEMILIK, { berkas: berkasUji(`${P}a.pdf`, CONTOH.pdf), perusahaanId: "utama" });
    galatPutus = h.ok ? "LOLOS" : `dikembalikan ${h.status} ${h.galat}`;
  } catch (galat) {
    galatPutus = galat instanceof Prisma.PrismaClientKnownRequestError ? "dilempar" : `lain: ${galat}`;
  }
  pastikan(galatPutus === "dilempar", `galat Prisma di simpanBerkas dilempar, tidak jadi 400: ${galatPutus}`);

  console.log("=== 4. Unggah sukses ===");
  const jpg = await unggahSukses(PEMILIK, `${P}foto.jpg`, CONTOH.jpeg, { folderKode: "LAINNYA", proyekId: p1.id });
  pastikan(jpg.namaBerkas === `${P}foto.jpg` && jpg.tipeMime === "image/jpeg" && jpg.ukuran === CONTOH.jpeg.length && jpg.folderKode === "LAINNYA" && jpg.proyekId === p1.id && jpg.jenisEntitas === null && jpg.tag === null, "metadata JPEG umum benar");
  pastikan(jpg.sha256 === createHash("sha256").update(CONTOH.jpeg).digest("hex"), "sha256 = hash isi");
  pastikan(jpg.diunggahOlehId === null && jpg.diunggahOlehNama === "Skrip Uji" && jpg.perusahaanId === "utama", "pengunggah skrip-uji tanpa id, perusahaan utama dari lingkup");
  const isiJpg = await db.isiBerkas.findUniqueOrThrow({ where: { berkasId: jpg.id } });
  pastikan(Buffer.from(isiJpg.isi).equals(Buffer.from(CONTOH.jpeg)), "IsiBerkas sama byte demi byte");
  const logUnggah = await db.logAktivitas.findMany({ where: { modul: "berkas", entitasId: jpg.id, aksi: "UNGGAH" } });
  const metaUnggah = logUnggah[0]?.meta as Record<string, unknown> | undefined;
  pastikan(logUnggah.length === 1 && metaUnggah?.folder === "LAINNYA" && metaUnggah?.proyekId === p1.id && metaUnggah?.ukuran === jpg.ukuran && logUnggah[0].jenis === "Berkas" && logUnggah[0].nomor === jpg.namaBerkas && logUnggah[0].perusahaanId === "utama", "satu log UNGGAH dengan meta folder dan proyekId");
  const pdfBesar = await unggahSukses(PEMILIK, `${P}besar 5mb.pdf`, gabung(teksByte("%PDF-1.7\n"), new Uint8Array(5 * 1024 * 1024)));
  pastikan(pdfBesar.ukuran > 5 * 1024 * 1024 && pdfBesar.folderKode === "LAINNYA", "PDF 5 MB sukses ke folder bawaan LAINNYA");
  const pdfTapussa = await unggahSukses(PEMILIK, `${P}tapussa.pdf`, CONTOH.pdf, { perusahaanId: "tapussa", proyekId: pTapussa.id });
  pastikan(pdfTapussa.perusahaanId === "tapussa" && pdfTapussa.proyekId === pTapussa.id, "unggahan umum memilih perusahaan dan proyek perusahaan itu");
  const lamPnw = await unggahSukses(KASIR, `${P}penawaran.pdf`, CONTOH.pdf, { jenisEntitas: "penawaran", entitasId: pnw.id, perusahaanId: "tapussa", proyekId: p2.id, dataFormulir: formulir({ perusahaanId: "tapussa" }) });
  pastikan(lamPnw.folderKode === "PENAWARAN" && lamPnw.proyekId === p1.id && lamPnw.perusahaanId === pnw.perusahaanId && lamPnw.tag === "REFERENSI" && lamPnw.entitasId === pnw.id, "KASIR unggah ke penawaran: folder PENAWARAN, proyek dan perusahaan dari penawaran, tag REFERENSI");
  const docx = await unggahSukses(PEMILIK, `${P}surat.docx`, CONTOH.zip);
  const hasilDesain = await unggahSukses(PEMILIK, `${P}hasil.png`, CONTOH.png, { jenisEntitas: "hasil-desain", entitasId: tugas.id, tag: "HASIL" });
  pastikan(hasilDesain.folderKode === "DESAIN" && hasilDesain.proyekId === p1.id && hasilDesain.tag === "HASIL", "lampiran hasil desain: folder DESAIN, proyek dari tugas");

  console.log("=== 5. Hak per berkas ===");
  const umum = { jenisEntitas: null };
  const tabel: [string, { jenisEntitas: string | null }, "lihat" | "unggah" | "ubah" | "hapus" | "bagikan", boolean[]][] = [
    ["lihat berkas umum", umum, "lihat", [true, false, true, true, true]],
    ["unggah berkas umum", umum, "unggah", [true, false, true, true, true]],
    ["ubah berkas umum", umum, "ubah", [true, false, true, false, false]],
    ["buang berkas umum", umum, "hapus", [false, false, false, false, false]],
    ["buang PDF penawaran", { jenisEntitas: "penawaran" }, "hapus", [true, false, false, false, false]],
    ["lihat lampiran faktur", { jenisEntitas: "faktur" }, "lihat", [true, true, false, false, false]],
    ["unggah bukti kas keluar", { jenisEntitas: "kas-keluar" }, "unggah", [true, true, false, false, false]],
    ["buang referensi konten", { jenisEntitas: "konten" }, "hapus", [false, false, true, false, false]],
    ["buang hasil desain", { jenisEntitas: "hasil-desain" }, "hapus", [false, false, false, false, false]],
    ["bagikan berkas umum", umum, "bagikan", [true, false, true, true, true]],
  ];
  const peranTabel = [ADMIN, KASIR, SOSMED, IKLAN, DESAINER];
  for (const [label, b, aksi, harapan] of tabel) {
    const hasil = peranTabel.map((p) => bolehAksesBerkas(p, b, aksi));
    pastikan(hasil.join() === harapan.join(), `${label} (ADMIN, KASIR, SOSMED, IKLAN, DESAINER): ${hasil.join()}`);
  }
  pastikan(!bolehAksesBerkas(ADMIN, { jenisEntitas: "asing" }, "lihat") && bolehAksesBerkas(PEMILIK, { jenisEntitas: "asing" }, "lihat"), "jenis tak dikenal hanya terbuka bagi berkas.akses-penuh");
  pastikan(bolehAksesBerkas(SOSMED, { jenisEntitas: "proyek" }, "lihat") && !bolehAksesBerkas(SOSMED, { jenisEntitas: "laporan-keuangan-proyek" }, "lihat"), "SOSMED melihat lampiran proyek (proyek.lihat), bukan laporan keuangan proyek");
  const tanpaBuat = (p: PenggunaSesi) => sesi(p.peran, p.hak.filter((h) => h !== "berkas.buat"));
  pastikan(bolehAksesBerkas(tanpaBuat(IKLAN), { jenisEntitas: "tugas-desain" }, "unggah") && !bolehAksesBerkas(tanpaBuat(IKLAN), { jenisEntitas: "hasil-desain" }, "unggah") && bolehAksesBerkas(tanpaBuat(DESAINER), { jenisEntitas: "hasil-desain" }, "unggah"), "tanpa berkas.buat: referensi tugas boleh diunggah pemesan (tugas-desain.buat), hasil hanya pemegang tugas-desain.ubah");

  console.log("=== 6. Pembatasan folder ===");
  const pdfFaktur = await unggahSukses(PEMILIK, `${P}di-faktur.pdf`, CONTOH.pdf, { folderKode: "FAKTUR" });
  await sebagaiPeran("DESAINER", async () => {
    pastikan(!(await idTerlihat(DESAINER)).has(pdfFaktur.id) && (await idTerlihat(DESAINER)).has(jpg.id), "DESAINER tidak melihat PDF di FAKTUR, tetap melihat berkas umum lain");
    pastikan((await ambilBerkasTerlihat(db, DESAINER, pdfFaktur.id)) === null, "ambilBerkasTerlihat DESAINER untuk FAKTUR = null");
    const kirim = await bacaUntukDikirim(db, DESAINER, pdfFaktur.id, { unduh: false, ifNoneMatch: null });
    pastikan(kirim.status === 404 && kirim.galat === "Berkas tidak ditemukan", "bacaUntukDikirim DESAINER untuk FAKTUR = 404 (bukan 403)");
    await pastikanGagal("DESAINER unggah ke FAKTUR", unggah(DESAINER, `${P}x.pdf`, CONTOH.pdf, { folderKode: "FAKTUR" }), 403, "tidak punya akses ke folder");
    pastikan(!(await daftarFolderTerlihat(db, DESAINER)).some((f) => f.kode === "FAKTUR" || f.kode === "KUITANSI"), "daftarFolderTerlihat DESAINER tanpa FAKTUR dan KUITANSI");
  });
  const folderAdmin = await daftarFolderTerlihat(db, ADMIN);
  pastikan((await idTerlihat(ADMIN)).has(pdfFaktur.id) && folderAdmin.find((f) => f.kode === "FAKTUR")?.terbatas === true && (folderAdmin.find((f) => f.kode === "FAKTUR")?.jumlah ?? 0) >= 1, "ADMIN melihat PDF di FAKTUR, folder bertanda terbatas dengan jumlah");
  pastikan(folderAdmin.find((f) => f.kode === "LAINNYA")?.terbatas === false, "folder terbuka tidak bertanda terbatas");
  // peranBoleh kosong: hanya akses penuh
  await sebagaiPeran("PEMILIK", () => jalankan("FAKTUR peranBoleh kosong", () => simpanAksesFolder(fdGanda([["folderDirender", "FAKTUR"], ["terbatas|FAKTUR", "on"]]))));
  pastikan(!(await idTerlihat(ADMIN)).has(pdfFaktur.id) && (await idTerlihat(PEMILIK)).has(pdfFaktur.id), "peranBoleh kosong: ADMIN tidak melihat, PEMILIK tetap");
  const logAkses = await db.logAktivitas.findFirst({ where: { modul: "berkas", jenis: "Akses Folder Berkas", nomor: "FAKTUR", waktu: { gte: mulaiUji } }, orderBy: { waktu: "desc" } });
  pastikan((logAkses?.meta as Record<string, unknown> | null)?.folder === "FAKTUR" && (logAkses?.meta as Record<string, unknown>).proyekId === null, "log akses folder dengan meta folder dan proyekId null");
  await sebagaiPeran("PEMILIK", () => jalankan("FAKTUR: PEMILIK/SUPERADMIN dibuang, KASIR+ADMIN", () => simpanAksesFolder(fdGanda([["folderDirender", "FAKTUR"], ["terbatas|FAKTUR", "on"], ["peran|FAKTUR", "PEMILIK"], ["peran|FAKTUR", "KASIR"], ["peran|FAKTUR", "SUPERADMIN"], ["peran|FAKTUR", "ADMIN"], ["peran|FAKTUR", "KASIR"]]))));
  pastikan((await db.folderBerkas.findUniqueOrThrow({ where: { kode: "FAKTUR" } })).peranBoleh.join(",") === "ADMIN,KASIR", "peranBoleh dibuang PEMILIK/SUPERADMIN, diurutkan dan unik");
  const sebelumKuitansi = await db.folderBerkas.findUniqueOrThrow({ where: { kode: "KUITANSI" } });
  await sebagaiPeran("PEMILIK", () => harusDitolak("peran palsu", () => simpanAksesFolder(fdGanda([["folderDirender", "KUITANSI"], ["peran|KUITANSI", "RAJA"]])), "Peran tidak dikenal: RAJA"));
  await sebagaiPeran("PEMILIK", () => harusDitolak("folder tak dikenal", () => simpanAksesFolder(fdGanda([["folderDirender", "ASING"]])), "Folder tidak dikenal: ASING"));
  await sebagaiPeran("PEMILIK", () => jalankan("hanya folder yang dirender", () => simpanAksesFolder(fdGanda([["folderDirender", "LAINNYA"], ["peran|KUITANSI", "SOSMED"]]))));
  const sesudahKuitansi = await db.folderBerkas.findUniqueOrThrow({ where: { kode: "KUITANSI" } });
  pastikan(sesudahKuitansi.terbatas === sebelumKuitansi.terbatas && sesudahKuitansi.peranBoleh.join() === sebelumKuitansi.peranBoleh.join(), "folder yang tidak ditandai dirender tidak berubah");
  await sebagaiPeran("ADMIN", () => harusDitolak("ADMIN simpan akses folder", () => simpanAksesFolder(fdGanda([["folderDirender", "FAKTUR"]])), "tidak punya hak"));

  console.log("=== 7. Folder kunci ===");
  await sebagaiPeran("ADMIN", () => jalankan("ADMIN pindah lampiran penawaran ke LAINNYA", () => ubahBerkas(lamPnw.id, formulir({ folderKode: "LAINNYA" }))));
  pastikan((await db.berkas.findUniqueOrThrow({ where: { id: lamPnw.id } })).folderKode === "LAINNYA" && (await idTerlihat(KASIR)).has(lamPnw.id), "lampiran penawaran di LAINNYA, KASIR masih melihat");
  await sebagaiPeran("PEMILIK", () => jalankan("PENAWARAN terbatas [ADMIN]", () => simpanAksesFolder(fdGanda([["folderDirender", "PENAWARAN"], ["terbatas|PENAWARAN", "on"], ["peran|PENAWARAN", "ADMIN"]]))));
  pastikan(!(await idTerlihat(KASIR)).has(lamPnw.id) && (await ambilBerkasTerlihat(db, KASIR, lamPnw.id)) === null, "folder kunci PENAWARAN tersembunyi: KASIR tidak melihat lampiran penawaran walau di LAINNYA");
  pastikan((await idTerlihat(ADMIN)).has(lamPnw.id), "ADMIN (peranBoleh PENAWARAN) tetap melihat");
  await pastikanGagal("KASIR unggah ke penawaran saat PENAWARAN tersembunyi", unggah(KASIR, `${P}x.pdf`, CONTOH.pdf, { jenisEntitas: "penawaran", entitasId: pnw.id, folderKode: "LAINNYA" }), 403, "tidak punya akses");
  await sebagaiPeran("PEMILIK", () => jalankan("PENAWARAN dibuka lagi", () => simpanAksesFolder(fdGanda([["folderDirender", "PENAWARAN"]]))));
  pastikan((await idTerlihat(KASIR)).has(lamPnw.id), "PENAWARAN dibuka: KASIR melihat lagi");

  console.log("=== 8. Pembatasan proyek ===");
  pastikan((await idTerlihat(DESAINER)).has(jpg.id) && (await idTerlihat(DESAINER)).has(hasilDesain.id), "sebelum dibatasi: DESAINER melihat berkas umum dan lampiran P1");
  await sebagaiPeran("PEMILIK", () => jalankan("batasi P1 untuk SOSMED + pengguna iklan", () => simpanAksesBerkasProyek(p1.id, fdGanda([["peran", "SOSMED"], ["pengguna", iklanNyata.id]]))));
  const terlihatDesainer = await idTerlihat(DESAINER);
  pastikan(!terlihatDesainer.has(jpg.id) && !terlihatDesainer.has(hasilDesain.id) && terlihatDesainer.has(docx.id), "DESAINER tidak melihat berkas P1 (umum dan lampiran), berkas tanpa proyek tetap");
  pastikan((await idTerlihat(SOSMED)).has(jpg.id) && (await idTerlihat(SOSMED)).has(hasilDesain.id), "SOSMED (peranBoleh) melihat berkas P1");
  const lihatSebagai = (namaPengguna: string, id: string) => sebagai(namaPengguna, async () => (await ambilBerkasTerlihat(db, (await penggunaSaatIni())!, id)) !== null);
  pastikan(await lihatSebagai(`${PENGGUNA_UJI}iklan`, jpg.id), "pengguna iklan di daftar melihat berkas P1");
  pastikan(!(await lihatSebagai(`${PENGGUNA_UJI}desainer`, jpg.id)), "pengguna desainer lain tidak melihat berkas P1");
  pastikan((await ambilBerkasTerlihat(db, IKLAN, jpg.id)) === null, "IKLAN tiruan (bukan pengguna di daftar) tidak melihat berkas P1");
  await pastikanGagal("DESAINER unggah ke P1", unggah(DESAINER, `${P}x.png`, CONTOH.png, { proyekId: p1.id }), 403, "tidak punya akses ke folder atau proyek");
  let gagalHapusProyek = "";
  try {
    await db.proyek.delete({ where: { id: p1.id } });
  } catch (galat) {
    gagalHapusProyek = String((galat as { code?: string }).code ?? galat);
  }
  pastikan(gagalHapusProyek !== "" && (await db.proyek.count({ where: { id: p1.id } })) === 1, `proyek berberkas tidak bisa dihapus (FK): ${gagalHapusProyek}`);
  await sebagaiPeran("PEMILIK", () => harusDitolak("pengguna nonaktif/tidak ada", () => simpanAksesBerkasProyek(p1.id, fdGanda([["pengguna", "tidak-ada"]])), "Pengguna terpilih tidak ditemukan atau nonaktif"));
  await sebagaiPeran("PEMILIK", () => harusDitolak("proyek tidak ada", () => simpanAksesBerkasProyek("tidak-ada", new FormData()), "Proyek tidak ditemukan"));
  await sebagaiPeran("ADMIN", () => harusDitolak("ADMIN simpan pembatasan proyek", () => simpanAksesBerkasProyek(p1.id, new FormData()), "tidak punya hak"));
  await sebagaiPeran("ADMIN", () => harusDitolak("ADMIN buka pembatasan proyek", () => bukaPembatasanProyek(p1.id), "tidak punya hak"));
  await sebagaiPeran("PEMILIK", () => jalankan("buka pembatasan P1", () => bukaPembatasanProyek(p1.id)));
  pastikan((await idTerlihat(DESAINER)).has(jpg.id) && (await db.aksesBerkasProyekPengguna.count({ where: { proyekId: p1.id } })) === 0, "pembatasan dibuka: DESAINER melihat lagi, daftar pengguna ikut terhapus");
  await sebagaiPeran("PEMILIK", () => jalankan("buka pembatasan yang tidak ada: tanpa galat", () => bukaPembatasanProyek(p1.id)));

  console.log("=== 9. Pratinjau dan unduh ===");
  const pratinjau = await bacaUntukDikirim(db, PEMILIK, jpg.id, { unduh: false, ifNoneMatch: null });
  pastikan(pratinjau.status === 200 && pratinjau.kepala["Content-Type"] === "image/jpeg" && pratinjau.kepala["Content-Disposition"].startsWith("inline;") && pratinjau.kepala.ETag === `"${jpg.sha256}"`, "JPEG: 200 inline image/jpeg, ETag sha256");
  pastikan(pratinjau.kepala["Cache-Control"] === "private, no-cache" && pratinjau.kepala["X-Content-Type-Options"] === "nosniff" && pratinjau.kepala["Content-Length"] === String(CONTOH.jpeg.length) && Buffer.from(pratinjau.isi!).equals(Buffer.from(CONTOH.jpeg)), "kepala cache privat, nosniff, panjang, isi sama");
  const tembolok = await bacaUntukDikirim(db, PEMILIK, jpg.id, { unduh: false, ifNoneMatch: `"${jpg.sha256}"` });
  pastikan(tembolok.status === 304 && tembolok.isi === undefined, "If-None-Match cocok: 304 tanpa isi");
  pastikan((await jumlahLog(jpg.id, "UNDUH")) === 0, "pratinjau tidak menambah log");
  const unduh = await bacaUntukDikirim(db, PEMILIK, jpg.id, { unduh: true, ifNoneMatch: null });
  pastikan(unduh.status === 200 && unduh.kepala["Content-Disposition"].startsWith("attachment;") && unduh.kepala["Content-Type"] === "application/octet-stream", "unduh=1: attachment + application/octet-stream");
  pastikan((await jumlahLog(jpg.id, "UNDUH")) === 1, "unduh: tepat satu log UNDUH");
  // perbaikan tinjauan P06 butir 7: unduhan tidak pernah 304 dan tidak disimpan cache peramban
  pastikan(unduh.kepala["Cache-Control"] === "private, no-store" && unduh.kepala.ETag === undefined, "unduh: private, no-store tanpa ETag");
  const unduhUlang = await bacaUntukDikirim(db, PEMILIK, jpg.id, { unduh: true, ifNoneMatch: `"${jpg.sha256}"` });
  pastikan(unduhUlang.status === 200 && unduhUlang.isi !== undefined && (await jumlahLog(jpg.id, "UNDUH")) === 2, "unduh dengan If-None-Match cocok tetap 200 dan dicatat UNDUH");
  const unduhDocx = await bacaUntukDikirim(db, PEMILIK, docx.id, { unduh: false, ifNoneMatch: null });
  pastikan(unduhDocx.status === 200 && unduhDocx.kepala["Content-Disposition"].startsWith("attachment;") && unduhDocx.kepala["Content-Type"] === "application/octet-stream", "DOCX selalu attachment");
  const tanpaSesi = await bacaUntukDikirim(db, null, jpg.id, { unduh: false, ifNoneMatch: null });
  pastikan(tanpaSesi.status === 401 && tanpaSesi.galat === "Belum masuk", "pengguna null: 401");
  pastikan((await bacaUntukDikirim(db, PEMILIK, "tidak-ada", { unduh: false, ifNoneMatch: null })).status === 404, "id tidak ada: 404");
  pastikan((await bacaUntukDikirim(db, KASIR, jpg.id, { unduh: false, ifNoneMatch: null })).status === 404, "KASIR tanpa berkas.lihat: berkas umum 404");

  console.log("=== 10. Ubah ===");
  await sebagaiPeran("SOSMED", () => jalankan("SOSMED ganti nama berkas umum", () => ubahBerkas(docx.id, formulir({ namaBerkas: `${P}surat/baru: final.docx` }))));
  const docxBaru = await db.berkas.findUniqueOrThrow({ where: { id: docx.id } });
  pastikan(docxBaru.namaBerkas === `${P}surat baru final.docx`, `nama dibersihkan, ekstensi tetap: ${docxBaru.namaBerkas}`);
  const logUbah = await db.logAktivitas.findFirst({ where: { modul: "berkas", entitasId: docx.id, aksi: "UBAH" } });
  pastikan((logUbah?.meta as Record<string, unknown> | null)?.namaLama === `${P}surat.docx` && (logUbah?.meta as Record<string, unknown>).folder === "LAINNYA", "log UBAH dengan namaLama dan folder");
  await sebagaiPeran("SOSMED", () => jalankan("ganti nama tanpa ekstensi", () => ubahBerkas(docx.id, formulir({ namaBerkas: `${P}surat` }))));
  pastikan((await db.berkas.findUniqueOrThrow({ where: { id: docx.id } })).namaBerkas === `${P}surat.docx`, "nama tanpa ekstensi diberi ekstensi lama");
  await sebagaiPeran("SOSMED", () => harusDitolak("pindah ke folder tak dikenal", () => ubahBerkas(docx.id, formulir({ folderKode: "ASING" })), "Folder tidak dikenal"));
  await sebagaiPeran("SOSMED", () => harusDitolak("pindah ke folder tersembunyi", () => ubahBerkas(docx.id, formulir({ folderKode: "FAKTUR" })), "Anda tidak punya akses ke folder itu"));
  await sebagaiPeran("PEMILIK", () => harusDitolak("ubah proyek lampiran", () => ubahBerkas(lamPnw.id, formulir({ proyekId: p2.id })), "Proyek lampiran mengikuti Penawaran Penjualan"));
  await sebagaiPeran("IKLAN", () => harusDitolak("IKLAN ubah berkas umum", () => ubahBerkas(docx.id, formulir({ namaBerkas: "x" })), "tidak punya hak mengubah"));
  await sebagaiPeran("DESAINER", () => harusDitolak("DESAINER ubah lampiran penawaran", () => ubahBerkas(lamPnw.id, formulir({ namaBerkas: "x" })), "Berkas tidak ditemukan"));
  await sebagaiPeran("SOSMED", () => harusDitolak("proyek perusahaan lain", () => ubahBerkas(docx.id, formulir({ proyekId: pTapussa.id })), "Proyek tidak ditemukan"));
  await sebagaiPeran("SOSMED", () => jalankan("SOSMED pindah ke DOKUMEN + proyek P2", () => ubahBerkas(docx.id, formulir({ folderKode: "DOKUMEN", proyekId: p2.id }))));
  const docxPindah = await db.berkas.findUniqueOrThrow({ where: { id: docx.id } });
  pastikan(docxPindah.folderKode === "DOKUMEN" && docxPindah.proyekId === p2.id, "pindah folder dan proyek berkas umum");
  await sebagaiPeran("SOSMED", () => jalankan("lepas proyek", () => ubahBerkas(docx.id, formulir({ proyekId: "" }))));
  pastikan((await db.berkas.findUniqueOrThrow({ where: { id: docx.id } })).proyekId === null, "proyek kosong = tanpa proyek");
  // perbaikan tinjauan P07 butir 3: nama yang tidak diubah di panel Ubah tetap persis, walau dibangun ulang akan berbeda
  const ganda = await unggahSukses(PEMILIK, `${P}laporan.pdf.pdf`, CONTOH.pdf);
  pastikan(ganda.namaBerkas === `${P}laporan.pdf.pdf`, `unggah ekstensi ganda tersimpan apa adanya: ${ganda.namaBerkas}`);
  await sebagaiPeran("PEMILIK", () => jalankan("pindah folder berkas ekstensi ganda (nama tidak diubah)", () => ubahBerkas(ganda.id, formulir({ namaBerkas: `${P}laporan.pdf`, folderKode: "DOKUMEN" }))));
  const gandaPindah = await db.berkas.findUniqueOrThrow({ where: { id: ganda.id } });
  pastikan(gandaPindah.namaBerkas === `${P}laporan.pdf.pdf` && gandaPindah.folderKode === "DOKUMEN", `ekstensi ganda: nama tetap, folder pindah (${gandaPindah.namaBerkas})`);
  const logGanda = await db.logAktivitas.findFirst({ where: { modul: "berkas", entitasId: ganda.id, aksi: "UBAH" }, select: { meta: true } });
  pastikan((logGanda?.meta as Record<string, unknown> | null)?.namaLama === `${P}laporan.pdf.pdf` && (logGanda?.meta as Record<string, unknown>).folderLama === "LAINNYA", "log UBAH ekstensi ganda: namaLama sama dengan nama sekarang");
  await db.berkas.update({ where: { id: ganda.id }, data: { namaBerkas: `${P}FOTO.PDF` } });
  await sebagaiPeran("PEMILIK", () => jalankan("pindah folder berkas ekstensi huruf besar (nama tidak diubah)", () => ubahBerkas(ganda.id, formulir({ namaBerkas: ` ${P}FOTO `, folderKode: "LAINNYA" }))));
  const besar = await db.berkas.findUniqueOrThrow({ where: { id: ganda.id } });
  pastikan(besar.namaBerkas === `${P}FOTO.PDF` && besar.folderKode === "LAINNYA", `ekstensi huruf besar dari data lama tetap: ${besar.namaBerkas}`);
  await sebagaiPeran("PEMILIK", () => jalankan("ganti nama berkas ekstensi huruf besar", () => ubahBerkas(ganda.id, formulir({ namaBerkas: `${P}foto-baru` }))));
  pastikan((await db.berkas.findUniqueOrThrow({ where: { id: ganda.id } })).namaBerkas === `${P}foto-baru.pdf`, "nama yang memang diubah tetap dibangun ulang dengan ekstensi kecil");
  const jumlahUbahGanda = await jumlahLog(ganda.id, "UBAH");
  await sebagaiPeran("PEMILIK", () => jalankan("simpan tanpa perubahan", () => ubahBerkas(ganda.id, formulir({ namaBerkas: `${P}foto-baru`, folderKode: "LAINNYA" }))));
  pastikan((await jumlahLog(ganda.id, "UBAH")) === jumlahUbahGanda, "simpan tanpa perubahan tidak menulis log UBAH");

  console.log("=== 11. Buang, pulihkan, hapus permanen ===");
  await sebagaiPeran("ADMIN", () => harusDitolak("ADMIN buang berkas umum", () => buangBerkas(jpg.id), "tidak punya hak membuang"));
  const tautanPnw = await buatTautanBagiBerkas(db, PEMILIK, lamPnw.id, "7");
  await sebagaiPeran("ADMIN", () => jalankan("ADMIN buang lampiran penawaran", () => buangBerkas(lamPnw.id)));
  const pnwDibuang = await db.berkas.findUniqueOrThrow({ where: { id: lamPnw.id } });
  pastikan(pnwDibuang.dihapusPada !== null && pnwDibuang.dihapusOlehNama === "Skrip Uji" && (await jumlahLog(lamPnw.id, "BUANG")) === 1, "lampiran dibuang dengan log BUANG");
  pastikan(!(await idTerlihat(ADMIN)).has(lamPnw.id) && (await idTerlihat(ADMIN, { sampah: true })).has(lamPnw.id), "hilang dari daftar, muncul di Sampah");
  pastikan((await bacaUntukDikirim(db, ADMIN, lamPnw.id, { unduh: true, ifNoneMatch: null })).status === 404, "unduh berkas dibuang: 404");
  pastikan((await db.tautanBagiBerkas.findUniqueOrThrow({ where: { id: tautanPnw.tautanId } })).dicabutPada !== null && (await bacaTautanPublik(db, tautanPnw.token)).status === 404, "tautan aktifnya tercabut");
  await sebagaiPeran("DESAINER", () => harusDitolak("DESAINER pulihkan lampiran penawaran", () => pulihkanBerkas(lamPnw.id), "tidak ditemukan di Sampah"));
  await sebagaiPeran("ADMIN", () => jalankan("ADMIN pulihkan", () => pulihkanBerkas(lamPnw.id)));
  pastikan((await idTerlihat(ADMIN)).has(lamPnw.id) && (await jumlahLog(lamPnw.id, "PULIHKAN")) === 1, "pulihkan: tampil lagi, log PULIHKAN");
  pastikan((await bacaTautanPublik(db, tautanPnw.token)).status === 404, "tautan yang tercabut tidak hidup lagi");
  await sebagaiPeran("PEMILIK", () => harusDitolak("hapus permanen berkas aktif", () => hapusPermanenBerkas(lamPnw.id), "Buang berkas ke Sampah dulu"));
  await sebagaiPeran("ADMIN", () => jalankan("ADMIN buang lagi", () => buangBerkas(lamPnw.id)));
  await sebagaiPeran("ADMIN", () => harusDitolak("ADMIN hapus permanen", () => hapusPermanenBerkas(lamPnw.id), "tidak punya hak"));
  await sebagaiPeran("PEMILIK", () => jalankan("PEMILIK hapus permanen", () => hapusPermanenBerkas(lamPnw.id)));
  const permanen = await db.berkas.findUniqueOrThrow({ where: { id: lamPnw.id } });
  pastikan(permanen.isiDihapusPada !== null && (await db.isiBerkas.count({ where: { berkasId: lamPnw.id } })) === 0 && (await db.tautanBagiBerkas.count({ where: { berkasId: lamPnw.id } })) === 0, "hapus permanen: isi dan tautan hilang, metadata tetap");
  pastikan((await bacaUntukDikirim(db, PEMILIK, lamPnw.id, { unduh: true, ifNoneMatch: null })).status === 404 && !(await idTerlihat(PEMILIK, { sampah: true })).has(lamPnw.id), "unduh 404 dan tidak tampil di Sampah");
  pastikan((await jumlahLog(lamPnw.id, "HAPUS_PERMANEN")) === 1, "log HAPUS_PERMANEN");
  // perbaikan tinjauan P07 butir 2: sorot di Sampah (saring id + sampah) hanya menemukan berkas yang dibuang
  pastikan((await idTerlihat(PEMILIK, { id: jpg.id, sampah: true })).size === 0 && (await idTerlihat(PEMILIK, { id: jpg.id })).has(jpg.id), "sorot berkas aktif di Sampah: kosong; di daftar biasa: ada");
  await sebagaiPeran("PEMILIK", () => harusDitolak("hapus permanen dua kali", () => hapusPermanenBerkas(lamPnw.id), "Berkas tidak ditemukan"));

  console.log("=== 12. Tautan bagi ===");
  const lamPnw2 = await unggahSukses(PEMILIK, `${P}penawaran-2.pdf`, CONTOH.pdf, { jenisEntitas: "penawaran", entitasId: pnw.id });
  await sebagaiPeran("KASIR", () => harusDitolak("KASIR bagikan lampiran penawaran", () => buatTautanBagi(lamPnw2.id, formulir({ masaBerlaku: "7" })), "tidak punya hak membagikan"));
  // perbaikan tinjauan P07 butir 6: pemegang hak hapus tanpa berkas.bagikan tetap melihat dan boleh mencabut tautan aktif
  const lamProyekKasir = await unggahSukses(PEMILIK, `${P}lampiran-proyek.pdf`, CONTOH.pdf, { jenisEntitas: "proyek", entitasId: p2.id });
  pastikan(bolehAksesBerkas(KASIR, lamProyekKasir, "lihat") && bolehAksesBerkas(KASIR, lamProyekKasir, "hapus") && !bolehAksesBerkas(KASIR, lamProyekKasir, "bagikan"), "KASIR: lampiran proyek boleh dilihat dan dihapus, tidak boleh dibagikan");
  const bagiKasir = await buatTautanBagiBerkas(db, PEMILIK, lamProyekKasir.id, "7");
  const petaKasir = await petaTautanAktif(KASIR, [lamProyekKasir]);
  pastikan(petaKasir.get(lamProyekKasir.id)?.length === 1 && petaKasir.get(lamProyekKasir.id)![0].id === bagiKasir.tautanId && petaKasir.get(lamProyekKasir.id)![0].bolehCabut, "petaTautanAktif KASIR (hak hapus saja): tautan buatan Pemilik dimuat dan boleh dicabut");
  pastikan((await petaTautanAktif(KASIR, [lamPnw2])).size === 0, "petaTautanAktif KASIR untuk lampiran penawaran (tanpa hak bagikan dan hapus): kosong");
  await sebagaiPeran("KASIR", () => jalankan("KASIR cabut tautan buatan Pemilik", () => cabutTautanBagi(bagiKasir.tautanId)));
  pastikan((await db.tautanBagiBerkas.findUniqueOrThrow({ where: { id: bagiKasir.tautanId } })).dicabutPada !== null && (await petaTautanAktif(KASIR, [lamProyekKasir])).size === 0, "tautan tercabut oleh KASIR dan hilang dari daftar aktif");
  await sebagaiPeran("SOSMED", () => jalankan("SOSMED bagikan lewat aksi", () => buatTautanBagi(docx.id, formulir({ masaBerlaku: "7" }))));
  const sebelumBagi = new Date();
  const bagi = await buatTautanBagiBerkas(db, SOSMED, docx.id, "7");
  const barisTautan = await db.tautanBagiBerkas.findUniqueOrThrow({ where: { id: bagi.tautanId } });
  pastikan(barisTautan.tokenHash === createHash("sha256").update(bagi.token).digest("hex") && barisTautan.tokenHash === hashTokenBagi(bagi.token), "tokenHash = sha256(token)");
  const selisihHari = (bagi.kedaluwarsa.getTime() - sebelumBagi.getTime()) / 86_400_000;
  pastikan(selisihHari > 6.99 && selisihHari < 7.01, "masa berlaku 7 hari");
  pastikan(!JSON.stringify(barisTautan).includes(bagi.token), "token asli tidak tersimpan di kolom tautan");
  const logSejak = await db.logAktivitas.findMany({ where: { waktu: { gte: mulaiUji } } });
  pastikan(!JSON.stringify(logSejak).includes(bagi.token) && logSejak.some((l) => l.aksi === "BAGIKAN" && l.entitasId === docx.id), "token tidak masuk log, log BAGIKAN ada");
  const publik = await bacaTautanPublik(db, bagi.token);
  pastikan(publik.status === 200 && publik.kepala["Content-Disposition"].startsWith("attachment;") && publik.kepala["Content-Type"] === "application/octet-stream" && publik.kepala["Cache-Control"] === "private, no-store" && publik.kepala["X-Robots-Tag"] === "noindex, nofollow" && publik.kepala["Referrer-Policy"] === "no-referrer", "tautan publik: 200 attachment, no-store, noindex, no-referrer");
  pastikan(Buffer.from(publik.isi!).equals(Buffer.from(CONTOH.zip)) && (await db.tautanBagiBerkas.findUniqueOrThrow({ where: { id: bagi.tautanId } })).jumlahUnduh === 1, "isi benar, jumlahUnduh = 1");
  pastikan((await bacaTautanPublik(db, `${bagi.token}x`)).status === 404 && (await bacaTautanPublik(db, "")).status === 404, "token salah: 404");
  // perbaikan tinjauan P06 butir 8: HEAD tanpa isi dan tanpa menaikkan penghitung
  const kepalaPublik = await periksaTautanPublik(db, bagi.token);
  pastikan(kepalaPublik.status === 200 && kepalaPublik.isi === undefined && kepalaPublik.kepala["Content-Disposition"] === publik.kepala["Content-Disposition"] && kepalaPublik.kepala["Content-Length"] === String(CONTOH.zip.length), "periksaTautanPublik (HEAD): 200, kepala sama, tanpa isi");
  pastikan((await db.tautanBagiBerkas.findUniqueOrThrow({ where: { id: bagi.tautanId } })).jumlahUnduh === 1 && (await periksaTautanPublik(db, `${bagi.token}x`)).status === 404, "HEAD tidak menaikkan jumlahUnduh; token salah 404");
  const bagiLampau = await buatTautanBagiBerkas(db, PEMILIK, docx.id, "1");
  await db.tautanBagiBerkas.update({ where: { id: bagiLampau.tautanId }, data: { kedaluwarsa: new Date(Date.now() - 1000) } });
  pastikan((await bacaTautanPublik(db, bagiLampau.token)).status === 404, "kedaluwarsa di masa lalu: 404");
  await sebagaiPeran("DESAINER", () => harusDitolak("DESAINER cabut tautan orang lain", () => cabutTautanBagi(bagi.tautanId), "tidak punya hak mencabut"));
  await sebagaiPeran("PEMILIK", () => jalankan("PEMILIK cabut tautan", () => cabutTautanBagi(bagi.tautanId)));
  pastikan((await bacaTautanPublik(db, bagi.token)).status === 404 && (await db.logAktivitas.count({ where: { modul: "berkas", entitasId: docx.id, aksi: "CABUT" } })) === 1, "dicabut: 404, log CABUT");
  // pembuat tautan boleh mencabut tautannya sendiri tanpa hak hapus berkas
  const bagiIklan = await sebagai(`${PENGGUNA_UJI}iklan`, async () => buatTautanBagiBerkas(db, (await penggunaSaatIni())!, docx.id, "30"));
  await sebagai(`${PENGGUNA_UJI}iklan`, () => jalankan("pembuat (IKLAN) mencabut tautannya", () => cabutTautanBagi(bagiIklan.tautanId)));
  pastikan((await db.tautanBagiBerkas.findUniqueOrThrow({ where: { id: bagiIklan.tautanId } })).dicabutPada !== null, "tautan IKLAN tercabut oleh pembuatnya");
  await harusDitolak("masa berlaku 5", () => buatTautanBagiBerkas(db, PEMILIK, docx.id, "5"), "Masa berlaku tidak dikenal");
  await harusDitolak("masa berlaku bukan angka", () => buatTautanBagiBerkas(db, PEMILIK, docx.id, "7 hari"), "Masa berlaku tidak dikenal");
  const aktifSekarang = await db.tautanBagiBerkas.count({ where: { berkasId: docx.id, dicabutPada: null, kedaluwarsa: { gt: new Date() } } });
  for (let i = aktifSekarang; i < 7; i++) await buatTautanBagiBerkas(db, PEMILIK, docx.id, "");
  // perbaikan tinjauan P06 butir 9: enam permintaan serentak saat 7 aktif, hanya tiga yang lolos
  const serentak = await Promise.allSettled(Array.from({ length: 6 }, () => buatTautanBagiBerkas(db, PEMILIK, docx.id, "")));
  const lolosSerentak = serentak.filter((h) => h.status === "fulfilled").length;
  pastikan(lolosSerentak === 3 && serentak.every((h) => h.status === "fulfilled" || String(h.reason).includes("sudah punya 10 tautan aktif")), `pembuatan serentak: ${lolosSerentak} lolos, sisanya ditolak batas 10`);
  pastikan((await db.tautanBagiBerkas.count({ where: { berkasId: docx.id, dicabutPada: null, kedaluwarsa: { gt: new Date() } } })) === 10, "10 tautan aktif (masa kosong = bawaan 7 hari)");
  await harusDitolak("tautan ke-11", () => buatTautanBagiBerkas(db, PEMILIK, docx.id, "7"), "sudah punya 10 tautan aktif");
  const bagiAkhir = await db.tautanBagiBerkas.findFirstOrThrow({ where: { berkasId: docx.id, dicabutPada: null, kedaluwarsa: { gt: new Date() } }, select: { id: true } });
  await db.tautanBagiBerkas.update({ where: { id: bagiAkhir.id }, data: { dicabutPada: new Date() } });
  const tokenAkhir = (await buatTautanBagiBerkas(db, PEMILIK, docx.id, "7")).token;
  pastikan((await bacaTautanPublik(db, tokenAkhir)).status === 200, "setelah satu dicabut, tautan baru bisa dibuat");
  // perbaikan tinjauan P08 butir 4: buang dikomit selagi pembuatan tautan menunggu kunci baris; tautan tidak boleh
  // terbuat, karena tautan itu akan hidup lagi saat berkas dipulihkan
  let balapan: Promise<string> | undefined;
  let sudahMenunggu = false;
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Berkas" WHERE "id" = ${docx.id} FOR UPDATE`;
    balapan = buatTautanBagiBerkas(db, PEMILIK, docx.id, "7").then(
      () => "lolos",
      (e: unknown) => String(e),
    );
    // perbaikan tinjauan P10 butir 10: tunggu sampai sesi lain benar-benar menunggu kunci baris ini (bukan jeda tetap),
    // supaya jalur "dibuang selagi menunggu kunci" yang teruji, bukan pemeriksaan awal
    for (let i = 0; i < 500 && !sudahMenunggu; i++) {
      const [{ n }] = await tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE NOT l.granted AND a.datname = current_database() AND l.pid <> pg_backend_pid()`;
      sudahMenunggu = n > 0;
      if (!sudahMenunggu) await new Promise((r) => setTimeout(r, 20));
    }
    await buangSatuBerkas(tx, docx.id, PEMILIK);
  }, { timeout: 30_000 });
  pastikan(sudahMenunggu, "pembuatan tautan sempat menunggu kunci baris berkas sebelum berkas dibuang");
  const hasilBalapan = await balapan!;
  pastikan(hasilBalapan.includes("Berkas tidak ditemukan"), `tautan yang menunggu kunci saat berkas dibuang ditolak (${hasilBalapan})`);
  pastikan((await bacaTautanPublik(db, tokenAkhir)).status === 404 && (await db.tautanBagiBerkas.count({ where: { berkasId: docx.id, dicabutPada: null } })) === 0, "berkas dibuang: semua tautan 404 dan tercabut");
  pastikan(!(await db.$transaction((tx) => buangSatuBerkas(tx, docx.id, PEMILIK))), "buangSatuBerkas pada berkas yang sudah dibuang: false, tanpa log baru");
  pastikan((await jumlahLog(docx.id, "BUANG")) === 1, "buangSatuBerkas menulis satu log BUANG");
  await harusDitolak("bagikan berkas di Sampah", () => buatTautanBagiBerkas(db, PEMILIK, docx.id, "7"), "Berkas tidak ditemukan");

  console.log("=== 13. Folder buatan ===");
  await sebagaiPeran("PEMILIK", () => jalankan("buat folder Kontrak UJIB", () => buatFolderBerkas(formulir({ nama: "Kontrak UJIB" }))));
  const folderBaru = await db.folderBerkas.findUnique({ where: { kode: "KONTRAK_UJIB" } });
  const urutanMaks = Math.max(...potret.map((f) => f.urutan));
  pastikan(folderBaru !== null && !folderBaru.sistem && folderBaru.nama === "Kontrak UJIB" && folderBaru.urutan === urutanMaks + 1, "kode KONTRAK_UJIB, bukan sistem, urutan terbesar + 1");
  await sebagaiPeran("PEMILIK", () => harusDitolak("nama sama (beda huruf besar)", () => buatFolderBerkas(formulir({ nama: "kontrak ujib" })), "Folder kontrak ujib sudah ada"));
  await sebagaiPeran("PEMILIK", () => harusDitolak("nama kosong", () => buatFolderBerkas(formulir({ nama: "  " })), "Nama folder wajib diisi"));
  await sebagaiPeran("PEMILIK", () => harusDitolak("nama 41 karakter", () => buatFolderBerkas(formulir({ nama: "x".repeat(41) })), "paling panjang 40"));
  await sebagaiPeran("PEMILIK", () => jalankan("buat folder Kontrak-UJIB! (bentrok kode)", () => buatFolderBerkas(formulir({ nama: "Kontrak-UJIB!" }))));
  pastikan((await db.folderBerkas.count({ where: { kode: "KONTRAK_UJIB_2" } })) === 1, "kode bentrok diberi akhiran _2");
  await sebagaiPeran("PEMILIK", () => jalankan("buat folder 9 UJIB", () => buatFolderBerkas(formulir({ nama: "9 UJIB" }))));
  pastikan((await db.folderBerkas.count({ where: { kode: "F_9_UJIB" } })) === 1, "nama berawalan angka: kode diawali F_");
  await db.folderBerkas.delete({ where: { kode: "F_9_UJIB" } });
  await sebagaiPeran("ADMIN", () => harusDitolak("ADMIN buat folder", () => buatFolderBerkas(formulir({ nama: "UJIB Admin" })), "tidak punya hak"));
  await sebagaiPeran("PEMILIK", () => jalankan("ganti nama folder buatan", () => ubahFolderBerkas("KONTRAK_UJIB", formulir({ nama: "Kontrak UJIB Baru" }))));
  pastikan((await db.folderBerkas.findUniqueOrThrow({ where: { kode: "KONTRAK_UJIB" } })).nama === "Kontrak UJIB Baru", "ganti nama: kode tetap");
  await sebagaiPeran("PEMILIK", () => harusDitolak("ganti nama ke nama folder lain", () => ubahFolderBerkas("KONTRAK_UJIB", formulir({ nama: "lainnya" })), "Folder lainnya sudah ada"));
  const diKontrak = await unggahSukses(PEMILIK, `${P}kontrak.pdf`, CONTOH.pdf, { folderKode: "KONTRAK_UJIB" });
  await sebagaiPeran("PEMILIK", () => harusDitolak("hapus folder berisi berkas", () => hapusFolderBerkas("KONTRAK_UJIB"), "Folder masih berisi 1 berkas"));
  await sebagaiPeran("PEMILIK", () => jalankan("hapus folder kosong", () => hapusFolderBerkas("KONTRAK_UJIB_2")));
  pastikan((await db.folderBerkas.count({ where: { kode: "KONTRAK_UJIB_2" } })) === 0, "folder kosong terhapus");
  await sebagaiPeran("PEMILIK", () => harusDitolak("hapus folder sistem", () => hapusFolderBerkas("LAINNYA"), "Folder sistem tidak bisa dihapus"));
  pastikan((await db.logAktivitas.count({ where: { modul: "berkas", jenis: "Folder Berkas", waktu: { gte: mulaiUji } } })) >= 4, "log BUAT/UBAH/HAPUS folder buatan");
  await sebagaiPeran("PEMILIK", () => jalankan("pindahkan berkas keluar folder buatan", () => ubahBerkas(diKontrak.id, formulir({ folderKode: "LAINNYA" }))));
  // perbaikan tinjauan P07 butir 4: berkas di Sampah menahan folder, berkas yang sudah dihapus permanen tidak
  const diKontrak2 = await unggahSukses(PEMILIK, `${P}kontrak-2.pdf`, CONTOH.pdf, { folderKode: "KONTRAK_UJIB" });
  await sebagaiPeran("PEMILIK", () => jalankan("buang berkas di folder buatan", () => buangBerkas(diKontrak2.id)));
  await sebagaiPeran("PEMILIK", () => harusDitolak("hapus folder yang berkasnya di Sampah", () => hapusFolderBerkas("KONTRAK_UJIB"), "Folder masih berisi 1 berkas (1 di Sampah)"));
  await sebagaiPeran("PEMILIK", () => jalankan("hapus permanen berkas folder buatan", () => hapusPermanenBerkas(diKontrak2.id)));
  const jumlahFolderPengaturan = async () => new Map((await db.berkas.groupBy({ by: ["folderKode"], where: { isiDihapusPada: null }, _count: { _all: true } })).map((h) => [h.folderKode, h._count._all])).get("KONTRAK_UJIB") ?? 0;
  pastikan((await jumlahFolderPengaturan()) === 0 && (await db.berkas.count({ where: { folderKode: "KONTRAK_UJIB" } })) === 1, "hitungan halaman Akses Berkas tidak memuat berkas yang dihapus permanen");
  await sebagaiPeran("ADMIN", () => harusDitolak("ADMIN hapus folder buatan", () => hapusFolderBerkas("KONTRAK_UJIB"), "tidak punya hak"));
  await sebagaiPeran("PEMILIK", () => jalankan("hapus folder yang tinggal berisi berkas terhapus permanen", () => hapusFolderBerkas("KONTRAK_UJIB")));
  const kontrak2 = await db.berkas.findUniqueOrThrow({ where: { id: diKontrak2.id } });
  pastikan((await db.folderBerkas.count({ where: { kode: "KONTRAK_UJIB" } })) === 0 && kontrak2.folderKode === "LAINNYA" && kontrak2.isiDihapusPada !== null, "folder terhapus, metadata berkas terhapus permanen pindah ke LAINNYA");
  const logHapusFolder = await db.logAktivitas.findFirst({ where: { modul: "berkas", jenis: "Folder Berkas", aksi: "HAPUS", nomor: "KONTRAK_UJIB", waktu: { gte: mulaiUji } }, select: { meta: true } });
  pastikan((logHapusFolder?.meta as Record<string, unknown> | null)?.berkasDihapusPermanenDipindah === 1 && (logHapusFolder?.meta as Record<string, unknown>).folder === "KONTRAK_UJIB", "log HAPUS folder mencatat jumlah berkas terhapus permanen yang dipindah");

  console.log("=== 14. Lampiran yatim dan pembantu domain ===");
  const lamYatim = await unggahSukses(PEMILIK, `${P}yatim.pdf`, CONTOH.pdf, { jenisEntitas: "penawaran", entitasId: pnw.id });
  await jalankan("hapus penawaran uji", () => hapusDokumen("penawaran", pnw.id));
  const yatim = await db.berkas.findUniqueOrThrow({ where: { id: lamYatim.id } });
  pastikan(yatim.dihapusPada === null && (await db.isiBerkas.count({ where: { berkasId: lamYatim.id } })) === 1, "dokumen lama dihapus: lampiran tetap ada dan tidak dibuang");
  pastikan((await JENIS_LAMPIRAN.penawaran.baca(db, pnw.id)) === null && (await idTerlihat(ADMIN)).has(lamYatim.id), "lampiran yatim: pembaca registri null (tampil sudah dihapus), tetap terlihat pemegang hak");
  const konten = await db.konten.create({ data: { judul: `${P}Konten`, dibuatOlehNama: "Skrip Uji" } });
  const logSebelum = await db.logAktivitas.count();
  pastikan((await db.$transaction((tx) => buangLampiranEntitas(tx, "konten", konten.id, PEMILIK))) === 0 && (await db.logAktivitas.count()) === logSebelum, "buangLampiranEntitas tanpa lampiran: 0, tanpa log");
  const k1 = await unggahSukses(PEMILIK, `${P}k1.jpg`, CONTOH.jpeg, { jenisEntitas: "konten", entitasId: konten.id });
  const k2 = await unggahSukses(PEMILIK, `${P}k2.png`, CONTOH.png, { jenisEntitas: "konten", entitasId: konten.id });
  const k3 = await unggahSukses(PEMILIK, `${P}k3.gif`, CONTOH.gif, { jenisEntitas: "konten", entitasId: konten.id });
  pastikan(k1.folderKode === "SOSMED" && k1.proyekId === null, "lampiran konten: folder SOSMED");
  await db.$transaction((tx) => buangSatuBerkas(tx, k3.id, PEMILIK));
  pastikan((await sinkronProyekLampiran(db, "konten", konten.id, p2.id)) === 3 && (await db.berkas.count({ where: { id: { in: [k1.id, k2.id, k3.id] }, proyekId: p2.id } })) === 3, "sinkronProyekLampiran mengubah proyek termasuk berkas di Sampah");
  const aktifKonten = await daftarBerkasAktifEntitas(db, "konten", konten.id);
  pastikan(aktifKonten.map((b) => b.id).sort().join() === [k1.id, k2.id].sort().join(), "daftarBerkasAktifEntitas: hanya yang aktif");
  const logSebelumBuang = await db.logAktivitas.count({ where: { modul: "berkas", aksi: "BUANG" } });
  pastikan((await db.$transaction((tx) => buangLampiranEntitas(tx, "konten", konten.id, PEMILIK))) === 2, "buangLampiranEntitas dengan 2 lampiran aktif: 2 dibuang");
  pastikan((await db.logAktivitas.count({ where: { modul: "berkas", aksi: "BUANG" } })) === logSebelumBuang + 1 && (await db.berkas.count({ where: { id: { in: [k1.id, k2.id] }, dihapusPada: null } })) === 0, "buangLampiranEntitas: satu log BUANG, semua aktif dibuang");
  const logBuangEntitas = await db.logAktivitas.findFirstOrThrow({ where: { modul: "berkas", aksi: "BUANG", entitasId: konten.id } });
  pastikan(logBuangEntitas.keterangan === "2 lampiran Konten Media Sosial dibuang bersama data induknya" && (logBuangEntitas.meta as Record<string, unknown>).folder === "SOSMED" && "proyekId" in (logBuangEntitas.meta as Record<string, unknown>), "keterangan dan meta folder/proyek log buang entitas");
  // daftarBerkasAktifEntitas tidak bergantung hak pembaca; tag REFERENSI ikut membaca tag null
  const refTugas = await unggahSukses(PEMILIK, `${P}ref.jpg`, CONTOH.jpeg, { jenisEntitas: "tugas-desain", entitasId: tugas.id });
  await db.berkas.update({ where: { id: refTugas.id }, data: { tag: null } });
  const hasilTugas = await daftarBerkasAktifEntitas(db, "hasil-desain", tugas.id, { tag: "HASIL" });
  pastikan(hasilTugas.length === 1 && hasilTugas[0].id === hasilDesain.id && !(await idTerlihat(KASIR)).has(hasilDesain.id), "daftarBerkasAktifEntitas memuat hasil desain walau KASIR (pembaca tanpa hak) tidak melihatnya");
  pastikan((await daftarBerkasAktifEntitas(db, "tugas-desain", tugas.id, { tag: "REFERENSI" })).some((b) => b.id === refTugas.id), "tag REFERENSI memuat berkas bertag null");
  pastikan((await daftarBerkasTerlihat(db, PEMILIK, { jenisEntitas: "tugas-desain", entitasId: tugas.id, tag: "REFERENSI" })).total === 1, "daftarBerkasTerlihat dengan saringan entitas dan tag");
  // pembaca registri jenis domain baru
  await db.konten.update({ where: { id: konten.id }, data: { diarsipkanPada: new Date() } });
  pastikan((await JENIS_LAMPIRAN.konten.baca(db, konten.id)) === null, "konten terarsip: pembaca null");
  await pastikanGagal("unggah ke konten terarsip", unggah(PEMILIK, `${P}x.jpg`, CONTOH.jpeg, { jenisEntitas: "konten", entitasId: konten.id }), 404, "Data tujuan lampiran tidak ditemukan");
  const kop = await db.kopSurat.create({ data: { nama: `${P}Kop` } });
  pastikan((await JENIS_LAMPIRAN["kop-surat"].baca(db, kop.id))?.label === `Kop ${P}Kop`, "kop aktif terbaca dengan label Kop {nama}");
  await db.kopSurat.update({ where: { id: kop.id }, data: { dihapusPada: new Date() } });
  pastikan((await JENIS_LAMPIRAN["kop-surat"].baca(db, kop.id)) === null, "kop terhapus: pembaca null");
  const kampanye = await db.kampanye.create({ data: { nama: `${P}Kampanye`, dibuatOlehNama: "Skrip Uji", proyekId: p2.id, diarsipkanPada: new Date() } });
  pastikan((await JENIS_LAMPIRAN.kampanye.baca(db, kampanye.id)) === null && (await JENIS_LAMPIRAN["tugas-desain"].baca(db, tugas.id))?.proyekId === p1.id, "kampanye terarsip null, tugas desain membawa proyeknya");
  const infoProyek = await JENIS_LAMPIRAN.proyek.baca(db, p2.id);
  pastikan(infoProyek?.proyekId === p2.id && infoProyek.label === p2.kode && (await JENIS_LAMPIRAN["laporan-keuangan-proyek"].baca(db, p2.id))?.proyekId === p2.id, "pembaca proyek dan laporan keuangan proyek: proyekId = id");
  const lamProyek = await unggahSukses(ADMIN, `${P}proyek.pdf`, CONTOH.pdf, { jenisEntitas: "proyek", entitasId: p2.id });
  pastikan((await idTerlihat(SOSMED)).has(lamProyek.id) && (await idTerlihat(KASIR)).has(lamProyek.id), "lampiran proyek terlihat dengan proyek.lihat (SOSMED, KASIR)");
  pastikan(!(await idTerlihat(sesi("GUDANG"))).has(lamProyek.id), "GUDANG tanpa proyek.lihat tidak melihat lampiran proyek");
  await pastikanGagal("SOSMED unggah lampiran proyek tanpa data-induk.tulis", unggah(sesi("SOSMED", hitungHak("SOSMED").filter((h) => h !== "berkas.buat")), `${P}x.pdf`, CONTOH.pdf, { jenisEntitas: "proyek", entitasId: p2.id }), 403, "tidak punya hak mengunggah");
  pastikan(JENIS_LAMPIRAN["talangan-mitra"].tautan("t1", { perusahaanId: "utama", proyekId: "p9", label: "x" }) === "/proyek/p9/keuangan/talangan/t1", "tautan talangan memakai proyek entitas");
  const isiBaca = await bacaIsiBerkas(db, jpg.id);
  pastikan(!!isiBaca && Buffer.from(isiBaca).equals(Buffer.from(CONTOH.jpeg)) && (await bacaIsiBerkas(db, lamPnw.id)) === null, "bacaIsiBerkas tanpa cek hak; null setelah hapus permanen");
  const ringkas = await ringkasPenyimpanan(db);
  pastikan(ringkas.jumlah >= 5 && ringkas.totalByte >= pdfBesar.ukuran, "ringkasPenyimpanan menghitung berkas yang isinya masih ada");

  console.log("=== 15. Pencarian dan log ===");
  const cariDesainer = await cariBerkas(db, DESAINER, P);
  pastikan(cariDesainer.length > 0 && !cariDesainer.some((b) => b.id === pdfFaktur.id || b.id === lamPnw2.id || b.id === lamYatim.id), "cariBerkas DESAINER tanpa berkas FAKTUR dan lampiran penawaran");
  pastikan(cariDesainer.every((b) => b.tautan === `/berkas?sorot=${b.id}`) && cariDesainer.length <= 10, "hasil cari bertaut ke /berkas?sorot=, paling banyak 10");
  pastikan((await cariBerkas(db, PEMILIK, "di-faktur")).some((b) => b.id === pdfFaktur.id) && (await cariBerkas(db, PEMILIK, "di-faktur", "tapussa")).length === 0, "cariBerkas PEMILIK menemukan berkas FAKTUR; saringan perusahaan berlaku");
  pastikan((await cariBerkas(db, PEMILIK, "  ")).length === 0, "kata kunci kosong: tanpa hasil");
  await db.logAktivitas.createMany({
    data: [
      { penggunaNama: "Skrip Uji", aksi: "HAPUS", jenis: "Uji", nomor: `${P}LOG-NULL` },
      { penggunaNama: "Skrip Uji", aksi: "UBAH", jenis: "Uji", nomor: `${P}LOG-KONTEN`, modul: "konten" },
      { penggunaNama: "Skrip Uji", aksi: "UNGGAH", jenis: "Berkas", nomor: `${P}LOG-FAKTUR`, modul: "berkas", meta: { folder: "FAKTUR", proyekId: null } },
      { penggunaNama: "Skrip Uji", aksi: "UNGGAH", jenis: "Berkas", nomor: `${P}LOG-UMUM`, modul: "berkas", meta: { folder: "LAINNYA", proyekId: null } },
    ],
  });
  const nomorLog = async (pengguna: PenggunaSesi, ruang: Awaited<ReturnType<typeof ruangTersembunyi>>) =>
    new Set((await db.logAktivitas.findMany({ where: { AND: [syaratLogTerlihat(pengguna, ruang), { nomor: { startsWith: `${P}LOG-` } }] }, select: { nomor: true } })).map((b) => b.nomor));
  const hanyaLog = sesi("KASIR", ["log-aktivitas.lihat"]);
  const lihatHanyaLog = await nomorLog(hanyaLog, await ruangTersembunyi(db, hanyaLog));
  pastikan(lihatHanyaLog.has(`${P}LOG-NULL`) && !lihatHanyaLog.has(`${P}LOG-FAKTUR`) && !lihatHanyaLog.has(`${P}LOG-UMUM`) && !lihatHanyaLog.has(`${P}LOG-KONTEN`), "hanya log-aktivitas.lihat: baris null terlihat, berkas dan konten tidak");
  await sebagaiPeran("PEMILIK", () => jalankan("FAKTUR peranBoleh kosong lagi", () => simpanAksesFolder(fdGanda([["folderDirender", "FAKTUR"], ["terbatas|FAKTUR", "on"]]))));
  const ruangAdmin = await ruangTersembunyi(db, ADMIN);
  pastikan(!!ruangAdmin && ruangAdmin.folder.includes("FAKTUR") && !ruangAdmin.folder.includes("KUITANSI"), "ruang ADMIN: FAKTUR tersembunyi, KUITANSI tidak");
  const lihatAdmin = await nomorLog(ADMIN, ruangAdmin);
  pastikan(!lihatAdmin.has(`${P}LOG-FAKTUR`) && lihatAdmin.has(`${P}LOG-UMUM`) && lihatAdmin.has(`${P}LOG-NULL`) && lihatAdmin.has(`${P}LOG-KONTEN`), "ADMIN: log berkas FAKTUR tidak terlihat, log berkas lain dan modul lain terlihat");
  pastikan((await ruangTersembunyi(db, PEMILIK)) === null, "PEMILIK: ruang null (akses penuh)");
  pastikan((await nomorLog(PEMILIK, null)).has(`${P}LOG-FAKTUR`), "PEMILIK melihat semua log berkas");
  const logUnggahFaktur = await db.logAktivitas.count({ where: { AND: [syaratLogTerlihat(ADMIN, ruangAdmin), { modul: "berkas", entitasId: pdfFaktur.id }] } });
  pastikan(logUnggahFaktur === 0 && (await db.logAktivitas.count({ where: { modul: "berkas", entitasId: pdfFaktur.id } })) >= 1, "log UNGGAH nyata di FAKTUR tersembunyi bagi ADMIN");
  // perbaikan tinjauan P06 butir 2 dan 3: folder kunci dan hak lihat jenis lampiran ikut menyaring log
  const tiruan = (nomor: string, folderKode: string, jenisEntitas: string | null) => ({ id: `ujib-${nomor}`, namaBerkas: `${P}LOG-${nomor}`, folderKode, proyekId: null, perusahaanId: "utama", jenisEntitas });
  await catatLogBerkas(db, PEMILIK, tiruan("KUNCI", "LAINNYA", "faktur"), "UNGGAH", { keterangan: "Lampiran Faktur Penjualan uji" });
  await catatLogBerkas(db, PEMILIK, tiruan("KOP", "KOP", "kop-surat"), "UNGGAH");
  await catatLogBerkas(db, PEMILIK, tiruan("PNW", "LAINNYA", "penawaran"), "UBAH");
  const metaKunci = (await db.logAktivitas.findFirstOrThrow({ where: { nomor: `${P}LOG-KUNCI` } })).meta as Record<string, unknown>;
  pastikan(metaKunci.folder === "LAINNYA" && metaKunci.folderKunci === "FAKTUR" && metaKunci.jenisEntitas === "faktur" && metaKunci.proyekId === null, "catatLogBerkas menulis folder, folderKunci, jenisEntitas, proyekId");
  const lihatAdmin2 = await nomorLog(ADMIN, ruangAdmin);
  pastikan(!lihatAdmin2.has(`${P}LOG-KUNCI`) && lihatAdmin2.has(`${P}LOG-PNW`) && lihatAdmin2.has(`${P}LOG-UMUM`), "ADMIN (FAKTUR tersembunyi): log lampiran faktur di LAINNYA tidak terlihat, lampiran penawaran dan baris lama tanpa folderKunci tetap terlihat");
  pastikan(!punyaHak(ADMIN, JENIS_LAMPIRAN["kop-surat"].hakLihat) && !lihatAdmin2.has(`${P}LOG-KOP`), "ADMIN tanpa pengaturan.tulis tidak melihat log lampiran kop");
  const lihatPemilik = await nomorLog(PEMILIK, null);
  pastikan(["KUNCI", "KOP", "PNW", "FAKTUR", "UMUM"].every((n) => lihatPemilik.has(`${P}LOG-${n}`)), "PEMILIK melihat semua log berkas, termasuk kop dan lampiran faktur");
  const tanpaLihatPenawaran = sesi("PEMILIK", PEMILIK.hak.filter((h) => h !== "penawaran.lihat"));
  const lihatTanpaPnw = await nomorLog(tanpaLihatPenawaran, null);
  pastikan(!lihatTanpaPnw.has(`${P}LOG-PNW`) && lihatTanpaPnw.has(`${P}LOG-KUNCI`), "akses penuh tanpa penawaran.lihat: log lampiran penawaran tersembunyi (saringan jenis tanpa ruang)");
  const logSuite = await db.logAktivitas.findMany({ where: { modul: "berkas", waktu: { gte: mulaiUji }, NOT: { nomor: { startsWith: `${P}LOG-` } } }, select: { aksi: true, nomor: true, meta: true } });
  const tanpaKunci = logSuite.filter((l) => { const m = (l.meta ?? {}) as Record<string, unknown>; return !["folder", "folderKunci", "jenisEntitas", "proyekId"].every((k) => k in m); });
  pastikan(logSuite.length > 20 && tanpaKunci.length === 0, `semua ${logSuite.length} log berkas suite ini memuat keempat kunci meta: ${tanpaKunci.map((l) => `${l.aksi} ${l.nomor}`).join("; ")}`);

  console.log("=== 16. Bersih-bersih ===");
  await bersihkanData();
  await pulihkanFolder();
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  pastikan((await db.berkas.count({ where: { namaBerkas: { startsWith: P } } })) === 0, "tidak ada Berkas UJIB- tersisa");
  const urutKode = (a: { kode: string }, b: { kode: string }) => (a.kode < b.kode ? -1 : a.kode > b.kode ? 1 : 0);
  const folderAkhir = (await db.folderBerkas.findMany({ select: { kode: true, nama: true, urutan: true, sistem: true, terbatas: true, peranBoleh: true } })).sort(urutKode);
  pastikan(JSON.stringify(folderAkhir) === JSON.stringify([...potret].sort(urutKode)), "FolderBerkas kembali ke potret awal");
  pastikan((await db.hakAksesPeran.count()) === awalHakAksesPeran, "tidak ada baris HakAksesPeran baru");
  console.log("=== DONE, all berkas checks passed ===");
}

main()
  .catch(async (galat) => {
    console.error(galat);
    await bersihkanData().catch((e) => console.error("bersih-bersih gagal", e));
    await pulihkanFolder().catch((e) => console.error("pemulihan folder gagal", e));
    await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } }).catch((e) => console.error("pembersihan log gagal", e));
    process.exit(1);
  })
  .finally(() => db.$disconnect());
