import "dotenv/config";
// Skrip ini memanggil halaman dan pustaka di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { db } from "../src/lib/db";
import { penggunaSaatIni } from "../src/lib/otentikasi";
import { PERUSAHAAN_UTAMA, lingkupArsip, lingkupPerusahaan, perusahaanFormulir, type Lingkup, type RingkasPerusahaan } from "../src/lib/perusahaan";
import { lupakanKonsistensiTersimpan, periksaKonsistensiTersimpan } from "../src/lib/sinkron";
import FormulirAksi from "../src/komponen/FormulirAksi";
import EditorBarisPenggajian from "../src/komponen/sdm/EditorBarisPenggajian";
import DaftarDokumenKasDraf from "../src/komponen/kas-bank/DaftarDokumenKasDraf";
import HalamanPersetujuan from "../src/app/(aplikasi)/persetujuan/page";
import HalamanPenggajianBaru from "../src/app/(aplikasi)/sdm/penggajian/baru/page";
import HalamanAsetTetapBaru from "../src/app/(aplikasi)/aset-tetap/baru/page";
import HalamanRekonsiliasiKasBank from "../src/app/(aplikasi)/rekonsiliasi/kas-bank/page";
import HalamanMataUang from "../src/app/(aplikasi)/pengaturan/mata-uang/page";
import { pastikan } from "./bantuan";

/*
 * Uji lingkup perusahaan di halaman P18 dan perbaikan P16 (tinjauan P18 S2, ditambah S1, R1, R2, R3):
 * - fungsi murni perusahaanFormulir dan lingkupArsip, juga lewat lingkupPerusahaan untuk perusahaan arsip;
 * - Persetujuan per lingkup (utama, perusahaan lain, gabungan): dokumen perusahaan lain tidak tampil di lingkup tunggal,
 *   kolom Perusahaan hanya di gabungan, jumlah dokumen menunggu di perusahaan lain mengikuti hak lihat per jenis, dan
 *   GUDANG dialihkan;
 * - DaftarDokumenKasDraf dengan perusahaanId string, null, dan tidak diisi;
 * - Proses Gaji: ?perusahaan= sah, palsu, dan perusahaan arsip di gabungan, diabaikan di lingkup tunggal, lingkup arsip,
 *   lingkup utama, karyawan dan akun kas milik satu perusahaan, dan KASIR dialihkan;
 * - Aset Tetap Baru di gabungan tidak menawarkan akun milik perusahaan arsip;
 * - Rekonsiliasi Kas/Bank di utama: catatan akun bersama hanya bila ada jurnal perusahaan lain, dan nomor jurnal di luar
 *   lingkup diberi akhiran kode perusahaan;
 * - Mata Uang di utama: petunjuk lingkup hanya bila ada faktur mata uang asing perusahaan lain;
 * - periksaKonsistensiTersimpan dengan waktu tiruan: hasil sukses disimpan 60 detik, hasil gagal 20 detik, dan
 *   permintaan bersamaan berbagi satu kueri.
 * Data uji berawalan UJILH dibuat langsung di basis data, lalu dihapus di awal dan akhir. Faktur seed yang dipinjam
 * untuk kasus Mata Uang dikembalikan di finally.
 */

const AWALAN = "UJILH";
const ID_ARSIP = "ujilh-arsip";

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

type Isian = { name: string; value: string; type: string };
type HasilRender = { teks: string; kepala: string[]; isian: Isian[]; opsi: string[]; karyawan: { id: string }[] | null };

/**
 * Menjalankan komponen server secara rekursif dan mengumpulkan teks, judul kolom (th), isian, nilai opsi, dan daftar
 * karyawan yang dikirim ke EditorBarisPenggajian. Komponen klien ber-hook (FormulirAksi, EditorBarisPenggajian) tidak
 * dipanggil: FormulirAksi hanya dirender anaknya, EditorBarisPenggajian dicatat props-nya.
 */
