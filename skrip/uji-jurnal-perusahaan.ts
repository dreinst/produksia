import "dotenv/config";
// Skrip ini memanggil pustaka dan aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import type { Prisma } from "../src/prisma-klien/client";
import { D } from "../src/lib/uang";
import { PERUSAHAAN_UTAMA } from "../src/lib/perusahaan";
import { BAGAN_AKUN_STANDAR } from "../src/lib/baganAkunStandar";
import { JASA_FLAGSHIP_STANDAR, terapkanDataFlagship } from "../src/lib/flagshipStandar";
import {
  catatJurnal,
  catatJurnalPenyesuaianPersediaan,
  catatJurnalReturPembelian,
  catatJurnalReturPenjualan,
  catatJurnalUangMuka,
  type OpsiJurnalPerusahaan,
} from "../src/lib/akuntansi";
import { BERKAS } from "../src/lib/persetujuan";
import { hitungRevaluasi, jalankanRevaluasi } from "../src/lib/selisihKurs";
import { periksaSinkron } from "../src/lib/sinkron";
import { buatAsetTetap, jalankanPenyusutanBulanan, lepasAset } from "../src/lib/aksi/asetTetap";
import { jalankanPenilaianKurs } from "../src/lib/aksi/mataUang";
import { buatPenggajian } from "../src/lib/aksi/sdm";
import { ubahStokBarang } from "../src/lib/aksi/dataInduk";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * Uji jurnal wajib perusahaan (P11, D1 §4.1-§4.5, §4.11, D5 §2.5): catatJurnal menolak jurnal tanpa perusahaan dan
 * akun milik perusahaan lain (D1 §9.1 kasus 22), pembungkus G5 membaca perusahaan dokumen, posting persetujuan memakai
 * perusahaan dan pengaturan dokumen, aset (perolehan, penyusutan per perusahaan, pelepasan; kasus 9 dan 12), penilaian
 * kurs per perusahaan (kasus 13), jurnal gaji, stok awal, hapus transaksi antar perusahaan, kunci tahun buku untuk
 * semua perusahaan (bagian P11 dari kasus 29-30), akun standar baru, dan jasa flagship bersama. Data uji berkode UJIJP
 * dibuat lewat db atau aksi dan dihapus di awal dan di akhir; periksaSinkron(db) seimbang sebelum dan sesudah.
 */

const KODE = "UJIJP";
const PERIODE_GAJI = "2017-10"; // bulan lampau yang tidak dipakai suite lain
const PERIODE_GAJI_DRAF = "2017-11";
const TAHUN_TUTUP_UJI = 2001; // tahun tanpa data, hanya untuk menguji kunci tahun buku

/** Menjalankan fn dengan UJI_PERUSAHAAN (dan opsional UJI_PERAN) sementara; "semua" = gabungan. */
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
/** Menjalankan fn di dalam transaksi lalu membatalkannya; mengembalikan hasil fn (data uji tidak tersimpan). */
async function dalamTxBatal<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let hasil: T | undefined;
  try {
    await db.$transaction(async (tx) => {
      hasil = await fn(tx);
      throw new Batal();
    });
  } catch (e) {
    if (!(e instanceof Batal)) throw e;
  }
  return hasil as T;
}

/** Tanggal lokal YYYY-MM-DD (bukan UTC). */
const isoLokal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const sama = (a: { toString(): string } | null | undefined, b: { toString(): string } | number) => D(a?.toString() ?? 0).equals(D(b.toString()));
const NOL = D(0);
const nomorLog: string[] = [];
const awalUji = new Date();

/** Hapus jurnal langsung beserta barisnya (hanya jurnal buatan uji ini). */
async function hapusJurnalLangsung(jurnalIds: string[]) {
  if (jurnalIds.length === 0) return;
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: jurnalIds } } });
  await db.jurnal.deleteMany({ where: { id: { in: jurnalIds } } });
}

/** Jumlah debit dan kredit semua jurnal satu perusahaan. */
async function neracaJurnal(perusahaanId: string) {
  const a = await db.barisJurnal.aggregate({ where: { jurnal: { perusahaanId } }, _sum: { debit: true, kredit: true } });
  return { debit: D(a._sum.debit ?? 0), kredit: D(a._sum.kredit ?? 0) };
}

