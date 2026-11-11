import "dotenv/config";
// Skrip ini memanggil aksi server dan halaman di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { db } from "../src/lib/db";
import { PERUSAHAAN_UTAMA } from "../src/lib/perusahaan";
import { ambilPengaturanPerusahaan } from "../src/lib/pengaturanPerusahaan";
import { periksaSinkron } from "../src/lib/sinkron";
import { jalankanFormulir } from "../src/lib/statusFormulir";
import { buatPerusahaan, gantiPerusahaanAktif, ubahPerusahaan } from "../src/lib/aksi/perusahaan";
import { simpanPemetaanAkun, simpanPengaturanUmum, tambahPemetaanTambahan, ubahPemetaanTambahan } from "../src/lib/aksi/pengaturan";
import { buatJurnalManual } from "../src/lib/aksi/jurnal";
import FormulirAksi from "../src/komponen/FormulirAksi";
import HalamanPengaturanPerusahaan from "../src/app/(aplikasi)/pengaturan/perusahaan/page";
import HalamanUbahPerusahaan from "../src/app/(aplikasi)/pengaturan/perusahaan/[id]/page";
import HalamanPerusahaanBaru from "../src/app/(aplikasi)/pengaturan/perusahaan/baru/page";
import HalamanIntegritasPerusahaan from "../src/app/(aplikasi)/pengaturan/perusahaan/integritas/page";
import HalamanPemetaanAkun from "../src/app/(aplikasi)/pengaturan/pemetaan-akun/page";
import HalamanPajak from "../src/app/(aplikasi)/buku-besar/pajak/page";
import { catatJurnalFakturPenjualan } from "../src/lib/akuntansi";
import { bacaTarifPpn, pesanAkunPajakBelumDiatur } from "../src/lib/pengaturanPerusahaan";
import { formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * Uji aksi dan halaman Pengaturan Perusahaan (P19, D1 §3.6, §3.7, §6.1, §6.2, §7.2, §9.1 kasus 20, 21, 33):
 * - buatPerusahaan: validasi identitas (kode, nama, email, NPWP, warna, jenis, urutan), kode ganda, baris
 *   PengaturanPerusahaan ber-id perusahaan, akun pajak kosong disalin dari baris "default" hanya bila bersama, log;
 * - ubahPerusahaan: arsip dan aktifkan (dokumen baru perusahaan arsip ditolak), utama tidak bisa diarsipkan, utama
 *   menulis baris "default" (nama ikut, tanpa baris kedua), validasi pajak lama, upsert berkunci idPengaturan untuk
 *   perusahaan tanpa baris, kode unik, akun pajak milik perusahaan lain ditolak, akun milik utama di baris default
 *   ditolak selama ada perusahaan tanpa pengaturan sendiri, ringkasan log;
 * - simpanPengaturanUmum hanya mengubah tahun buku dan wajib persetujuan;
 * - pemetaan akun standar dan tambahan menolak akun berpemilik;
 * - hak: KASIR ditolak di semua aksi tulis dan halaman; gantiPerusahaanAktif di luar HTTP (kasus 33);
 * - hapus perusahaan yang masih dirujuk ditolak 23001 dengan pesan "masih dipakai" (tidak ada aksi hapus fisik);
 * - render halaman daftar, ubah (utama dan lain), baru, dan integritas.
 * Data uji berkode UJIPA dan UJIPB dihapus di awal dan akhir; baris utama dan "default" dikembalikan.
 */

const KODE = "UJIPA";
const KODE2 = "UJIPB";
const KOLOM_AKUN = ["akunPpnKeluaranId", "akunPpnMasukanId", "akunPph23DimukaId", "akunPph23DipotongId", "akunBebanPphFinalId", "akunHutangPphFinalId"] as const;
const awalUji = new Date();

/** Menjalankan fn dengan UJI_PERUSAHAAN dan UJI_PERAN sementara. */
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

type HasilRender = { teks: string; href: string[]; isian: { name: string; value: string; type: string; disabled: boolean; checked: boolean }[] };

/**
 * Menjalankan komponen server secara rekursif dan mengumpulkan teks, tautan, dan isian. FormulirAksi (klien, ber-hook)
 * hanya dirender anaknya.
 */
async function render(node: ReactNode): Promise<HasilRender> {
  const hasil: HasilRender = { teks: "", href: [], isian: [] };
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
    if (el.type === Link) {
      hasil.href.push(String(el.props.href));
      return jalan(el.props.children as ReactNode);
    }
    if (el.type === FormulirAksi) return jalan(el.props.children as ReactNode);
    if (el.type === "input" || el.type === "select" || el.type === "textarea") {
      hasil.isian.push({
        name: String(el.props.name ?? ""),
        value: String(el.props.value ?? el.props.defaultValue ?? ""),
        type: String(el.type === "input" ? (el.props.type ?? "text") : el.type),
        disabled: Boolean(el.props.disabled),
        checked: Boolean(el.props.defaultChecked ?? el.props.checked),
      });
    }
    if (typeof el.type === "function") return jalan((el.type as (p: unknown) => ReactNode | Promise<ReactNode>)(el.props));
    return jalan(el.props.children as ReactNode);
  };
  await jalan(node);
  hasil.teks = teks.join("");
  return hasil;
}

/** Halaman harus dialihkan (wajibHak) atau notFound; mengembalikan digest galat Next. */
async function digestHalaman(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return String((e as { digest?: string })?.digest ?? (e as Error)?.message ?? e);
  }
  return "";
}