async function render(node: ReactNode): Promise<HasilRender> {
  const hasil: HasilRender = { teks: "", kepala: [], isian: [], opsi: [], karyawan: null };
  const jalan = async (n: ReactNode | Promise<ReactNode>, teks: string[]): Promise<void> => {
    const v = await n;
    if (v === null || v === undefined || typeof v === "boolean") return;
    if (typeof v === "string" || typeof v === "number") return void teks.push(String(v));
    if (Array.isArray(v)) {
      for (const x of v) await jalan(x, teks);
      return;
    }
    if (!isValidElement(v)) return;
    const el = v as ReactElement<Record<string, unknown>>;
    if (el.type === Link || el.type === FormulirAksi) return jalan(el.props.children as ReactNode, teks);
    if (el.type === EditorBarisPenggajian) {
      hasil.karyawan = el.props.daftarKaryawan as { id: string }[];
      return;
    }
    if (el.type === "th") {
      const isi: string[] = [];
      await jalan(el.props.children as ReactNode, isi);
      hasil.kepala.push(isi.join(""));
      teks.push(...isi);
      return;
    }
    if (el.type === "option") hasil.opsi.push(String(el.props.value ?? ""));
    if (el.type === "input" || el.type === "select" || el.type === "textarea") {
      hasil.isian.push({
        name: String(el.props.name ?? ""),
        value: String(el.props.value ?? el.props.defaultValue ?? ""),
        type: String(el.type === "input" ? (el.props.type ?? "text") : el.type),
      });
    }
    if (typeof el.type === "function") return jalan((el.type as (p: unknown) => ReactNode | Promise<ReactNode>)(el.props), teks);
    return jalan(el.props.children as ReactNode, teks);
  };
  const teks: string[] = [];
  await jalan(node, teks);
  hasil.teks = teks.join("");
  return hasil;
}

/** Halaman harus dialihkan (wajibHak, redirect); mengembalikan digest galat Next. */
async function digestHalaman(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return String((e as { digest?: string })?.digest ?? (e as Error)?.message ?? e);
  }
  return "";
}

const sp = (isi: Record<string, string> = {}) => ({ searchParams: Promise.resolve(isi) });
/** Angka "Ada {n} dokumen menunggu di perusahaan lain" (0 bila tidak tampil). */
const menungguLain = (teks: string) => Number(/Ada (\d+) dokumen menunggu di perusahaan lain/.exec(teks)?.[1] ?? 0);

async function bersihkanData() {
  await db.dokumenKas.deleteMany({ where: { nomor: { startsWith: `${AWALAN}-` } } });
  await db.asetTetap.deleteMany({ where: { kode: { startsWith: `${AWALAN}-` } } });
  await db.karyawan.deleteMany({ where: { kode: { startsWith: `${AWALAN}-` } } });
  const jurnal = await db.jurnal.findMany({ where: { nomor: { startsWith: `${AWALAN}-` } }, select: { id: true } });
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: jurnal.map((j) => j.id) } } });
  await db.jurnal.deleteMany({ where: { id: { in: jurnal.map((j) => j.id) } } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `${AWALAN}-` } } });
  await db.perusahaan.deleteMany({ where: { id: ID_ARSIP } });
}