async function bersihkanData() {
  const pt = await db.perusahaan.findUnique({ where: { kode: KODE }, select: { id: true } });
  const akunUji = (await db.akun.findMany({ where: { kode: { startsWith: `${KODE}-` } }, select: { id: true } })).map((a) => a.id);
  const asetUji = await db.asetTetap.findMany({ where: { kode: { startsWith: `${KODE}-` } }, include: { penyusutan: true, pelepasan: true } });
  for (const a of asetUji) {
    if (a.pelepasan) await jalankan(`hapus pelepasan uji ${a.kode}`, () => hapusDokumen("pelepasanAset", a.pelepasan!.id));
    for (const jurnalId of [...new Set(a.penyusutan.map((p) => p.jurnalId).filter((j): j is string => !!j))]) await jalankan(`hapus penyusutan uji ${a.kode}`, () => hapusDokumen("penyusutan", jurnalId));
    await jalankan(`hapus aset uji ${a.kode}`, () => hapusDokumen("aset", a.id));
  }
  const gaji = await db.penggajian.findMany({ where: { OR: [{ bulan: { in: [PERIODE_GAJI, PERIODE_GAJI_DRAF] }, baris: { some: { karyawan: { kode: { startsWith: `${KODE}-` } } } } }, ...(pt ? [{ perusahaanId: pt.id }] : [])] }, select: { id: true } });
  for (const g of gaji) await jalankan(`hapus penggajian uji ${g.id}`, () => hapusDokumen("penggajian", g.id));
  const barangUji = (await db.barang.findMany({ where: { kode: { startsWith: `${KODE}-` } }, select: { id: true } })).map((b) => b.id);
  const ps = await db.penyesuaianPersediaan.findMany({ where: { baris: { some: { barangId: { in: barangUji } } } }, select: { id: true } });
  for (const p of ps) await jalankan(`hapus penyesuaian uji ${p.id}`, () => hapusDokumen("penyesuaian", p.id));
  await db.transaksiAntarPerusahaan.deleteMany({ where: { nomor: { startsWith: `${KODE}-` } } });
  await db.barisFakturPenjualan.deleteMany({ where: { faktur: { nomor: { startsWith: `${KODE}-` } } } });
  await db.fakturPenjualan.deleteMany({ where: { nomor: { startsWith: `${KODE}-` } } });
  await db.dokumenKas.deleteMany({ where: { nomor: { startsWith: `${KODE}-` } } });
  const jurnalUji = await db.jurnal.findMany({ where: { OR: [{ nomor: { startsWith: `${KODE}-` } }, ...(pt ? [{ perusahaanId: pt.id }] : []), { baris: { some: { akunId: { in: akunUji } } } }] }, select: { id: true } });
  await hapusJurnalLangsung(jurnalUji.map((j) => j.id));
  await db.stokBarang.deleteMany({ where: { barangId: { in: barangUji } } });
  await db.barang.deleteMany({ where: { id: { in: barangUji } } });
  await db.gudang.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  await db.pelanggan.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  const mu = await db.mataUang.findUnique({ where: { kode: "UJJ" }, select: { id: true } });
  if (mu) {
    await db.kursMataUang.deleteMany({ where: { mataUangId: mu.id } });
    await db.mataUang.delete({ where: { id: mu.id } });
  }
  await db.tutupBuku.deleteMany({ where: { tahun: TAHUN_TUTUP_UJI } });
  await db.karyawan.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  if (pt) await db.pengaturanPerusahaan.deleteMany({ where: { perusahaanId: pt.id } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  if (pt) await db.perusahaan.delete({ where: { id: pt.id } });
  await db.logAktivitas.deleteMany({ where: { OR: [{ nomor: { startsWith: `${KODE}-` } }, { nomor: { in: nomorLog }, waktu: { gte: awalUji } }] } });
}

async function main() {
  await bersihkanData();
  aturPersetujuan(false);
  const awalHakAksesPeran = await db.hakAksesPeran.count();
  const sinkronAwal = await periksaSinkron(db);
  pastikan(sinkronAwal.seimbang, "buku besar seimbang sebelum uji");
  const jumlahJurnalAwal = await db.jurnal.count();
  const tahunIni = new Date().getFullYear();
  const hariIni = new Date();
  // aset diperoleh 10 hari lalu dan dilepas hari ini, jadi tidak pernah bertanggal di masa depan
  const tanggalPerolehanUji = isoLokal(new Date(hariIni.getTime() - 10 * 24 * 60 * 60 * 1000));

  console.log("=== 1. Akun standar baru (D1 §4.5, D5 §2.5) dan jasa flagship bersama ===");
  const harapanAkun: [string, string, string][] = [
    ["1-1750", "Piutang Antar Perusahaan", "ASET"],
    ["2-1550", "Hutang Antar Perusahaan", "KEWAJIBAN"],
    ["2-1700", "Hutang Mitra Proyek", "KEWAJIBAN"],
    ["5-1500", "Biaya Talent / Artis", "BEBAN"],
    ["5-1600", "Sewa Venue Event", "BEBAN"],
    ["5-1700", "Bagi Hasil Mitra Proyek", "BEBAN"],
  ];
  const induk: Record<string, string> = { "1-1750": "1-1000", "2-1550": "2-1000", "2-1700": "2-1000", "5-1500": "5-1000", "5-1600": "5-1000", "5-1700": "5-1000" };
  pastikan(harapanAkun.every(([kode, nama, jenis]) => BAGAN_AKUN_STANDAR.some((a) => a.kode === kode && a.nama === nama && a.jenis === jenis && a.induk === induk[kode] && !a.kelompok && a.asal === "USUL")), "enam akun baru ada di BAGAN_AKUN_STANDAR dengan nama, jenis, induk, dan asal USUL");
  const kodeStandar = BAGAN_AKUN_STANDAR.map((a) => a.kode);
  pastikan(new Set(kodeStandar).size === kodeStandar.length && BAGAN_AKUN_STANDAR.every((a) => !a.induk || kodeStandar.indexOf(a.induk) < kodeStandar.indexOf(a.kode)), "kode standar unik dan setiap induk didefinisikan lebih dulu");
  const akunDb = await db.akun.findMany({ where: { kode: { in: harapanAkun.map(([k]) => k) } }, include: { induk: { select: { kode: true } } } });
  pastikan(akunDb.length === 6 && akunDb.every((a) => a.perusahaanId === null && !a.kelompok && a.induk?.kode === induk[a.kode]), "keenam akun ada di basis data seed sebagai akun bersama yang bisa dijurnal");
  const flagshipBaru = await dalamTxBatal(async (tx) => {
    const lama = await tx.barang.findUnique({ where: { kode: JASA_FLAGSHIP_STANDAR[0].kode } });
    if (lama) await tx.barang.update({ where: { id: lama.id }, data: { kode: `${KODE}-FLAGSHIP-LAMA` } });
    await terapkanDataFlagship(tx);
    return tx.barang.findUnique({ where: { kode: JASA_FLAGSHIP_STANDAR[0].kode }, select: { perusahaanId: true, jenis: true } });
  });
  pastikan(flagshipBaru !== null && flagshipBaru.jenis === "JASA" && flagshipBaru.perusahaanId === null, "terapkanDataFlagship membuat jasa flagship sebagai jasa bersama (perusahaanId null)");

  console.log("=== 2. Data uji ===");
  const pt = await db.perusahaan.create({ data: { kode: KODE, nama: "PT Uji Jurnal Perusahaan", urutan: 97 } });
  const U = pt.id;
  const akunBaru = (kode: string, nama: string, jenis: "ASET" | "BEBAN" | "KEWAJIBAN" | "PENDAPATAN", perusahaanId: string | null, kasBank = false) =>
    db.akun.create({ data: { kode: `${KODE}-${kode}`, nama, jenis, kasBank, perusahaanId } });
  const kasU = await akunBaru("KAS-U", "Kas Uji Jurnal Perusahaan", "ASET", U, true);
  const kasUt = await akunBaru("KAS-UT", "Kas Uji Jurnal Utama", "ASET", PERUSAHAAN_UTAMA, true);
  const asetB = await akunBaru("ASET", "Peralatan Uji Bersama", "ASET", null);
  const akumB = await akunBaru("AKM", "Akumulasi Penyusutan Uji Bersama", "ASET", null);
  const bebanPnyB = await akunBaru("BPNY", "Beban Penyusutan Uji Bersama", "BEBAN", null);
  const labaRugiB = await akunBaru("LR", "Laba Rugi Pelepasan Uji Bersama", "BEBAN", null);
  const labaRugiUt = await akunBaru("LR-UT", "Laba Rugi Pelepasan Uji Utama", "BEBAN", PERUSAHAAN_UTAMA);
  const bebanUt = await akunBaru("BEBAN-UT", "Beban Uji Utama", "BEBAN", PERUSAHAAN_UTAMA);
  const pendapatanB = await akunBaru("PDPT", "Pendapatan Uji Bersama", "PENDAPATAN", null);
  const ppnU = await akunBaru("PPN-U", "PPN Keluaran Uji Perusahaan", "KEWAJIBAN", U);
  const ppnUt = await akunBaru("PPN-UT", "PPN Keluaran Uji Utama", "KEWAJIBAN", PERUSAHAAN_UTAMA);
  const gudangU = await db.gudang.create({ data: { kode: `${KODE}-WH-U`, nama: "Gudang Uji Perusahaan", perusahaanId: U } });
  const barangU = await db.barang.create({ data: { kode: `${KODE}-BRG-U`, nama: "Barang Uji Perusahaan", jenis: "BARANG", satuan: "pcs", hargaBeli: 10_000, hargaJual: 15_000, perusahaanId: U } });
  const jasaB = await db.barang.create({ data: { kode: `${KODE}-JSA`, nama: "Jasa Uji Bersama", jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 100_000, perusahaanId: null } });
  const pelanggan = await db.pelanggan.create({ data: { kode: `${KODE}-PLG`, nama: "Pelanggan Uji Jurnal Perusahaan" } });
  const karyawanU = await db.karyawan.create({ data: { kode: `${KODE}-KRY-U`, nama: "Karyawan Uji Jurnal Perusahaan", gajiPokok: 2_000_000, perusahaanId: U } });
  const karyawanUBebanUt = await db.karyawan.create({ data: { kode: `${KODE}-KRY-U2`, nama: "Karyawan Uji Beban Utama", gajiPokok: 1_000_000, perusahaanId: U, akunBebanId: bebanUt.id } });
  pastikan(true, `perusahaan uji ${U}, akun, gudang, barang, pelanggan, dan karyawan uji dibuat`);

  console.log("=== 3. catatJurnal wajib perusahaan (D1 §4.1, §9.1 kasus 22) ===");
  const barisKas = (debit: string, kredit: string, nilai = 1000) => [
    { akunId: debit, debit: D(nilai), kredit: NOL, keterangan: "uji" },
    { akunId: kredit, debit: NOL, kredit: D(nilai), keterangan: "uji" },
  ];
  await harusDitolak("catatJurnal tanpa perusahaanId", () => db.$transaction((tx) => catatJurnal(tx, "JU-X", "x", "PENJUALAN", barisKas(kasU.id, pendapatanB.id), {} as never)), "Jurnal otomatis JU-X tanpa perusahaan");
  await harusDitolak("catatJurnal opsi kosong", () => db.$transaction((tx) => catatJurnal(tx, "JU-X", "x", "PENJUALAN", barisKas(kasU.id, pendapatanB.id), undefined as unknown as OpsiJurnalPerusahaan)), "tanpa perusahaan");
  await harusDitolak("catatJurnal perusahaan uji dengan akun kas milik utama", () => db.$transaction((tx) => catatJurnal(tx, "JU-X", "x", "PENJUALAN", barisKas(kasUt.id, pendapatanB.id), { perusahaanId: U })), `Akun ${KODE}-KAS-UT Kas Uji Jurnal Utama milik`);
  await harusDitolak("catatJurnal utama dengan akun milik perusahaan uji", () => db.$transaction((tx) => catatJurnal(tx, "JU-X", "x", "PENJUALAN", barisKas(kasU.id, pendapatanB.id), { perusahaanId: PERUSAHAAN_UTAMA })), `tidak bisa dipakai di pembukuan`);
  const jurnalX = await dalamTxBatal((tx) => catatJurnal(tx, "JU-X", "Uji jurnal perusahaan", "ANTAR_PERUSAHAAN", barisKas(kasU.id, pendapatanB.id), { perusahaanId: U }));
  pastikan(jurnalX?.perusahaanId === U && jurnalX.sumber === "ANTAR_PERUSAHAAN" && jurnalX.statusPersetujuan === "DISETUJUI", "akun milik sendiri dan akun bersama diterima; jurnal milik perusahaan uji, sumber ANTAR_PERUSAHAAN");
  const jurnalMitra = await dalamTxBatal((tx) => catatJurnal(tx, "JU-X", "Uji jurnal mitra", "MITRA_PROYEK", barisKas(kasUt.id, pendapatanB.id), { perusahaanId: PERUSAHAAN_UTAMA }));
  pastikan(jurnalMitra?.perusahaanId === PERUSAHAAN_UTAMA && jurnalMitra.sumber === "MITRA_PROYEK", "sumber MITRA_PROYEK diterima, jurnal utama");

  console.log("=== 4. Pembungkus G5: perusahaan dari dokumen ===");
  await harusDitolak("retur penjualan tanpa perusahaan dan dokumen tidak ada", () => db.$transaction((tx) => catatJurnalReturPenjualan(tx, { nomor: `${KODE}-RJ-TIDAKADA`, total: D(1000) }, [{ barangId: jasaB.id, jumlah: D(1), harga: D(1000) }])), "Jurnal otomatis JU-RJ tanpa perusahaan");
  await harusDitolak("retur pembelian tanpa perusahaan dan dokumen tidak ada", () => db.$transaction((tx) => catatJurnalReturPembelian(tx, { nomor: `${KODE}-RB-TIDAKADA`, total: D(1000) }, [{ barangId: jasaB.id, jumlah: D(1), harga: D(1000) }])), "Jurnal otomatis JU-RB tanpa perusahaan");
  await harusDitolak("penyesuaian tanpa perusahaan dan dokumen tidak ada", () => db.$transaction((tx) => catatJurnalPenyesuaianPersediaan(tx, { nomor: `${KODE}-PS-TIDAKADA`, akunLawanId: pendapatanB.id }, [{ barangId: barangU.id, selisih: D(1), hargaSatuan: D(1000) }])), "Jurnal otomatis JU-PS tanpa perusahaan");
  const jurnalRj = await dalamTxBatal((tx) => catatJurnalReturPenjualan(tx, { nomor: `${KODE}-RJ-1`, total: D(1000), perusahaanId: U }, [{ barangId: jasaB.id, jumlah: D(1), harga: D(1000) }]));
  pastikan(jurnalRj?.perusahaanId === U, "retur penjualan dengan perusahaanId eksplisit: jurnal milik perusahaan itu tanpa membaca dokumen");
  const jurnalPs = await dalamTxBatal(async (tx) => {
    const nomor = `${KODE}-PS-1`;
    await tx.penyesuaianPersediaan.create({ data: { nomor, gudangId: gudangU.id, akunLawanId: pendapatanB.id, perusahaanId: U } });
    return catatJurnalPenyesuaianPersediaan(tx, { nomor, akunLawanId: pendapatanB.id }, [{ barangId: barangU.id, selisih: D(2), hargaSatuan: D(10_000) }]);
  });
  pastikan(jurnalPs?.perusahaanId === U, "penyesuaian tanpa perusahaanId: perusahaan dibaca dari dokumen lewat nomornya di transaksi yang sama");
  const jurnalUm = await dalamTxBatal((tx) => catatJurnalUangMuka(tx, { nomor: `${KODE}-UM-1`, akunId: kasU.id, jumlah: 5000, perusahaanId: U }));
  pastikan(jurnalUm?.perusahaanId === U, "pembungkus lain mengambil perusahaanId dari objek dokumen");
  await harusDitolak("uang muka perusahaan uji ke kas utama", () => db.$transaction((tx) => catatJurnalUangMuka(tx, { nomor: `${KODE}-UM-2`, akunId: kasUt.id, jumlah: 5000, perusahaanId: U })), "milik");

  console.log("=== 5. Posting persetujuan memakai perusahaan dan pengaturan dokumen ===");
  await db.pengaturanPerusahaan.create({ data: { id: U, perusahaanId: U, nama: pt.nama, pkp: true, akunPpnKeluaranId: ppnU.id } });
  const fakturU = await db.fakturPenjualan.create({
    data: { nomor: `${KODE}-FJ-1`, pelangganId: pelanggan.id, perusahaanId: U, total: 111_000, dpp: 100_000, ppnPersen: 11, ppn: 11_000, baris: { create: [{ barangId: jasaB.id, jumlah: 1, harga: 100_000, subtotal: 100_000 }] } },
  });
  const posFaktur = await dalamTxBatal(async (tx) => {
    await BERKAS.faktur.posting(tx, fakturU.id);
    const f = await tx.fakturPenjualan.findUniqueOrThrow({ where: { id: fakturU.id }, include: { jurnal: { include: { baris: true } } } });
    return f.jurnal;
  });
  pastikan(posFaktur?.perusahaanId === U && posFaktur.baris.some((b) => b.akunId === ppnU.id && sama(b.kredit, 11_000)), "posting faktur perusahaan uji: jurnal milik perusahaan uji dan PPN keluaran dari pengaturan perusahaan uji");
  await db.pengaturanPerusahaan.update({ where: { id: U }, data: { akunPpnKeluaranId: ppnUt.id } });
  await harusDitolak("posting faktur perusahaan uji dengan akun PPN milik utama", () => db.$transaction((tx) => BERKAS.faktur.posting(tx, fakturU.id)), `Akun ${KODE}-PPN-UT`);
  await db.pengaturanPerusahaan.update({ where: { id: U }, data: { akunPpnKeluaranId: ppnU.id } });

  const kasDraf = await db.dokumenKas.create({ data: { nomor: `${KODE}-KM-1`, jenis: "MASUK", akunKasId: kasU.id, akunLawanId: pendapatanB.id, jumlah: 50_000, dibuatOleh: "uji", perusahaanId: U } });
  const posKas = await dalamTxBatal(async (tx) => {
    await BERKAS.dokumenKas.posting(tx, kasDraf.id);
    return (await tx.dokumenKas.findUniqueOrThrow({ where: { id: kasDraf.id }, include: { jurnal: true } })).jurnal;
  });
  pastikan(posKas?.perusahaanId === U && posKas.nomor.startsWith("KM"), "posting kas masuk perusahaan uji: jurnal KM milik perusahaan uji");
  const kasSalah = await db.dokumenKas.create({ data: { nomor: `${KODE}-KK-1`, jenis: "KELUAR", akunKasId: kasUt.id, akunLawanId: bebanUt.id, jumlah: 10_000, dibuatOleh: "uji", perusahaanId: U } });
  await harusDitolak("posting kas keluar perusahaan uji dengan akun milik utama", () => db.$transaction((tx) => BERKAS.dokumenKas.posting(tx, kasSalah.id)), "milik");

  console.log("=== 6. Aset: perolehan, posting, penyusutan per perusahaan, pelepasan (D1 §9.1 kasus 9 dan 12) ===");
  const isianAset = (kode: string, akunPembayaranId: string | null, lain: Record<string, string> = {}) =>
    formulir({ kode: `${KODE}-${kode}`, nama: `Aset Uji ${kode}`, tanggalPerolehan: tanggalPerolehanUji, umurBulan: 12, hargaPerolehan: 1_200_000, nilaiSisa: 0, akunAsetId: asetB.id, akunBebanPenyusutanId: bebanPnyB.id, akunAkumulasiPenyusutanId: akumB.id, akunPembayaranId, ...lain });
  await dengan({ perusahaan: U }, () => jalankan("aset perusahaan uji dibayar kas perusahaan uji", () => buatAsetTetap(isianAset("AT-U", kasU.id))));
  const asetU = await db.asetTetap.findUniqueOrThrow({ where: { kode: `${KODE}-AT-U` }, include: { jurnalPerolehan: true } });
  pastikan(asetU.perusahaanId === U && asetU.jurnalPerolehan?.perusahaanId === U && asetU.jurnalPerolehan.nomor.startsWith("JU-AT"), "aset dan jurnal perolehan JU-AT milik perusahaan uji");
  await dengan({ perusahaan: U }, () => harusDitolak("aset perusahaan uji dibayar kas utama", () => buatAsetTetap(isianAset("AT-SALAH", kasUt.id)), `Akun ${KODE}-KAS-UT Kas Uji Jurnal Utama milik`));
  await dengan({ perusahaan: "semua" }, () => jalankan("aset di lingkup gabungan, akun kas milik perusahaan uji", () => buatAsetTetap(isianAset("AT-G", kasU.id))));
  pastikan((await db.asetTetap.findUniqueOrThrow({ where: { kode: `${KODE}-AT-G` } })).perusahaanId === U, "lingkup gabungan tanpa isian: perusahaan aset dari pemilik akun yang dipilih");
  await dengan({ perusahaan: "semua" }, () => jalankan("aset di lingkup gabungan, semua akun bersama", () => buatAsetTetap(isianAset("AT-UT", null))));
  const asetUt = await db.asetTetap.findUniqueOrThrow({ where: { kode: `${KODE}-AT-UT` } });
  pastikan(asetUt.perusahaanId === PERUSAHAAN_UTAMA && asetUt.jurnalPerolehanId === null, "lingkup gabungan, akun bersama, tanpa pembayaran: aset utama tanpa jurnal (perilaku lama)");
  await dengan({ perusahaan: "semua" }, () => jalankan("aset gabungan dengan isian perusahaan uji", () => buatAsetTetap(isianAset("AT-ISI", null, { perusahaanId: U }))));
  pastikan((await db.asetTetap.findUniqueOrThrow({ where: { kode: `${KODE}-AT-ISI` } })).perusahaanId === U, "isian perusahaanId dipakai lebih dulu");
  await jalankan("hapus aset isian", async () => hapusDokumen("aset", (await db.asetTetap.findUniqueOrThrow({ where: { kode: `${KODE}-AT-ISI` } })).id));
  await jalankan("hapus aset gabungan", async () => hapusDokumen("aset", (await db.asetTetap.findUniqueOrThrow({ where: { kode: `${KODE}-AT-G` } })).id));

  // posting aset lewat alur persetujuan
  aturPersetujuan(true);
  await dengan({ perusahaan: U }, () => jalankan("aset draf perusahaan uji", () => buatAsetTetap(isianAset("AT-DRAF", kasU.id))));
  aturPersetujuan(false);
  const asetDraf = await db.asetTetap.findUniqueOrThrow({ where: { kode: `${KODE}-AT-DRAF` } });
  const posAset = await dalamTxBatal(async (tx) => {
    await BERKAS.aset.posting(tx, asetDraf.id);
    return (await tx.asetTetap.findUniqueOrThrow({ where: { id: asetDraf.id }, include: { jurnalPerolehan: true } })).jurnalPerolehan;
  });
  pastikan(asetDraf.statusPersetujuan === "DRAFT" && asetDraf.perusahaanId === U && posAset?.perusahaanId === U, "posting aset draf: jurnal perolehan milik perusahaan aset");
  await jalankan("hapus aset draf", () => hapusDokumen("aset", asetDraf.id));

  // penyusutan: periode jauh di depan supaya tidak bentrok dengan penyusutan seed dan suite lain
  const periodePny = `${tahunIni + 6}-01`;
  await dengan({ perusahaan: U }, () => jalankan(`penyusutan ${periodePny} lingkup perusahaan uji`, () => jalankanPenyusutanBulanan(formulir({ periode: periodePny }))));
  const pnyU = await db.penyusutanAset.findMany({ where: { periode: new Date(`${periodePny}-01T00:00:00.000Z`) }, include: { aset: true, jurnal: true } });
  pastikan(pnyU.length === 1 && pnyU[0].asetId === asetU.id && pnyU[0].jurnal?.perusahaanId === U && sama(pnyU[0].jumlah, 100_000), "lingkup perusahaan uji hanya menyusutkan aset perusahaan uji, jurnal JU-PNY milik perusahaan uji");
  pastikan(pnyU[0].jurnal?.keterangan === `Penyusutan aset periode ${periodePny} ${KODE}`, `keterangan penyusutan perusahaan lain diberi kode: "${pnyU[0].jurnal?.keterangan}"`);
  await jalankan("hapus penyusutan perusahaan uji", () => hapusDokumen("penyusutan", pnyU[0].jurnalId!));
  const jumlahPnySeb = await db.jurnal.count({ where: { sumber: "PENYUSUTAN" } });
  await dengan({ perusahaan: "semua" }, () => jalankan(`penyusutan ${periodePny} lingkup gabungan`, () => jalankanPenyusutanBulanan(formulir({ periode: periodePny }))));
  const pnyG = await db.penyusutanAset.findMany({ where: { periode: new Date(`${periodePny}-01T00:00:00.000Z`) }, include: { aset: true, jurnal: true } });
  const jurnalPny = [...new Map(pnyG.map((p) => [p.jurnalId, p.jurnal!])).values()];
  pastikan(pnyG.every((p) => p.jurnal?.perusahaanId === p.aset.perusahaanId), "setiap penyusutan memakai jurnal milik perusahaan asetnya");
  pastikan(jurnalPny.length === new Set(pnyG.map((p) => p.aset.perusahaanId)).size && jurnalPny.length >= 2 && (await db.jurnal.count({ where: { sumber: "PENYUSUTAN" } })) - jumlahPnySeb === jurnalPny.length, `penyusutan dua aset beda perusahaan: satu jurnal per perusahaan (${jurnalPny.length} jurnal)`);
  const jurnalPnyUt = jurnalPny.find((j) => j.perusahaanId === PERUSAHAAN_UTAMA)!;
  pastikan(jurnalPnyUt.keterangan === `Penyusutan aset periode ${periodePny}` && pnyG.some((p) => p.asetId === asetUt.id && p.jurnalId === jurnalPnyUt.id), "jurnal utama berketerangan sama dengan sebelum multi perusahaan dan memuat aset utama uji");
  for (const j of jurnalPny) {
    const s = await db.barisJurnal.aggregate({ where: { jurnalId: j.id }, _sum: { debit: true, kredit: true } });
    pastikan(sama(s._sum.debit, s._sum.kredit ?? 0), `jurnal ${j.nomor} seimbang`);
  }
  for (const j of jurnalPny) await jalankan(`hapus penyusutan ${j.nomor}`, () => hapusDokumen("penyusutan", j.id));
  pastikan((await db.penyusutanAset.count({ where: { periode: new Date(`${periodePny}-01T00:00:00.000Z`) } })) === 0, "penyusutan uji terhapus semua");

  // pelepasan mewarisi perusahaan aset
  await harusDitolak("pelepasan aset perusahaan uji dengan akun laba rugi milik utama", () => lepasAset(formulir({ asetId: asetU.id, jenis: "DIJUAL", tanggal: isoLokal(hariIni), hargaJual: 1_000_000, akunPenerimaanId: kasU.id, akunLabaRugiId: labaRugiUt.id })), `Akun ${KODE}-LR-UT`);
  await jalankan("pelepasan aset perusahaan uji", () => lepasAset(formulir({ asetId: asetU.id, jenis: "DIJUAL", tanggal: isoLokal(hariIni), hargaJual: 1_000_000, akunPenerimaanId: kasU.id, akunLabaRugiId: labaRugiB.id })));
  const lepas = await db.pelepasanAset.findUniqueOrThrow({ where: { asetId: asetU.id }, include: { jurnal: true } });
  const logLepas = await db.logAktivitas.findFirst({ where: { aksi: "LEPAS", nomor: lepas.jurnal!.nomor } });
  nomorLog.push(lepas.jurnal!.nomor);
  pastikan(lepas.jurnal?.perusahaanId === U && lepas.jurnal.nomor.startsWith("JU-LPS") && logLepas?.perusahaanId === U, "jurnal JU-LPS dan log pelepasan milik perusahaan aset");
  await jalankan("hapus pelepasan", () => hapusDokumen("pelepasanAset", lepas.id));

  console.log("=== 7. Penilaian kurs per perusahaan (D1 §4.4, §9.1 kasus 13) ===");
  const tanggalNilai = new Date(`${isoLokal(hariIni)}T23:59:59.999`);
  const sisaLain = await db.$transaction((tx) => hitungRevaluasi(tx, tanggalNilai));
  const mu = await db.mataUang.create({ data: { kode: "UJJ", nama: "Mata Uang Uji Jurnal Perusahaan" } });
  const kemarin = new Date(hariIni.getTime() - 24 * 60 * 60 * 1000);
  await db.kursMataUang.create({ data: { mataUangId: mu.id, tanggal: new Date(kemarin.toDateString()), kurs: 1000 } });
  const kursHariIni = await db.kursMataUang.create({ data: { mataUangId: mu.id, tanggal: new Date(hariIni.toDateString()), kurs: 1100 } });
  const fakturAsing = (nomor: string, perusahaanId: string) =>
    db.fakturPenjualan.create({ data: { nomor: `${KODE}-${nomor}`, tanggal: kemarin, pelangganId: pelanggan.id, perusahaanId, total: 1_000_000, dpp: 1_000_000, mataUangId: mu.id, kurs: 1000, nilaiAsli: 1000, statusPersetujuan: "DISETUJUI" } });
  const fjAsingU = await fakturAsing("FJ-USJ-U", U);
  const fjAsingUt = await fakturAsing("FJ-USJ-UT", PERUSAHAAN_UTAMA);
  const pratinjauU = await db.$transaction((tx) => hitungRevaluasi(tx, tanggalNilai, U));
  pastikan(pratinjauU.baris.length === 1 && pratinjauU.baris[0].nomor === fjAsingU.nomor && pratinjauU.baris[0].perusahaanId === U && sama(pratinjauU.labaRugi, 100_000), "hitungRevaluasi per perusahaan hanya memuat faktur perusahaan itu (laba 100.000)");
  const jumlahSk0 = await db.jurnal.count({ where: { sumber: "SELISIH_KURS" } });
  await dengan({ perusahaan: U }, () => jalankan("penilaian kurs lingkup perusahaan uji", () => jalankanPenilaianKurs(formulir({ tanggal: isoLokal(hariIni) }))));
  const skU = await db.jurnal.findMany({ where: { sumber: "SELISIH_KURS", perusahaanId: U }, include: { baris: true } });
  const nomorSk = skU.map((j) => j.nomor);
  pastikan(skU.length === 1 && (await db.jurnal.count({ where: { sumber: "SELISIH_KURS" } })) - jumlahSk0 === 1, "satu jurnal JU-SK milik perusahaan uji, perusahaan lain tidak dinilai");
  pastikan(!!skU[0].keterangan?.startsWith(`Penilaian kembali kurs ${KODE} per `) && !!skU[0].keterangan?.includes("1 faktur") && sama(skU[0].baris.reduce((n, b) => n.plus(b.debit), NOL), 100_000), `JU-SK perusahaan uji seimbang 100.000: "${skU[0].keterangan}"`);
  const logSk = await db.logAktivitas.findFirst({ where: { aksi: "REVALUASI", nomor: skU[0].nomor } });
  nomorLog.push(skU[0].nomor);
  pastikan(logSk?.perusahaanId === U && logSk.keterangan?.startsWith(`${KODE}: 1 faktur dinilai ulang`), `log penilaian kurs per perusahaan: "${logSk?.keterangan}"`);
  pastikan((await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fjAsingUt.id } })).kursRevaluasi === null && sama((await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fjAsingU.id } })).kursRevaluasi, 1100), "kurs dibawa hanya diperbarui untuk faktur perusahaan uji");
  if (sisaLain.baris.length === 0) {
    await db.kursMataUang.update({ where: { id: kursHariIni.id }, data: { kurs: 1200 } });
    const hasilG = await db.$transaction((tx) => jalankanRevaluasi(tx, tanggalNilai));
    nomorLog.push(...hasilG.jurnalPerPerusahaan.map((j) => j.nomor));
    nomorSk.push(...hasilG.jurnalPerPerusahaan.map((j) => j.nomor));
    const perP = new Map(hasilG.jurnalPerPerusahaan.map((j) => [j.perusahaanId, j]));
    pastikan(hasilG.jurnalPerPerusahaan.length === 2 && hasilG.nomorJurnal === `${perP.get(PERUSAHAAN_UTAMA)!.nomor}, ${perP.get(U)!.nomor}`, `gabungan: satu JU-SK per perusahaan, nomorJurnal digabung (${hasilG.nomorJurnal})`);
    pastikan(sama(perP.get(PERUSAHAAN_UTAMA)!.ringkasan.labaRugi, 200_000) && sama(perP.get(U)!.ringkasan.labaRugi, 100_000) && sama(hasilG.ringkasan.labaRugi, 300_000), "selisih per perusahaan: utama 200.000, perusahaan uji 100.000, gabungan 300.000");
    const jurnalG = await db.jurnal.findMany({ where: { nomor: { in: hasilG.jurnalPerPerusahaan.map((j) => j.nomor) } }, include: { baris: true } });
    pastikan(jurnalG.every((j) => j.perusahaanId === hasilG.jurnalPerPerusahaan.find((x) => x.nomor === j.nomor)!.perusahaanId && j.baris.reduce((n, b) => n.plus(b.debit), NOL).equals(j.baris.reduce((n, b) => n.plus(b.kredit), NOL))), "setiap JU-SK seimbang dan milik perusahaannya");
    pastikan(!!jurnalG.find((j) => j.perusahaanId === PERUSAHAAN_UTAMA)!.keterangan?.startsWith("Penilaian kembali kurs per "), "keterangan JU-SK utama sama dengan sebelum multi perusahaan");
    const kedua = await db.$transaction((tx) => jalankanRevaluasi(tx, tanggalNilai));
    pastikan(kedua.nomorJurnal === null && kedua.jurnalPerPerusahaan.length === 0, "penilaian kedua pada kurs yang sama tidak membuat jurnal");
  } else {
    console.log(`   (lewati bagian gabungan: basis data punya ${sisaLain.baris.length} selisih kurs lain yang tidak boleh dinilai uji ini)`);
  }
  await hapusJurnalLangsung((await db.jurnal.findMany({ where: { sumber: "SELISIH_KURS", nomor: { in: nomorSk } }, select: { id: true } })).map((j) => j.id));
  pastikan((await db.jurnal.count({ where: { sumber: "SELISIH_KURS" } })) === jumlahSk0, "jurnal JU-SK uji dihapus");

  console.log("=== 8. Jurnal gaji perusahaan penggajian ===");
  const barisGaji = (k: { id: string }, pokok: number) => [{ karyawanId: k.id, gajiPokok: pokok, tunjangan: 0, potongan: 0 }];
  await dengan({ perusahaan: U }, () => jalankan("penggajian perusahaan uji", () => buatPenggajian(formulir({ periode: PERIODE_GAJI, tanggal: "2017-10-25", akunKasId: kasU.id, baris: barisGaji(karyawanU, 2_000_000) }))));
  const gajiU = await db.penggajian.findFirstOrThrow({ where: { perusahaanId: U, bulan: PERIODE_GAJI }, include: { jurnal: true } });
  nomorLog.push(gajiU.nomor);
  pastikan(gajiU.jurnal?.perusahaanId === U && gajiU.jurnal.nomor.startsWith("GJ"), "jurnal gaji tercatat di perusahaan penggajian lewat catatJurnal");
  await dengan({ perusahaan: U }, () => harusDitolak("penggajian perusahaan uji dengan akun beban karyawan milik utama", () => buatPenggajian(formulir({ periode: PERIODE_GAJI_DRAF, tanggal: "2017-11-25", akunKasId: kasU.id, baris: barisGaji(karyawanUBebanUt, 1_000_000) })), `Akun ${KODE}-BEBAN-UT Beban Uji Utama milik`));
  pastikan((await db.penggajian.count({ where: { perusahaanId: U, bulan: PERIODE_GAJI_DRAF } })) === 0, "penggajian yang ditolak tidak tersimpan");
  aturPersetujuan(true);
  await dengan({ perusahaan: U }, () => jalankan("penggajian draf perusahaan uji", () => buatPenggajian(formulir({ periode: PERIODE_GAJI_DRAF, tanggal: "2017-11-25", akunKasId: kasU.id, baris: barisGaji(karyawanU, 2_000_000) }))));
  aturPersetujuan(false);
  const gajiDraf = await db.penggajian.findFirstOrThrow({ where: { perusahaanId: U, bulan: PERIODE_GAJI_DRAF } });
  nomorLog.push(gajiDraf.nomor);
  const ringkas = await db.$transaction((tx) => BERKAS.penggajian.ringkas!(tx, gajiDraf.id));
  pastikan(gajiDraf.periode.includes("@") && ringkas.startsWith(`Periode ${PERIODE_GAJI_DRAF}: 1 karyawan`), `ringkasan persetujuan gaji memakai bulan, bukan kunci periode: "${ringkas}"`);
  const posGaji = await dalamTxBatal(async (tx) => {
    await BERKAS.penggajian.posting(tx, gajiDraf.id);
    return (await tx.penggajian.findUniqueOrThrow({ where: { id: gajiDraf.id }, include: { jurnal: true } })).jurnal;
  });
  pastikan(posGaji?.perusahaanId === U, "posting gaji lewat persetujuan: jurnal milik perusahaan penggajian");
  await jalankan("hapus penggajian draf", () => hapusDokumen("penggajian", gajiDraf.id));
  await jalankan("hapus penggajian perusahaan uji", () => hapusDokumen("penggajian", gajiU.id));
  const logGaji = await db.logAktivitas.findFirst({ where: { aksi: "HAPUS", nomor: gajiU.nomor }, orderBy: { waktu: "desc" } });
  pastikan(logGaji?.keterangan?.startsWith(`Penggajian periode ${PERIODE_GAJI} dibatalkan`) === true && !logGaji.keterangan.includes("@"), `log hapus gaji memakai bulan: "${logGaji?.keterangan}"`);

  console.log("=== 9. Jurnal stok dari halaman Barang memakai pemilik barang ===");
  await dengan({ perusahaan: U }, () => jalankan("koreksi stok barang perusahaan uji", () => ubahStokBarang(barangU.id, formulir({ gudangId: gudangU.id, stok: 5, akunLawanId: pendapatanB.id }))));
  const psStok = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { baris: { some: { barangId: barangU.id } } }, include: { jurnal: true } });
  pastikan(psStok.jurnal?.perusahaanId === U && psStok.jurnal.nomor.startsWith("JU-PS"), "jurnal JU-PS koreksi stok milik pemilik barang");
  await jalankan("hapus koreksi stok", () => hapusDokumen("penyesuaian", psStok.id));

  console.log("=== 10. Hapus transaksi antar perusahaan (D1 §4.5, §4.11) ===");
  const pap = await db.akun.findUniqueOrThrow({ where: { kode: "1-1750" } });
  const hap = await db.akun.findUniqueOrThrow({ where: { kode: "2-1550" } });
  const nomorAp = `${KODE}-AP-1`;
  const ap = await db.$transaction(async (tx) => {
    const ket = `Antar perusahaan ${nomorAp}: uji`;
    const tanggal = new Date();
    const pemberi = await catatJurnal(tx, "JU-AP", ket, "ANTAR_PERUSAHAAN", [
      { akunId: pap.id, debit: D(300_000), kredit: NOL, keterangan: ket },
      { akunId: kasUt.id, debit: NOL, kredit: D(300_000), keterangan: ket },
    ], { tanggal, perusahaanId: PERUSAHAAN_UTAMA });
    const penerima = await catatJurnal(tx, "JU-AP", ket, "ANTAR_PERUSAHAAN", [
      { akunId: bebanPnyB.id, debit: D(300_000), kredit: NOL, keterangan: ket },
      { akunId: hap.id, debit: NOL, kredit: D(300_000), keterangan: ket },
    ], { tanggal, perusahaanId: U });
    return tx.transaksiAntarPerusahaan.create({
      data: { nomor: nomorAp, tanggal, jenis: "TAGIH", pemberiId: PERUSAHAAN_UTAMA, penerimaId: U, jumlah: 300_000, keterangan: "uji", akunPemberiId: kasUt.id, akunPenerimaId: bebanPnyB.id, jurnalPemberiId: pemberi!.id, jurnalPenerimaId: penerima!.id, dicatatOlehNama: "uji" },
    });
  });
  nomorLog.push(nomorAp);
  const [jp, jt] = await Promise.all([db.jurnal.findUniqueOrThrow({ where: { id: ap.jurnalPemberiId! } }), db.jurnal.findUniqueOrThrow({ where: { id: ap.jurnalPenerimaId! } })]);
  pastikan(jp.perusahaanId === PERUSAHAAN_UTAMA && jt.perusahaanId === U, "dua jurnal JU-AP: pemberi di utama, penerima di perusahaan uji");
  await harusDitolak("hapus satu sisi lewat jurnal", () => hapusDokumen("jurnal", jp.id), "jurnal otomatis; hapus lewat dokumen sumbernya");
  await dengan({ peran: "KASIR" }, () => harusDitolak("KASIR menghapus transaksi antar perusahaan", () => hapusDokumen("antarPerusahaan", ap.id), "tidak punya hak"));
  await jalankan("hapus transaksi antar perusahaan", () => hapusDokumen("antarPerusahaan", ap.id));
  pastikan((await db.jurnal.count({ where: { id: { in: [jp.id, jt.id] } } })) === 0 && (await db.transaksiAntarPerusahaan.count({ where: { id: ap.id } })) === 0, "dokumen dan kedua jurnalnya terhapus");
  const logAp = await db.logAktivitas.findMany({ where: { aksi: "HAPUS", nomor: nomorAp } });
  pastikan(logAp.length === 1 && logAp[0].jenis === "Transaksi Antar Perusahaan" && logAp[0].keterangan === "Transaksi antar perusahaan dihapus; dua jurnal dibalik", "satu log HAPUS Transaksi Antar Perusahaan");

  console.log("=== 11. Tahun buku tertutup berlaku untuk semua perusahaan (bagian P11 dari D1 §9.1 kasus 29-30) ===");
  await db.tutupBuku.create({ data: { tahun: TAHUN_TUTUP_UJI, labaBersih: 0, penggunaNama: "uji" } });
  const tanggalTutup = new Date(TAHUN_TUTUP_UJI, 5, 1);
  await harusDitolak("jurnal perusahaan uji di tahun tertutup", () => db.$transaction((tx) => catatJurnal(tx, "JU-X", "x", "PENJUALAN", barisKas(kasU.id, pendapatanB.id), { tanggal: tanggalTutup, perusahaanId: U })), `Tahun buku ${TAHUN_TUTUP_UJI} sudah ditutup`);
  await harusDitolak("jurnal utama di tahun tertutup", () => db.$transaction((tx) => catatJurnal(tx, "JU-X", "x", "PENJUALAN", barisKas(kasUt.id, pendapatanB.id), { tanggal: tanggalTutup, perusahaanId: PERUSAHAAN_UTAMA })), `Tahun buku ${TAHUN_TUTUP_UJI} sudah ditutup`);
  await db.tutupBuku.delete({ where: { tahun: TAHUN_TUTUP_UJI } });
  const jurnalBuka = await dalamTxBatal((tx) => catatJurnal(tx, "JU-X", "x", "PENJUALAN", barisKas(kasU.id, pendapatanB.id), { tanggal: tanggalTutup, perusahaanId: U }));
  pastikan(jurnalBuka?.perusahaanId === U, "sesudah tahun dibuka kembali, jurnal perusahaan uji diterima lagi");

  console.log("=== 12. Keseimbangan per perusahaan dan sinkron ===");
  for (const p of [U, PERUSAHAAN_UTAMA]) {
    const n = await neracaJurnal(p);
    pastikan(n.debit.equals(n.kredit), `jurnal ${p} seimbang (${n.debit.toFixed(2)})`);
  }

  console.log("=== 13. Bersih-bersih ===");
  await bersihkanData();
  pastikan((await db.perusahaan.count({ where: { kode: KODE } })) === 0 && (await db.akun.count({ where: { kode: { startsWith: `${KODE}-` } } })) === 0 && (await db.asetTetap.count({ where: { kode: { startsWith: `${KODE}-` } } })) === 0, "perusahaan, akun, dan aset uji terhapus");
  pastikan((await db.jurnal.count()) === jumlahJurnalAwal, `jumlah jurnal kembali ${jumlahJurnalAwal}`);
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron sesudah uji sama dengan sebelum uji dan seimbang");
  pastikan((await db.hakAksesPeran.count()) === awalHakAksesPeran, "HakAksesPeran tidak berubah");
  pastikan(!JSON.stringify(sinkronAwal).includes(KODE), "tidak ada data uji yang tersisa di ringkasan sinkron");
  console.log("=== DONE, all jurnal-perusahaan checks passed ===");
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("TEST FAILED", err);
    try {
      await bersihkanData();
    } catch (e) {
      console.error("bersih-bersih gagal", e);
    }
    process.exit(1);
  });
