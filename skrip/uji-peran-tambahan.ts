import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { HAK_BAWAAN, hitungHak, hitungHakPengguna, labelPeranPengguna, punyaHak, type PenggunaSesi } from "../src/lib/hakAkses";
import { buatPengguna, ubahPengguna } from "../src/lib/aksi/pengguna";
import { penggunaSaatIni, wajibHakAksi } from "../src/lib/otentikasi";
import { lingkupPerusahaan, simpanLingkupSesi, tentukanLingkup } from "../src/lib/perusahaan";
import { hashKataSandi } from "../src/lib/kataSandi";
import type { PeranPengguna } from "../src/prisma-klien/enums";
import { jalankan, sebagai } from "./bantuan";

/*
 * Peran tambahan per pengguna lewat aksi Pengaturan › Pengguna (D7 §3.1.2, §6.6): nilai yang boleh, nilai yang sama
 * dengan peran utama dibuang, penanda peranTambahanDikirim, pencabutan sesi, aturan akun sendiri, aturan akun
 * Superadmin/Pemilik, hak efektif gabungan, dan hak lingkup gabungan yang hanya datang dari peran utama. Semua pengguna uji berawalan "ujipt-". Pemeriksa lokal melempar galat
 * (bukan process.exit) supaya blok finally selalu menghapus pengguna uji dan baris HakAksesPeran buatan suite ini.
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

const PREFIKS = "ujipt-";
const PESAN_TOLAK = "Peran tambahan hanya boleh Pengelola Media Sosial, Pengelola Iklan, atau Desainer";
const PESAN_DIRI = "Peran atau status akun sendiri tidak bisa diubah";

type IsianPengguna = { nama: string; namaPengguna: string; peran: PeranPengguna; aktif?: boolean; tambahan?: string[]; penanda?: boolean };

/** FormData formulir pengguna; peranTambahan bisa berulang (kotak centang), penanda hanya bila diminta. */
function formulirPengguna(x: IsianPengguna): FormData {
  const fd = new FormData();
  fd.set("nama", x.nama);
  fd.set("namaPengguna", x.namaPengguna);
  fd.set("email", "");
  fd.set("nomorTelepon", "+6281200000099");
  fd.set("kataSandi", "rahasia123");
  fd.set("peran", x.peran);
  if (x.aktif !== false) fd.set("aktif", "on");
  for (const t of x.tambahan ?? []) fd.append("peranTambahan", t);
  if (x.penanda) fd.set("peranTambahanDikirim", "1");
  return fd;
}

const ambil = (namaPengguna: string) => db.pengguna.findUniqueOrThrow({ where: { namaPengguna }, select: { id: true, peran: true, peranTambahan: true, nama: true } });
const sama = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

async function buatSesi(penggunaId: string) {
  await db.sesi.create({ data: { tokenHash: randomBytes(32).toString("hex"), penggunaId, kedaluwarsa: new Date(Date.now() + 3_600_000) } });
}
const jumlahSesi = (penggunaId: string) => db.sesi.count({ where: { penggunaId } });

async function bersihkan() {
  await db.hakAksesPeran.deleteMany({ where: { peran: "ADMIN", hak: "pengguna.kelola" } });
  await db.pengguna.deleteMany({ where: { namaPengguna: { startsWith: PREFIKS } } }); // sesi ikut terhapus (Cascade)
}

