import "dotenv/config";
// Skrip ini memanggil halaman dan pustaka di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { db } from "../src/lib/db";
import { SEMUA_HAK, hitungHak, type Hak, type PenggunaSesi } from "../src/lib/hakAkses";
import {
  DAFTAR_MODUL_LOG,
  MODUL_LOG,
  PANJANG_KETERANGAN_LOG,
  PANJANG_NOMOR_LOG,
  adaSaringanLog,
  bacaSaringanLog,
  catatAktivitas,
  catatMasuk,
  gayaAksiLog,
  labelModulLog,
  paramSaringanLog,
  saringLogLingkup,
  syaratLogTerlihat,
  syaratSaringanLog,
  type KlienDb,
  type ModulLog,
  type RuangTersembunyi,
} from "../src/lib/log";
import { bacaWaktuLokal } from "../src/lib/waktu";
import { kelasLencanaAksiLog } from "../src/komponen/beranda/PanelSistem";
import KontrolDaftar from "../src/komponen/ui/KontrolDaftar";
import HalamanLogAktivitas from "../src/app/(aplikasi)/pengaturan/log-aktivitas/page";
import type { PeranPengguna, Prisma } from "../src/prisma-klien/client";
import { pastikan } from "./bantuan";

/*
 * Uji log aktivitas diperluas (P04, D7 §3.7): catatAktivitas (potong nomor dan keterangan, pengguna semu tanpa
 * penggunaId), catatMasuk (satu baris auth, galat tidak dilempar), syaratLogTerlihat per hak modul dan ruang berkas
 * (cabang modul null wajib), warna lencana, saringan halaman, dan halaman Log Aktivitas per peran dan lingkup.
 * Semua baris uji bernomor berawalan UJLOG- atau ujilog-, dihapus di awal dan di akhir.
 */

const AWALAN = "UJLOG-";
const AWALAN_MASUK = "ujilog-";
const SYARAT_UJI: Prisma.LogAktivitasWhereInput = { OR: [{ nomor: { startsWith: AWALAN } }, { nomor: { startsWith: AWALAN_MASUK } }] };

async function bersihkan() {
  await db.logAktivitas.deleteMany({ where: SYARAT_UJI });
}

function penggunaSintetis(peran: PeranPengguna, hak: readonly Hak[] = hitungHak(peran)): PenggunaSesi {
  return { id: "skrip-uji", nama: "Skrip Uji", namaPengguna: "skrip-uji", email: null, nomorTelepon: null, peran, hak };
}