async function bersihkanData() {
  const pt = await db.perusahaan.findMany({ where: { kode: { in: [KODE, KODE2, "UJIPC", "UJIPD", "UJIPE"] } }, select: { id: true } });
  const ids = pt.map((p) => p.id);
  await db.pemetaanAkunTambahan.deleteMany({ where: { OR: [{ kunci: { startsWith: "ujipa" } }, { akun: { kode: { startsWith: `${KODE}-` } } }] } });
  if (ids.length > 0) {
    await db.sesi.updateMany({ where: { perusahaanAktifId: { in: ids } }, data: { perusahaanAktifId: null } });
    await db.pengaturanPerusahaan.deleteMany({ where: { perusahaanId: { in: ids } } });
  }
  await db.pengaturanPerusahaan.updateMany({ where: { akunPpnKeluaranId: { not: null }, akunPpnKeluaran: { kode: { startsWith: `${KODE}-` } } }, data: { akunPpnKeluaranId: null } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  if (ids.length > 0) await db.perusahaan.deleteMany({ where: { id: { in: ids } } });
  await db.logAktivitas.deleteMany({ where: { OR: [{ perusahaanId: { in: ids } }, { jenis: "Perusahaan", nomor: { startsWith: "UJIP" } }, { jenis: "Perusahaan", nomor: "DPRO", waktu: { gte: awalUji } }] } });
}

/** Isian formulir perusahaan lengkap (semua bidang yang dikirim FormPerusahaan). */
function isiPerusahaan(tambahan: Record<string, string | null | undefined> = {}): FormData {
  return formulir({
    kode: KODE,
    nama: "PT Uji Pengaturan",
    jenis: "AGENSI",
    urutan: "90",
    aktif: "on",
    tarifPpnPersen: "11",
    terminHari: "14",
    pphFinalPersen: "0.5",
    ...tambahan,
  });
}

async function main() {
  await bersihkanData();
  const awalHakAksesPeran = await db.hakAksesPeran.count();
  const sinkronAwal = await periksaSinkron(db);
  const utamaAwal = await db.perusahaan.findUniqueOrThrow({ where: { id: PERUSAHAAN_UTAMA } });
  const defaultAwal = await db.pengaturanPerusahaan.findUnique({ where: { id: "default" } });
  const jumlahPengaturanUtama = await db.pengaturanPerusahaan.count({ where: { perusahaanId: PERUSAHAAN_UTAMA } });
  const pemetaanAwal = await db.pemetaanAkun.findUnique({ where: { id: "default" } });
  pastikan(defaultAwal && pemetaanAwal, "baris pengaturan dan pemetaan default ada (seed)");

  try {
    console.log("=== 1. Hak akses ===");
    await dengan({ peran: "KASIR" }, async () => {
      await harusDitolak("KASIR buat perusahaan", () => buatPerusahaan(isiPerusahaan()), "tidak punya hak");
      await harusDitolak("KASIR ubah perusahaan", () => ubahPerusahaan(PERUSAHAAN_UTAMA, isiPerusahaan()), "tidak punya hak");
      await harusDitolak("KASIR simpan pengaturan umum", () => simpanPengaturanUmum(formulir({ tahunBuku: "" })), "tidak punya hak");
      for (const [jalur, fn] of [
        ["/pengaturan/perusahaan", () => HalamanPengaturanPerusahaan()],
        ["/pengaturan/perusahaan/baru", () => HalamanPerusahaanBaru()],
        ["/pengaturan/perusahaan/utama", () => HalamanUbahPerusahaan({ params: Promise.resolve({ id: PERUSAHAAN_UTAMA }) })],
      ] as const) {
        const d = await digestHalaman(fn);
        pastikan(d.startsWith("NEXT_REDIRECT") && d.includes("tanpa-akses"), `KASIR dialihkan dari ${jalur}`);
      }
    });
    // integritas memakai buku-besar.lihat; peran tanpa hak itu dialihkan
    const dGudang = await dengan({ peran: "GUDANG" }, () => digestHalaman(() => HalamanIntegritasPerusahaan()));
    pastikan(dGudang.startsWith("NEXT_REDIRECT") && dGudang.includes("tanpa-akses"), "GUDANG dialihkan dari halaman integritas");
    await harusDitolak("ganti lingkup di luar HTTP (kasus 33)", () => gantiPerusahaanAktif(formulir({ perusahaanId: "semua" })), "hanya bisa diganti dari peramban");

    console.log("=== 2. Validasi buat perusahaan (kasus 21) ===");
    await harusDitolak("kode terlalu pendek", () => buatPerusahaan(isiPerusahaan({ kode: "x" })), "Kode perusahaan 2-12 huruf besar atau angka");
    await harusDitolak("kode bertanda baca", () => buatPerusahaan(isiPerusahaan({ kode: "UJI-PA" })), "Kode perusahaan");
    await harusDitolak("nama kosong", () => buatPerusahaan(isiPerusahaan({ nama: " " })), "Nama perusahaan wajib diisi (maks. 120 karakter)");
    await harusDitolak("nama 121 karakter", () => buatPerusahaan(isiPerusahaan({ nama: "N".repeat(121) })), "Nama perusahaan wajib diisi");
    await harusDitolak("email salah", () => buatPerusahaan(isiPerusahaan({ email: "bukan-email" })), "Email perusahaan tidak valid");
    await harusDitolak("NPWP 3 digit", () => buatPerusahaan(isiPerusahaan({ npwp: "123" })), "NPWP harus 15 atau 16 digit");
    await harusDitolak("warna salah", () => buatPerusahaan(isiPerusahaan({ warna: "merah" })), "Warna harus kode heksa #RRGGBB");
    await harusDitolak("jenis tidak dikenal", () => buatPerusahaan(isiPerusahaan({ jenis: "PABRIK" })), "Jenis perusahaan");
    await harusDitolak("urutan 1000", () => buatPerusahaan(isiPerusahaan({ urutan: "1000" })), "Urutan harus bilangan bulat");
    await harusDitolak("telepon 41 karakter", () => buatPerusahaan(isiPerusahaan({ telepon: "1".repeat(41) })), "Telepon maks. 40 karakter");
    await harusDitolak("kode DPRO sudah dipakai", () => buatPerusahaan(isiPerusahaan({ kode: "dpro" })), "Kode DPRO sudah dipakai");
    await harusDitolak("tarif PPN 101", () => buatPerusahaan(isiPerusahaan({ tarifPpnPersen: "101" })), "Tarif PPN maksimal 100%");
    await harusDitolak("termin 400", () => buatPerusahaan(isiPerusahaan({ terminHari: "400" })), "Termin jatuh tempo harus 0 sampai 365 hari");
    const kelompok = await db.akun.findFirstOrThrow({ where: { kelompok: true, jenis: "KEWAJIBAN" } });
    await harusDitolak("akun pajak kelompok", () => buatPerusahaan(isiPerusahaan({ akunPpnKeluaranId: kelompok.id })), "Akun kelompok tidak bisa dijurnal");
    await harusDitolak("akun pajak tidak ada", () => buatPerusahaan(isiPerusahaan({ akunPpnKeluaranId: "tidak-ada" })), "Akun pajak tidak ditemukan");
    pastikan((await db.perusahaan.count({ where: { kode: KODE } })) === 0, "perusahaan yang ditolak tidak tersimpan");

    console.log("=== 3. Buat perusahaan ===");
    // akun milik utama di baris default tidak disalin ke perusahaan baru (D1 §3.4); diuji dengan menunjuk sementara
    const akunUtama = await db.akun.create({ data: { kode: `${KODE}-PPNK-UT`, nama: "Hutang PPN Uji Utama", jenis: "KEWAJIBAN", kelompok: false, perusahaanId: PERUSAHAAN_UTAMA } });
    await db.pengaturanPerusahaan.update({ where: { id: "default" }, data: { akunPpnKeluaranId: akunUtama.id } });
    try {
      await harusDitolak("akun pajak milik utama untuk perusahaan baru", () => buatPerusahaan(isiPerusahaan({ akunPpnKeluaranId: akunUtama.id })), "tidak bisa dipakai untuk perusahaan baru; pilih akun bersama");
      await harusDitolak("PKP tanpa akun PPN Keluaran bersama", () => buatPerusahaan(isiPerusahaan({ kode: "UJIPC", pkp: "on" })), "Status PKP membutuhkan akun PPN Keluaran dan PPN Masukan");
      await jalankan("buat perusahaan tanpa akun pajak saat default memakai akun milik utama", () => buatPerusahaan(isiPerusahaan({ kode: "UJIPC", nama: "PT Uji Salinan" })));
      const salinan = await db.pengaturanPerusahaan.findFirstOrThrow({ where: { perusahaan: { kode: "UJIPC" } } });
      pastikan(salinan.akunPpnKeluaranId === null && salinan.akunPpnMasukanId === defaultAwal.akunPpnMasukanId, "akun milik utama tidak disalin, akun bersama disalin");
    } finally {
      await db.pengaturanPerusahaan.update({ where: { id: "default" }, data: { akunPpnKeluaranId: defaultAwal.akunPpnKeluaranId } });
    }

    await jalankan("buat perusahaan uji", () =>
      buatPerusahaan(isiPerusahaan({ kode: "ujipa", namaLegal: "PT Uji Pengaturan Legal", email: "uji@contoh.id", npwp: "01.234.567.8-901.000", warna: "#12AB34", jenis: "MEREK", pkp: "on", terminHari: "30" })),
    );
    const U = await db.perusahaan.findUniqueOrThrow({ where: { kode: KODE }, include: { pengaturan: true } });
    pastikan(U.kode === KODE && U.jenis === "MEREK" && U.aktif && U.npwp === "01.234.567.8-901.000" && U.namaLegal === "PT Uji Pengaturan Legal", "kode dibesarkan, NPWP disimpan seperti diketik, jenis dan nama legal tersimpan");
    pastikan(U.pengaturan?.id === U.id && U.pengaturan.perusahaanId === U.id && U.pengaturan.nama === U.nama, "PengaturanPerusahaan ber-id perusahaan baru dengan nama yang sama");
    pastikan(
      U.pengaturan.pkp && U.pengaturan.terminHari === 30 && U.pengaturan.akunPpnKeluaranId === defaultAwal.akunPpnKeluaranId && U.pengaturan.akunHutangPphFinalId === defaultAwal.akunHutangPphFinalId,
      "isian pajak tersimpan; akun pajak kosong disalin dari baris default",
    );
    pastikan(U.pengaturan.tahunBuku === null, "tahun buku tidak disalin (global)");
    const logBuat = await db.logAktivitas.findFirst({ where: { jenis: "Perusahaan", nomor: KODE, aksi: "BUAT" } });
    pastikan(logBuat?.modul === "perusahaan" && logBuat.entitasId === U.id && logBuat.perusahaanId === U.id && logBuat.keterangan === "Perusahaan PT Uji Pengaturan dibuat", "log BUAT Perusahaan");
    await harusDitolak("kode ganda", () => buatPerusahaan(isiPerusahaan()), `Kode ${KODE} sudah dipakai`);
    const pajakU = await ambilPengaturanPerusahaan(db, U.id);
    pastikan(pajakU.pkp && pajakU.terminHari === 30 && pajakU.perusahaanId === U.id, "ambilPengaturanPerusahaan membaca baris perusahaan baru");

    console.log("=== 4. Ubah perusahaan, arsip (kasus 20) ===");
    const isiU = (tambahan: Record<string, string | null | undefined> = {}) =>
      isiPerusahaan({ nama: U.nama, namaLegal: U.namaLegal, jenis: U.jenis, email: U.email, npwp: U.npwp, warna: U.warna, pkp: "on", terminHari: "30", ...Object.fromEntries(KOLOM_AKUN.map((k) => [k, U.pengaturan![k]])), ...tambahan });
    await jalankan("arsipkan perusahaan uji", () => ubahPerusahaan(U.id, isiU({ aktif: null })));
    pastikan(!(await db.perusahaan.findUniqueOrThrow({ where: { id: U.id } })).aktif, "perusahaan uji diarsipkan");
    const kas = await db.akun.findUniqueOrThrow({ where: { kode: "1-1100" } });
    const pendapatan = await db.akun.findUniqueOrThrow({ where: { kode: "4-1100" } });
    const isiJu = formulir({ keterangan: `${KODE} JU arsip`, baris: [{ akunId: kas.id, debit: 1000, kredit: 0 }, { akunId: pendapatan.id, debit: 0, kredit: 1000 }] });
    await dengan({ perusahaan: U.id }, () => harusDitolak("jurnal manual di perusahaan arsip", () => buatJurnalManual(isiJu), "sudah diarsipkan"));
    pastikan((await db.jurnal.count({ where: { keterangan: `${KODE} JU arsip` } })) === 0, "jurnal perusahaan arsip tidak tercatat");
    await jalankan("aktifkan lagi perusahaan uji", () => ubahPerusahaan(U.id, isiU()));
    pastikan((await db.perusahaan.findUniqueOrThrow({ where: { id: U.id } })).aktif, "perusahaan uji aktif lagi");
    const logArsip = await db.logAktivitas.findMany({ where: { jenis: "Perusahaan", nomor: KODE, aksi: "UBAH" }, orderBy: { waktu: "asc" } });
    pastikan(logArsip.length === 2 && logArsip[0].keterangan === "diarsipkan" && logArsip[1].keterangan === "diaktifkan" && logArsip[0].modul === "perusahaan", "log UBAH mencatat diarsipkan dan diaktifkan");
    await harusDitolak("utama diarsipkan", () => ubahPerusahaan(PERUSAHAAN_UTAMA, isiPerusahaan({ kode: "DPRO", aktif: null })), "Perusahaan utama tidak bisa diarsipkan");
    await harusDitolak("perusahaan tidak ada", () => ubahPerusahaan("tidak-ada", isiPerusahaan()), "Perusahaan tidak ditemukan");

    await jalankan("ubah PKP, termin, dan kota", () => ubahPerusahaan(U.id, isiU({ pkp: null, terminHari: "45", kota: "Malang" })));
    const logUbah = await db.logAktivitas.findFirstOrThrow({ where: { jenis: "Perusahaan", nomor: KODE, aksi: "UBAH" }, orderBy: { waktu: "desc" } });
    pastikan(logUbah.keterangan?.includes("PKP: Ya → Tidak") && logUbah.keterangan.includes("termin 30 → 45") && logUbah.keterangan.includes("kota - → Malang"), `log UBAH menyebut kolom yang berubah: ${logUbah.keterangan}`);
    const U2 = await db.perusahaan.create({ data: { kode: KODE2, nama: "PT Uji Tanpa Pengaturan", urutan: 91 } });
    await harusDitolak("kode milik perusahaan lain", () => ubahPerusahaan(U.id, isiU({ kode: KODE2 })), `Kode ${KODE2} sudah dipakai`);

    console.log("=== 5. Akun pajak milik perusahaan ===");
    const akunU = await db.akun.create({ data: { kode: `${KODE}-PPNK-U`, nama: "Hutang PPN Uji U", jenis: "KEWAJIBAN", kelompok: false, perusahaanId: U.id } });
    const akunU2 = await db.akun.create({ data: { kode: `${KODE}-PPNK-U2`, nama: "Hutang PPN Uji U2", jenis: "KEWAJIBAN", kelompok: false, perusahaanId: U2.id } });
    await harusDitolak("akun pajak milik perusahaan lain", () => ubahPerusahaan(U.id, isiU({ akunPpnKeluaranId: akunU2.id })), `Akun ${KODE}-PPNK-U2 Hutang PPN Uji U2 milik PT Uji Tanpa Pengaturan, tidak bisa dipakai di pengaturan pajak PT Uji Pengaturan`);
    await jalankan("akun pajak milik perusahaan sendiri", () => ubahPerusahaan(U.id, isiU({ akunPpnKeluaranId: akunU.id })));
    pastikan((await db.pengaturanPerusahaan.findUniqueOrThrow({ where: { id: U.id } })).akunPpnKeluaranId === akunU.id, "akun pajak milik perusahaan sendiri tersimpan");
    // baris default dipakai perusahaan tanpa pengaturan (U2), jadi akun milik utama ditolak
    const isiUtama = (tambahan: Record<string, string | null | undefined> = {}) =>
      formulir({
        kode: utamaAwal.kode,
        nama: defaultAwal.nama,
        namaLegal: utamaAwal.namaLegal,
        jenis: utamaAwal.jenis,
        industri: utamaAwal.industri,
        alamat: utamaAwal.alamat,
        kota: utamaAwal.kota,
        telepon: utamaAwal.telepon,
        email: utamaAwal.email,
        website: utamaAwal.website,
        instagram: utamaAwal.instagram,
        npwp: utamaAwal.npwp,
        infoPajak: utamaAwal.infoPajak,
        namaBank: utamaAwal.namaBank,
        cabangBank: utamaAwal.cabangBank,
        nomorRekening: utamaAwal.nomorRekening,
        atasNamaRekening: utamaAwal.atasNamaRekening,
        penandaTangan: utamaAwal.penandaTangan,
        jabatanPenandaTangan: utamaAwal.jabatanPenandaTangan,
        warna: utamaAwal.warna,
        urutan: String(utamaAwal.urutan),
        catatan: utamaAwal.catatan,
        aktif: "on",
        pkp: defaultAwal.pkp ? "on" : null,
        tarifPpnPersen: defaultAwal.tarifPpnPersen.toString(),
        terminHari: String(defaultAwal.terminHari),
        pphFinalPersen: defaultAwal.pphFinalPersen.toString(),
        akunPpnKeluaranId: defaultAwal.akunPpnKeluaranId,
        akunPpnMasukanId: defaultAwal.akunPpnMasukanId,
        akunPph23DimukaId: defaultAwal.akunPph23DimukaId,
        akunPph23DipotongId: defaultAwal.akunPph23DipotongId,
        akunBebanPphFinalId: defaultAwal.akunBebanPphFinalId,
        akunHutangPphFinalId: defaultAwal.akunHutangPphFinalId,
        ...tambahan,
      });
    await harusDitolak("akun milik utama di pengaturan utama selama ada perusahaan tanpa pengaturan", () => ubahPerusahaan(PERUSAHAAN_UTAMA, isiUtama({ akunPpnKeluaranId: akunUtama.id })), `${KODE2}`);
    await harusDitolak("akun milik perusahaan lain di pengaturan utama", () => ubahPerusahaan(PERUSAHAAN_UTAMA, isiUtama({ akunPpnKeluaranId: akunU.id })), "tidak bisa dipakai di pengaturan pajak");

    console.log("=== 6. Upsert berkunci idPengaturan ===");
    pastikan((await db.pengaturanPerusahaan.count({ where: { perusahaanId: U2.id } })) === 0, "perusahaan tanpa baris pengaturan");
    await jalankan("ubah perusahaan tanpa baris pengaturan", () => ubahPerusahaan(U2.id, isiPerusahaan({ kode: KODE2, nama: "PT Uji Tanpa Pengaturan", terminHari: "21" })));
    const barisU2 = await db.pengaturanPerusahaan.findMany({ where: { perusahaanId: U2.id } });
    pastikan(barisU2.length === 1 && barisU2[0].id === U2.id && barisU2[0].terminHari === 21 && barisU2[0].nama === "PT Uji Tanpa Pengaturan", "baris pengaturan dibuat dengan id = id perusahaan");
    await jalankan("ubah lagi memperbarui baris yang sama", () => ubahPerusahaan(U2.id, isiPerusahaan({ kode: KODE2, nama: "PT Uji Tanpa Pengaturan Dua", terminHari: "7" })));
    const barisU2b = await db.pengaturanPerusahaan.findMany({ where: { perusahaanId: U2.id } });
    pastikan(barisU2b.length === 1 && barisU2b[0].terminHari === 7 && barisU2b[0].nama === "PT Uji Tanpa Pengaturan Dua", "baris pengaturan diperbarui, tidak bertambah");

    console.log("=== 7. Utama tetap di baris default (halaman lama) ===");
    await harusDitolak("utama PKP tanpa akun PPN", () => ubahPerusahaan(PERUSAHAAN_UTAMA, isiUtama({ pkp: "on", akunPpnMasukanId: null })), "Status PKP membutuhkan akun PPN Keluaran dan PPN Masukan");
    await harusDitolak("utama tarif PPh Final 101", () => ubahPerusahaan(PERUSAHAAN_UTAMA, isiUtama({ pphFinalPersen: "101" })), "Tarif PPh Final maksimal 100%");
    await harusDitolak("utama tarif PPN kosong", () => ubahPerusahaan(PERUSAHAAN_UTAMA, isiUtama({ tarifPpnPersen: "" })), "Tarif PPN wajib diisi");
    await jalankan("utama: ubah nama, PKP, PPN 12, termin 30, PPh Final 1", () =>
      ubahPerusahaan(PERUSAHAAN_UTAMA, isiUtama({ nama: "D'Pro Uji Nama", pkp: "on", tarifPpnPersen: "12", terminHari: "30", pphFinalPersen: "1" })),
    );
    const defaultBaru = await db.pengaturanPerusahaan.findUniqueOrThrow({ where: { id: "default" } });
    pastikan(
      defaultBaru.nama === "D'Pro Uji Nama" && defaultBaru.pkp && defaultBaru.tarifPpnPersen.toString() === "12" && defaultBaru.terminHari === 30 && defaultBaru.pphFinalPersen.toString() === "1" && defaultBaru.perusahaanId === PERUSAHAAN_UTAMA,
      "pengaturan utama tersimpan di baris default",
    );
    pastikan(defaultBaru.tahunBuku === defaultAwal.tahunBuku && defaultBaru.wajibPersetujuan === defaultAwal.wajibPersetujuan, "ubah perusahaan tidak menyentuh tahun buku dan wajib persetujuan");
    pastikan((await db.pengaturanPerusahaan.count({ where: { perusahaanId: PERUSAHAAN_UTAMA } })) === jumlahPengaturanUtama, "tidak ada baris pengaturan kedua untuk utama");
    pastikan((await db.perusahaan.findUniqueOrThrow({ where: { id: PERUSAHAAN_UTAMA } })).nama === "D'Pro Uji Nama", "nama utama juga tersimpan di Perusahaan");
    const pajakUtama = await ambilPengaturanPerusahaan(db);
    pastikan(pajakUtama.nama === "D'Pro Uji Nama" && pajakUtama.pkp && pajakUtama.terminHari === 30, "ambilPengaturanPerusahaan (kartu bilah samping, faktur) membaca nilai baru");
    const logUtama = await db.logAktivitas.findFirstOrThrow({ where: { jenis: "Perusahaan", nomor: "DPRO", aksi: "UBAH", waktu: { gte: awalUji } } });
    pastikan(logUtama.keterangan?.includes(`nama ${defaultAwal.nama} → D'Pro Uji Nama`) && logUtama.keterangan.includes("termin"), `log UBAH utama: ${logUtama.keterangan}`);

    console.log("=== 8. Pengaturan umum ===");
    await harusDitolak("tahun buku 1999", () => simpanPengaturanUmum(formulir({ tahunBuku: "1999", wajibPersetujuan: "on" })), "Tahun buku harus tahun antara 2000 dan 2100");
    await jalankan("simpan tahun buku 2030 dan matikan persetujuan", () => simpanPengaturanUmum(formulir({ tahunBuku: "2030" })));
    const umum = await db.pengaturanPerusahaan.findUniqueOrThrow({ where: { id: "default" } });
    pastikan(umum.tahunBuku === 2030 && !umum.wajibPersetujuan && umum.nama === "D'Pro Uji Nama" && umum.terminHari === 30, "pengaturan umum hanya mengubah tahun buku dan wajib persetujuan");
    pastikan((await ambilPengaturanPerusahaan(db, U.id)).tahunBuku === 2030, "tahun buku global terbaca di perusahaan lain");
    await jalankan("tahun buku kosong dan persetujuan menyala", () => simpanPengaturanUmum(formulir({ tahunBuku: "", wajibPersetujuan: "on" })));
    const umum2 = await db.pengaturanPerusahaan.findUniqueOrThrow({ where: { id: "default" } });
    pastikan(umum2.tahunBuku === null && umum2.wajibPersetujuan, "tahun buku kosong = tahun kalender, persetujuan menyala");

    console.log("=== 9. Pemetaan akun hanya akun bersama ===");
    const p = pemetaanAwal;
    const isiPeta = (ganti: Record<string, string>) =>
      formulir({
        piutangUsahaId: p.piutangUsahaId,
        persediaanId: p.persediaanId,
        hppId: p.hppId,
        pendapatanPenjualanId: p.pendapatanPenjualanId,
        utangUsahaId: p.utangUsahaId,
        bebanJasaId: p.bebanJasaId,
        barangBelumDitagihId: p.barangBelumDitagihId,
        selisihPersediaanId: p.selisihPersediaanId,
        barangTerkirimId: p.barangTerkirimId,
        uangMukaPelangganId: p.uangMukaPelangganId,
        labaDitahanId: p.labaDitahanId,
        diskonPenjualanId: p.diskonPenjualanId,
        pendapatanLainId: p.pendapatanLainId,
        selisihKursId: p.selisihKursId,
        ...ganti,
      });
    await harusDitolak("pemetaan utang usaha ke akun berpemilik", () => simpanPemetaanAkun(isiPeta({ utangUsahaId: akunU.id })), "pemetaan akun berlaku untuk semua perusahaan, jadi pilih akun bersama");
    pastikan((await db.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" } })).utangUsahaId === p.utangUsahaId, "pemetaan yang ditolak tidak berubah");
    await harusDitolak("pemetaan tambahan ke akun berpemilik", () => tambahPemetaanTambahan(formulir({ label: "ujipa peran", akunId: akunU.id })), `Akun ${KODE}-PPNK-U Hutang PPN Uji U milik PT Uji Pengaturan`);
    const akunBersama = await db.akun.create({ data: { kode: `${KODE}-BERSAMA`, nama: "Akun Bersama Uji", jenis: "KEWAJIBAN", kelompok: false } });
    await jalankan("pemetaan tambahan ke akun bersama", () => tambahPemetaanTambahan(formulir({ label: "ujipa peran", akunId: akunBersama.id })));
    const peta = await db.pemetaanAkunTambahan.findUniqueOrThrow({ where: { kunci: "ujipa-peran" } });
    await harusDitolak("ubah pemetaan tambahan ke akun berpemilik", () => ubahPemetaanTambahan(peta.id, formulir({ akunId: akunU2.id })), "pilih akun bersama");
    pastikan((await db.pemetaanAkunTambahan.findUniqueOrThrow({ where: { id: peta.id } })).akunId === akunBersama.id, "pemetaan tambahan yang ditolak tidak berubah");
    await jalankan("simpan pemetaan lama tetap jalan", () => simpanPemetaanAkun(isiPeta({})));

    console.log("=== 10. Tidak ada hapus fisik: 23001 ===");
    const hasilHapus = await jalankanFormulir(async () => {
      await db.perusahaan.delete({ where: { id: U.id } });
    });
    pastikan(hasilHapus.galat === "Data ini masih dipakai oleh data/transaksi lain, tidak bisa dihapus atau diubah." && (await db.perusahaan.count({ where: { id: U.id } })) === 1, `hapus perusahaan yang punya akun ditolak: ${hasilHapus.galat}`);

    console.log("=== 11. Halaman ===");
    const daftar = await render(await HalamanPengaturanPerusahaan());
    const kodeAktif = (await db.perusahaan.findMany({ select: { kode: true } })).map((x) => x.kode);
    pastikan(kodeAktif.every((k) => daftar.teks.includes(k)), "daftar memuat semua perusahaan termasuk uji");
    pastikan(daftar.teks.includes("Wajib persetujuan (maker-checker)") && daftar.teks.includes("Pengaturan umum (semua perusahaan)") && daftar.teks.includes("Tahun buku yang dibuka"), "penanda Wajib persetujuan dan pengaturan umum ada");
    pastikan(daftar.teks.includes("Piutang Antar Perusahaan:") && daftar.teks.includes("Hutang Antar Perusahaan:"), "kartu akun antar perusahaan");
    pastikan(daftar.href.includes("/pengaturan/perusahaan/baru") && daftar.href.includes("/pengaturan/perusahaan/integritas") && daftar.href.includes(`/pengaturan/perusahaan/${U.id}`) && daftar.href.includes("/pengaturan/perusahaan/utama") && daftar.href.includes("/pengaturan/pemetaan-akun"), "tautan baru, integritas, ubah, dan pemetaan akun");
    pastikan(daftar.teks.includes("D'Pro Uji Nama"), "nama utama di daftar dari baris default");
    pastikan(!daftar.isian.some((x) => x.name === "nama" || x.name === "pkp"), "isian pajak tidak lagi di halaman daftar");
    const halUtama = await render(await HalamanUbahPerusahaan({ params: Promise.resolve({ id: PERUSAHAAN_UTAMA }) }));
    const nilai = (n: string) => halUtama.isian.find((x) => x.name === n);
    pastikan(nilai("nama")?.value === "D'Pro Uji Nama" && nilai("terminHari")?.value === "30" && nilai("pkp")?.checked && nilai("akunPpnKeluaranId")?.value === defaultAwal.akunPpnKeluaranId, "halaman utama memuat nama, termin, PKP, dan akun pajak dari baris default");
    pastikan(halUtama.teks.includes("Perusahaan utama tidak bisa diarsipkan") && halUtama.isian.some((x) => x.name === "aktif" && x.type === "hidden" && x.value === "on") && halUtama.isian.some((x) => x.type === "checkbox" && x.disabled), "utama: kotak aktif nonaktif dengan isian tersembunyi");
    for (const n of ["tarifPpnPersen", "pphFinalPersen", "akunPpnMasukanId", "akunPph23DimukaId", "akunPph23DipotongId", "akunBebanPphFinalId", "akunHutangPphFinalId", "kode", "email", "npwp", "namaBank", "penandaTangan"]) {
      pastikan(Boolean(nilai(n)), `isian ${n} ada di halaman ubah utama`);
    }
    pastikan(halUtama.teks.includes("Tersimpan") && halUtama.teks.includes("Dokumen cetak") && !halUtama.href.some((h) => h.includes("/kop")), "lencana pajak tersimpan dan kartu dokumen cetak tanpa tautan");
    const halTapussa = await render(await HalamanUbahPerusahaan({ params: Promise.resolve({ id: "tapussa" }) }));
    const adaBarisTapussa = (await db.pengaturanPerusahaan.count({ where: { perusahaanId: "tapussa" } })) > 0;
    pastikan(halTapussa.teks.includes(adaBarisTapussa ? "Tersimpan" : "Masih bawaan") && halTapussa.isian.some((x) => x.name === "aktif" && x.type === "checkbox" && !x.disabled), "perusahaan lain: kotak aktif bisa diubah");
    // pilihan akun pajak perusahaan U: akun miliknya dan bersama, tanpa akun U2
    const halU = await render(await HalamanUbahPerusahaan({ params: Promise.resolve({ id: U.id }) }));
    pastikan(halU.teks.includes(`${KODE}-PPNK-U - Hutang PPN Uji U`) && !halU.teks.includes(`${KODE}-PPNK-U2`), "pilihan akun pajak: milik perusahaan itu dan bersama");
    const d404 = await digestHalaman(() => HalamanUbahPerusahaan({ params: Promise.resolve({ id: "tidak-ada" }) }));
    pastikan(d404.includes("404"), "perusahaan tidak ada = notFound");
    const halBaru = await render(await HalamanPerusahaanBaru());
    pastikan(halBaru.teks.includes("Perusahaan Baru") && halBaru.isian.some((x) => x.name === "aktif" && x.checked && !x.disabled) && !halBaru.teks.includes(`${KODE}-PPNK-U`), "halaman baru: aktif tercentang dan hanya akun bersama");
    const integritas = await render(await HalamanIntegritasPerusahaan());
    pastikan(integritas.teks.includes("Integritas per Perusahaan") && integritas.teks.includes("Gabungan") && integritas.teks.includes(KODE) && integritas.teks.includes("DPRO"), "halaman integritas: baris per perusahaan dan Gabungan");
    pastikan(integritas.teks.includes("Semua dokumen dan jurnal konsisten per perusahaan") && integritas.teks.includes("Jurnal berbeda perusahaan dengan dokumennya"), "halaman integritas: konsistensi dihitung langsung");

    // Perbaikan tinjauan P19 (ditambahkan sesudah P19, suite milik P19): temuan 1, 3, 4, 5, dan Pemetaan Akun
    console.log("=== 12. Perbaikan tinjauan P19 ===");
    // temuan 5: tautan ke Perusahaan & Pajak hanya untuk pemegang pengaturan.tulis
    pastikan(integritas.href.includes("/pengaturan/perusahaan") && !integritas.href.includes("/"), "integritas PEMILIK: Kembali dan jejak ke Perusahaan & Pajak");
    const integritasAdmin = await dengan({ peran: "ADMIN" }, async () => render(await HalamanIntegritasPerusahaan()));
    pastikan(integritasAdmin.teks.includes("Integritas per Perusahaan") && !integritasAdmin.href.includes("/pengaturan/perusahaan") && integritasAdmin.href.includes("/") && integritasAdmin.teks.includes("Beranda"), "integritas ADMIN: tanpa tautan ke halaman tanpa-akses, Kembali ke beranda");
    // temuan 1: galat satu pemeriksaan hanya menandai barisnya
    const queryRawAsli = db.$queryRaw;
    const klienRaw = db as unknown as Record<string, unknown>;
    const memuatId = (a: unknown[], id: string): boolean => a.some((x) => x === id || (typeof x === "object" && x !== null && "values" in x && memuatId((x as { values: unknown[] }).values, id)));
    const gagalSebagian = await (async () => {
      klienRaw.$queryRaw = (...a: unknown[]) => {
        if (memuatId(a.slice(1), U.id)) return Promise.reject(new Error("galat tiruan uji integritas"));
        return (queryRawAsli as (...x: unknown[]) => Promise<unknown>).apply(db, a);
      };
      const errAsli = console.error;
      console.error = () => {};
      try {
        return await render(await HalamanIntegritasPerusahaan());
      } finally {
        klienRaw.$queryRaw = queryRawAsli;
        console.error = errAsli;
      }
    })();
    pastikan((gagalSebagian.teks.match(/Gagal diperiksa, lihat log server/g) ?? []).length === 1 && gagalSebagian.teks.includes("Gabungan") && gagalSebagian.teks.includes("Semua dokumen dan jurnal konsisten per perusahaan"), "integritas: satu perusahaan gagal, baris lain dan konsistensi tetap tampil");
    const gagalSemua = await (async () => {
      klienRaw.$queryRaw = () => Promise.reject(new Error("galat tiruan uji integritas"));
      const errAsli = console.error;
      console.error = () => {};
      try {
        return await render(await HalamanIntegritasPerusahaan());
      } finally {
        klienRaw.$queryRaw = queryRawAsli;
        console.error = errAsli;
      }
    })();
    const jumlahBarisIntegritas = (await db.perusahaan.count({ where: { OR: [{ aktif: true }, { jurnal: { some: {} } }] } })) + 2;
    pastikan((gagalSemua.teks.match(/Gagal diperiksa, lihat log server/g) ?? []).length === jumlahBarisIntegritas && !gagalSemua.teks.includes("Semua dokumen dan jurnal konsisten"), "integritas: semua pemeriksaan gagal, halaman tetap tampil dengan tanda gagal per baris dan konsistensi");
    // temuan 3: selama ada perusahaan tanpa pengaturan, pilihan akun pajak utama hanya akun bersama dan yang tersimpan
    const akunMilikUtama = await db.akun.create({ data: { kode: `${KODE}-UTM`, nama: "Aset Milik Utama Uji", jenis: "ASET", kelompok: false, perusahaanId: PERUSAHAAN_UTAMA } });
    const tanpaPengaturanUji = await db.perusahaan.create({ data: { kode: "UJIPD", nama: "PT Uji Tanpa Pajak", urutan: 93 } });
    const halUtamaTerbatas = await render(await HalamanUbahPerusahaan({ params: Promise.resolve({ id: PERUSAHAAN_UTAMA }) }));
    pastikan(!halUtamaTerbatas.teks.includes(`${KODE}-UTM`) && halUtamaTerbatas.teks.includes("Pilihan akun pajak hanya berisi akun bersama"), "utama dengan perusahaan tanpa pengaturan: akun milik utama tidak ditawarkan dan ada petunjuk");
    const nilaiTerbatas = (n: string) => halUtamaTerbatas.isian.find((x) => x.name === n)?.value;
    pastikan(nilaiTerbatas("akunPpnKeluaranId") === nilai("akunPpnKeluaranId")?.value && nilaiTerbatas("akunHutangPphFinalId") === nilai("akunHutangPphFinalId")?.value, "nilai akun pajak tersimpan tetap terpilih");
    const tanpaPengaturanLain = await db.perusahaan.findMany({ where: { id: { not: PERUSAHAAN_UTAMA }, pengaturan: { is: null } }, select: { id: true, nama: true } });
    for (const t of tanpaPengaturanLain) await db.pengaturanPerusahaan.create({ data: { id: t.id, perusahaanId: t.id, nama: t.nama } });
    try {
      const halUtamaBebas = await render(await HalamanUbahPerusahaan({ params: Promise.resolve({ id: PERUSAHAAN_UTAMA }) }));
      pastikan(halUtamaBebas.teks.includes(`${KODE}-UTM - Aset Milik Utama Uji`) && !halUtamaBebas.teks.includes("Pilihan akun pajak hanya berisi akun bersama"), "semua perusahaan punya pengaturan: akun milik utama ditawarkan tanpa petunjuk");
    } finally {
      await db.pengaturanPerusahaan.deleteMany({ where: { id: { in: tanpaPengaturanLain.map((t) => t.id) } } });
    }
    const halTapussaAkun = await render(await HalamanUbahPerusahaan({ params: Promise.resolve({ id: "tapussa" }) }));
    pastikan(!halTapussaAkun.teks.includes("Pilihan akun pajak hanya berisi akun bersama") && !halTapussaAkun.teks.includes(`${KODE}-UTM`), "perusahaan lain: tanpa petunjuk, akun milik utama tidak ditawarkan (seperti sebelumnya)");
    await db.perusahaan.delete({ where: { id: tanpaPengaturanUji.id } });
    // Pemetaan Akun: pilihan hanya akun bersama
    const halPemetaan = await render(await HalamanPemetaanAkun());
    pastikan(halPemetaan.teks.includes(`${KODE}-BERSAMA - Akun Bersama Uji`) && !halPemetaan.teks.includes(`${KODE}-PPNK-U`) && !halPemetaan.teks.includes(`${KODE}-UTM`), "Pemetaan Akun: akun berpemilik tidak ditawarkan, akun bersama ditawarkan");
    await db.pemetaanAkunTambahan.update({ where: { id: peta.id }, data: { akunId: akunU.id } });
    const halPemetaanLama = await render(await HalamanPemetaanAkun());
    pastikan(halPemetaanLama.teks.includes(`${KODE}-PPNK-U - Hutang PPN Uji U (milik ${KODE}, ganti ke akun bersama)`) && !halPemetaanLama.teks.includes(`${KODE}-PPNK-U2`), "Pemetaan Akun: akun berpemilik yang tersimpan tetap tampil dengan tanda");
    await db.pemetaanAkunTambahan.update({ where: { id: peta.id }, data: { akunId: akunBersama.id } });
    await db.akun.delete({ where: { id: akunMilikUtama.id } });
    // temuan 4: pesan akun pajak dan PKP menyebut perusahaan dokumen
    const namaU = (await db.perusahaan.findUniqueOrThrow({ where: { id: U.id } })).nama;
    pastikan(pesanAkunPajakBelumDiatur("Akun PPN Keluaran", "TAPUSSA") === "Akun PPN Keluaran belum diatur untuk TAPUSSA (Pengaturan > Perusahaan & Pajak > TAPUSSA)", "bentuk pesan akun pajak belum diatur");
    const galatJurnal = await db
      .$transaction(async (tx) => {
        await catatJurnalFakturPenjualan(tx, { nomor: "UJIPA-FJ", total: 111, ppn: 11, perusahaanId: U.id }, [], null);
        throw new Error("transaksi uji harus gagal lebih dulu");
      })
      .then(
        () => "",
        (e: Error) => e.message,
      );
    pastikan(galatJurnal === pesanAkunPajakBelumDiatur("Akun PPN Keluaran", namaU), `jurnal faktur tanpa akun PPN menyebut perusahaan dokumen: ${galatJurnal}`);
    const nonPkp = { ...(await ambilPengaturanPerusahaan(db, U.id)), pkp: false, nama: namaU };
    let galatPkp = "";
    try {
      bacaTarifPpn("11", nonPkp);
    } catch (e) {
      galatPkp = (e as Error).message;
    }
    pastikan(galatPkp.includes("belum PKP") && galatPkp.includes(namaU), `pesan non-PKP menyebut perusahaan: ${galatPkp}`);
    const barisPajakU = await db.pengaturanPerusahaan.findUniqueOrThrow({ where: { id: U.id } });
    await db.pengaturanPerusahaan.update({ where: { id: U.id }, data: { akunBebanPphFinalId: null } });
    try {
      const halPajak = await dengan({ perusahaan: U.id }, async () => render(await HalamanPajak({ searchParams: Promise.resolve({}) })));
      pastikan(halPajak.teks.includes(`Akun PPh Final ${namaU} belum diatur`) && halPajak.href.includes(`/pengaturan/perusahaan/${U.id}`), "peringatan akun PPh Final menaut ke halaman ubah perusahaan lingkup");
    } finally {
      await db.pengaturanPerusahaan.update({ where: { id: U.id }, data: { akunBebanPphFinalId: barisPajakU.akunBebanPphFinalId } });
    }
  } finally {
    // kembalikan baris utama dan default seperti semula
    const { id: idUtama, dibuatPada, diubahPada, ...dataUtama } = utamaAwal;
    void [idUtama, dibuatPada, diubahPada];
    await db.perusahaan.update({ where: { id: PERUSAHAAN_UTAMA }, data: dataUtama });
    if (defaultAwal) {
      const { id: idDefault, ...dataDefault } = defaultAwal;
      void idDefault;
      await db.pengaturanPerusahaan.update({ where: { id: "default" }, data: dataDefault });
    }
    if (pemetaanAwal) {
      const { id: idPeta, ...dataPeta } = pemetaanAwal;
      void idPeta;
      await db.pemetaanAkun.update({ where: { id: "default" }, data: dataPeta });
    }
    await bersihkanData();
  }

  pastikan(JSON.stringify(await db.perusahaan.findUniqueOrThrow({ where: { id: PERUSAHAAN_UTAMA }, select: { kode: true, nama: true, aktif: true, email: true } })) === JSON.stringify({ kode: utamaAwal.kode, nama: utamaAwal.nama, aktif: utamaAwal.aktif, email: utamaAwal.email }), "perusahaan utama kembali seperti semula");
  const defaultAkhir = await db.pengaturanPerusahaan.findUniqueOrThrow({ where: { id: "default" } });
  pastikan(defaultAkhir.nama === defaultAwal!.nama && defaultAkhir.terminHari === defaultAwal!.terminHari && defaultAkhir.tahunBuku === defaultAwal!.tahunBuku && defaultAkhir.wajibPersetujuan === defaultAwal!.wajibPersetujuan, "baris default kembali seperti semula");
  pastikan((await db.perusahaan.count({ where: { kode: { in: [KODE, KODE2, "UJIPC"] } } })) === 0 && (await db.akun.count({ where: { kode: { startsWith: `${KODE}-` } } })) === 0, "perusahaan dan akun uji terhapus");
  pastikan((await db.hakAksesPeran.count()) === awalHakAksesPeran, "HakAksesPeran tidak berubah");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron sesudah uji sama dengan sebelum uji");
  console.log("=== DONE, all perusahaan-aksi checks passed ===");
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