async function main() {
  // Di awal hanya sisa pengguna uji yang dibuang; baris HakAksesPeran yang tersisa berarti suite lain bocor.
  await db.pengguna.deleteMany({ where: { namaPengguna: { startsWith: PREFIKS } } });
  pastikan((await db.hakAksesPeran.count()) === 0, "HakAksesPeran kosong sebelum suite mulai");
  try {
    // Pemilik uji nyata untuk aturan akun sendiri dan sasaran aturan Superadmin/Pemilik.
    const pemilikId = (await db.pengguna.create({ data: { nama: "Pemilik Uji PT", namaPengguna: `${PREFIKS}pemilik`, nomorTelepon: "+6281200000098", kataSandiHash: await hashKataSandi("rahasia123"), peran: "PEMILIK" } })).id;

    console.log("=== 1. Buat pengguna dengan peran tambahan ===");
    await jalankan("buat KASIR + SOSMED + DESAINER (penanda)", () =>
      buatPengguna(formulirPengguna({ nama: "Kasir Uji PT", namaPengguna: `${PREFIKS}kasir`, peran: "KASIR", tambahan: ["SOSMED", "DESAINER", "SOSMED"], penanda: true })),
    );
    const kasir = await ambil(`${PREFIKS}kasir`);
    pastikan(sama(kasir.peranTambahan, ["DESAINER", "SOSMED"]), `tambahan tersimpan terurut tanpa duplikat: ${kasir.peranTambahan.join(",")}`);

    await harusDitolak("tambahan KASIR", () => buatPengguna(formulirPengguna({ nama: "Tolak", namaPengguna: `${PREFIKS}tolak`, peran: "ADMIN", tambahan: ["SOSMED", "KASIR"], penanda: true })), PESAN_TOLAK);
    await harusDitolak("tambahan nilai asing", () => buatPengguna(formulirPengguna({ nama: "Tolak", namaPengguna: `${PREFIKS}tolak`, peran: "ADMIN", tambahan: ["ROOT"], penanda: true })), PESAN_TOLAK);
    pastikan((await db.pengguna.count({ where: { namaPengguna: `${PREFIKS}tolak` } })) === 0, "penolakan tidak menyimpan pengguna");

    await jalankan("buat SOSMED + SOSMED,IKLAN (penanda)", () =>
      buatPengguna(formulirPengguna({ nama: "Sosmed Uji PT", namaPengguna: `${PREFIKS}sosmed`, peran: "SOSMED", tambahan: ["SOSMED", "IKLAN"], penanda: true })),
    );
    pastikan(sama((await ambil(`${PREFIKS}sosmed`)).peranTambahan, ["IKLAN"]), "tambahan yang sama dengan peran utama dibuang");

    await jalankan("buat ADMIN dengan kotak dicentang tanpa penanda", () =>
      buatPengguna(formulirPengguna({ nama: "Admin Uji PT", namaPengguna: `${PREFIKS}admin`, peran: "ADMIN", tambahan: ["DESAINER"] })),
    );
    const admin = await ambil(`${PREFIKS}admin`);
    pastikan(admin.peranTambahan.length === 0, "tanpa penanda: tambahan kosong");

    console.log("=== 2. Ubah pengguna ===");
    // Sesi Pemilik uji menjadi pembanding: perubahan tambahan pengguna lain tidak boleh ikut mencabutnya.
    await buatSesi(admin.id);
    await buatSesi(pemilikId);
    await jalankan("ubah ADMIN, tambahan DESAINER (penanda)", () =>
      ubahPengguna(admin.id, formulirPengguna({ nama: "Admin Uji PT", namaPengguna: `${PREFIKS}admin`, peran: "ADMIN", tambahan: ["DESAINER"], penanda: true })),
    );
    pastikan(sama((await ambil(`${PREFIKS}admin`)).peranTambahan, ["DESAINER"]), "tambahan DESAINER tersimpan lewat ubah");
    pastikan((await jumlahSesi(admin.id)) === 0, "tambahan yang ditambah mencabut sesi pengguna itu");
    pastikan((await jumlahSesi(pemilikId)) === 1, "sesi pengguna lain tidak ikut terhapus saat tambahan ditambah");

    await buatSesi(kasir.id);
    await jalankan("ubah nama KASIR tanpa penanda", () => ubahPengguna(kasir.id, formulirPengguna({ nama: "Kasir Uji PT Baru", namaPengguna: `${PREFIKS}kasir`, peran: "KASIR" })));
    const kasir2 = await ambil(`${PREFIKS}kasir`);
    pastikan(kasir2.nama === "Kasir Uji PT Baru" && sama(kasir2.peranTambahan, ["DESAINER", "SOSMED"]), "formulir tanpa penanda tidak mengubah tambahan");
    pastikan((await jumlahSesi(kasir.id)) === 1, "tanpa perubahan tambahan, sesi tetap");

    await jalankan("ubah KASIR, tambahan sama urutan lain (penanda)", () =>
      ubahPengguna(kasir.id, formulirPengguna({ nama: "Kasir Uji PT Baru", namaPengguna: `${PREFIKS}kasir`, peran: "KASIR", tambahan: ["SOSMED", "DESAINER"], penanda: true })),
    );
    pastikan((await jumlahSesi(kasir.id)) === 1, "tambahan yang sama (urutan lain) tidak mencabut sesi");

    await harusDitolak("ubah dengan tambahan GUDANG", () =>
      ubahPengguna(kasir.id, formulirPengguna({ nama: "Kasir Uji PT Baru", namaPengguna: `${PREFIKS}kasir`, peran: "KASIR", tambahan: ["GUDANG"], penanda: true })), PESAN_TOLAK);
    pastikan(sama((await ambil(`${PREFIKS}kasir`)).peranTambahan, ["DESAINER", "SOSMED"]) && (await jumlahSesi(kasir.id)) === 1, "penolakan ubah tidak mengubah tambahan dan sesi");

    await jalankan("ubah KASIR, penanda tanpa centang", () =>
      ubahPengguna(kasir.id, formulirPengguna({ nama: "Kasir Uji PT Baru", namaPengguna: `${PREFIKS}kasir`, peran: "KASIR", penanda: true })),
    );
    pastikan((await ambil(`${PREFIKS}kasir`)).peranTambahan.length === 0, "penanda tanpa centang mengosongkan tambahan");
    pastikan((await jumlahSesi(kasir.id)) === 0, "tambahan yang dikurangi mencabut sesi pengguna itu");
    pastikan((await jumlahSesi(pemilikId)) === 1, "sesi pengguna lain tidak ikut terhapus saat tambahan dikurangi");

    console.log("=== 3. Akun sendiri dan akun Pemilik ===");
    const pemilik = await ambil(`${PREFIKS}pemilik`);
    await harusDitolak("ubah tambahan akun sendiri", () =>
      sebagai(`${PREFIKS}pemilik`, () => ubahPengguna(pemilik.id, formulirPengguna({ nama: "Pemilik Uji PT", namaPengguna: `${PREFIKS}pemilik`, peran: "PEMILIK", tambahan: ["DESAINER"], penanda: true }))), PESAN_DIRI);
    pastikan((await ambil(`${PREFIKS}pemilik`)).peranTambahan.length === 0, "tambahan akun sendiri tidak berubah");
    await jalankan("simpan akun sendiri tanpa penanda (kotak disabled)", () =>
      sebagai(`${PREFIKS}pemilik`, () => ubahPengguna(pemilik.id, formulirPengguna({ nama: "Pemilik Uji PT", namaPengguna: `${PREFIKS}pemilik`, peran: "PEMILIK", tambahan: ["DESAINER"] }))),
    );
    pastikan((await ambil(`${PREFIKS}pemilik`)).peranTambahan.length === 0, "akun sendiri tanpa penanda: tambahan tetap");

    // ADMIN yang dibuka hak pengguna.kelola tetap tidak boleh menyentuh akun Pemilik.
    await db.hakAksesPeran.create({ data: { peran: "ADMIN", hak: "pengguna.kelola", boleh: true } });
    await harusDitolak("ADMIN (pengguna.kelola) ubah tambahan Pemilik", () =>
      denganEnv({ UJI_PERAN: "ADMIN" }, () => ubahPengguna(pemilik.id, formulirPengguna({ nama: "Pemilik Uji PT", namaPengguna: `${PREFIKS}pemilik`, peran: "PEMILIK", tambahan: ["SOSMED"], penanda: true }))),
      "Hanya Superadmin atau Pemilik");
    await jalankan("ADMIN (pengguna.kelola) ubah tambahan KASIR", () =>
      denganEnv({ UJI_PERAN: "ADMIN" }, () => ubahPengguna(kasir.id, formulirPengguna({ nama: "Kasir Uji PT Baru", namaPengguna: `${PREFIKS}kasir`, peran: "KASIR", tambahan: ["SOSMED"], penanda: true }))),
    );
    pastikan(sama((await ambil(`${PREFIKS}kasir`)).peranTambahan, ["SOSMED"]), "ADMIN berhak kelola pengguna boleh mengatur tambahan KASIR");
    await db.hakAksesPeran.deleteMany({ where: { peran: "ADMIN", hak: "pengguna.kelola" } });
    pastikan((await db.hakAksesPeran.count()) === 0, "penyesuaian hak sementara dihapus");

    console.log("=== 4. Hak akses aksi ===");
    await harusDitolak("ADMIN tanpa pengguna.kelola", () =>
      denganEnv({ UJI_PERAN: "ADMIN" }, () => buatPengguna(formulirPengguna({ nama: "X", namaPengguna: `${PREFIKS}x`, peran: "KASIR", tambahan: ["SOSMED"], penanda: true }))), "tidak punya hak");
    await harusDitolak("KASIR + SOSMED tanpa pengguna.kelola", () =>
      sebagai(`${PREFIKS}kasir`, () => ubahPengguna(kasir.id, formulirPengguna({ nama: "Kasir Uji PT Baru", namaPengguna: `${PREFIKS}kasir`, peran: "KASIR", tambahan: ["SOSMED", "IKLAN"], penanda: true }))), "tidak punya hak");
    pastikan(sama((await ambil(`${PREFIKS}kasir`)).peranTambahan, ["SOSMED"]), "penolakan hak tidak mengubah tambahan");

    console.log("=== 5. Hak efektif dan label ===");
    const sesiKasir = await sebagai(`${PREFIKS}kasir`, () => penggunaSaatIni());
    pastikan(sesiKasir !== null && sama(sesiKasir.peranTambahan ?? [], ["SOSMED"]), "sesi KASIR + SOSMED memuat peranTambahan");
    pastikan(!HAK_BAWAAN.KASIR.includes("konten.lihat") && sesiKasir.hak.includes("konten.lihat") && sesiKasir.hak.includes("konten.buat"), "hak efektif KASIR + SOSMED memuat konten.lihat dan konten.buat");
    pastikan(hitungHak("KASIR").every((h) => sesiKasir.hak.includes(h)), "hak KASIR tetap utuh");
    pastikan(punyaHak(sesiKasir, "konten.lihat") && !punyaHak(sesiKasir, "pengguna.kelola"), "punyaHak membaca hak efektif");
    await jalankan("wajibHakAksi konten.lihat sebagai KASIR + SOSMED", () => sebagai(`${PREFIKS}kasir`, () => wajibHakAksi("konten.lihat")));
    pastikan(labelPeranPengguna(sesiKasir) === "Kasir + Pengelola Media Sosial", `label gabungan: ${labelPeranPengguna(sesiKasir)}`);

    const sesiAdmin = await sebagai(`${PREFIKS}admin`, () => penggunaSaatIni());
    pastikan(sesiAdmin !== null && labelPeranPengguna(sesiAdmin) === "Admin + Desainer", "label Admin + Desainer");
    const adminSosmed = await denganEnv({ UJI_PERAN: "ADMIN", UJI_PERAN_TAMBAHAN: "SOSMED" }, () => penggunaSaatIni());
    pastikan(adminSosmed !== null && !HAK_BAWAAN.ADMIN.includes("konten.buat") && adminSosmed.hak.includes("konten.buat") && hitungHak("ADMIN").every((h) => adminSosmed.hak.includes(h)), "ADMIN + SOSMED: konten.buat (tidak ada di bawaan ADMIN) bertambah, hak ADMIN tetap utuh");

    const sesiPemilik = await sebagai(`${PREFIKS}pemilik`, () => penggunaSaatIni());
    pastikan(sesiPemilik !== null && labelPeranPengguna(sesiPemilik) === "Pemilik", "tanpa tambahan: label peran utama saja");

    console.log("=== 6. Lingkup gabungan hanya dari peran utama ===");
    const semuaId = new Set((await db.perusahaan.findMany({ select: { id: true } })).map((p) => p.id));
    for (const utama of ["KASIR", "KRU", "GUEST"] as const) {
      const hak = hitungHakPengguna(utama, ["SOSMED", "IKLAN", "DESAINER"]);
      const label = `${utama} + SOSMED/IKLAN/DESAINER`;
      pastikan(!hak.includes("perusahaan-gabungan.lihat") && hak.includes("konten.buat"), `${label}: tanpa perusahaan-gabungan.lihat, kunci pemasaran lain tetap bertambah`);
      pastikan(tentukanLingkup({ pilihan: null, bolehGabungan: hak.includes("perusahaan-gabungan.lihat"), adaIds: semuaId }) === "utama", `${label}: tanpa pilihan lingkup tetap utama`);
      const lingkup = await denganEnv({ UJI_PERAN: utama, UJI_PERAN_TAMBAHAN: "SOSMED", UJI_PERUSAHAAN: "semua" }, () => lingkupPerusahaan());
      pastikan(lingkup.perusahaanId === "utama" && !lingkup.bolehGabungan, `${utama} + SOSMED meminta gabungan lewat UJI_PERUSAHAAN=semua: tetap utama`);
      const sesiSintetis: PenggunaSesi = { id: "skrip-uji", nama: "Skrip Uji", namaPengguna: "skrip-uji", email: null, nomorTelepon: null, peran: utama, peranTambahan: ["SOSMED"], hak };
      await harusDitolak(`${utama} + SOSMED memilih Semua perusahaan`, () => simpanLingkupSesi(db, "sesi-tidak-ada", "semua", sesiSintetis), "tidak punya hak");
    }
    pastikan(!sesiKasir.hak.includes("perusahaan-gabungan.lihat"), "sesi nyata KASIR + SOSMED tanpa perusahaan-gabungan.lihat");
    pastikan(hitungHakPengguna("KASIR", ["SOSMED"], [{ peran: "SOSMED", hak: "perusahaan-gabungan.lihat", boleh: true }]).includes("perusahaan-gabungan.lihat") === false, "penyesuaian boleh pada peran tambahan tidak membuka lingkup gabungan");
    pastikan(hitungHakPengguna("KASIR", ["SOSMED"], [{ peran: "KASIR", hak: "perusahaan-gabungan.lihat", boleh: true }]).includes("perusahaan-gabungan.lihat"), "penyesuaian boleh pada peran utama KASIR tetap membuka lingkup gabungan");
    for (const utama of ["ADMIN", "GUDANG", "SOSMED"] as const) {
      pastikan(hitungHakPengguna(utama, ["IKLAN", "DESAINER"]).includes("perusahaan-gabungan.lihat"), `${utama} + tambahan: hak gabungan dari peran utama tetap ada`);
    }
  } finally {
    await bersihkan();
  }
  pastikan((await db.pengguna.count({ where: { namaPengguna: { startsWith: PREFIKS } } })) === 0, "pengguna uji terhapus");
  pastikan((await db.hakAksesPeran.count()) === 0, "tidak ada HakAksesPeran tertinggal");
  console.log("=== DONE, semua pemeriksaan peran tambahan lulus ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