async function denganEnv<T>(isian: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const lama: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(isian)) {
    lama[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(lama)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Cari elemen bertipe tertentu di pohon tanpa menjalankan komponen anak. */
function cariDangkal(node: ReactNode, tipe: unknown): ReactElement<Record<string, unknown>>[] {
  const hasil: ReactElement<Record<string, unknown>>[] = [];
  const jalan = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(jalan);
    if (!isValidElement(n)) return;
    const el = n as ReactElement<Record<string, unknown>>;
    if (el.type === tipe) hasil.push(el);
    jalan(el.props.children as ReactNode);
  };
  jalan(node);
  return hasil;
}

/** Semua teks di pohon (tanpa menjalankan komponen anak). */
function teksDangkal(node: ReactNode): string {
  const keluar: string[] = [];
  const jalan = (n: ReactNode) => {
    if (n === null || n === undefined || typeof n === "boolean") return;
    if (typeof n === "string" || typeof n === "number") return void keluar.push(String(n));
    if (Array.isArray(n)) return n.forEach(jalan);
    if (!isValidElement(n)) return;
    jalan((n as ReactElement<Record<string, unknown>>).props.children as ReactNode);
  };
  jalan(node);
  return keluar.join(" ");
}

/** Render halaman Log Aktivitas sebagai peran dan lingkup tertentu; kembalikan total KontrolDaftar dan pohonnya. */
async function bukaHalaman(peran: PeranPengguna, perusahaan: string, param: Record<string, string> = {}) {
  return denganEnv({ UJI_PERAN: peran, UJI_PERUSAHAAN: perusahaan, UJI_PENGGUNA: undefined }, async () => {
    const pohon = (await HalamanLogAktivitas({ searchParams: Promise.resolve(param) })) as ReactNode;
    const kontrol = cariDangkal(pohon, KontrolDaftar);
    pastikan(kontrol.length === 1, `halaman ${peran} memuat satu KontrolDaftar`);
    return { total: kontrol[0].props.total as number, tambahan: kontrol[0].props.tambahan as Record<string, string | undefined>, pohon };
  });
}

async function nomorTerlihat(pengguna: PenggunaSesi, ruang: RuangTersembunyi): Promise<Set<string>> {
  const baris = await db.logAktivitas.findMany({ where: { AND: [syaratLogTerlihat(pengguna, ruang), { nomor: { startsWith: AWALAN } }] }, select: { nomor: true } });
  return new Set(baris.map((b) => b.nomor));
}

const nomorModul = (m: ModulLog) => `${AWALAN}M-${m}`;

async function main() {
  await bersihkan();
  pastikan((await db.logAktivitas.count({ where: SYARAT_UJI })) === 0, "awal: tidak ada sisa baris uji log");

  console.log("=== 1. Daftar modul dan warna lencana ===");
  const harapanModul = ["auth", "pengguna", "pengaturan", "perusahaan", "antar-perusahaan", "penjualan", "dokumen", "crm", "konten", "tugas-desain", "kampanye", "proyek", "anggaran-proyek", "bagi-hasil", "berkas"];
  pastikan(DAFTAR_MODUL_LOG.length === harapanModul.length && harapanModul.every((m) => (DAFTAR_MODUL_LOG as string[]).includes(m)), "DAFTAR_MODUL_LOG memuat 15 modul DESAIN §3.3");
  pastikan(DAFTAR_MODUL_LOG.every((m) => MODUL_LOG[m].label.trim() !== "" && (MODUL_LOG[m].hakLihat === null || SEMUA_HAK.includes(MODUL_LOG[m].hakLihat!))), "setiap modul berlabel dan hak lihatnya kunci yang ada");
  const hakModul: Partial<Record<ModulLog, Hak | null>> = { crm: "lead.lihat", berkas: "berkas.lihat", konten: "konten.lihat", "tugas-desain": "tugas-desain.lihat", kampanye: "kampanye.lihat", pengguna: "pengguna.kelola", proyek: "data-induk.lihat", "anggaran-proyek": "anggaran-proyek.lihat", "bagi-hasil": "bagi-hasil.lihat", auth: null, pengaturan: null, perusahaan: null, dokumen: null };
  pastikan(Object.entries(hakModul).every(([m, h]) => MODUL_LOG[m as ModulLog].hakLihat === h), "hak lihat modul sesuai tabel D7 §3.7.2");
  pastikan(labelModulLog(null) === "Akuntansi & umum" && labelModulLog("crm") === "CRM" && labelModulLog("modul-asing") === "modul-asing", "label modul: null, dikenal, tidak dikenal");
  const aksiDf5 = ["BUAT", "UBAH", "HAPUS", "TOLAK", "TUTUP", "MASUK", "SETUJUI", "AJUKAN", "ATUR ULANG", ""];
  pastikan(aksiDf5.every((a) => kelasLencanaAksiLog(a) === gayaAksiLog(a, null)), "kelasLencanaAksiLog membungkus gayaAksiLog untuk catatan tanpa modul");
  pastikan(gayaAksiLog("BUAT", null) === "lencana lencana-emerald" && gayaAksiLog("UBAH", null) === "lencana lencana-blue" && gayaAksiLog("HAPUS", null) === "lencana lencana-rose" && ["TOLAK", "MASUK", "SETUJUI", "LAIN"].every((a) => gayaAksiLog(a, null) === "lencana lencana-slate"), "tanpa modul: warna DF5 (BUAT hijau, UBAH biru, HAPUS merah, lainnya abu-abu)");
  const warnaModul: Record<string, string> = {
    HAPUS: "rose", BUANG: "rose", HAPUS_PERMANEN: "rose", TOLAK: "rose", CABUT: "rose", ARSIP: "rose", ARSIPKAN: "rose",
    BUAT: "emerald", SETUJUI: "emerald", PULIHKAN: "emerald",
    AJUKAN: "amber", REVISI: "amber", STATUS: "amber", TUGASKAN: "amber",
    MASUK: "slate", UNGGAH: "slate", UNDUH: "slate", BAGIKAN: "slate",
    UBAH: "blue", CATAT: "blue", LAIN: "blue",
  };
  pastikan(Object.entries(warnaModul).every(([a, w]) => gayaAksiLog(a, "berkas") === `lencana lencana-${w}`), "bermodul: warna D7 §7.11 (BUAT hijau seperti DF5, lainnya biru)");

  console.log("=== 2. catatAktivitas ===");
  const semu = penggunaSintetis("PEMILIK");
  const nomorPanjang = `${AWALAN}PANJANG-${"x".repeat(200)}`;
  await catatAktivitas(db, semu, { aksi: "UBAH", jenis: "Uji", nomor: nomorPanjang, keterangan: "k".repeat(800), modul: "pengaturan", entitasId: "ujilog-entitas", meta: { a: 1, b: "dua" }, perusahaanId: "utama" });
  const panjang = await db.logAktivitas.findFirstOrThrow({ where: { nomor: { startsWith: `${AWALAN}PANJANG-` } } });
  pastikan(panjang.nomor.length === PANJANG_NOMOR_LOG && PANJANG_NOMOR_LOG === 120 && panjang.nomor === nomorPanjang.slice(0, 120), "nomor dipotong 120 karakter");
  pastikan(panjang.keterangan?.length === PANJANG_KETERANGAN_LOG && PANJANG_KETERANGAN_LOG === 500, "keterangan dipotong 500 karakter");
  pastikan(panjang.penggunaId === null && panjang.penggunaNama === "Skrip Uji", "pengguna semu skrip-uji: penggunaId null, nama tetap ditulis");
  pastikan(panjang.modul === "pengaturan" && panjang.entitasId === "ujilog-entitas" && panjang.perusahaanId === "utama" && JSON.stringify(panjang.meta) === JSON.stringify({ a: 1, b: "dua" }), "modul, entitasId, meta, perusahaanId tersimpan");
  await catatAktivitas(db, { id: "ujilog-pelaku", nama: "Pelaku Uji" }, { aksi: "BUAT", jenis: "Uji", nomor: `${AWALAN}PELAKU`, modul: "perusahaan" });
  const pelaku = await db.logAktivitas.findFirstOrThrow({ where: { nomor: `${AWALAN}PELAKU` } });
  pastikan(pelaku.penggunaId === "ujilog-pelaku" && pelaku.keterangan === null && pelaku.entitasId === null && pelaku.meta === null && pelaku.perusahaanId === null, "pelaku biasa: penggunaId terisi, kolom opsional null");
  await db.$transaction(async (tx) => {
    await catatAktivitas(tx, semu, { aksi: "UBAH", jenis: "Uji", nomor: `${AWALAN}TX`, modul: "pengaturan" });
  });
  pastikan((await db.logAktivitas.count({ where: { nomor: `${AWALAN}TX` } })) === 1, "catatAktivitas bisa dipanggil dengan tx");
  let gagalTx = false;
  try {
    await db.$transaction(async (tx) => {
      await catatAktivitas(tx, semu, { aksi: "UBAH", jenis: "Uji", nomor: `${AWALAN}TX-BATAL`, modul: "pengaturan" });
      throw new Error("batalkan");
    });
  } catch {
    gagalTx = true;
  }
  pastikan(gagalTx && (await db.logAktivitas.count({ where: { nomor: `${AWALAN}TX-BATAL` } })) === 0, "log ikut batal bersama transaksinya");

  console.log("=== 3. catatMasuk ===");
  const akun = { id: "ujilog-akun", nama: "Uji Log Masuk", namaPengguna: "ujilog-masuk" };
  const sebelumAuth = await db.logAktivitas.count({ where: { modul: "auth" } });
  pastikan((await catatMasuk(db, akun)) === true, "catatMasuk berhasil mengembalikan true");
  const masuk = await db.logAktivitas.findMany({ where: { nomor: "ujilog-masuk" } });
  pastikan(masuk.length === 1 && (await db.logAktivitas.count({ where: { modul: "auth" } })) === sebelumAuth + 1, "catatMasuk menulis tepat satu baris");
  const m = masuk[0];
  pastikan(m.modul === "auth" && m.aksi === "MASUK" && m.jenis === "Sesi" && m.keterangan === "Masuk berhasil" && m.penggunaId === "ujilog-akun" && m.penggunaNama === "Uji Log Masuk" && m.perusahaanId === null, "baris masuk: modul auth, aksi MASUK, jenis Sesi, tingkat sistem");
  const klienRusak = { logAktivitas: { create: async () => { throw new Error("basis data mati (uji)"); } } } as unknown as KlienDb;
  const errorAsli = console.error;
  let dicetak = 0;
  console.error = () => { dicetak++; };
  let hasilRusak: boolean | "lempar" = "lempar";
  try {
    hasilRusak = await catatMasuk(klienRusak, akun);
  } catch {
    hasilRusak = "lempar";
  } finally {
    console.error = errorAsli;
  }
  pastikan(hasilRusak === false && dicetak === 1, "galat di catatMasuk ditangkap (false, dicetak ke log server), tidak dilempar");
  const sumberOtentikasi = readFileSync("src/lib/aksi/otentikasi.ts", "utf8");
  const blokMasuk = sumberOtentikasi.slice(sumberOtentikasi.indexOf("export async function masuk("), sumberOtentikasi.indexOf("export async function masukFormulir"));
  pastikan(/await buatSesi\(pengguna\.id\);\s*(\/\/[^\n]*\n\s*)?await catatMasuk\(db, pengguna\);\s*redirect\(/.test(blokMasuk), "aksi masuk memanggil catatMasuk tepat setelah buatSesi dan sebelum redirect");
  pastikan((sumberOtentikasi.match(/catatMasuk\(/g) ?? []).length === 1 && (blokMasuk.match(/catatMasuk\(/g) ?? []).length === 1, "catatMasuk hanya dipanggil sekali, di aksi masuk setelah sukses (gagal masuk tidak dicatat)");

  console.log("=== 4. syaratLogTerlihat ===");
  await db.logAktivitas.createMany({
    data: [
      { penggunaNama: "Skrip Uji", aksi: "HAPUS", jenis: "Uji", nomor: `${AWALAN}NULL` },
      ...DAFTAR_MODUL_LOG.filter((x) => x !== "berkas").map((mod) => ({ penggunaNama: "Skrip Uji", aksi: "UBAH", jenis: "Uji", nomor: nomorModul(mod), modul: mod })),
      { penggunaNama: "Skrip Uji", aksi: "UNGGAH", jenis: "Berkas", nomor: `${AWALAN}B-FAKTUR`, modul: "berkas", meta: { folder: "FAKTUR", proyekId: null } },
      { penggunaNama: "Skrip Uji", aksi: "UNGGAH", jenis: "Berkas", nomor: `${AWALAN}B-UMUM`, modul: "berkas", meta: { folder: "UMUM", proyekId: null } },
      { penggunaNama: "Skrip Uji", aksi: "UNGGAH", jenis: "Berkas", nomor: `${AWALAN}B-PROYEK`, modul: "berkas", meta: { folder: "UMUM", proyekId: "ujilog-proyek" } },
      { penggunaNama: "Skrip Uji", aksi: "UBAH", jenis: "Akses Folder Berkas", nomor: `${AWALAN}B-AKSES`, modul: "berkas", meta: { folder: null, proyekId: null } },
    ],
  });
  const semuaUji = new Set((await db.logAktivitas.findMany({ where: { nomor: { startsWith: AWALAN } }, select: { nomor: true } })).map((b) => b.nomor));
  const berkasUji = [`${AWALAN}B-FAKTUR`, `${AWALAN}B-UMUM`, `${AWALAN}B-PROYEK`, `${AWALAN}B-AKSES`];

  const hanyaLog = penggunaSintetis("KASIR", ["log-aktivitas.lihat"]);
  const lihatHanyaLog = await nomorTerlihat(hanyaLog, null);
  pastikan(lihatHanyaLog.has(`${AWALAN}NULL`), "cabang modul null: catatan lama terlihat bagi pemegang log-aktivitas.lihat saja");
  pastikan(DAFTAR_MODUL_LOG.filter((x) => x !== "berkas").every((mod) => lihatHanyaLog.has(nomorModul(mod)) === (MODUL_LOG[mod].hakLihat === null)), "tanpa hak modul: hanya modul tanpa syarat (auth, pengaturan, perusahaan, penjualan, dokumen) yang terlihat");
  pastikan(berkasUji.every((n) => !lihatHanyaLog.has(n)), "tanpa berkas.lihat: catatan berkas tidak terlihat");
  for (const mod of DAFTAR_MODUL_LOG.filter((x) => x !== "berkas" && MODUL_LOG[x].hakLihat !== null)) {
    const h = MODUL_LOG[mod].hakLihat!;
    const lihat = await nomorTerlihat(penggunaSintetis("KASIR", ["log-aktivitas.lihat", h]), null);
    const lain = DAFTAR_MODUL_LOG.filter((x) => x !== "berkas" && x !== mod && MODUL_LOG[x].hakLihat !== null && MODUL_LOG[x].hakLihat !== h);
    pastikan(lihat.has(nomorModul(mod)) && lihat.has(`${AWALAN}NULL`) && lain.every((x) => !lihat.has(nomorModul(x))), `modul ${mod} hanya terlihat bagi pemegang ${h}`);
  }
  const lihatLead = await nomorTerlihat(penggunaSintetis("KASIR", ["log-aktivitas.lihat", "lead.lihat"]), null);
  pastikan(lihatLead.has(nomorModul("crm")) && !lihatHanyaLog.has(nomorModul("crm")), "baris crm hanya bagi pemegang lead.lihat");
  const lihatBerkas = await nomorTerlihat(penggunaSintetis("KASIR", ["log-aktivitas.lihat", "berkas.lihat"]), null);
  pastikan(berkasUji.every((n) => lihatBerkas.has(n)) && !lihatBerkas.has(nomorModul("crm")), "baris berkas hanya bagi pemegang berkas.lihat (ruang null = semua berkas)");
  const pemilik = penggunaSintetis("PEMILIK");
  const lihatPemilik = await nomorTerlihat(pemilik, null);
  pastikan([...semuaUji].every((n) => lihatPemilik.has(n)), "Pemilik melihat semua baris uji");
  const admin = penggunaSintetis("ADMIN");
  const lihatAdmin = await nomorTerlihat(admin, null);
  pastikan(lihatAdmin.has(nomorModul("crm")) && lihatAdmin.has(nomorModul("konten")) && lihatAdmin.has(nomorModul("antar-perusahaan")) && berkasUji.every((n) => lihatAdmin.has(n)) && !lihatAdmin.has(nomorModul("pengguna")), "ADMIN bawaan: crm, konten, antar perusahaan, berkas terlihat; pengguna tidak (tanpa pengguna.kelola)");
  const lihatSosmed = await nomorTerlihat(penggunaSintetis("SOSMED", [...hitungHak("SOSMED"), "log-aktivitas.lihat"]), null);
  pastikan(lihatSosmed.has(nomorModul("konten")) && lihatSosmed.has(nomorModul("tugas-desain")) && !lihatSosmed.has(nomorModul("crm")) && !lihatSosmed.has(nomorModul("kampanye")) && !lihatSosmed.has(nomorModul("bagi-hasil")), "SOSMED + log-aktivitas.lihat: konten dan tugas desain, bukan crm, iklan, bagi hasil");
  const ruang: RuangTersembunyi = { folder: ["FAKTUR"], proyek: ["ujilog-proyek"] };
  const lihatRuang = await nomorTerlihat(admin, ruang);
  pastikan(!lihatRuang.has(`${AWALAN}B-FAKTUR`) && !lihatRuang.has(`${AWALAN}B-PROYEK`), "ruang tersembunyi: log berkas folder FAKTUR dan proyek terbatas disembunyikan");
  pastikan(lihatRuang.has(`${AWALAN}B-UMUM`) && lihatRuang.has(`${AWALAN}B-AKSES`), "ruang tersembunyi: log berkas lain tetap terlihat, termasuk meta folder dan proyek null");
  pastikan(lihatRuang.has(`${AWALAN}NULL`) && lihatRuang.has(nomorModul("crm")) && lihatRuang.has(nomorModul("proyek")), "ruang tersembunyi tidak menyaring catatan lama dan modul lain");
  const lihatRuangKosong = await nomorTerlihat(admin, { folder: [], proyek: [] });
  pastikan(berkasUji.every((n) => lihatRuangKosong.has(n)), "ruang kosong: semua log berkas terlihat");
  const syaratTanpaBerkas = JSON.stringify(syaratLogTerlihat(hanyaLog, ruang));
  pastikan(!syaratTanpaBerkas.includes('"berkas"') && syaratTanpaBerkas.includes('{"modul":null}'), "syarat tanpa berkas.lihat tidak memuat cabang berkas, cabang null selalu ada");

  console.log("=== 5. Hitungan tanpa saringan dan lingkup ===");
  const semuaBaris = await db.logAktivitas.count();
  const tanpaSaringan = syaratSaringanLog(bacaSaringanLog({}));
  pastikan(JSON.stringify(tanpaSaringan) === "{}" && !adaSaringanLog(bacaSaringanLog({})), "tanpa query: tidak ada saringan");
  pastikan((await db.logAktivitas.count({ where: { AND: [syaratLogTerlihat(pemilik, null), saringLogLingkup(null), tanpaSaringan] } })) === semuaBaris, "Pemilik tanpa saringan: hitungan sama dengan count(*)");
  await db.logAktivitas.createMany({
    data: [
      { penggunaNama: "Skrip Uji", aksi: "HAPUS", jenis: "Uji", nomor: `${AWALAN}PT-UTAMA`, perusahaanId: "utama", modul: "perusahaan" },
      { penggunaNama: "Skrip Uji", aksi: "HAPUS", jenis: "Uji", nomor: `${AWALAN}PT-TAPUSSA`, perusahaanId: "tapussa", modul: "perusahaan" },
    ],
  });
  const lingkupUtama = new Set((await db.logAktivitas.findMany({ where: { AND: [saringLogLingkup("utama"), { nomor: { startsWith: AWALAN } }] }, select: { nomor: true } })).map((b) => b.nomor));
  pastikan(lingkupUtama.has(`${AWALAN}PT-UTAMA`) && lingkupUtama.has(`${AWALAN}NULL`) && !lingkupUtama.has(`${AWALAN}PT-TAPUSSA`), "lingkup satu perusahaan: catatan perusahaan itu dan tingkat sistem, bukan perusahaan lain");
  pastikan(JSON.stringify(saringLogLingkup(null)) === "{}", "lingkup gabungan: tanpa syarat");

  console.log("=== 6. Saringan halaman ===");
  pastikan(bacaSaringanLog({ modul: "asing" }).modul === null && bacaSaringanLog({ modul: "crm" }).modul === "crm" && bacaSaringanLog({ modul: "umum" }).modul === "umum", "modul tidak dikenal diabaikan");
  pastikan(bacaSaringanLog({ dari: "2026-02-30", sampai: "kemarin" }).dari === null && bacaSaringanLog({ sampai: "kemarin" }).sampai === null && bacaSaringanLog({ dari: "2026-01-15" }).dari === "2026-01-15", "tanggal tidak sah diabaikan");
  pastikan(bacaSaringanLog({ aksi: ["HAPUS", "UBAH"] }).aksi === "HAPUS" && bacaSaringanLog({ aksi: "  " }).aksi === null, "nilai larik diambil yang pertama, nilai kosong diabaikan");
  const lengkap = bacaSaringanLog({ modul: "crm", aksi: "UBAH", pengguna: "tanpa-akun", perusahaan: "sistem", dari: "2026-01-01", sampai: "2026-01-31" });
  pastikan(adaSaringanLog(lengkap) && JSON.stringify(paramSaringanLog(lengkap)) === JSON.stringify({ modul: "crm", aksi: "UBAH", pengguna: "tanpa-akun", perusahaan: "sistem", dari: "2026-01-01", sampai: "2026-01-31" }), "parameter saringan dipertahankan untuk paginasi");
  const hitungUji = async (p: Record<string, string>) => db.logAktivitas.count({ where: { AND: [syaratSaringanLog(bacaSaringanLog(p)), { nomor: { startsWith: AWALAN } }] } });
  pastikan((await hitungUji({ modul: "umum" })) === 1, "modul umum = catatan tanpa modul");
  pastikan((await hitungUji({ modul: "crm" })) === 1 && (await hitungUji({ modul: "berkas" })) === 4, "saringan modul");
  pastikan((await hitungUji({ aksi: "UNGGAH" })) === 3, "saringan aksi");
  pastikan((await hitungUji({ pengguna: "ujilog-pelaku" })) === 1 && (await hitungUji({ pengguna: "tanpa-akun" })) === semuaUji.size + 2 - 1, "saringan pengguna dan tanpa akun");
  pastikan((await hitungUji({ perusahaan: "tapussa" })) === 1 && (await hitungUji({ perusahaan: "utama" })) === 2 && (await hitungUji({ perusahaan: "sistem" })) === semuaUji.size + 2 - 3, "saringan perusahaan dan tingkat sistem");
  await db.logAktivitas.createMany({
    data: [
      { penggunaNama: "Skrip Uji", aksi: "TANGGAL", jenis: "Uji", nomor: `${AWALAN}T-AKHIR15`, waktu: bacaWaktuLokal("2026-01-15T23:30")! },
      { penggunaNama: "Skrip Uji", aksi: "TANGGAL", jenis: "Uji", nomor: `${AWALAN}T-AWAL16`, waktu: bacaWaktuLokal("2026-01-16T00:10")! },
      { penggunaNama: "Skrip Uji", aksi: "TANGGAL", jenis: "Uji", nomor: `${AWALAN}T-AWAL15`, waktu: bacaWaktuLokal("2026-01-15T00:00")! },
    ],
  });
  pastikan((await hitungUji({ aksi: "TANGGAL", sampai: "2026-01-15" })) === 2, "sampai: seluruh hari terakhir ikut (zona waktu usaha), hari berikutnya tidak");
  pastikan((await hitungUji({ aksi: "TANGGAL", dari: "2026-01-16" })) === 1 && (await hitungUji({ aksi: "TANGGAL", dari: "2026-01-15", sampai: "2026-01-15" })) === 2, "dari: mulai pukul 00.00 hari itu");
  pastikan((await hitungUji({ aksi: "TANGGAL", dari: "2026-01-17" })) === 0, "periode tanpa catatan: kosong");

  console.log("=== 7. Halaman Log Aktivitas ===");
  const semuaSekarang = await db.logAktivitas.count();
  const hPemilik = await bukaHalaman("PEMILIK", "semua");
  pastikan(hPemilik.total === semuaSekarang, "Pemilik gabungan tanpa saringan: total KontrolDaftar = count(*)");
  const teksPemilik = teksDangkal(hPemilik.pohon);
  pastikan(["Waktu", "Pengguna", "Aksi", "Dokumen", "Keterangan"].every((k) => teksPemilik.includes(k)) && teksPemilik.includes("Tingkat sistem"), "kolom lama tampil dan saringan perusahaan tersedia di gabungan");
  const hAdmin = await bukaHalaman("ADMIN", "semua");
  const harapanAdmin = await db.logAktivitas.count({ where: syaratLogTerlihat(admin, null) });
  pastikan(hAdmin.total === harapanAdmin && hAdmin.total === semuaSekarang - (await db.logAktivitas.count({ where: { modul: "pengguna" } })) && hAdmin.total < semuaSekarang, "ADMIN gabungan: semua kecuali modul pengguna (tanpa pengguna.kelola)");
  const hCrm = await bukaHalaman("PEMILIK", "semua", { q: AWALAN, modul: "crm" });
  pastikan(hCrm.total === 1 && hCrm.tambahan.modul === "crm", "saringan modul dari query dan dipertahankan paginasi");
  const hAksi = await bukaHalaman("ADMIN", "semua", { q: AWALAN, aksi: "UNGGAH" });
  pastikan(hAksi.total === 3, "saringan aksi di halaman");
  const hPengguna = await bukaHalaman("PEMILIK", "semua", { q: AWALAN, pengguna: "ujilog-pelaku" });
  pastikan(hPengguna.total === 1, "saringan pengguna di halaman");
  const hPengguna2 = await bukaHalaman("ADMIN", "semua", { q: AWALAN, modul: "pengguna" });
  pastikan(hPengguna2.total === 0, "ADMIN memilih modul pengguna lewat URL tetap tidak melihat catatannya");
  const hUtama = await bukaHalaman("PEMILIK", "utama", { q: AWALAN, perusahaan: "tapussa" });
  const harapanUtama = await db.logAktivitas.count({ where: { AND: [saringLogLingkup("utama"), { nomor: { startsWith: AWALAN } }] } });
  pastikan(hUtama.total === harapanUtama && hUtama.tambahan.perusahaan === undefined, "lingkup satu perusahaan: saringan perusahaan dari URL diabaikan, catatan tanpa perusahaan ikut");
  pastikan(teksDangkal(hUtama.pohon).includes("termasuk catatan tanpa perusahaan") && !teksDangkal(hUtama.pohon).includes("Tingkat sistem"), "lingkup satu perusahaan: keterangan lingkup tampil, pilihan perusahaan tidak");
  for (const peran of ["KASIR", "GUDANG", "SOSMED"] as const) {
    let arah = "";
    try {
      await denganEnv({ UJI_PERAN: peran, UJI_PERUSAHAAN: undefined, UJI_PENGGUNA: undefined }, () => HalamanLogAktivitas({ searchParams: Promise.resolve({}) }));
    } catch (galat) {
      arah = String((galat as { digest?: string }).digest ?? "");
    }
    pastikan(arah.startsWith("NEXT_REDIRECT") && arah.includes("/tanpa-akses"), `${peran} tanpa log-aktivitas.lihat dialihkan ke tanpa akses`);
  }

  await bersihkan();
  pastikan((await db.logAktivitas.count({ where: SYARAT_UJI })) === 0, "akhir: baris uji log dihapus");
  console.log("=== DONE, all log checks passed ===");
}

main()
  .catch(async (galat) => {
    console.error(galat);
    await bersihkan().catch(() => undefined);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
