import "dotenv/config";
// Skrip ini memanggil halaman, aksi, dan pustaka di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { db } from "../src/lib/db";
import { hitungHak, type Hak, type PenggunaSesi } from "../src/lib/hakAkses";
import { labaRugiKas, labaRugiKasBulanan, type LabaRugiKasBulanan } from "../src/lib/basisKas";
import { periksaSinkron, type HasilSinkron } from "../src/lib/sinkron";
import { bacaPeriode, hitungLabaRugiBulanan, saldoAkunPeriode } from "../src/lib/laporan";
import { urutkanAkunKas } from "../src/lib/berandaKeuangan";
import { ambilPengaturanPerusahaan } from "../src/lib/pengaturanPerusahaan";
import { ID_PERUSAHAAN_STANDAR } from "../src/lib/perusahaan";
import { alasanKontenSaya, geserTanggalIso, kontenSaya, menungguPenyetujuSaja } from "../src/lib/konten";
import { KALIMAT_INTEGRITAS_LAMA, kalimatIntegritas } from "../src/lib/beranda";
import { Prisma } from "../src/prisma-klien/client";
import { tanggalIso } from "../src/lib/waktu";
import { D } from "../src/lib/uang";
import { buatPesanan, buatFaktur, buatPenerimaan, buatPengiriman, buatUangMuka } from "../src/lib/aksi/penjualan";
import { buatPesananPembelian, buatPenerimaanBarang, buatFakturPembelian } from "../src/lib/aksi/pembelian";
import { buatKasMasuk, buatKasKeluar } from "../src/lib/aksi/jurnal";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import Beranda from "../src/app/(aplikasi)/page";
import DasborModul from "../src/komponen/beranda/DasborModul";
import PanelSaya, { HAK_SETUJUI_TUGAS_SAYA, LENCANA_ALASAN, kartuTugasSaya, menungguPersetujuanSaya } from "../src/komponen/beranda/PanelSaya";
import PanelCrmBeranda from "../src/komponen/beranda/PanelCrmBeranda";
import { kelasLencanaAksiLog } from "../src/komponen/beranda/PanelSistem";
import PanelProyek, { teksPersen } from "../src/komponen/beranda/PanelProyek";
import KartuKpi from "../src/komponen/ui/KartuKpi";
import AngkaBergerak from "../src/komponen/ui/AngkaBergerak";
import GrafikTren from "../src/komponen/ui/GrafikTren";
import type { PeranPengguna } from "../src/prisma-klien/client";
import { formulir, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * Uji perbaikan pratinjau beranda (paket DF5):
 * - labaRugiKasBulanan, labaRugiKas, saldoAkunPeriode, hitungLabaRugiBulanan, dan periksaSinkron per perusahaan:
 *   panggilan lama tanpa parameter baru = gabungan dengan hasil identik, satu perusahaan hanya datanya sendiri,
 *   gabungan = jumlah per perusahaan, dan ketidakcocokan per perusahaan terlihat walau gabungan tetap cocok;
 * - halaman beranda lingkup satu perusahaan menampilkan tren kas dan Integritas perusahaan itu (juga bagi KASIR walau
 *   perusahaan lain punya data) dan rincian Kas & Bank mendahulukan rekening perusahaan itu;
 * - tab Tugas Saya per hak (kartu tugas desain, Konten saya, menunggu persetujuan) dan lencana perusahaan pada tindak
 *   lanjut CRM di lingkup gabungan;
 * - warna lencana log, KartuKpi rata atas, persen margin satu desimal;
 * - (P01) kalimat Integritas lama di gabungan dan di instalasi satu perusahaan aktif, lencana Menunggu persetujuan di
 *   Konten saya, dan konten yang hanya menunggu penyetuju diurutkan sesudah ide/draf.
 * Data uji memakai perusahaan UJL1/UJL2, pengguna ujilingkup-*, dan kode UJL-*; semuanya dibersihkan di akhir.
 */

const PREFIKS = "ujilingkup-";

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

function penggunaSintetis(peran: PeranPengguna, hak: readonly Hak[] = hitungHak(peran)): PenggunaSesi {
  return { id: "skrip-uji", nama: "Skrip Uji", namaPengguna: "skrip-uji", email: null, nomorTelepon: null, peran, hak };
}

const sama = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const json = (x: unknown) => JSON.stringify(x);

/** Menjalankan komponen server (termasuk async) secara rekursif; mengumpulkan teks, href, dan props GrafikTren. */
async function render(node: ReactNode): Promise<{ teks: string; href: string[]; grafik: { bulan: { pendapatan: unknown; bebanPokok: unknown }[] }[] }> {
  const teks: string[] = [];
  const href: string[] = [];
  const grafik: { bulan: { pendapatan: unknown; bebanPokok: unknown }[] }[] = [];
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
      href.push(String(el.props.href));
      return jalan(el.props.children as ReactNode);
    }
    if (el.type === AngkaBergerak) return void teks.push(`${el.props.awalan ?? "Rp "}${Number(el.props.nilai).toLocaleString("id-ID")}`);
    if (el.type === GrafikTren) return void grafik.push(el.props as never);
    if (typeof el.type === "function") return jalan((el.type as (p: unknown) => ReactNode | Promise<ReactNode>)(el.props));
    return jalan(el.props.children as ReactNode);
  };
  await jalan(node);
  return { teks: teks.join(""), href, grafik };
}

/** Bagian teks antara dua penanda (penanda awal termasuk). */
function potong(teks: string, dari: string, sampai: string): string {
  const i = teks.indexOf(dari);
  if (i < 0) return "";
  const j = teks.indexOf(sampai, i + dari.length);
  return teks.slice(i, j < 0 ? undefined : j);
}

/** Jumlah per bulan dua hasil tren kas (Decimal). */
function jumlahTren(a: LabaRugiKasBulanan, b: LabaRugiKasBulanan) {
  return a.bulan.map((m, i) => ({ diterima: m.diterima.plus(b.bulan[i].diterima).toFixed(2), dikeluarkan: m.dikeluarkan.plus(b.bulan[i].dikeluarkan).toFixed(2) }));
}
const ringkasTren = (t: LabaRugiKasBulanan) => t.bulan.map((m) => ({ diterima: m.diterima.toFixed(2), dikeluarkan: m.dikeluarkan.toFixed(2) }));

/** Butir sinkron dalam bentuk teks untuk dibandingkan dan dijumlahkan. */
const BUTIR = ["persediaan", "piutang", "hutang", "barangBelumDitagih", "barangTerkirim", "uangMuka"] as const;
function semuaCocok(s: HasilSinkron) {
  return s.seimbang && BUTIR.every((b) => s[b].sinkron);
}

/** Hapus dokumen lewat aksi; kegagalan dicatat lalu dilewati supaya sisa data lain tetap dibersihkan. */
async function hapusSisa(jenis: Parameters<typeof hapusDokumen>[0], id: string, nomor: string) {
  // jalankan mengabaikan galat revalidatePath di luar permintaan HTTP (datanya sudah terhapus saat itu)
  await jalankan(`hapus sisa ${nomor}`, () => hapusDokumen(jenis, id)).catch((e: unknown) => console.warn(`[bersih] ${nomor} gagal dihapus: ${(e as Error).message}`));
}

/**
 * Membersihkan sisa data uji dari percobaan yang terputus (pastikan memanggil process.exit, jadi pembersihan akhir
 * bisa terlewat). Dokumen keuangan dikembalikan ke utama lalu dihapus lewat aksi supaya stok dan jurnal ikut dibalik,
 * baru data induk berkode UJL-* dan perusahaan uji dihapus. Aman dijalankan berulang di basis data yang sama.
 */