async function main() {
  await bersihkanData();
  const awalHakAksesPeran = await db.hakAksesPeran.count();
  const tapussa = await db.perusahaan.findUniqueOrThrow({ where: { id: "tapussa" } });
  pastikan(tapussa.aktif, "perusahaan standar TAPUSSA harus aktif");
  const fakturPinjam = await db.fakturPembelian.findFirst({ where: { statusPersetujuan: "DISETUJUI", mataUangId: null, perusahaanId: PERUSAHAAN_UTAMA }, select: { id: true } });
  const usd = await db.mataUang.findFirst({ where: { fungsional: false } });

  try {
    // ---------- 1. perusahaanFormulir dan lingkupArsip (murni) ----------
    const ringkas = (id: string, aktif: boolean): RingkasPerusahaan => ({ id, kode: id.toUpperCase(), nama: `PT ${id}`, warna: null, aktif, urutan: 0 });
    const lingkupUtama: Lingkup = { perusahaanId: PERUSAHAAN_UTAMA, perusahaan: ringkas(PERUSAHAAN_UTAMA, true), bolehGabungan: true };
    const lingkupLain: Lingkup = { perusahaanId: "tapussa", perusahaan: ringkas("tapussa", true), bolehGabungan: false };
    const lingkupMati: Lingkup = { perusahaanId: "lama", perusahaan: ringkas("lama", false), bolehGabungan: true };
    const lingkupGabungan: Lingkup = { perusahaanId: null, perusahaan: null, bolehGabungan: true };
    pastikan(perusahaanFormulir(lingkupUtama) === PERUSAHAAN_UTAMA, "perusahaanFormulir utama = utama");
    pastikan(perusahaanFormulir(lingkupLain) === "tapussa", "perusahaanFormulir perusahaan aktif = perusahaan itu");
    pastikan(perusahaanFormulir(lingkupMati) === null, "perusahaanFormulir perusahaan arsip = null (seperti gabungan)");
    pastikan(perusahaanFormulir(lingkupGabungan) === null, "perusahaanFormulir gabungan = null");
    pastikan(lingkupArsip(lingkupUtama) === null && lingkupArsip(lingkupLain) === null && lingkupArsip(lingkupGabungan) === null, "lingkupArsip null untuk perusahaan aktif dan gabungan");
    pastikan(lingkupArsip(lingkupMati)?.id === "lama", "lingkupArsip mengembalikan perusahaan arsip");
    // lingkup tanpa data perusahaan (id tidak dikenal) tidak dianggap aktif
    pastikan(perusahaanFormulir({ perusahaanId: "x", perusahaan: null, bolehGabungan: false }) === null, "perusahaanFormulir tanpa data perusahaan = null");
    console.log("[ok] perusahaanFormulir dan lingkupArsip: utama, perusahaan lain, arsip, gabungan");

    // data bersama: perusahaan arsip, akun, karyawan, dokumen
    await db.perusahaan.create({ data: { id: ID_ARSIP, kode: `${AWALAN}A`, nama: "PT Uji Lingkup Arsip", aktif: false, urutan: 990 } });
    const lingkupArsipNyata = await dengan({ perusahaan: ID_ARSIP }, () => lingkupPerusahaan());
    pastikan(lingkupArsipNyata.perusahaanId === ID_ARSIP, "lingkup perusahaan arsip tetap bisa dipilih");
    pastikan(perusahaanFormulir(lingkupArsipNyata) === null && lingkupArsip(lingkupArsipNyata)?.kode === `${AWALAN}A`, "lingkupPerusahaan arsip: formulir null, lingkupArsip terisi");
    console.log("[ok] lingkupPerusahaan perusahaan arsip: perusahaanFormulir null dan lingkupArsip terisi");

    const kas = await db.akun.findFirstOrThrow({ where: { kode: "1-1100" } });
    pastikan(kas.perusahaanId === null, "akun kas seed 1-1100 bersama");
    const lawan = await db.akun.findFirstOrThrow({ where: { kelompok: false, perusahaanId: null, jenis: "PENDAPATAN" }, orderBy: { kode: "asc" } });
    const akunAset = await db.akun.findFirstOrThrow({ where: { kelompok: false, perusahaanId: null, jenis: "ASET", kode: { not: kas.kode } }, orderBy: { kode: "asc" } });
    const akunBeban = await db.akun.findFirstOrThrow({ where: { kelompok: false, perusahaanId: null, jenis: "BEBAN" }, orderBy: { kode: "asc" } });
    const akunArsip = await db.akun.create({ data: { kode: `${AWALAN}-ARSIP`, nama: "Akun Uji Perusahaan Arsip", jenis: "ASET", kelompok: false, perusahaanId: ID_ARSIP } });
    const akunKasTapussa = await db.akun.create({ data: { kode: `${AWALAN}-KAST`, nama: "Kas Uji TAPUSSA", jenis: "ASET", kelompok: false, perusahaanId: "tapussa", kasBank: true } });

    // ---------- 2. Persetujuan per lingkup ----------
    const awal = {
      utama: menungguLain((await dengan({ perusahaan: PERUSAHAAN_UTAMA }, async () => render(await HalamanPersetujuan()))).teks),
      tapussa: menungguLain((await dengan({ perusahaan: "tapussa" }, async () => render(await HalamanPersetujuan()))).teks),
      kasirUtama: menungguLain((await dengan({ perusahaan: PERUSAHAAN_UTAMA, peran: "KASIR" }, async () => render(await HalamanPersetujuan()))).teks),
    };
    const dok = (nomor: string, jenis: "MASUK" | "KELUAR", perusahaanId: string, status: "DRAFT" | "MENUNGGU") =>
      db.dokumenKas.create({ data: { nomor, jenis, perusahaanId, statusPersetujuan: status, akunKasId: kas.id, akunLawanId: lawan.id, jumlah: 1000, dibuatOleh: "uji", keterangan: `Uji ${nomor}` } });
    await dok(`${AWALAN}-KM-U`, "MASUK", PERUSAHAAN_UTAMA, "MENUNGGU");
    await dok(`${AWALAN}-KM-T`, "MASUK", "tapussa", "MENUNGGU");
    await dok(`${AWALAN}-KK-T`, "KELUAR", "tapussa", "DRAFT");
    await db.asetTetap.create({
      data: {
        kode: `${AWALAN}-AT`, nama: "Aset Uji Lingkup", hargaPerolehan: 1000, umurBulan: 12, perusahaanId: "tapussa", statusPersetujuan: "MENUNGGU",
        akunAsetId: akunAset.id, akunBebanPenyusutanId: akunBeban.id, akunAkumulasiPenyusutanId: akunAset.id,
      },
    });

    const persetujuan = async (perusahaan: string, peran?: string) => dengan({ perusahaan, peran }, async () => render(await HalamanPersetujuan()));
    const pUtama = await persetujuan(PERUSAHAAN_UTAMA);
    pastikan(pUtama.teks.includes(`${AWALAN}-KM-U`), "Persetujuan utama memuat draf utama");
    pastikan(![`${AWALAN}-KM-T`, `${AWALAN}-KK-T`, `${AWALAN}-AT`].some((n) => pUtama.teks.includes(n)), "Persetujuan utama tidak memuat dokumen TAPUSSA");
    pastikan(!pUtama.kepala.includes("Perusahaan"), "Persetujuan utama tanpa kolom Perusahaan");
    pastikan(menungguLain(pUtama.teks) === awal.utama + 2, `Persetujuan utama menyebut 2 dokumen menunggu tambahan di perusahaan lain (KM dan aset; draf KK tidak), dapat ${menungguLain(pUtama.teks)} dari ${awal.utama}`);
    console.log("[ok] Persetujuan lingkup utama: hanya dokumen utama, tanpa kolom Perusahaan, jumlah menunggu di perusahaan lain");

    const pTapussa = await persetujuan("tapussa");
    pastikan([`${AWALAN}-KM-T`, `${AWALAN}-KK-T`, `${AWALAN}-AT`].every((n) => pTapussa.teks.includes(n)), "Persetujuan TAPUSSA memuat ketiga dokumen TAPUSSA");
    pastikan(!pTapussa.teks.includes(`${AWALAN}-KM-U`), "Persetujuan TAPUSSA tidak memuat draf utama");
    pastikan(!pTapussa.kepala.includes("Perusahaan"), "Persetujuan TAPUSSA tanpa kolom Perusahaan");
    pastikan(menungguLain(pTapussa.teks) === awal.tapussa + 1, "Persetujuan TAPUSSA menyebut 1 dokumen menunggu tambahan di perusahaan lain");
    console.log("[ok] Persetujuan lingkup TAPUSSA: hanya dokumen TAPUSSA, jumlah menunggu di perusahaan lain");

    const pGabungan = await persetujuan("semua");
    pastikan([`${AWALAN}-KM-U`, `${AWALAN}-KM-T`, `${AWALAN}-KK-T`, `${AWALAN}-AT`].every((n) => pGabungan.teks.includes(n)), "Persetujuan gabungan memuat semua dokumen uji");
    pastikan(pGabungan.kepala.includes("Perusahaan"), "Persetujuan gabungan punya kolom Perusahaan");
    pastikan(pGabungan.teks.includes("TAPUSSA") && menungguLain(pGabungan.teks) === 0, "Persetujuan gabungan memberi lencana perusahaan tanpa kalimat perusahaan lain");
    console.log("[ok] Persetujuan gabungan: semua dokumen dengan kolom Perusahaan");

    // KASIR tidak punya aset.lihat: aset TAPUSSA tidak ikut dihitung, kas masuk TAPUSSA ikut
    const pKasir = await persetujuan(PERUSAHAAN_UTAMA, "KASIR");
    pastikan(!pKasir.teks.includes(`${AWALAN}-AT`) && !pKasir.teks.includes(`${AWALAN}-KM-T`), "KASIR utama tidak melihat dokumen TAPUSSA");
    pastikan(menungguLain(pKasir.teks) === awal.kasirUtama + 1, `KASIR utama hanya menghitung jenis yang boleh dilihat (kas masuk), dapat ${menungguLain(pKasir.teks)} dari ${awal.kasirUtama}`);
    const digestGudang = await dengan({ perusahaan: PERUSAHAAN_UTAMA, peran: "GUDANG" }, () => digestHalaman(() => HalamanPersetujuan()));
    pastikan(digestGudang.startsWith("NEXT_REDIRECT"), "GUDANG dialihkan dari Persetujuan");
    console.log("[ok] Persetujuan hak: KASIR hanya menghitung jenis yang boleh dilihat, GUDANG dialihkan");

    // ---------- 3. DaftarDokumenKasDraf ----------
    const pengguna = await penggunaSaatIni();
    pastikan(pengguna, "pengguna uji PEMILIK ada");
    const draf = (jenis: "MASUK" | "KELUAR", perusahaanId?: string | null) =>
      render(createElement(DaftarDokumenKasDraf, { jenis, pengguna, bolehHapus: false, ...(perusahaanId === undefined ? {} : { perusahaanId }) }));
    const dUtama = await draf("MASUK", PERUSAHAAN_UTAMA);
    pastikan(dUtama.teks.includes(`${AWALAN}-KM-U`) && !dUtama.teks.includes(`${AWALAN}-KM-T`), "draf kas utama hanya memuat draf utama");
    pastikan(!dUtama.kepala.includes("Perusahaan"), "draf kas utama tanpa kolom Perusahaan");
    const dTapussa = await draf("MASUK", "tapussa");
    pastikan(dTapussa.teks.includes(`${AWALAN}-KM-T`) && !dTapussa.teks.includes(`${AWALAN}-KM-U`), "draf kas TAPUSSA hanya memuat draf TAPUSSA");
    const dGabungan = await draf("MASUK", null);
    pastikan(dGabungan.teks.includes(`${AWALAN}-KM-U`) && dGabungan.teks.includes(`${AWALAN}-KM-T`), "draf kas gabungan memuat keduanya");
    pastikan(dGabungan.kepala.includes("Perusahaan"), "draf kas gabungan punya kolom Perusahaan");
    const dLama = await draf("MASUK");
    pastikan(dLama.teks.includes(`${AWALAN}-KM-U`) && dLama.teks.includes(`${AWALAN}-KM-T`) && !dLama.kepala.includes("Perusahaan"), "draf kas tanpa prop: semua draf tanpa kolom (perilaku lama)");
    const dKeluarUtama = await draf("KELUAR", PERUSAHAAN_UTAMA);
    pastikan(!dKeluarUtama.teks.includes(`${AWALAN}-KK-T`), "draf kas keluar utama tidak memuat draf TAPUSSA");
    pastikan((await draf("KELUAR", "tapussa")).teks.includes(`${AWALAN}-KK-T`), "draf kas keluar TAPUSSA memuat drafnya");
    console.log("[ok] DaftarDokumenKasDraf: string menyaring, null menambah kolom, tanpa prop sama dengan dulu");

    // ---------- 4. Proses Gaji ----------
    const karyawanT = await db.karyawan.create({ data: { kode: `${AWALAN}-K1`, nama: "Karyawan Uji TAPUSSA", perusahaanId: "tapussa", gajiPokok: 1000 } });
    const karyawanU = await db.karyawan.create({ data: { kode: `${AWALAN}-K2`, nama: "Karyawan Uji Utama", perusahaanId: PERUSAHAAN_UTAMA, gajiPokok: 1000 } });
    const gaji = (perusahaan: string, param: Record<string, string> = {}, peran?: string) => dengan({ perusahaan, peran }, async () => render(await HalamanPenggajianBaru(sp(param))));
    const isianPerusahaan = (h: HasilRender) => h.isian.filter((i) => i.name === "perusahaanId");
    const adaPemilih = (h: HasilRender) => h.isian.some((i) => i.name === "perusahaan" && i.type === "select");

    const gGabungan = await gaji("semua");
    pastikan(adaPemilih(gGabungan) && isianPerusahaan(gGabungan).length === 0 && gGabungan.karyawan === null, "Proses Gaji gabungan tanpa pilihan: hanya pemilih perusahaan");
    const gPilih = await gaji("semua", { perusahaan: "tapussa" });
    pastikan(adaPemilih(gPilih), "Proses Gaji gabungan tetap menampilkan pemilih");
    pastikan(isianPerusahaan(gPilih).length === 1 && isianPerusahaan(gPilih)[0].value === "tapussa" && isianPerusahaan(gPilih)[0].type === "hidden", "Proses Gaji ?perusahaan=tapussa: isian tersembunyi tapussa");
    pastikan(gPilih.teks.includes(`Formulir di bawah untuk ${tapussa.nama}`), "petunjuk pemilih menyebut perusahaan formulir (R2)");
    pastikan(gPilih.teks.includes(tapussa.kode) && gPilih.teks.includes("Perusahaan"), "formulir gaji memuat bidang baca saja perusahaan (R2)");
    const idKaryawan = (gPilih.karyawan ?? []).map((k) => k.id);
    pastikan(idKaryawan.includes(karyawanT.id) && !idKaryawan.includes(karyawanU.id), "karyawan formulir milik TAPUSSA saja");
    const milikKaryawan = await db.karyawan.findMany({ where: { id: { in: idKaryawan } }, select: { perusahaanId: true } });
    pastikan(milikKaryawan.every((k) => k.perusahaanId === "tapussa"), "semua karyawan di formulir milik TAPUSSA");
    const akunOpsi = await db.akun.findMany({ where: { id: { in: gPilih.opsi } }, select: { id: true, perusahaanId: true } });
    pastikan(akunOpsi.some((a) => a.id === akunKasTapussa.id), "akun kas milik TAPUSSA ditawarkan");
    pastikan(akunOpsi.every((a) => a.perusahaanId === null || a.perusahaanId === "tapussa"), "akun kas formulir milik TAPUSSA atau bersama");
    console.log("[ok] Proses Gaji gabungan ?perusahaan=tapussa: karyawan dan akun kas milik TAPUSSA, bidang perusahaan di formulir");

    for (const [label, nilai] of [["palsu", "bukan-perusahaan"], ["perusahaan arsip", ID_ARSIP]] as const) {
      const g = await gaji("semua", { perusahaan: nilai });
      pastikan(adaPemilih(g) && isianPerusahaan(g).length === 0 && g.karyawan === null, `Proses Gaji ?perusahaan= ${label} tidak menampilkan formulir`);
      pastikan(!g.opsi.includes(ID_ARSIP), "perusahaan arsip tidak ditawarkan di pemilih");
    }
    console.log("[ok] Proses Gaji ?perusahaan= palsu dan perusahaan arsip ditolak");

    const gTunggal = await gaji("tapussa", { perusahaan: "smara" });
    pastikan(!adaPemilih(gTunggal), "lingkup tunggal tanpa pemilih GET");
    pastikan(isianPerusahaan(gTunggal).length === 1 && isianPerusahaan(gTunggal)[0].value === "tapussa", "lingkup TAPUSSA mengabaikan ?perusahaan=smara");
    pastikan((gTunggal.karyawan ?? []).some((k) => k.id === karyawanT.id), "lingkup TAPUSSA memuat karyawan TAPUSSA");
    const gUtama = await gaji(PERUSAHAAN_UTAMA);
    pastikan(!adaPemilih(gUtama) && isianPerusahaan(gUtama).length === 1 && isianPerusahaan(gUtama)[0].value === PERUSAHAAN_UTAMA && isianPerusahaan(gUtama)[0].type === "hidden", "lingkup utama: isian tersembunyi utama saja");
    pastikan(!gUtama.teks.includes("Pilih perusahaan"), "lingkup utama tanpa pilihan perusahaan");
    pastikan((gUtama.karyawan ?? []).some((k) => k.id === karyawanU.id) && !(gUtama.karyawan ?? []).some((k) => k.id === karyawanT.id), "lingkup utama memuat karyawan utama saja");
    const gArsip = await gaji(ID_ARSIP);
    pastikan(adaPemilih(gArsip) && isianPerusahaan(gArsip).length === 0 && gArsip.teks.includes("sudah diarsipkan"), "lingkup arsip: pemilih perusahaan dengan petunjuk arsip");
    const gArsipPilih = await gaji(ID_ARSIP, { perusahaan: "tapussa" });
    pastikan(isianPerusahaan(gArsipPilih)[0]?.value === "tapussa", "lingkup arsip dengan ?perusahaan=tapussa menampilkan formulir TAPUSSA");
    const digestKasir = await dengan({ perusahaan: PERUSAHAAN_UTAMA, peran: "KASIR" }, () => digestHalaman(() => HalamanPenggajianBaru(sp())));
    pastikan(digestKasir.startsWith("NEXT_REDIRECT"), "KASIR dialihkan dari Proses Gaji");
    console.log("[ok] Proses Gaji lingkup tunggal, utama, arsip, dan hak KASIR");

    // ---------- 5. Aset Tetap Baru: akun perusahaan arsip tidak ditawarkan ----------
    const aGabungan = await dengan({ perusahaan: "semua" }, async () => render(await HalamanAsetTetapBaru()));
    pastikan(!aGabungan.opsi.includes(akunArsip.id), "Aset Tetap Baru gabungan tidak menawarkan akun perusahaan arsip");
    pastikan(aGabungan.opsi.includes(akunKasTapussa.id), "Aset Tetap Baru gabungan menawarkan akun perusahaan aktif");
    const aArsip = await dengan({ perusahaan: ID_ARSIP }, async () => render(await HalamanAsetTetapBaru()));
    pastikan(!aArsip.opsi.includes(akunArsip.id), "Aset Tetap Baru lingkup arsip tidak menawarkan akun perusahaan arsip");
    const aTapussa = await dengan({ perusahaan: "tapussa" }, async () => render(await HalamanAsetTetapBaru()));
    pastikan(aTapussa.opsi.includes(akunKasTapussa.id) && !aTapussa.opsi.includes(akunArsip.id), "Aset Tetap Baru TAPUSSA: akun TAPUSSA ditawarkan, akun arsip tidak");
    console.log("[ok] Aset Tetap Baru: akun milik perusahaan arsip tidak ditawarkan di gabungan dan lingkup arsip");

    // ---------- 6. Rekonsiliasi Kas/Bank ----------
    const hari = new Date().toISOString().slice(0, 10);
    const paramRek = { akun: kas.id, dari: `${hari.slice(0, 4)}-01-01`, sampai: `${hari.slice(0, 4)}-12-31` };
    const rekon = (perusahaan: string) => dengan({ perusahaan }, async () => render(await HalamanRekonsiliasiKasBank(sp(paramRek))));
    const CATATAN = "Akun dipakai bersama";
    const lainAwal = await db.barisJurnal.count({ where: { akunId: kas.id, jurnal: { perusahaanId: { not: PERUSAHAAN_UTAMA } } } });
    pastikan(lainAwal === 0, "data seed: akun 1-1100 belum dipakai perusahaan lain");
    pastikan(!(await rekon(PERUSAHAAN_UTAMA)).teks.includes(CATATAN), "Rekonsiliasi utama tanpa jurnal perusahaan lain: tanpa catatan akun bersama (tampilan lama)");
    pastikan((await rekon("tapussa")).teks.includes(CATATAN), "Rekonsiliasi TAPUSSA: catatan akun bersama tampil");
    const nomorJurnalT = `${AWALAN}-JU-T`;
    await db.jurnal.create({
      data: {
        nomor: nomorJurnalT, tanggal: new Date(`${hari}T12:00:00`), keterangan: "Uji jurnal TAPUSSA di akun bersama", sumber: "MANUAL", perusahaanId: "tapussa",
        baris: { create: [{ akunId: kas.id, debit: 1000, kredit: 0 }, { akunId: lawan.id, debit: 0, kredit: 1000 }] },
      },
    });
    const rUtama = await rekon(PERUSAHAAN_UTAMA);
    pastikan(rUtama.teks.includes(CATATAN), "Rekonsiliasi utama: catatan akun bersama tampil sesudah ada jurnal perusahaan lain (S1)");
    pastikan(rUtama.teks.includes(`${nomorJurnalT} · ${tapussa.kode}`), "Rekonsiliasi utama: nomor jurnal TAPUSSA diberi akhiran kode");
    const rTapussa = await rekon("tapussa");
    pastikan(rTapussa.teks.includes(nomorJurnalT) && !rTapussa.teks.includes(`${nomorJurnalT} · `), "Rekonsiliasi TAPUSSA: jurnal sendiri tanpa akhiran");
    const rGabungan = await rekon("semua");
    pastikan(rGabungan.teks.includes(nomorJurnalT) && !rGabungan.teks.includes(`${nomorJurnalT} · `), "Rekonsiliasi gabungan: nomor jurnal tanpa akhiran");
    console.log("[ok] Rekonsiliasi Kas/Bank: catatan akun bersama di utama hanya bila ada jurnal perusahaan lain, akhiran kode jurnal di luar lingkup");

    // ---------- 7. Mata Uang ----------
    const PETUNJUK = "Dijalankan untuk";
    const mu = (perusahaan: string) => dengan({ perusahaan }, async () => render(await HalamanMataUang()));
    pastikan(!(await mu(PERUSAHAAN_UTAMA)).teks.includes(PETUNJUK), "Mata Uang utama tanpa faktur valas perusahaan lain: tanpa petunjuk (tampilan lama)");
    pastikan((await mu("tapussa")).teks.includes(`${PETUNJUK} ${tapussa.nama}`), "Mata Uang TAPUSSA: petunjuk lingkup");
    pastikan((await mu("semua")).teks.includes(`${PETUNJUK} semua perusahaan`), "Mata Uang gabungan: petunjuk semua perusahaan");
    if (fakturPinjam && usd) {
      await db.fakturPembelian.update({ where: { id: fakturPinjam.id }, data: { mataUangId: usd.id, perusahaanId: "tapussa" } });
      try {
        const utamaNama = (await db.perusahaan.findUniqueOrThrow({ where: { id: PERUSAHAAN_UTAMA } })).nama;
        pastikan((await mu(PERUSAHAAN_UTAMA)).teks.includes(`${PETUNJUK} ${utamaNama}`), "Mata Uang utama: petunjuk tampil bila ada faktur valas perusahaan lain (S1)");
      } finally {
        await db.fakturPembelian.update({ where: { id: fakturPinjam.id }, data: { mataUangId: null, perusahaanId: PERUSAHAAN_UTAMA } });
      }
      console.log("[ok] Mata Uang: petunjuk lingkup di utama hanya bila ada faktur valas perusahaan lain");
    } else {
      console.log("[ok] Mata Uang: petunjuk lingkup per lingkup (kasus faktur valas dilewati, data seed tidak punya faktur atau mata uang asing)");
    }

    // ---------- 8. periksaKonsistensiTersimpan dengan waktu tiruan ----------
    const klien = db as unknown as Record<string, unknown>;
    const queryRawAsli = db.$queryRaw;
    const nowAsli = Date.now;
    let kini = nowAsli();
    let kueri = 0;
    let gagal = false;
    // dibaca lewat fungsi supaya TypeScript tidak mempersempit nilainya sesudah pastikan
    const jumlahKueri = () => kueri;
    Date.now = () => kini;
    klien.$queryRaw = (...a: unknown[]) => {
      kueri++;
      if (gagal) return Promise.reject(new Error("kueri konsistensi gagal (buatan uji)"));
      return (queryRawAsli as (...x: unknown[]) => Promise<unknown>).apply(db, a);
    };
    try {
      lupakanKonsistensiTersimpan();
      const j1 = periksaKonsistensiTersimpan();
      const j2 = periksaKonsistensiTersimpan();
      pastikan(j1 === j2 && jumlahKueri() === 1, "permintaan bersamaan berbagi satu kueri");
      pastikan(typeof (await j1).konsisten === "boolean", "hasil konsistensi terbaca");
      kini += 59_000;
      await periksaKonsistensiTersimpan();
      pastikan(jumlahKueri() === 1, "hasil sukses dipakai ulang sebelum 60 detik");
      kini += 2_000;
      await periksaKonsistensiTersimpan();
      pastikan(jumlahKueri() === 2, "hasil sukses dikueri ulang sesudah 60 detik");
      console.log("[ok] simpanan konsistensi: sukses disimpan 60 detik, permintaan bersamaan berbagi kueri");

      lupakanKonsistensiTersimpan();
      gagal = true;
      const ditolak = async () => {
        try {
          await periksaKonsistensiTersimpan();
        } catch (e) {
          return (e as Error).message;
        }
        return "";
      };
      pastikan((await ditolak()).includes("buatan uji") && jumlahKueri() === 3, "kueri gagal diteruskan ke pemanggil");
      kini += 19_000;
      pastikan((await ditolak()).includes("buatan uji") && jumlahKueri() === 3, "hasil gagal dipakai ulang sebelum 20 detik (tanpa kueri ulang)");
      kini += 2_000;
      gagal = false;
      await periksaKonsistensiTersimpan();
      pastikan(jumlahKueri() === 4, "hasil gagal dikueri ulang sesudah 20 detik, bukan 60 detik");
      kini += 59_000;
      await periksaKonsistensiTersimpan();
      pastikan(jumlahKueri() === 4, "hasil sukses sesudah gagal disimpan 60 detik lagi");
      console.log("[ok] simpanan konsistensi: hasil gagal disimpan 20 detik lalu dicoba lagi");
    } finally {
      Date.now = nowAsli;
      klien.$queryRaw = queryRawAsli;
      lupakanKonsistensiTersimpan();
    }
  } finally {
    if (fakturPinjam) await db.fakturPembelian.update({ where: { id: fakturPinjam.id }, data: { mataUangId: null, perusahaanId: PERUSAHAAN_UTAMA } });
    await bersihkanData();
  }

  pastikan((await db.hakAksesPeran.count()) === awalHakAksesPeran, "tidak ada baris HakAksesPeran tertinggal");
  pastikan((await db.dokumenKas.count({ where: { nomor: { startsWith: `${AWALAN}-` } } })) === 0, "data uji terhapus");
  console.log("[ok] data uji dibersihkan");
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