async function bersihkanDataUji() {
  const ids = (await db.perusahaan.findMany({ where: { kode: { in: ["UJL1", "UJL2"] } }, select: { id: true } })).map((p) => p.id);
  await db.tugasDesain.deleteMany({ where: { perusahaanId: { in: ids } } });
  await db.konten.deleteMany({ where: { perusahaanId: { in: ids } } });
  await db.tindakLanjut.deleteMany({ where: { perusahaanId: { in: ids } } });
  await db.pengguna.deleteMany({ where: { namaPengguna: { startsWith: PREFIKS } } });
  for (const id of ids) {
    await db.jurnal.updateMany({ where: { perusahaanId: id }, data: { perusahaanId: "utama" } });
    for (const t of [
      "penyesuaianPersediaan", "pesananPenjualan", "fakturPenjualan", "penerimaanPenjualan", "dokumenKas", "pengirimanPesanan", "uangMukaPelanggan",
      "pesananPembelian", "penerimaanBarang", "fakturPembelian",
    ] as const) {
      await (db[t] as unknown as { updateMany: (a: unknown) => Promise<unknown> }).updateMany({ where: { perusahaanId: id }, data: { perusahaanId: "utama" } });
    }
    await db.akun.updateMany({ where: { perusahaanId: id }, data: { perusahaanId: null } });
    await db.barang.updateMany({ where: { perusahaanId: id }, data: { perusahaanId: "utama" } });
  }

  const akunUji = (await db.akun.findMany({ where: { kode: { startsWith: "UJL-" } }, select: { id: true } })).map((a) => a.id);
  const barangUji = (await db.barang.findMany({ where: { kode: { in: ["UJL-BRG", "UJL-JASA"] } }, select: { id: true } })).map((b) => b.id);
  const pelanggan = { pelanggan: { kode: "UJL-CUST" } };
  const pemasok = { pemasok: { kode: "UJL-SUP" } };
  const terbaru = { orderBy: { tanggal: "desc" as const }, select: { id: true, nomor: true } };
  for (const d of await db.dokumenKas.findMany({ where: { OR: [{ akunKasId: { in: akunUji } }, { akunLawanId: { in: akunUji } }] }, select: { id: true, nomor: true } })) await hapusSisa("dokumenKas", d.id, d.nomor);
  for (const j of await db.jurnal.findMany({ where: { sumber: { in: ["KAS_MASUK", "KAS_KELUAR"] }, baris: { some: { akunId: { in: akunUji } } } }, select: { id: true, nomor: true } })) await hapusSisa("jurnal", j.id, j.nomor);
  for (const d of await db.uangMukaPelanggan.findMany({ where: { pesanan: pelanggan }, ...terbaru })) await hapusSisa("uangMuka", d.id, d.nomor);
  for (const d of await db.penerimaanPenjualan.findMany({ where: { faktur: pelanggan }, ...terbaru })) await hapusSisa("penerimaan", d.id, d.nomor);
  for (const d of await db.fakturPenjualan.findMany({ where: pelanggan, ...terbaru })) await hapusSisa("faktur", d.id, d.nomor);
  for (const d of await db.pengirimanPesanan.findMany({ where: { pesanan: pelanggan }, ...terbaru })) await hapusSisa("pengiriman", d.id, d.nomor);
  for (const d of await db.pesananPenjualan.findMany({ where: pelanggan, ...terbaru })) await hapusSisa("pesanan", d.id, d.nomor);
  for (const d of await db.fakturPembelian.findMany({ where: pemasok, ...terbaru })) await hapusSisa("fakturPembelian", d.id, d.nomor);
  for (const d of await db.penerimaanBarang.findMany({ where: { pesanan: pemasok }, ...terbaru })) await hapusSisa("penerimaanBarang", d.id, d.nomor);
  for (const d of await db.pesananPembelian.findMany({ where: pemasok, ...terbaru })) await hapusSisa("pesananPembelian", d.id, d.nomor);
  for (const d of await db.penyesuaianPersediaan.findMany({ where: { baris: { some: { barangId: { in: barangUji } } } }, ...terbaru })) await hapusSisa("penyesuaian", d.id, d.nomor);

  const abaikan = () => undefined;
  await db.stokBarang.deleteMany({ where: { barangId: { in: barangUji } } }).catch(abaikan);
  await db.barang.deleteMany({ where: { id: { in: barangUji } } }).catch(abaikan);
  await db.gudang.deleteMany({ where: { kode: "UJL-GDG" } }).catch(abaikan);
  await db.pelanggan.deleteMany({ where: { kode: "UJL-CUST" } }).catch(abaikan);
  await db.pemasok.deleteMany({ where: { kode: "UJL-SUP" } }).catch(abaikan);
  await db.akun.deleteMany({ where: { id: { in: akunUji } } }).catch(abaikan);
  await db.perusahaan.deleteMany({ where: { id: { in: ids } } }).catch(abaikan);
}

async function main() {
  // Bila putaran sebelumnya terhenti di tengah bagian 6, perusahaan standar bisa tertinggal nonaktif; aktifkan lagi
  // lewat SQL (diubahPada tidak tersentuh). Keenamnya aktif sejak migrasi.
  await db.$executeRaw`UPDATE "Perusahaan" SET "aktif" = true WHERE "aktif" = false AND "id" IN (${Prisma.join([...ID_PERUSAHAAN_STANDAR])})`;
  await bersihkanDataUji();
  const tahun = (await ambilPengaturanPerusahaan(db)).tahunBuku;
  const periode = bacaPeriode({ dari: `${tahun}-01-01`, sampai: `${tahun}-12-31` });

  console.log("=== 1. Fungsi murni ===");
  const akunContoh = [
    { kode: "1-1100", perusahaanId: null, balance: 0 },
    { kode: "1-1200", perusahaanId: null, balance: 5 },
    { kode: "1-1210", perusahaanId: "x", balance: -7 },
    { kode: "1-1300", perusahaanId: null, balance: -9 },
  ];
  pastikan(sama(urutkanAkunKas(akunContoh, null), akunContoh), "urutkanAkunKas gabungan: urutan semula (identik dengan sebelum perbaikan)");
  pastikan(sama(urutkanAkunKas(akunContoh, "x").map((a) => a.kode), ["1-1210", "1-1200", "1-1300", "1-1100"]), "urutkanAkunKas satu perusahaan: milik sendiri, lalu bersama bersaldo, lalu bersama nol, masing-masing urut kode");
  pastikan(urutkanAkunKas(akunContoh, "x").length === akunContoh.length, "urutkanAkunKas tidak membuang akun (total kas tetap)");
  const akunBersama = [
    { kode: "1-1100", perusahaanId: null, balance: 0 },
    { kode: "1-1200", perusahaanId: null, balance: 5 },
    { kode: "1-1300", perusahaanId: null, balance: 9 },
  ];
  pastikan(sama(urutkanAkunKas(akunBersama, "utama"), urutkanAkunKas(akunBersama, null)) && sama(urutkanAkunKas(akunBersama, "utama"), akunBersama), "lingkup satu perusahaan tanpa akun sendiri (mis. KASIR di utama sesudah migrasi): urutan sama dengan gabungan, tidak menurut saldo");
  pastikan(kelasLencanaAksiLog("BUAT").includes("lencana-emerald") && kelasLencanaAksiLog("UBAH").includes("lencana-blue") && kelasLencanaAksiLog("HAPUS").includes("lencana-rose"), "lencana aksi log: BUAT hijau, UBAH biru, HAPUS merah");
  pastikan(["TOLAK", "TUTUP", "MASUK", ""].every((a) => kelasLencanaAksiLog(a) === "lencana lencana-slate"), "aksi log lain abu-abu");
  pastikan(teksPersen(D(35)) === "35,0%" && teksPersen(D("12.34")) === "12,3%" && teksPersen(D("-4.05")) === "-4,1%" && teksPersen(null) === "-", "persen margin seragam satu desimal (35,0%; 12,3%; -4,1%), kosong = -");
  const kpiTanpa = KartuKpi({ judul: "A", ikon: "domain", nilai: 6, awalan: "" }) as ReactElement<{ className: string }>;
  const kpiDengan = KartuKpi({ judul: "B", ikon: "group", nilai: 14, awalan: "", sub: "14 aktif" }) as ReactElement<{ className: string }>;
  pastikan(kpiTanpa.props.className === kpiDengan.props.className && !kpiTanpa.props.className.includes("justify-between"), "KartuKpi rata atas dengan atau tanpa subteks (angka sejajar)");

  const hariIni = tanggalIso(new Date());
  const hari = (n: number) => new Date(`${geserTanggalIso(hariIni, n)}T12:00:00`);
  const dari = new Date(`${hariIni}T00:00:00+07:00`), sampai = new Date(`${geserTanggalIso(hariIni, 15)}T00:00:00+07:00`);
  const alasan = (status: string, statusPersetujuan: string, n: number | null, statusDesain: string | null) =>
    alasanKontenSaya({ status: status as never, statusPersetujuan: statusPersetujuan as never, tanggalTerbit: n === null ? null : hari(n), statusDesain: statusDesain as never }, dari, sampai);
  pastikan(sama(alasan("DRAF", "DITOLAK", null, null), ["DITOLAK", "BELUM_SELESAI"]), "alasan konten: ditolak + masih draf");
  pastikan(sama(alasan("DESAIN", "TIDAK_ADA", null, "REVISI"), ["REVISI_DESAIN"]) && sama(alasan("DESAIN", "TIDAK_ADA", null, "SELESAI"), ["DESAIN_SIAP"]), "alasan konten: desain direvisi, desain selesai = siap diajukan");
  pastikan(sama(alasan("TERJADWAL", "DISETUJUI", 3, null), ["AKAN_TERBIT"]) && sama(alasan("TERJADWAL", "DISETUJUI", 14, null), ["AKAN_TERBIT"]), "alasan konten: terjadwal 3 dan 14 hari lagi = akan terbit");
  pastikan(sama(alasan("DISETUJUI", "DISETUJUI", -1, null), ["LEWAT_TERBIT"]) && sama(alasan("TERJADWAL", "DISETUJUI", -10, null), ["LEWAT_TERBIT"]), "alasan konten: disetujui/terjadwal dengan tanggal terbit lewat dan belum ditandai terbit = lewat terbit");
  pastikan(sama(alasan("DISETUJUI", "DISETUJUI", null, null), ["BELUM_DIJADWALKAN"]) && sama(alasan("DISETUJUI", "DISETUJUI", 0, null), ["AKAN_TERBIT"]), "alasan konten: disetujui tanpa tanggal = perlu dijadwalkan; terbit hari ini = akan terbit, belum lewat");
  pastikan(alasan("TERJADWAL", "DISETUJUI", 15, null).length === 0 && alasan("TERBIT", "DISETUJUI", 2, null).length === 0 && alasan("TERBIT", "DISETUJUI", -3, null).length === 0 && alasan("DITINJAU", "MENUNGGU", null, "DISETUJUI").length === 0 && alasan("DITINJAU", "MENUNGGU", -2, null).length === 0 && alasan("TERJADWAL", "DISETUJUI", null, null).length === 0, "bukan tindakan: terbit 15 hari lagi, sudah terbit (juga yang tanggalnya lewat), menunggu penyetuju (walau tanggal lewat), terjadwal tanpa tanggal");
  pastikan(LENCANA_ALASAN.LEWAT_TERBIT?.warna === "rose" && !!LENCANA_ALASAN.BELUM_DIJADWALKAN && !!LENCANA_ALASAN.DITOLAK, "lencana alasan lewat terbit (merah) dan perlu dijadwalkan tersedia");
  pastikan(menungguPenyetujuSaja({ statusPersetujuan: "MENUNGGU", alasan: ["AKAN_TERBIT"] }) && !menungguPenyetujuSaja({ statusPersetujuan: "DISETUJUI", alasan: ["AKAN_TERBIT"] }), "menunggu penyetuju saja: akan terbit dan persetujuan MENUNGGU; yang sudah disetujui tidak");
  pastikan(!menungguPenyetujuSaja({ statusPersetujuan: "MENUNGGU", alasan: ["AKAN_TERBIT", "REVISI_DESAIN"] }) && !menungguPenyetujuSaja({ statusPersetujuan: "MENUNGGU", alasan: [] }), "ada alasan lain (mis. revisi desain) atau tanpa alasan: bukan menunggu penyetuju saja");
  // kalimat Integritas: lama di gabungan dan bila lingkup satu-satunya perusahaan aktif, selain itu menyebut nama perusahaan
  pastikan(kalimatIntegritas({ perusahaanId: null, nama: null }, ["utama", "tapussa"]) === KALIMAT_INTEGRITAS_LAMA, "kalimat Integritas gabungan: kalimat lama");
  pastikan(kalimatIntegritas({ perusahaanId: "utama", nama: "PT A" }, ["utama"]) === KALIMAT_INTEGRITAS_LAMA, "kalimat Integritas satu perusahaan aktif yang menjadi lingkup: kalimat lama");
  pastikan(kalimatIntegritas({ perusahaanId: "utama", nama: "PT A" }, ["utama", "tapussa"]).startsWith("Buku besar PT A dicocokkan"), "kalimat Integritas lebih dari satu perusahaan aktif: menyebut nama perusahaan");
  pastikan(kalimatIntegritas({ perusahaanId: "arsip", nama: "PT Arsip" }, ["utama"]).startsWith("Buku besar PT Arsip dicocokkan"), "kalimat Integritas lingkup perusahaan arsip (bukan satu-satunya yang aktif): menyebut nama perusahaan");

  console.log("=== 2. Kartu Tugas Saya per hak bawaan ===");
  const k = (peran: PeranPengguna, n: number | null = 0) => kartuTugasSaya({ hak: hitungHak(peran) }, n);
  pastikan(!k("SOSMED").desain && k("SOSMED", 2).desain && k("SOSMED").konten && k("SOSMED").menunggu && !k("SOSMED").tindakLanjut, "SOSMED: tanpa kartu tugas desain kosong (muncul bila ditugasi), dengan Konten saya dan menunggu persetujuan (tugas-desain.setujui)");
  pastikan(k("DESAINER").desain && !k("DESAINER").konten && !k("DESAINER").menunggu && !k("DESAINER").tindakLanjut, "DESAINER: kartu tugas desain selalu ada, tanpa Konten saya dan tanpa menunggu persetujuan (tidak punya hak setujui)");
  pastikan(!k("IKLAN").desain && !k("IKLAN").konten && !k("IKLAN").menunggu, "IKLAN (tanpa tugas-desain.ubah dan konten.ubah): tanpa ketiga kartu");
  pastikan(!k("ADMIN").desain && k("ADMIN", 1).desain && !k("ADMIN").konten && k("ADMIN").tindakLanjut && k("ADMIN").menunggu, "ADMIN: tugas desain hanya bila ditugasi, tindak lanjut dan menunggu persetujuan ada");
  pastikan(!k("PEMILIK").desain && k("PEMILIK", 3).desain && k("PEMILIK").konten && k("PEMILIK").menunggu, "PEMILIK: tugas desain hanya bila ditugasi");
  pastikan(kartuTugasSaya({ hak: ["tugas-desain.lihat", "tugas-desain.buat"] }, 5).desain === false, "tanpa tugas-desain.ubah tidak ada kartu tugas desain walau ada angka");
  pastikan(kartuTugasSaya({ hak: ["kas-masuk.setujui"] }, null).menunggu && !kartuTugasSaya({ hak: ["kas-masuk.lihat", "kas-masuk.buat"] }, null).menunggu, "menunggu persetujuan: cukup satu hak setujui; tanpa hak setujui tidak ada");
  pastikan(HAK_SETUJUI_TUGAS_SAYA.every((h) => h.endsWith(".setujui")) && new Set(HAK_SETUJUI_TUGAS_SAYA).size === HAK_SETUJUI_TUGAS_SAYA.length, "daftar hak setujui Tugas Saya hanya kunci setujui, tanpa ganda");
  pastikan(HAK_SETUJUI_TUGAS_SAYA.length === 11 && HAK_SETUJUI_TUGAS_SAYA.includes("konten.setujui") && HAK_SETUJUI_TUGAS_SAYA.includes("tugas-desain.setujui") && HAK_SETUJUI_TUGAS_SAYA.includes("penggajian.setujui"), "hak setujui Tugas Saya diturunkan dari baris penghitung menunggu persetujuan (11 baris)");

  console.log("=== 3. Sebelum data uji: panggilan lama = gabungan, gabungan = utama ===");
  const trenLama = await labaRugiKasBulanan(db, tahun);
  pastikan(json(trenLama) === json(await labaRugiKasBulanan(db, tahun, {})) && json(trenLama) === json(await labaRugiKasBulanan(db, tahun, { perusahaanId: null })), "labaRugiKasBulanan tanpa parameter = opsi kosong = perusahaanId null");
  const sinkronLama = await periksaSinkron(db);
  pastikan(json(sinkronLama) === json(await periksaSinkron(db, {})) && json(sinkronLama) === json(await periksaSinkron()), "periksaSinkron tanpa parameter = opsi kosong");
  const kasLama = await labaRugiKas(db, periode);
  const sinkronUtamaAwal = await periksaSinkron(db, { perusahaanId: "utama" });
  pastikan(json(sinkronUtamaAwal) === json(sinkronLama), "semua data lama milik utama: sinkron utama identik dengan gabungan");
  pastikan(json(ringkasTren(await labaRugiKasBulanan(db, tahun, { perusahaanId: "utama" }))) === json(ringkasTren(trenLama)), "tren kas utama identik dengan gabungan");
  const lrBulananLama = await hitungLabaRugiBulanan(db, tahun);

  console.log("=== Data uji keuangan dua perusahaan ===");
  const p1 = await db.perusahaan.create({ data: { kode: "UJL1", nama: "PT Uji Lingkup Satu", urutan: 98 } });
  const p2 = await db.perusahaan.create({ data: { kode: "UJL2", nama: "PT Uji Lingkup Dua", urutan: 99 } });
  const kosongP2 = await periksaSinkron(db, { perusahaanId: p2.id });
  pastikan(semuaCocok(kosongP2) && kosongP2.totalDebit.isZero() && kosongP2.persediaan.dokumen.isZero() && kosongP2.piutang.bukuBesar.isZero(), "perusahaan tanpa data: semua butir nol dan cocok (tidak merah palsu)");
  pastikan((await labaRugiKasBulanan(db, tahun, { perusahaanId: p2.id })).total.diterima.isZero(), "perusahaan tanpa data: tren kas nol");

  const idJurnalAwal = new Set((await db.jurnal.findMany({ select: { id: true } })).map((j) => j.id));
  const idLogAwal = new Set((await db.logAktivitas.findMany({ select: { id: true } })).map((l) => l.id));
  const gudang = await db.gudang.create({ data: { kode: "UJL-GDG", nama: "Gudang Uji Lingkup" } });
  const barang = await db.barang.create({ data: { kode: "UJL-BRG", nama: "Barang Uji Lingkup", jenis: "BARANG", hargaBeli: 0, hargaJual: 9000, perusahaanId: p1.id } });
  const jasa = await db.barang.create({ data: { kode: "UJL-JASA", nama: "Jasa Uji Lingkup", jenis: "JASA", hargaBeli: 0, hargaJual: 1000000, perusahaanId: p1.id } });
  const pelanggan = await db.pelanggan.create({ data: { kode: "UJL-CUST", nama: "Pelanggan Uji Lingkup" } });
  const kas1 = await db.akun.create({ data: { kode: "UJL-KAS1", nama: "Kas Uji Lingkup Satu", jenis: "ASET", kasBank: true } });
  const modal = await db.akun.create({ data: { kode: "UJL-MODAL", nama: "Modal Uji Lingkup", jenis: "MODAL" } });
  const beban = await db.akun.create({ data: { kode: "UJL-BEBAN", nama: "Beban Uji Lingkup", jenis: "BEBAN" } });
  const kasBersama = await db.akun.findFirstOrThrow({ where: { kasBank: true, kelompok: false, perusahaanId: null, NOT: { kode: { startsWith: "UJL" } } }, orderBy: { kode: "asc" } });

  await jalankan("PS saldo awal 10 @ 5.000", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, baris: [{ barangId: barang.id, jumlahSesudah: 10, hargaSatuan: 5000 }] })));
  await jalankan("PSJ jasa 1.000.000", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: jasa.id, jumlah: 1, harga: 1000000 }] })));
  const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id }, include: { baris: true } });
  await jalankan("FJ jasa 1.000.000", () => buatFaktur(formulir({ pesananId: psj.id, baris: [{ barangId: jasa.id, jumlah: 1, harga: 1000000 }] })));
  const fj = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id } });
  await jalankan("TRM 400.000 ke kas perusahaan satu", () => buatPenerimaan(formulir({ fakturId: fj.id, akunId: kas1.id, jumlah: 400000 })));
  await jalankan("KM setoran modal 300.000", () => buatKasMasuk(formulir({ akunKasId: kas1.id, akunLawanId: modal.id, jumlah: 300000, keterangan: "UJL setoran modal" })));
  await jalankan("KK beban 120.000 dari kas perusahaan satu", () => buatKasKeluar(formulir({ akunKasId: kas1.id, akunLawanId: beban.id, jumlah: 120000, keterangan: "UJL beban satu" })));
  await jalankan("KK beban 50.000 dari kas bersama", () => buatKasKeluar(formulir({ akunKasId: kasBersama.id, akunLawanId: beban.id, jumlah: 50000, keterangan: "UJL beban bersama" })));
  const ps = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { baris: { some: { barangId: barang.id } } } });
  const trm = await db.penerimaanPenjualan.findFirstOrThrow({ where: { fakturId: fj.id } });
  // tanpa alur persetujuan (bawaan skrip uji) kas masuk/keluar langsung menjadi jurnal; dokumen kas hanya ada bila alurnya menyala
  const dokKas = await db.dokumenKas.findMany({ where: { akunKasId: { in: [kas1.id, kasBersama.id] }, akunLawanId: { in: [modal.id, beban.id] } } });
  const jurnalBaru = (await db.jurnal.findMany({ select: { id: true, nomor: true, sumber: true } })).filter((j) => !idJurnalAwal.has(j.id));
  const jurnalKas = jurnalBaru.filter((j) => j.sumber === "KAS_MASUK" || j.sumber === "KAS_KELUAR");
  pastikan(jurnalBaru.length === 6 && jurnalKas.length === 3, `data uji membuat 6 jurnal (PS, FJ, TRM, KM, 2 KK) (${jurnalBaru.length}, kas ${jurnalKas.length})`);
  const fjAwal = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fj.id } });
  const sisaPiutang = D(fjAwal.total).minus(fjAwal.uangMuka).minus(400000);

  // pindahkan seluruh data uji ke perusahaan satu (aksi lama belum mengisi perusahaan, sama seperti isi-demo)
  const pindah = async (ke: string) =>
    db.$transaction(async (tx) => {
      await tx.penyesuaianPersediaan.update({ where: { id: ps.id }, data: { perusahaanId: ke } });
      await tx.pesananPenjualan.update({ where: { id: psj.id }, data: { perusahaanId: ke } });
      await tx.fakturPenjualan.update({ where: { id: fj.id }, data: { perusahaanId: ke } });
      await tx.penerimaanPenjualan.update({ where: { id: trm.id }, data: { perusahaanId: ke } });
      await tx.dokumenKas.updateMany({ where: { id: { in: dokKas.map((d) => d.id) } }, data: { perusahaanId: ke } });
      await tx.jurnal.updateMany({ where: { id: { in: jurnalBaru.map((j) => j.id) } }, data: { perusahaanId: ke } });
      await tx.akun.update({ where: { id: kas1.id }, data: { perusahaanId: ke === "utama" ? null : ke } });
    });
  await pindah(p1.id);
  console.log("[ok] data uji dipindah ke UJL1");

  console.log("=== 4. periksaSinkron per perusahaan (D1 §4.9) ===");
  const s1 = await periksaSinkron(db, { perusahaanId: p1.id });
  pastikan(semuaCocok(s1), "perusahaan satu: semua butir cocok");
  pastikan(s1.persediaan.bukuBesar.equals(D(50000)) && s1.persediaan.dokumen.equals(D(50000)), `persediaan perusahaan satu = 10 × 5.000 menurut pemilik barang (${s1.persediaan.bukuBesar}, ${s1.persediaan.dokumen})`);
  pastikan(s1.piutang.dokumen.equals(sisaPiutang) && s1.piutang.bukuBesar.equals(sisaPiutang), `piutang perusahaan satu = sisa faktur ${sisaPiutang}`);
  const debitBaru = (await db.barisJurnal.aggregate({ where: { jurnalId: { in: jurnalBaru.map((j) => j.id) } }, _sum: { debit: true } }))._sum.debit;
  pastikan(s1.totalDebit.equals(D(debitBaru ?? 0)) && s1.seimbang, "Σ debit perusahaan satu = jurnal perusahaan satu saja");
  const sU = await periksaSinkron(db, { perusahaanId: "utama" });
  pastikan(json(sU) === json(sinkronUtamaAwal), "utama tidak berubah oleh data perusahaan satu (identik dengan sebelum data uji)");
  const sG = await periksaSinkron(db);
  pastikan(semuaCocok(sG) && sG.totalDebit.equals(sU.totalDebit.plus(s1.totalDebit)), "gabungan cocok dan Σ debit = utama + perusahaan satu");
  pastikan(BUTIR.every((b) => sG[b].bukuBesar.equals(sU[b].bukuBesar.plus(s1[b].bukuBesar)) && sG[b].dokumen.equals(sU[b].dokumen.plus(s1[b].dokumen))), "setiap butir gabungan = utama + perusahaan satu");

  // ketidakcocokan per perusahaan: faktur pindah ke utama tetapi jurnalnya tetap di perusahaan satu
  await db.fakturPenjualan.update({ where: { id: fj.id }, data: { perusahaanId: "utama" } });
  const s1Salah = await periksaSinkron(db, { perusahaanId: p1.id });
  const sUSalah = await periksaSinkron(db, { perusahaanId: "utama" });
  const sGSalah = await periksaSinkron(db);
  pastikan(!s1Salah.piutang.sinkron && !sUSalah.piutang.sinkron && sGSalah.piutang.sinkron, "faktur dan jurnalnya beda perusahaan: piutang tiap perusahaan tidak cocok, gabungan tetap cocok");
  pastikan(s1Salah.persediaan.sinkron && sUSalah.persediaan.sinkron, "butir lain tidak ikut merah");
  await db.fakturPenjualan.update({ where: { id: fj.id }, data: { perusahaanId: p1.id } });
  pastikan(semuaCocok(await periksaSinkron(db, { perusahaanId: p1.id })), "faktur dikembalikan: perusahaan satu cocok lagi");

  console.log("=== 5. Tren kas dan laporan per perusahaan (D1 §4.6, §4.8) ===");
  const bulanIni = new Date().getMonth();
  const t1 = await labaRugiKasBulanan(db, tahun, { perusahaanId: p1.id });
  const tU = await labaRugiKasBulanan(db, tahun, { perusahaanId: "utama" });
  const tG = await labaRugiKasBulanan(db, tahun);
  pastikan(t1.bulan[bulanIni].diterima.equals(D(400000)) && t1.bulan[bulanIni].dikeluarkan.equals(D(170000)), `perusahaan satu bulan ini: masuk 400.000 dari pelanggan (setoran modal bukan operasi), keluar 120.000 + 50.000 termasuk dari kas bersama (${t1.bulan[bulanIni].diterima}, ${t1.bulan[bulanIni].dikeluarkan})`);
  pastikan(t1.total.diterima.equals(D(400000)) && t1.total.dikeluarkan.equals(D(170000)), "perusahaan satu: tanpa data utama");
  pastikan(json(ringkasTren(tU)) === json(ringkasTren(trenLama)), "tren utama identik dengan sebelum data uji");
  pastikan(json(jumlahTren(tU, t1)) === json(ringkasTren(tG)), "tren gabungan = utama + perusahaan satu tiap bulan");
  pastikan(json(tG) === json(await labaRugiKasBulanan(db, tahun, {})), "panggilan lama tetap gabungan");
  const k1 = await labaRugiKas(db, periode, { perusahaanId: p1.id });
  const kU = await labaRugiKas(db, periode, { perusahaanId: "utama" });
  const kG = await labaRugiKas(db, periode);
  pastikan(k1.totalPendapatan.plus(k1.ppnTitipan).equals(D(400000)) && k1.totalPengeluaran.equals(D(170000)) && k1.perPelanggan.length === 1 && k1.perPelanggan[0].kode === "UJL-CUST", "labaRugiKas perusahaan satu: penerimaan pelanggan uji saja");
  pastikan(json(kU) === json(kasLama), "labaRugiKas utama identik dengan gabungan sebelum data uji");
  pastikan(kG.surplus.equals(kU.surplus.plus(k1.surplus)) && kG.totalPengeluaran.equals(kU.totalPengeluaran.plus(k1.totalPengeluaran)), "labaRugiKas gabungan = utama + perusahaan satu");
  const lr1 = await hitungLabaRugiBulanan(db, tahun, { perusahaanId: p1.id });
  const lrU = await hitungLabaRugiBulanan(db, tahun, { perusahaanId: "utama" });
  const lrG = await hitungLabaRugiBulanan(db, tahun);
  pastikan(lr1.total.pendapatan.equals(D(fjAwal.dpp)) && lrU.total.labaBersih.equals(lrBulananLama.total.labaBersih) && lrG.total.labaBersih.equals(lrU.total.labaBersih.plus(lr1.total.labaBersih)), "hitungLabaRugiBulanan per perusahaan: satu = DPP faktur uji, utama tetap, gabungan = jumlah");
  const saldo1 = await saldoAkunPeriode(db, periode.dari, periode.sampai, false, { perusahaanId: p1.id });
  pastikan(saldo1.find((a) => a.id === kas1.id)!.saldo.equals(D(580000)) && saldo1.find((a) => a.id === kasBersama.id)!.saldo.equals(D(-50000)), "saldoAkunPeriode perusahaan satu: kas sendiri 580.000, kas bersama -50.000 (hanya jurnal perusahaan satu)");

  console.log("=== 6. Halaman beranda per lingkup ===");
  const muat = (peran: string, perusahaan: string | undefined) => denganEnv({ UJI_PERAN: peran, UJI_PERUSAHAAN: perusahaan, UJI_PENGGUNA: undefined }, () => render(Beranda({ searchParams: Promise.resolve({ tab: "keuangan" }) })));
  const hal1 = await muat("PEMILIK", p1.id);
  pastikan(hal1.teks.includes("Tren Kas Masuk & Keluar") && !hal1.teks.includes("belum tersedia"), "lingkup perusahaan satu: tren kas tampil walau perusahaan lain punya data");
  pastikan(hal1.grafik.length === 1 && json(hal1.grafik[0].bulan.map((m) => [String(m.pendapatan), String(m.bebanPokok)])) === json(t1.bulan.map((m) => [String(m.diterima), String(m.dikeluarkan)])), "grafik tren lingkup satu = labaRugiKasBulanan perusahaan satu");
  const integritas1 = potong(hal1.teks, "Integritas & Sinkronisasi", "PostgreSQL 18");
  pastikan(integritas1.includes("PT Uji Lingkup Satu") && integritas1.includes("Jurnal seimbang") && integritas1.includes("stok Rp 50.000") && integritas1.includes(`dokumen Rp ${Number(sisaPiutang).toLocaleString("id-ID")}`), "Integritas lingkup satu: angka perusahaan satu (stok 50.000, piutang sisa faktur)");
  const kartuKas1 = potong(hal1.teks, "Kas & Bank Tersedia", "Nilai Persediaan");
  pastikan(kartuKas1.includes("Kas Uji Lingkup Satu + ") && !kartuKas1.includes(" + Kas Uji Lingkup Satu"), "Kas & Bank lingkup satu: rekening milik perusahaan satu disebut pertama");
  pastikan(kartuKas1.includes("Kas Uji Lingkup SatuRp 580.000"), "rincian Kas & Bank baris pertama: Kas Uji Lingkup Satu Rp 580.000");
  const halU = await muat("PEMILIK", "utama");
  pastikan(!halU.teks.includes("Kas Uji Lingkup Satu"), "lingkup utama: rekening milik perusahaan satu tidak tampil");
  const halG = await muat("PEMILIK", "semua");
  const kartuKasG = potong(halG.teks, "Kas & Bank Tersedia", "Nilai Persediaan");
  pastikan(kartuKasG.includes(" + Kas Uji Lingkup Satu") && !kartuKasG.includes("Kas Uji Lingkup Satu + "), "gabungan: semua rekening, urutan kode akun seperti sebelum perbaikan (UJL-KAS1 di belakang akun 1-xxxx)");
  pastikan(halG.grafik.length === 1 && json(halG.grafik[0].bulan.map((m) => String(m.pendapatan))) === json(tG.bulan.map((m) => String(m.diterima))), "gabungan: grafik tren = labaRugiKasBulanan tanpa parameter");
  const integritasG = potong(halG.teks, "Integritas & Sinkronisasi", "PostgreSQL 18");
  pastikan(integritasG.includes("Buku besar dicocokkan dengan dokumen dan stok fisik") && integritasG.includes(`stok Rp ${Number(sG.persediaan.dokumen).toLocaleString("id-ID")}`), "gabungan: kalimat dan angka Integritas seperti sebelum perbaikan");
  const halKasir = await muat("KASIR", undefined);
  pastikan(halKasir.teks.includes("Jurnal seimbang") && halKasir.teks.includes("Persediaan = stok fisik") && !halKasir.teks.includes("belum tersedia"), "KASIR (lingkup utama, perusahaan lain punya data): Integritas tetap tampil dengan angka utama");
  const namaUtama = (await db.perusahaan.findUniqueOrThrow({ where: { id: "utama" }, select: { nama: true } })).nama;
  pastikan(potong(halKasir.teks, "Integritas & Sinkronisasi", "PostgreSQL 18").includes(`Buku besar ${namaUtama} dicocokkan`), "KASIR dengan beberapa perusahaan aktif: kalimat Integritas menyebut perusahaan lingkupnya");
  // KASIR di instalasi satu perusahaan: perusahaan aktif lain dinonaktifkan sementara lewat SQL (diubahPada tidak tersentuh),
  // lalu dipulihkan di finally sebelum pemeriksaan (pastikan menghentikan proses bila gagal)
  const aktifLain = (await db.perusahaan.findMany({ where: { aktif: true, id: { not: "utama" } }, select: { id: true } })).map((p) => p.id);
  let halKasirSatu: Awaited<ReturnType<typeof muat>> | null = null;
  // Prisma.join menolak daftar kosong; tanpa perusahaan aktif lain, instalasi sudah satu perusahaan sehingga UPDATE dilewati
  if (aktifLain.length > 0) await db.$executeRaw`UPDATE "Perusahaan" SET "aktif" = false WHERE "id" IN (${Prisma.join(aktifLain)})`;
  try {
    halKasirSatu = await muat("KASIR", undefined);
  } finally {
    if (aktifLain.length > 0) await db.$executeRaw`UPDATE "Perusahaan" SET "aktif" = true WHERE "id" IN (${Prisma.join(aktifLain)})`;
  }
  pastikan((await db.perusahaan.count({ where: { id: { in: aktifLain }, aktif: true } })) === aktifLain.length, `perusahaan yang dinonaktifkan sementara sudah aktif lagi (${aktifLain.length})`);
  const integritasSatu = potong(halKasirSatu!.teks, "Integritas & Sinkronisasi", "PostgreSQL 18");
  pastikan(integritasSatu.includes(KALIMAT_INTEGRITAS_LAMA) && !integritasSatu.includes(`Buku besar ${namaUtama}`) && integritasSatu.includes("Jurnal seimbang"), "KASIR dengan satu perusahaan aktif: kalimat Integritas lama seperti sebelum peleburan");
  pastikan(potong(halG.teks, "Integritas & Sinkronisasi", "PostgreSQL 18").includes(KALIMAT_INTEGRITAS_LAMA), "gabungan tetap memakai kalimat lama");
  // Tren kas sejak sebelum multi perusahaan dijaga buku-besar.lihat; KASIR bawaan tidak memegangnya, jadi tetap tanpa tren
  const kasirBukuBesar = hitungHak("KASIR").includes("buku-besar.lihat");
  pastikan(halKasir.teks.includes("Tren Kas Masuk & Keluar") === kasirBukuBesar, `KASIR: tren kas mengikuti hak buku-besar.lihat (${kasirBukuBesar ? "punya" : "tidak punya"}), bukan data perusahaan lain`);
  const halAdmin = await muat("ADMIN", "utama");
  pastikan(halAdmin.teks.includes("Tren Kas Masuk & Keluar") && halAdmin.grafik.length === 1 && json(halAdmin.grafik[0].bulan.map((m) => String(m.pendapatan))) === json(tU.bulan.map((m) => String(m.diterima))), "ADMIN lingkup utama (perusahaan lain punya data): tren kas tampil dengan angka utama saja");
  pastikan(!halKasir.teks.includes("Kas Uji Lingkup Satu"), "KASIR tidak melihat rekening perusahaan lain");
  const namaKasBersama = (await db.akun.findMany({ where: { kasBank: true, kelompok: false, perusahaanId: null }, orderBy: { kode: "asc" }, select: { nama: true } })).map((a) => a.nama).join(" + ");
  pastikan(potong(halKasir.teks, "Kas & Bank Tersedia", "Nilai Persediaan").includes(namaKasBersama) && kartuKasG.includes(`${namaKasBersama} + Kas Uji Lingkup Satu`), `KASIR (lingkup utama tanpa akun sendiri): rincian Kas & Bank urut kode akun seperti gabungan, tidak menurut saldo (${namaKasBersama})`);
  const halSosmed = (await denganEnv({ UJI_PERAN: "SOSMED", UJI_PERUSAHAAN: p1.id }, () => Beranda({ searchParams: Promise.resolve({ tab: "keuangan" }) }))) as ReactElement;
  pastikan(halSosmed.type === DasborModul, "SOSMED tanpa beranda-keuangan.lihat: tidak mendapat tab keuangan (tren dan Integritas tidak dimuat)");

  console.log("=== 6b. Butir Integritas lain per perusahaan: hutang, barang belum ditagih, barang terkirim, uang muka ===");
  const pemasok = await db.pemasok.create({ data: { kode: "UJL-SUP", nama: "Pemasok Uji Lingkup" } });
  const idJurnalSebelumLain = new Set((await db.jurnal.findMany({ select: { id: true } })).map((j) => j.id));
  await jalankan("PSB barang 10 @ 6.000", () => buatPesananPembelian(formulir({ pemasokId: pemasok.id, baris: [{ barangId: barang.id, jumlah: 10, harga: 6000 }] })));
  const psb = await db.pesananPembelian.findFirstOrThrow({ where: { pemasokId: pemasok.id }, include: { baris: true } });
  await jalankan("TB sebagian 4 dari 10", () => buatPenerimaanBarang(formulir({ pesananId: psb.id, gudangId: gudang.id, baris: [{ barisPesananId: psb.baris[0].id, barangId: barang.id, jumlah: 4 }] })));
  const tb = await db.penerimaanBarang.findFirstOrThrow({ where: { pesananId: psb.id } });
  await jalankan("FB 2 dari 4 yang diterima", () => buatFakturPembelian(formulir({ pesananId: psb.id, baris: [{ barangId: barang.id, jumlah: 2, harga: 6000 }] })));
  const fb = await db.fakturPembelian.findFirstOrThrow({ where: { pesananId: psb.id } });
  await jalankan("PSJ barang 5 @ 9.000", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: barang.id, jumlah: 5, harga: 9000 }] })));
  const psj2 = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id, NOT: { id: psj.id } }, include: { baris: true } });
  await jalankan("SJ 3 dari 5, belum difaktur", () => buatPengiriman(formulir({ pesananId: psj2.id, gudangId: gudang.id, baris: [{ barisPesananId: psj2.baris[0].id, barangId: barang.id, jumlah: 3 }] })));
  const sj = await db.pengirimanPesanan.findFirstOrThrow({ where: { pesananId: psj2.id }, include: { baris: true } });
  await jalankan("UM 25.000 ke kas perusahaan satu", () => buatUangMuka(formulir({ pesananId: psj2.id, akunId: kas1.id, jumlah: 25000 })));
  const um = await db.uangMukaPelanggan.findFirstOrThrow({ where: { pesananId: psj2.id } });
  const jurnalLain = (await db.jurnal.findMany({ select: { id: true, nomor: true } })).filter((j) => !idJurnalSebelumLain.has(j.id));
  pastikan(jurnalLain.length === 4, `TB, FB, SJ, dan UM masing-masing satu jurnal (${jurnalLain.length})`);
  const pindahLain = async (ke: string) =>
    db.$transaction(async (tx) => {
      await tx.pesananPembelian.update({ where: { id: psb.id }, data: { perusahaanId: ke } });
      await tx.penerimaanBarang.update({ where: { id: tb.id }, data: { perusahaanId: ke } });
      await tx.fakturPembelian.update({ where: { id: fb.id }, data: { perusahaanId: ke } });
      await tx.pesananPenjualan.update({ where: { id: psj2.id }, data: { perusahaanId: ke } });
      await tx.pengirimanPesanan.update({ where: { id: sj.id }, data: { perusahaanId: ke } });
      await tx.uangMukaPelanggan.update({ where: { id: um.id }, data: { perusahaanId: ke } });
      await tx.jurnal.updateMany({ where: { id: { in: jurnalLain.map((j) => j.id) } }, data: { perusahaanId: ke } });
    });
  await pindahLain(p1.id);
  const s1b = await periksaSinkron(db, { perusahaanId: p1.id });
  pastikan(semuaCocok(s1b), "perusahaan satu dengan pembelian, surat jalan, dan uang muka: semua butir cocok");
  pastikan(BUTIR.every((b) => !s1b[b].dokumen.isZero() && !s1b[b].bukuBesar.isZero()), `setiap butir perusahaan satu bukan nol (${BUTIR.map((b) => `${b} ${s1b[b].dokumen}`).join(", ")})`);
  pastikan(s1b.barangBelumDitagih.dokumen.equals(D(12000)), `barang belum ditagih perusahaan satu = (4 diterima - 2 difaktur) × 6.000 (${s1b.barangBelumDitagih.dokumen})`);
  pastikan(s1b.hutang.dokumen.equals(D(fb.total)), `hutang perusahaan satu = total FB ${fb.total}`);
  pastikan(s1b.barangTerkirim.dokumen.equals(D(sj.baris[0].hargaPokok).times(3)), `barang terkirim perusahaan satu = 3 × harga pokok saat kirim (${s1b.barangTerkirim.dokumen})`);
  pastikan(s1b.uangMuka.dokumen.equals(D(25000)), "uang muka perusahaan satu = 25.000");
  const sUb = await periksaSinkron(db, { perusahaanId: "utama" });
  pastikan(json(sUb) === json(sinkronUtamaAwal), "utama tetap identik dengan sebelum data uji");
  const sGb = await periksaSinkron(db);
  pastikan(semuaCocok(sGb) && BUTIR.every((b) => sGb[b].bukuBesar.equals(sUb[b].bukuBesar.plus(s1b[b].bukuBesar)) && sGb[b].dokumen.equals(sUb[b].dokumen.plus(s1b[b].dokumen))), "gabungan cocok dan setiap butir = utama + perusahaan satu");
  pastikan(semuaCocok(await periksaSinkron(db, { perusahaanId: p2.id })), "perusahaan dua tetap kosong dan cocok");
  // pesanan pembelian di perusahaan lain dengan penerimaan tetap di perusahaan satu: barang belum ditagih tiap perusahaan tidak cocok
  await db.pesananPembelian.update({ where: { id: psb.id }, data: { perusahaanId: "utama" } });
  const s1bSalah = await periksaSinkron(db, { perusahaanId: p1.id });
  pastikan(!s1bSalah.barangBelumDitagih.sinkron && s1bSalah.persediaan.sinkron && s1bSalah.hutang.sinkron, "PSB pindah perusahaan: barang belum ditagih perusahaan satu tidak cocok, butir lain tetap cocok");
  await db.pesananPembelian.update({ where: { id: psb.id }, data: { perusahaanId: p1.id } });
  await db.uangMukaPelanggan.update({ where: { id: um.id }, data: { perusahaanId: "utama" } });
  const s1bUm = await periksaSinkron(db, { perusahaanId: p1.id });
  pastikan(!s1bUm.uangMuka.sinkron && s1bUm.piutang.sinkron, "UM pindah perusahaan tanpa jurnalnya: uang muka perusahaan satu tidak cocok");
  await db.uangMukaPelanggan.update({ where: { id: um.id }, data: { perusahaanId: p1.id } });
  pastikan(semuaCocok(await periksaSinkron(db, { perusahaanId: p1.id })), "dokumen dikembalikan: perusahaan satu cocok lagi");

  console.log("=== 7. Tugas Saya: Konten saya dan kartu per hak ===");
  const uS = await db.pengguna.create({ data: { namaPengguna: `${PREFIKS}s`, nama: "Uji Lingkup Sosmed", peran: "SOSMED", kataSandiHash: "-" } });
  const uD = await db.pengguna.create({ data: { namaPengguna: `${PREFIKS}d`, nama: "Uji Lingkup Desainer", peran: "DESAINER", kataSandiHash: "-" } });
  const uA = await db.pengguna.create({ data: { namaPengguna: `${PREFIKS}a`, nama: "Uji Lingkup Admin", peran: "ADMIN", kataSandiHash: "-" } });
  const konten = (perusahaanId: string, judul: string, status: string, n: number | null, lain: { persetujuan?: string; smm?: string | null; pembuat?: string; arsip?: boolean } = {}) =>
    db.konten.create({
      data: {
        perusahaanId, judul, status: status as never, platform: "INSTAGRAM", dibuatOlehNama: "Skrip Uji",
        tanggalTerbit: n === null ? null : hari(n), statusPersetujuan: (lain.persetujuan ?? "TIDAK_ADA") as never,
        smmId: lain.smm === undefined ? uS.id : lain.smm, dibuatOlehId: lain.pembuat ?? null, diarsipkanPada: lain.arsip ? new Date() : null,
      },
    });
  const kDitolak = await konten(p1.id, "UJL Ditolak", "DRAF", null, { persetujuan: "DITOLAK" });
  const kRevisi = await konten(p1.id, "UJL Revisi desain", "DESAIN", null);
  const kSiap = await konten(p1.id, "UJL Desain siap", "DESAIN", null);
  const kTerbit = await konten(p1.id, "UJL Akan terbit", "TERJADWAL", 3, { persetujuan: "DISETUJUI" });
  const kIde = await konten(p1.id, "UJL Ide", "IDE", null);
  const kLewat = await konten(p1.id, "UJL Lewat terbit", "TERJADWAL", -2, { persetujuan: "DISETUJUI" });
  const kTanpaTanggal = await konten(p1.id, "UJL Belum dijadwalkan", "DISETUJUI", null, { persetujuan: "DISETUJUI" });
  await konten(p1.id, "UJL Terbit lalu", "TERBIT", -5, { persetujuan: "DISETUJUI" });
  await konten(p1.id, "UJL Menunggu", "DITINJAU", null, { persetujuan: "MENUNGGU" });
  await konten(p1.id, "UJL Sudah terbit", "TERBIT", 2, { persetujuan: "DISETUJUI" });
  await konten(p1.id, "UJL Jauh", "TERJADWAL", 20, { persetujuan: "DISETUJUI" });
  await konten(p1.id, "UJL Orang lain", "DRAF", null, { smm: uD.id });
  await konten(p1.id, "UJL Arsip", "IDE", null, { arsip: true });
  const kBuatan = await konten(p1.id, "UJL Buatan sendiri", "DRAF", null, { smm: null, pembuat: uS.id });
  const kDua = await konten(p2.id, "UJL Perusahaan dua", "IDE", null);
  const tugas = (kontenId: string | null, judul: string, status: string, desainerId: string | null) =>
    db.tugasDesain.create({ data: { perusahaanId: p1.id, judul, status: status as never, desainerId, kontenId, kunciKontenAktif: kontenId, dibuatOlehNama: "Skrip Uji" } });
  await tugas(kRevisi.id, "UJL Tugas revisi", "REVISI", uD.id);
  await tugas(kSiap.id, "UJL Tugas selesai", "SELESAI", uD.id);

  const ks1 = await kontenSaya(db, uS.id, p1.id);
  pastikan(
    sama(ks1.baris.map((x) => x.id), [kDitolak.id, kLewat.id, kRevisi.id, kSiap.id, kTerbit.id, kTanpaTanggal.id, kBuatan.id, kIde.id]),
    `Konten saya lingkup satu: ditolak, lewat tanggal terbit, revisi desain, desain siap, akan terbit, disetujui tanpa tanggal, lalu ide/draf; tanpa menunggu, sudah terbit, jauh, milik orang lain, arsip, perusahaan lain (${ks1.baris.map((x) => x.judul).join(", ")})`,
  );
  pastikan(ks1.total === 8 && ks1.baris[2].statusDesain === "REVISI" && sama(ks1.baris[0].alasan, ["DITOLAK", "BELUM_SELESAI"]) && sama(ks1.baris[1].alasan, ["LEWAT_TERBIT"]), "total 8, status desain dan alasan terbaca");
  const ksG = await kontenSaya(db, uS.id, null);
  pastikan(ksG.total === 9 && ksG.baris.some((x) => x.id === kDua.id), "Konten saya gabungan memuat konten perusahaan dua");
  pastikan((await kontenSaya(db, uS.id, p1.id, 2)).baris.length === 2 && (await kontenSaya(db, uS.id, p1.id, 2)).total === 8, "batas baris tidak mengubah total");
  pastikan((await kontenSaya(db, uD.id, p1.id)).total === 1, "pengguna lain hanya melihat konten yang ia tangani");

  const sosmed = (await sebagai(`${PREFIKS}s`, async () => (await import("../src/lib/otentikasi")).penggunaSaatIni()))!;
  const desainer = (await sebagai(`${PREFIKS}d`, async () => (await import("../src/lib/otentikasi")).penggunaSaatIni()))!;
  const admin = (await sebagai(`${PREFIKS}a`, async () => (await import("../src/lib/otentikasi")).penggunaSaatIni()))!;
  pastikan(sosmed.id === uS.id && desainer.id === uD.id && admin.id === uA.id, "pengguna nyata terbaca lewat UJI_PENGGUNA");
  const sayaS = await render(PanelSaya({ pengguna: sosmed, perusahaanId: p1.id }));
  pastikan(sayaS.teks.includes("Konten saya") && sayaS.teks.includes("UJL Ditolak") && sayaS.teks.includes("Desain direvisi") && sayaS.teks.includes("Desain siap, ajukan") && sayaS.teks.includes("Terbit "), "SOSMED: kartu Konten saya dengan alasan dan tanggal terbit");
  pastikan(!sayaS.teks.includes("UJL Menunggu") && !sayaS.teks.includes("UJL Orang lain") && !sayaS.teks.includes("UJL Perusahaan dua") && !sayaS.teks.includes("UJL Terbit lalu"), "SOSMED lingkup satu: tanpa konten menunggu penyetuju, milik orang lain, perusahaan lain, dan yang sudah terbit");
  pastikan(sayaS.teks.includes("UJL Lewat terbit") && sayaS.teks.includes("Lewat tanggal terbit") && sayaS.teks.includes("Perlu dijadwalkan"), "SOSMED: konten lewat tanggal terbit dan disetujui tanpa tanggal tampil dengan lencananya");
  const hanyaKonten = await menungguPersetujuanSaya(penggunaSintetis("IKLAN", ["konten.setujui"]), p1.id);
  pastikan(json(hanyaKonten) === json([{ kode: "konten", label: "Konten media sosial", jumlah: 1 }]), "pemegang konten.setujui saja: baris menunggu konten (kartu dan penghitung memakai daftar hak yang sama)");
  pastikan((await menungguPersetujuanSaya(penggunaSintetis("IKLAN", ["konten.lihat", "konten.ubah"]), p1.id)).length === 0, "tanpa hak setujui: tidak ada baris menunggu");
  pastikan(!sayaS.teks.includes("Tugas desain saya") && sayaS.teks.includes("Menunggu persetujuan Anda"), "SOSMED tanpa tugas yang ditugaskan: tanpa kartu tugas desain kosong, dengan kartu menunggu persetujuan");
  pastikan(sayaS.href.length === 0, "kartu Tugas Saya SOSMED tidak menaut ke halaman yang belum ada");
  await db.tugasDesain.create({ data: { perusahaanId: p1.id, judul: "UJL Tugas untuk sosmed", status: "DITUGASKAN", desainerId: uS.id, dibuatOlehNama: "Skrip Uji" } });
  pastikan((await render(PanelSaya({ pengguna: sosmed, perusahaanId: p1.id }))).teks.includes("UJL Tugas untuk sosmed"), "SOSMED yang ditugasi desain: kartu tugas desain muncul");
  const sayaD = await render(PanelSaya({ pengguna: desainer, perusahaanId: p2.id }));
  pastikan(sayaD.teks.includes("Tugas desain saya") && sayaD.teks.includes("Tidak ada tugas desain aktif.") && !sayaD.teks.includes("Menunggu persetujuan Anda") && !sayaD.teks.includes("Konten saya"), "DESAINER: kartu tugas desain walau kosong, tanpa menunggu persetujuan dan Konten saya");
  const sayaI = await render(PanelSaya({ pengguna: penggunaSintetis("IKLAN"), perusahaanId: null }));
  pastikan(sayaI.teks.includes("Tidak ada tugas untuk Anda saat ini.") && !sayaI.teks.includes("Menunggu persetujuan Anda"), "tanpa satu pun kartu relevan: pesan kosong");

  // SMM dengan 10 konten menunggu penyetuju bertanggal dekat dan satu ide tanpa tanggal: idenya tetap di 10 baris pertama
  const uS2 = await db.pengguna.create({ data: { namaPengguna: `${PREFIKS}s2`, nama: "Uji Lingkup Sosmed Dua", peran: "SOSMED", kataSandiHash: "-" } });
  for (let i = 1; i <= 10; i++) await konten(p1.id, `UJL Tinjau ${String(i).padStart(2, "0")}`, "DITINJAU", i, { persetujuan: "MENUNGGU", smm: uS2.id });
  const kIdeS2 = await konten(p1.id, "UJL Ide tanpa tanggal", "IDE", null, { smm: uS2.id });
  const ksMenunggu = await kontenSaya(db, uS2.id, p1.id);
  pastikan(ksMenunggu.total === 11 && ksMenunggu.baris.length === 10 && ksMenunggu.baris[0].id === kIdeS2.id, `10 konten menunggu penyetuju + 1 ide: ide tanpa tanggal tetap di 10 baris pertama, paling atas (${ksMenunggu.baris.map((x) => x.judul).join(", ")})`);
  pastikan(ksMenunggu.baris.slice(1).every((x) => x.statusPersetujuan === "MENUNGGU") && ksMenunggu.baris[1].judul === "UJL Tinjau 01", "yang menunggu penyetuju menyusul sesudah ide/draf, urut tanggal terbit");
  const sosmed2 = (await sebagai(`${PREFIKS}s2`, async () => (await import("../src/lib/otentikasi")).penggunaSaatIni()))!;
  const sayaS2 = await render(PanelSaya({ pengguna: sosmed2, perusahaanId: p1.id }));
  const kartuKontenS2 = potong(sayaS2.teks, "Konten saya", "Menunggu persetujuan Anda");
  pastikan(kartuKontenS2.includes("UJL Ide tanpa tanggal") && (kartuKontenS2.match(/Menunggu persetujuan/g) ?? []).length === 9, "kartu Konten saya: ide tampil, dan 9 konten menunggu yang tampil berlencana Menunggu persetujuan");
  pastikan(!potong(sayaS.teks, "Konten saya", "Menunggu persetujuan Anda").includes("Menunggu persetujuan"), "konten tanpa persetujuan menunggu tidak berlencana Menunggu persetujuan");

  console.log("=== 8. Tindak lanjut CRM dengan lencana perusahaan di gabungan ===");
  await db.tindakLanjut.create({ data: { perusahaanId: p1.id, judul: "UJL Telepon klien satu", jatuhTempo: hari(1), ditugaskanKeId: uA.id, dibuatOlehNama: "Skrip Uji" } });
  await db.tindakLanjut.create({ data: { perusahaanId: p2.id, judul: "UJL Telepon klien dua", jatuhTempo: hari(2), ditugaskanKeId: uA.id, dibuatOlehNama: "Skrip Uji" } });
  const crmG = await render(PanelCrmBeranda({ pengguna: admin, perusahaanId: null }));
  const daftarG = potong(crmG.teks, "Tindak lanjut saya", "Sumber lead");
  pastikan(daftarG.includes("UJL Telepon klien satu") && daftarG.includes("UJL1") && daftarG.includes("UJL2"), "gabungan: tiap tindak lanjut berlencana perusahaannya");
  const crm1 = await render(PanelCrmBeranda({ pengguna: admin, perusahaanId: p1.id }));
  const daftar1 = potong(crm1.teks, "Tindak lanjut saya", "Sumber lead");
  pastikan(daftar1.includes("UJL Telepon klien satu") && !daftar1.includes("UJL Telepon klien dua") && !daftar1.includes("UJL1"), "lingkup satu: hanya tindak lanjut perusahaan itu, tanpa lencana");
  pastikan((await PanelCrmBeranda({ pengguna: sosmed, perusahaanId: null })) === null, "tanpa lead.lihat: panel CRM tidak dirender");

  console.log("=== 9. Kolom Keuangan Proyek ===");
  const proyek = await render(PanelProyek({ pengguna: penggunaSintetis("PEMILIK"), perusahaanId: p1.id }));
  pastikan(proyek.teks.includes("Margin kas (Rp)") && proyek.teks.includes("Biaya aktual (Rp)"), "judul kolom uang Keuangan Proyek bertanda (Rp)");

  console.log("=== Bersih-bersih ===");
  await db.tindakLanjut.deleteMany({ where: { perusahaanId: { in: [p1.id, p2.id] } } });
  await db.tugasDesain.deleteMany({ where: { perusahaanId: { in: [p1.id, p2.id] } } });
  await db.konten.deleteMany({ where: { perusahaanId: { in: [p1.id, p2.id] } } });
  await db.pengguna.deleteMany({ where: { namaPengguna: { startsWith: PREFIKS } } });
  await pindahLain("utama");
  await pindah("utama");
  const nomorDok = [
    ps.nomor, psj.nomor, fj.nomor, trm.nomor, ...dokKas.map((d) => d.nomor), ...jurnalBaru.map((j) => j.nomor),
    psb.nomor, tb.nomor, fb.nomor, psj2.nomor, sj.nomor, um.nomor, ...jurnalLain.map((j) => j.nomor),
  ];
  await jalankan("hapus UM", () => hapusDokumen("uangMuka", um.id));
  await jalankan("hapus SJ", () => hapusDokumen("pengiriman", sj.id));
  await jalankan("hapus PSJ barang", () => hapusDokumen("pesanan", psj2.id));
  await jalankan("hapus FB", () => hapusDokumen("fakturPembelian", fb.id));
  await jalankan("hapus TB", () => hapusDokumen("penerimaanBarang", tb.id));
  await jalankan("hapus PSB", () => hapusDokumen("pesananPembelian", psb.id));
  for (const d of dokKas) await jalankan(`hapus ${d.nomor}`, () => hapusDokumen("dokumenKas", d.id));
  for (const j of jurnalKas) if (await db.jurnal.findUnique({ where: { id: j.id } })) await jalankan(`hapus ${j.nomor}`, () => hapusDokumen("jurnal", j.id));
  await jalankan("hapus TRM", () => hapusDokumen("penerimaan", trm.id));
  await jalankan("hapus FJ", () => hapusDokumen("faktur", fj.id));
  await jalankan("hapus PSJ", () => hapusDokumen("pesanan", psj.id));
  await jalankan("hapus PS", () => hapusDokumen("penyesuaian", ps.id));
  pastikan((await db.jurnal.count({ where: { id: { in: [...jurnalBaru, ...jurnalLain].map((j) => j.id) } } })) === 0, "jurnal uji sudah terhapus");
  await db.stokBarang.deleteMany({ where: { barangId: barang.id } });
  await db.barang.deleteMany({ where: { id: { in: [barang.id, jasa.id] } } });
  await db.gudang.delete({ where: { id: gudang.id } });
  await db.pelanggan.delete({ where: { id: pelanggan.id } });
  await db.pemasok.delete({ where: { id: pemasok.id } });
  await db.akun.deleteMany({ where: { id: { in: [kas1.id, modal.id, beban.id] } } });
  const logUji = await db.logAktivitas.findMany({ where: { nomor: { in: nomorDok } }, select: { id: true } });
  await db.logAktivitas.deleteMany({ where: { id: { in: logUji.map((l) => l.id).filter((id) => !idLogAwal.has(id)) } } });
  await db.perusahaan.deleteMany({ where: { id: { in: [p1.id, p2.id] } } });
  pastikan(json(await periksaSinkron(db)) === json(sinkronLama), "setelah bersih: periksaSinkron gabungan identik dengan awal");
  pastikan(json(await labaRugiKasBulanan(db, tahun)) === json(trenLama), "setelah bersih: tren kas gabungan identik dengan awal");
  console.log("=== DONE, all beranda lingkup checks passed ===");
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("TEST FAILED", err);
    await bersihkanDataUji().catch(() => undefined);
    process.exit(1);
  });
