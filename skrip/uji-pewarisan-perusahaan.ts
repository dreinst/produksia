import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import type { Prisma } from "../src/prisma-klien/client";
import { D } from "../src/lib/uang";
import { NILAI_BERSAMA, PERUSAHAAN_UTAMA, lingkupPerusahaan } from "../src/lib/perusahaan";
import { BERKAS } from "../src/lib/persetujuan";
import { periksaSinkron, type HasilSinkron } from "../src/lib/sinkron";
import { daftarProyekAktif } from "../src/lib/proyek";
import { jalankanFormulir } from "../src/lib/statusFormulir";
import { buatPesananPembelian, buatPenerimaanBarang, buatFakturPembelian, buatPembayaranPembelian, buatReturPembelian } from "../src/lib/aksi/pembelian";
import { buatPenyesuaianPersediaan, buatPindahBarang } from "../src/lib/aksi/persediaan";
import { buatPeminjamanBarang } from "../src/lib/aksi/peminjaman";
import { buatLaporanKerusakan, tautkanPenyesuaianKerusakan } from "../src/lib/aksi/kerusakan";
import { buatJurnalManual, buatKasKeluar, buatKasMasuk } from "../src/lib/aksi/jurnal";
import { buatPrive } from "../src/lib/aksi/prive";
import { buatDataInduk, ubahDataInduk, ubahStokBarang } from "../src/lib/aksi/dataInduk";
import { buatPenggajian } from "../src/lib/aksi/sdm";
import { hapusDokumen, type JenisDokumen } from "../src/lib/aksi/hapusDokumen";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * Uji pewarisan perusahaan di aksi lama non-penjualan dan data induk (P13, D1 §3.3-§3.5, §9.1 kasus 4, 6, 7, 8, 9, 18,
 * 19, 23; D5 §3.1, §4.7, §9.1 B2): dokumen akar memakai perusahaan isian atau lingkup, dokumen anak mewarisi induknya,
 * dokumen persediaan memakai pemilik tunggal barang, jurnalnya ikut dokumen, rujukan gudang, akun, barang, dan proyek
 * milik perusahaan lain ditolak, pemilik data induk hanya bisa diganti bila aman, dan validasi isian perusahaan
 * (keputusan orkestrator). Data berkode UJIPW dibuat lewat db atau aksi dan dihapus di awal dan di akhir.
 */

const KODE = "UJIPW";
const PERIODE_GAJI = "2016-04"; // bulan lampau yang tidak dipakai suite lain
const awalUji = new Date();
/** Nomor dokumen yang dihapus selama uji; log HAPUS-nya dibersihkan di akhir. */
const nomorLog: string[] = [];

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

const JPEG_PALSU = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
function denganFoto(isian: Parameters<typeof formulir>[0]): FormData {
  const fd = formulir(isian);
  fd.append("foto", new File([new Uint8Array(JPEG_PALSU)], "bukti.jpg", { type: "image/jpeg" }));
  return fd;
}

const BUTIR = ["persediaan", "piutang", "hutang", "barangBelumDitagih", "barangTerkirim", "uangMuka"] as const;
const semuaCocok = (s: HasilSinkron) => s.seimbang && BUTIR.every((b) => s[b].sinkron);
const hariDari = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));

/** Hapus dokumen uji lewat hapusDokumen (jalur hapus lama, jurnal dibalik dan stok dipulihkan). */
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
  const urut = { orderBy: { nomor: "desc" as const }, select: { id: true, nomor: true } };
  await hapusSemua("returPembelian", await db.returPembelian.findMany({ where: { faktur: pemasok }, ...urut }));
  await hapusSemua("pembayaran", await db.pembayaranPembelian.findMany({ where: pemasok, ...urut }));
  await hapusSemua("fakturPembelian", await db.fakturPembelian.findMany({ where: pemasok, ...urut }));
  await hapusSemua("penerimaanBarang", await db.penerimaanBarang.findMany({ where: { pesanan: pemasok }, ...urut }));
  await hapusSemua("pesananPembelian", await db.pesananPembelian.findMany({ where: pemasok, ...urut }));
  const berBarang = { baris: { some: { barangId: { in: barangUji } } } };
  await hapusSemua("peminjamanBarang", await db.peminjamanBarang.findMany({ where: berBarang, ...urut }));
  await hapusSemua("laporanKerusakan", await db.laporanKerusakanBarang.findMany({ where: berBarang, ...urut }));
  await hapusSemua("pindahBarang", await db.pindahBarang.findMany({ where: berBarang, ...urut }));
  await hapusSemua("penyesuaian", await db.penyesuaianPersediaan.findMany({ where: berBarang, ...urut }));
  await hapusSemua("dokumenKas", await db.dokumenKas.findMany({ where: { OR: [{ akunKasId: { in: akunUji } }, { akunLawanId: { in: akunUji } }] }, ...urut }));
  await hapusSemua("prive", await db.prive.findMany({ where: { akunKasId: { in: akunUji } }, ...urut }));
  await hapusSemua("penggajian", await db.penggajian.findMany({ where: { baris: { some: { karyawan: { kode: { startsWith: `${KODE}-` } } } } }, ...urut }));
  // jurnal manual dan kas langsung yang memakai akun uji
  await hapusSemua("jurnal", await db.jurnal.findMany({ where: { sumber: { in: ["MANUAL", "KAS_MASUK", "KAS_KELUAR"] }, baris: { some: { akunId: { in: akunUji } } } }, ...urut }));
  await db.pemetaanAkunTambahan.deleteMany({ where: { akunId: { in: akunUji } } });
  await db.stokBarang.deleteMany({ where: { barangId: { in: barangUji } } });
  await db.foto.deleteMany({ where: { barangId: { in: barangUji } } });
  await db.barang.deleteMany({ where: { id: { in: barangUji } } });
  await db.gudang.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  await db.karyawan.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  await db.proyek.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  await db.pemasok.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  if (pt) {
    await db.pengaturanPerusahaan.deleteMany({ where: { perusahaanId: pt.id } });
    await db.perusahaan.delete({ where: { id: pt.id } });
  }
  await db.logAktivitas.deleteMany({ where: { OR: [{ nomor: { startsWith: `${KODE}-` } }, { nomor: { in: nomorLog }, waktu: { gte: awalUji } }] } });
}

async function main() {
  await bersihkanData();
  aturPersetujuan(false);
  const awalHakAksesPeran = await db.hakAksesPeran.count();
  const sinkronAwal = await periksaSinkron(db);
  pastikan(sinkronAwal.seimbang, "buku besar seimbang sebelum uji");
  const jumlahJurnalAwal = await db.jurnal.count();

  console.log("=== 1. Data uji ===");
  const pt = await db.perusahaan.create({ data: { kode: KODE, nama: "PT Uji Pewarisan", urutan: 96 } });
  const U = pt.id;
  // termin 30 hari supaya faktur pembelian terbukti memakai pengaturan perusahaan pesanannya
  await db.pengaturanPerusahaan.create({ data: { id: U, perusahaanId: U, nama: pt.nama, terminHari: 30 } });
  const akunBaru = (kode: string, nama: string, jenis: "ASET" | "BEBAN" | "MODAL" | "PENDAPATAN", perusahaanId: string | null, kasBank = false) =>
    db.akun.create({ data: { kode: `${KODE}-${kode}`, nama, jenis, kasBank, perusahaanId } });
  const kasU = await akunBaru("KAS-U", "Kas Uji Pewarisan", "ASET", U, true);
  const kasUt = await akunBaru("KAS-UT", "Kas Uji Pewarisan Utama", "ASET", PERUSAHAAN_UTAMA, true);
  const kasB = await akunBaru("KAS-B", "Kas Uji Pewarisan Bersama", "ASET", null, true);
  const modalB = await akunBaru("MODAL", "Modal Uji Pewarisan", "MODAL", null);
  const modalUt = await akunBaru("MODAL-UT", "Modal Uji Pewarisan Utama", "MODAL", PERUSAHAAN_UTAMA);
  const priveB = await akunBaru("PRIVE", "Prive Uji Pewarisan", "MODAL", null);
  const pendapatanB = await akunBaru("PDPT", "Pendapatan Uji Pewarisan", "PENDAPATAN", null);
  const bebanB = await akunBaru("BEBAN", "Beban Uji Pewarisan", "BEBAN", null);
  const gudangU = await db.gudang.create({ data: { kode: `${KODE}-WH-U`, nama: "Gudang Uji Pewarisan", perusahaanId: U } });
  const gudangUt = await db.gudang.create({ data: { kode: `${KODE}-WH-UT`, nama: "Gudang Uji Pewarisan Utama", perusahaanId: PERUSAHAAN_UTAMA } });
  const gudangB = await db.gudang.create({ data: { kode: `${KODE}-WH-B`, nama: "Gudang Uji Pewarisan Bersama" } });
  const barangU = await db.barang.create({ data: { kode: `${KODE}-BRG-U`, nama: "Barang Uji Pewarisan", jenis: "BARANG", satuan: "pcs", hargaBeli: 10_000, hargaJual: 15_000, perusahaanId: U } });
  const barangUt = await db.barang.create({ data: { kode: `${KODE}-BRG-UT`, nama: "Barang Uji Pewarisan Utama", jenis: "BARANG", satuan: "pcs", hargaBeli: 5_000, hargaJual: 8_000, perusahaanId: PERUSAHAAN_UTAMA } });
  const jasaB = await db.barang.create({ data: { kode: `${KODE}-JSA`, nama: "Jasa Uji Pewarisan", jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 100_000, perusahaanId: null } });
  const pemasok = await db.pemasok.create({ data: { kode: `${KODE}-SUP`, nama: "Pemasok Uji Pewarisan" } });
  const proyekU = await db.proyek.create({ data: { kode: `${KODE}-PRJ-U`, nama: "Event Uji Pewarisan", perusahaanId: U } });
  const proyekUt = await db.proyek.create({ data: { kode: `${KODE}-PRJ-UT`, nama: "Event Uji Pewarisan Utama", perusahaanId: PERUSAHAAN_UTAMA } });
  const karyawanU = await db.karyawan.create({ data: { kode: `${KODE}-KRY-U`, nama: "Karyawan Uji Pewarisan", gajiPokok: 1_000_000, perusahaanId: U } });
  pastikan(true, `perusahaan uji ${U}, akun, gudang, barang, pemasok, proyek, dan karyawan uji dibuat`);

  console.log("=== 2. Isian perusahaan dokumen akar (keputusan orkestrator, D1 §3.2, §9.1 kasus 19) ===");
  const isiJu = (nilai: number, ket: string, tambahan: Record<string, string> = {}) => ({
    keterangan: `${KODE} ${ket}`,
    baris: [{ akunId: kasU.id, debit: nilai, kredit: 0 }, { akunId: pendapatanB.id, debit: 0, kredit: nilai }],
    ...tambahan,
  });
  await harusDitolak("isian perusahaan yang tidak ada", () => buatJurnalManual(formulir(isiJu(1000, "x", { perusahaanId: "tidak-ada" }))), "Perusahaan tidak ditemukan");
  await harusDitolak("isian gabungan bukan perusahaan", () => buatJurnalManual(formulir(isiJu(1000, "x", { perusahaanId: "semua" }))), "Perusahaan tidak ditemukan");
  await dengan({ perusahaan: "semua" }, () => harusDitolak("lingkup gabungan tanpa isian perusahaan", () => buatJurnalManual(formulir(isiJu(1000, "gabungan"))), "Pilih perusahaan untuk dokumen ini"));
  await dengan({ perusahaan: "semua" }, () => jalankan("lingkup gabungan dengan isian perusahaan uji", () => buatJurnalManual(formulir(isiJu(11_000, "gabungan isian", { perusahaanId: U })))));
  const juGabungan = await db.jurnal.findFirstOrThrow({ where: { keterangan: `${KODE} gabungan isian` } });
  pastikan(juGabungan.perusahaanId === U && juGabungan.nomor.startsWith("JU"), "jurnal manual di gabungan memakai isian perusahaan");
  await db.perusahaan.update({ where: { id: U }, data: { aktif: false } });
  await dengan({ perusahaan: U }, () => harusDitolak("lingkup perusahaan yang diarsipkan", () => buatJurnalManual(formulir(isiJu(1000, "arsip"))), "sudah diarsipkan"));
  await harusDitolak("isian perusahaan yang diarsipkan", () => buatJurnalManual(formulir(isiJu(1000, "arsip", { perusahaanId: U }))), "sudah diarsipkan");
  await db.perusahaan.update({ where: { id: U }, data: { aktif: true } });
  const lingkupKasir = await dengan({ perusahaan: "semua", peran: "KASIR" }, () => lingkupPerusahaan());
  pastikan(lingkupKasir.perusahaanId === PERUSAHAAN_UTAMA && !lingkupKasir.bolehGabungan, "KASIR tanpa hak gabungan yang meminta gabungan tetap berlingkup utama");
  await dengan({ perusahaan: "semua", peran: "KASIR" }, () =>
    jalankan("KASIR kas masuk tanpa isian", () => buatKasMasuk(formulir({ akunKasId: kasB.id, akunLawanId: pendapatanB.id, jumlah: 12_000, keterangan: `${KODE} kasir utama` }))),
  );
  pastikan((await db.jurnal.findFirstOrThrow({ where: { keterangan: `${KODE} kasir utama` } })).perusahaanId === PERUSAHAAN_UTAMA, "KASIR tanpa isian: kas masuk milik perusahaan lingkupnya (utama), tidak pernah gabungan");
  await dengan({ peran: "KASIR" }, () =>
    jalankan("KASIR kas masuk dengan isian perusahaan uji", () => buatKasMasuk(formulir({ akunKasId: kasU.id, akunLawanId: pendapatanB.id, jumlah: 13_000, keterangan: `${KODE} kasir isian`, perusahaanId: U }))),
  );
  pastikan((await db.jurnal.findFirstOrThrow({ where: { keterangan: `${KODE} kasir isian` } })).perusahaanId === U, "KASIR dengan isian perusahaan aktif lain diterima (hak global, lingkup hanya tampilan)");

  console.log("=== 3. Persediaan: pemilik tunggal barang (D1 §9.1 kasus 4 dan 18) ===");
  const isiPs = (gudangId: string, baris: { barangId: string; jumlahSesudah: number; hargaSatuan?: number }[], akunLawanId = modalB.id, keterangan = `${KODE} PS`) => formulir({ gudangId, akunLawanId, keterangan, baris });
  await dengan({ perusahaan: U }, () => jalankan("PS saldo awal 50 barang perusahaan uji", () => buatPenyesuaianPersediaan(isiPs(gudangU.id, [{ barangId: barangU.id, jumlahSesudah: 50, hargaSatuan: 10_000 }], modalB.id, `${KODE} PS saldo awal`))));
  const psAwal = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { keterangan: `${KODE} PS saldo awal` }, include: { jurnal: true } });
  pastikan(psAwal.perusahaanId === U && psAwal.jurnal?.perusahaanId === U && psAwal.jurnal.nomor.startsWith("JU-PS"), "penyesuaian dan jurnal JU-PS milik pemilik barang (kasus 4)");
  await harusDitolak("PS dengan gudang milik utama", () => buatPenyesuaianPersediaan(isiPs(gudangUt.id, [{ barangId: barangU.id, jumlahSesudah: 5, hargaSatuan: 10_000 }])), `Gudang ${KODE}-WH-UT`);
  await harusDitolak("PS dengan barang dua pemilik", () => buatPenyesuaianPersediaan(isiPs(gudangB.id, [{ barangId: barangU.id, jumlahSesudah: 5, hargaSatuan: 10_000 }, { barangId: barangUt.id, jumlahSesudah: 5, hargaSatuan: 5_000 }])), "Satu dokumen hanya untuk barang milik satu perusahaan");
  await harusDitolak("PS dengan jasa: pesan lama lebih dulu", () => buatPenyesuaianPersediaan(isiPs(gudangB.id, [{ barangId: barangUt.id, jumlahSesudah: 5, hargaSatuan: 5_000 }, { barangId: jasaB.id, jumlahSesudah: 1 }])), "adalah JASA");
  await harusDitolak("PS dengan akun lawan milik utama", () => buatPenyesuaianPersediaan(isiPs(gudangU.id, [{ barangId: barangU.id, jumlahSesudah: 55, hargaSatuan: 10_000 }], modalUt.id)), `Akun ${KODE}-MODAL-UT`);
  pastikan((await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barangU.id, gudangId: gudangU.id } } })).jumlah.equals(D(50)), "penyesuaian yang ditolak tidak mengubah stok");
  await jalankan("PS saldo awal barang utama di gudang bersama", () => buatPenyesuaianPersediaan(isiPs(gudangB.id, [{ barangId: barangUt.id, jumlahSesudah: 10, hargaSatuan: 5_000 }], modalB.id, `${KODE} PS utama`)));
  const psUtama = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { keterangan: `${KODE} PS utama` }, include: { jurnal: true } });
  pastikan(psUtama.perusahaanId === PERUSAHAAN_UTAMA && psUtama.jurnal?.perusahaanId === PERUSAHAAN_UTAMA, "barang utama di gudang bersama: penyesuaian dan jurnal utama");
  aturPersetujuan(true);
  await dengan({ perusahaan: U }, () => jalankan("PS draf barang perusahaan uji", () => buatPenyesuaianPersediaan(isiPs(gudangU.id, [{ barangId: barangU.id, jumlahSesudah: 60, hargaSatuan: 10_000 }], modalB.id, `${KODE} PS draf`))));
  aturPersetujuan(false);
  const psDraf = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { keterangan: `${KODE} PS draf` } });
  pastikan(psDraf.statusPersetujuan === "DRAFT" && psDraf.perusahaanId === U, "PS draf saat persetujuan menyala milik pemilik barang");
  const posPs = await dalamTxBatal(async (tx) => {
    await BERKAS.penyesuaian.posting(tx, psDraf.id);
    return (await tx.penyesuaianPersediaan.findUniqueOrThrow({ where: { id: psDraf.id }, include: { jurnal: true } })).jurnal;
  });
  pastikan(posPs?.perusahaanId === U, "PS draf disetujui: jurnal milik perusahaan dokumen");
  // draf yang dibuat sebelum perusahaannya diarsipkan tidak bisa disetujui (tinjauan P15 butir 10A)
  await db.perusahaan.update({ where: { id: U }, data: { aktif: false } });
  try {
    await harusDitolak("setujui PS draf milik perusahaan arsip", () => dalamTxBatal((tx) => BERKAS.penyesuaian.posting(tx, psDraf.id)), "PT Uji Pewarisan sudah diarsipkan; aktifkan dulu");
  } finally {
    await db.perusahaan.update({ where: { id: U }, data: { aktif: true } });
  }
  pastikan((await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barangU.id, gudangId: gudangU.id } } })).jumlah.equals(D(50)), "PS draf perusahaan arsip yang ditolak tidak mengubah stok");
  nomorLog.push(psDraf.nomor);
  await jalankan("hapus PS draf", () => hapusDokumen("penyesuaian", psDraf.id));

  const isiPb = (asal: string, tujuan: string, baris: { barangId: string; jumlah: number }[], keterangan = `${KODE} PB`) => formulir({ gudangAsalId: asal, gudangTujuanId: tujuan, keterangan, baris });
  await jalankan("PB barang perusahaan uji ke gudang bersama", () => buatPindahBarang(isiPb(gudangU.id, gudangB.id, [{ barangId: barangU.id, jumlah: 10 }], `${KODE} PB ke bersama`)));
  const pb = await db.pindahBarang.findFirstOrThrow({ where: { keterangan: `${KODE} PB ke bersama` } });
  pastikan(pb.perusahaanId === U, "pindah barang milik pemilik barang (tanpa jurnal)");
  await harusDitolak("PB ke gudang milik utama", () => buatPindahBarang(isiPb(gudangU.id, gudangUt.id, [{ barangId: barangU.id, jumlah: 1 }])), `Gudang ${KODE}-WH-UT`);
  await harusDitolak("PB barang dua pemilik", () => buatPindahBarang(isiPb(gudangB.id, gudangU.id, [{ barangId: barangU.id, jumlah: 1 }, { barangId: barangUt.id, jumlah: 1 }])), "Satu dokumen hanya untuk barang milik satu perusahaan");
  pastikan((await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barangUt.id, gudangId: gudangB.id } } })).jumlah.equals(D(10)), "pindah barang yang ditolak tidak mengubah stok");
  // tinjauan P13 butir 8: isian perusahaan yang berbeda dari pemilik barang ditolak, bukan diabaikan
  await harusDitolak("PS dengan isian perusahaan selain pemilik barang", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudangU.id, akunLawanId: modalB.id, perusahaanId: PERUSAHAAN_UTAMA, baris: [{ barangId: barangU.id, jumlahSesudah: 45, hargaSatuan: 10_000 }] })), "dokumen persediaan harus di perusahaan pemilik barang");
  await harusDitolak("PB dengan isian perusahaan selain pemilik barang", () => buatPindahBarang(formulir({ gudangAsalId: gudangB.id, gudangTujuanId: gudangU.id, perusahaanId: PERUSAHAAN_UTAMA, baris: [{ barangId: barangU.id, jumlah: 1 }] })), "dokumen persediaan harus di perusahaan pemilik barang");
  await harusDitolak("PJ dengan isian perusahaan selain pemilik barang", () => buatPeminjamanBarang(denganFoto({ gudangId: gudangU.id, namaPengambil: "Uji", nomorTelepon: "+6281234567890", perusahaanId: PERUSAHAAN_UTAMA, baris: [{ barangId: barangU.id, jumlah: 1 }] })), "dokumen persediaan harus di perusahaan pemilik barang");
  await jalankan("PB dengan isian perusahaan sama dengan pemilik barang", () => buatPindahBarang(formulir({ gudangAsalId: gudangB.id, gudangTujuanId: gudangU.id, perusahaanId: U, keterangan: `${KODE} PB isian`, baris: [{ barangId: barangU.id, jumlah: 1 }] })));
  pastikan((await db.pindahBarang.findFirstOrThrow({ where: { keterangan: `${KODE} PB isian` } })).perusahaanId === U, "isian perusahaan yang sama dengan pemilik barang diterima");
  pastikan((await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barangU.id, gudangId: gudangU.id } } })).jumlah.equals(D(41)), "stok sesudah PS dan PB yang ditolak hanya berubah oleh PB yang diterima");
  // tinjauan P13 butir 4: barang milik perusahaan arsip tidak bisa dibukukan atau dipindah sampai perusahaannya diaktifkan
  await db.perusahaan.update({ where: { id: U }, data: { aktif: false } });
  try {
    await harusDitolak("PS barang perusahaan arsip", () => buatPenyesuaianPersediaan(isiPs(gudangU.id, [{ barangId: barangU.id, jumlahSesudah: 45, hargaSatuan: 10_000 }])), "PT Uji Pewarisan sudah diarsipkan; aktifkan dulu");
    await harusDitolak("PB barang perusahaan arsip", () => buatPindahBarang(isiPb(gudangU.id, gudangB.id, [{ barangId: barangU.id, jumlah: 1 }])), "sudah diarsipkan; aktifkan dulu");
    await harusDitolak("PJ barang perusahaan arsip", () => buatPeminjamanBarang(denganFoto({ gudangId: gudangU.id, namaPengambil: "Uji", nomorTelepon: "+6281234567890", baris: [{ barangId: barangU.id, jumlah: 1 }] })), "sudah diarsipkan; aktifkan dulu");
    await harusDitolak("BR barang perusahaan arsip", () => buatLaporanKerusakan(denganFoto({ gudangId: gudangU.id, namaPelapor: "Uji", baris: [{ barangId: barangU.id, jumlah: 1 }] })), "sudah diarsipkan; aktifkan dulu");
    await harusDitolak("koreksi stok barang perusahaan arsip", () => ubahStokBarang(barangU.id, formulir({ gudangId: gudangU.id, stok: 45, akunLawanId: modalB.id })), "sudah diarsipkan; aktifkan dulu");
    await jalankan("PS barang utama tetap bisa saat perusahaan lain diarsipkan", () => buatPenyesuaianPersediaan(isiPs(gudangB.id, [{ barangId: barangUt.id, jumlahSesudah: 12, hargaSatuan: 5_000 }], modalB.id, `${KODE} PS utama arsip`)));
  } finally {
    await db.perusahaan.update({ where: { id: U }, data: { aktif: true } });
  }
  pastikan((await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barangU.id, gudangId: gudangU.id } } })).jumlah.equals(D(41)), "dokumen persediaan perusahaan arsip yang ditolak tidak mengubah stok");

  await jalankan("BR barang perusahaan uji di gudang bersama", () => buatLaporanKerusakan(denganFoto({ gudangId: gudangB.id, namaPelapor: "Uji", keterangan: `${KODE} BR`, baris: [{ barangId: barangU.id, jumlah: 1 }] })));
  const br = await db.laporanKerusakanBarang.findFirstOrThrow({ where: { keterangan: `${KODE} BR` } });
  pastikan(br.perusahaanId === U, "laporan kerusakan milik pemilik barang");
  await harusDitolak("BR di gudang milik utama", () => buatLaporanKerusakan(denganFoto({ gudangId: gudangUt.id, namaPelapor: "Uji", baris: [{ barangId: barangU.id, jumlah: 1 }] })), `Gudang ${KODE}-WH-UT`);
  await harusDitolak("tautkan penyesuaian perusahaan lain ke BR", () => tautkanPenyesuaianKerusakan(br.id, formulir({ penyesuaianId: psUtama.id })), `Penyesuaian ${psUtama.nomor} milik perusahaan lain`);
  await jalankan("PJ barang perusahaan uji untuk event utama", () =>
    buatPeminjamanBarang(denganFoto({ gudangId: gudangU.id, namaPengambil: "Uji", nomorTelepon: "+6281234567890", keterangan: `${KODE} PJ`, proyekId: proyekUt.id, baris: [{ barangId: barangU.id, jumlah: 2 }] })),
  );
  const pj = await db.peminjamanBarang.findFirstOrThrow({ where: { keterangan: `${KODE} PJ` } });
  pastikan(pj.perusahaanId === U && pj.proyekId === proyekUt.id, "peminjaman milik pemilik barang; proyek perusahaan lain boleh (catatan B)");
  // BR dan PJ dihapus lagi sebelum siklus beli: harga rata-rata pembelian berikutnya tidak menimbang barang yang
  // sedang rusak atau dipinjam (perilaku lama stok.ts), jadi sinkron persediaan di bagian 9 hanya bermakna tanpa keduanya
  nomorLog.push(br.nomor, pj.nomor);
  await jalankan("hapus BR uji", () => hapusDokumen("laporanKerusakan", br.id));
  await jalankan("hapus PJ uji", () => hapusDokumen("peminjamanBarang", pj.id));
  await harusDitolak("PJ barang dua pemilik", () => buatPeminjamanBarang(denganFoto({ gudangId: gudangB.id, namaPengambil: "Uji", nomorTelepon: "+6281234567890", baris: [{ barangId: barangU.id, jumlah: 1 }, { barangId: barangUt.id, jumlah: 1 }] })), "Satu dokumen hanya untuk barang milik satu perusahaan");

  console.log("=== 4. Pembelian: dokumen akar dan anak (D1 §9.1 kasus 6 dan 18) ===");
  const isiPsb = (barangId: string, proyekId: string) => formulir({ pemasokId: pemasok.id, proyekId, baris: [{ barangId, jumlah: 20, harga: 9_000 }] });
  await dengan({ perusahaan: U }, () => harusDitolak("PSB perusahaan uji dengan barang utama", () => buatPesananPembelian(isiPsb(barangUt.id, proyekU.id)), `${KODE}-BRG-UT - Barang Uji Pewarisan Utama milik`));
  await dengan({ perusahaan: U }, () => harusDitolak("PSB perusahaan uji dengan proyek utama", () => buatPesananPembelian(isiPsb(barangU.id, proyekUt.id)), `Proyek ${KODE}-PRJ-UT milik`));
  await dengan({ perusahaan: U }, () => jalankan("PSB 20 barang perusahaan uji", () => buatPesananPembelian(isiPsb(barangU.id, proyekU.id))));
  const psb = await db.pesananPembelian.findFirstOrThrow({ where: { pemasokId: pemasok.id }, include: { baris: true } });
  pastikan(psb.perusahaanId === U && psb.proyekId === proyekU.id, "PSB milik perusahaan lingkup, proyek perusahaan itu");
  const isiTb = (gudangId: string, tambahan: Record<string, string> = {}) => formulir({ pesananId: psb.id, gudangId, baris: [{ barisPesananId: psb.baris[0].id, barangId: barangU.id, jumlah: 20 }], ...tambahan });
  await harusDitolak("TB ke gudang milik utama", () => buatPenerimaanBarang(isiTb(gudangUt.id)), `Gudang ${KODE}-WH-UT`);
  await harusDitolak("TB dengan isian perusahaan lain dari induk", () => buatPenerimaanBarang(isiTb(gudangU.id, { perusahaanId: PERUSAHAAN_UTAMA })), `Dokumen induk ${psb.nomor} milik perusahaan lain`);
  // tinjauan P13 butir 2: barang baris formulir wajib sama dengan barang baris pesanan
  await harusDitolak("TB dengan barang yang beda dari baris pesanan", () => buatPenerimaanBarang(formulir({ pesananId: psb.id, gudangId: gudangU.id, baris: [{ barisPesananId: psb.baris[0].id, barangId: barangUt.id, jumlah: 1 }] })), "Barang tidak sesuai baris pesanan");
  pastikan((await db.stokBarang.count({ where: { barangId: barangUt.id, gudangId: gudangU.id } })) === 0, "TB yang ditolak tidak menambah stok barang utama");
  // dokumen anak tidak membaca lingkup: dibuat di lingkup utama tetap mewarisi pesanan
  await jalankan("TB 20 ke gudang perusahaan uji", () => buatPenerimaanBarang(isiTb(gudangU.id)));
  const tb = await db.penerimaanBarang.findFirstOrThrow({ where: { pesananId: psb.id }, include: { jurnal: true } });
  pastikan(tb.perusahaanId === U && tb.jurnal?.perusahaanId === U && tb.jurnal.proyekId === proyekU.id, "TB dan jurnal JU-TB milik perusahaan pesanan, berproyek");
  // tinjauan P13 butir 6: penerimaan yang ditaut faktur harus milik pesanan faktur itu
  await jalankan("PSB utama untuk penerimaan pesanan lain", () => buatPesananPembelian(formulir({ pemasokId: pemasok.id, keterangan: `${KODE} PSB lain`, baris: [{ barangId: barangUt.id, jumlah: 1, harga: 5_000 }] })));
  const psbLain = await db.pesananPembelian.findFirstOrThrow({ where: { pemasokId: pemasok.id, NOT: { id: psb.id } }, include: { baris: true } });
  await jalankan("TB pesanan utama", () => buatPenerimaanBarang(formulir({ pesananId: psbLain.id, gudangId: gudangB.id, baris: [{ barisPesananId: psbLain.baris[0].id, barangId: barangUt.id, jumlah: 1 }] })));
  const tbLain = await db.penerimaanBarang.findFirstOrThrow({ where: { pesananId: psbLain.id } });
  await harusDitolak("FB menaut penerimaan pesanan lain", () => buatFakturPembelian(formulir({ pesananId: psb.id, penerimaanId: tbLain.id, baris: [{ barangId: barangU.id, jumlah: 20, harga: 9_000 }] })), "Penerimaan barang tidak sesuai pesanan pembelian ini");
  await harusDitolak("FB menaut penerimaan yang tidak ada", () => buatFakturPembelian(formulir({ pesananId: psb.id, penerimaanId: "tidak-ada", baris: [{ barangId: barangU.id, jumlah: 20, harga: 9_000 }] })), "Penerimaan barang tidak sesuai pesanan pembelian ini");
  nomorLog.push(tbLain.nomor, psbLain.nomor);
  await jalankan("hapus TB pesanan utama", () => hapusDokumen("penerimaanBarang", tbLain.id));
  await jalankan("hapus PSB utama", () => hapusDokumen("pesananPembelian", psbLain.id));
  await jalankan("FB 20 menaut penerimaan pesanannya", () => buatFakturPembelian(formulir({ pesananId: psb.id, penerimaanId: tb.id, baris: [{ barangId: barangU.id, jumlah: 20, harga: 9_000 }] })));
  const fb = await db.fakturPembelian.findFirstOrThrow({ where: { pesananId: psb.id }, include: { jurnal: true } });
  pastikan(fb.perusahaanId === U && fb.jurnal?.perusahaanId === U && fb.penerimaanId === tb.id, "FB dan jurnal JU-FB milik perusahaan pesanan, menaut TB pesanannya");
  pastikan(!!fb.jatuhTempo && hariDari(fb.tanggal, fb.jatuhTempo) === 30, `jatuh tempo FB memakai termin perusahaan pesanan (${fb.jatuhTempo ? hariDari(fb.tanggal, fb.jatuhTempo) : "-"} hari)`);
  await harusDitolak("BYR dari kas milik utama", () => buatPembayaranPembelian(formulir({ fakturId: fb.id, akunId: kasUt.id, jumlah: 100_000 })), `Akun ${KODE}-KAS-UT`);
  await jalankan("BYR 100.000 dari kas perusahaan uji", () => buatPembayaranPembelian(formulir({ fakturId: fb.id, akunId: kasU.id, jumlah: 100_000 })));
  const byr = await db.pembayaranPembelian.findFirstOrThrow({ where: { fakturId: fb.id }, include: { jurnal: true } });
  pastikan(byr.perusahaanId === U && byr.jurnal?.perusahaanId === U, "BYR dan jurnal JU-BYR milik perusahaan faktur");
  await harusDitolak("RB dari gudang milik utama", () => buatReturPembelian(formulir({ fakturId: fb.id, gudangId: gudangUt.id, baris: [{ barangId: barangU.id, jumlah: 2 }] })), `Gudang ${KODE}-WH-UT`);
  await jalankan("RB 2 dari gudang perusahaan uji", () => buatReturPembelian(formulir({ fakturId: fb.id, gudangId: gudangU.id, baris: [{ barangId: barangU.id, jumlah: 2 }] })));
  const rb = await db.returPembelian.findFirstOrThrow({ where: { fakturId: fb.id }, include: { jurnal: true } });
  pastikan(rb.perusahaanId === U && rb.jurnal?.perusahaanId === U, "RB dan jurnal JU-RB milik perusahaan faktur");

  console.log("=== 5. Kas, jurnal manual, dan prive (D1 §9.1 kasus 7, 8, 9) ===");
  const isiKas = (akunKasId: string, akunLawanId: string, jumlah: number, keterangan: string) => formulir({ akunKasId, akunLawanId, jumlah, keterangan: `${KODE} ${keterangan}` });
  await dengan({ perusahaan: U }, () => jalankan("KM 50.000 perusahaan uji", () => buatKasMasuk(isiKas(kasU.id, pendapatanB.id, 50_000, "KM"))));
  pastikan((await db.jurnal.findFirstOrThrow({ where: { keterangan: `${KODE} KM` } })).perusahaanId === U, "jurnal KM langsung milik perusahaan lingkup (kasus 7)");
  await dengan({ perusahaan: U }, () => harusDitolak("KK langsung dengan kas milik utama", () => buatKasKeluar(isiKas(kasUt.id, bebanB.id, 30_000, "KK salah")), `Akun ${KODE}-KAS-UT`));
  aturPersetujuan(true);
  await dengan({ perusahaan: U }, () => jalankan("KK draf 30.000 perusahaan uji", () => buatKasKeluar(isiKas(kasU.id, bebanB.id, 30_000, "KK draf"))));
  await dengan({ perusahaan: U }, () => harusDitolak("KK draf dengan kas milik utama", () => buatKasKeluar(isiKas(kasUt.id, bebanB.id, 30_000, "KK draf salah")), `Akun ${KODE}-KAS-UT`));
  aturPersetujuan(false);
  const kkDraf = await db.dokumenKas.findFirstOrThrow({ where: { keterangan: `${KODE} KK draf` } });
  pastikan(kkDraf.perusahaanId === U && kkDraf.statusPersetujuan === "DRAFT" && (await db.dokumenKas.count({ where: { keterangan: `${KODE} KK draf salah` } })) === 0, "dokumen kas draf milik perusahaan lingkup; draf berakun utama tidak tersimpan");
  const posKk = await dalamTxBatal(async (tx) => {
    await BERKAS.dokumenKas.posting(tx, kkDraf.id);
    return (await tx.dokumenKas.findUniqueOrThrow({ where: { id: kkDraf.id }, include: { jurnal: true } })).jurnal;
  });
  pastikan(posKk?.perusahaanId === U && posKk.nomor.startsWith("KK"), "KK draf disetujui: jurnal KK milik perusahaan dokumen (kasus 8)");
  nomorLog.push(kkDraf.nomor);
  await jalankan("hapus KK draf", () => hapusDokumen("dokumenKas", kkDraf.id));

  await dengan({ perusahaan: U }, () => jalankan("JU manual perusahaan uji berproyek", () => buatJurnalManual(formulir(isiJu(75_000, "JU", { proyekId: proyekU.id })))));
  const ju = await db.jurnal.findFirstOrThrow({ where: { keterangan: `${KODE} JU` } });
  pastikan(ju.perusahaanId === U && ju.proyekId === proyekU.id && ju.sumber === "MANUAL", "jurnal manual milik perusahaan lingkup dengan proyek perusahaan itu (kasus 9)");
  await dengan({ perusahaan: U }, () => harusDitolak("JU dengan proyek utama", () => buatJurnalManual(formulir(isiJu(1000, "JU proyek salah", { proyekId: proyekUt.id }))), `Proyek ${KODE}-PRJ-UT milik`));
  await dengan({ perusahaan: U }, () =>
    harusDitolak("JU dengan kas milik utama", () => buatJurnalManual(formulir({ keterangan: "x", baris: [{ akunId: kasUt.id, debit: 1000, kredit: 0 }, { akunId: pendapatanB.id, debit: 0, kredit: 1000 }] })), `Akun ${KODE}-KAS-UT`),
  );
  const isiPrive = (akunKasId: string, keterangan: string) => formulir({ pemilikNama: "Uji Pewarisan", akunKasId, akunPriveId: priveB.id, jumlah: 40_000, keterangan: `${KODE} ${keterangan}` });
  await dengan({ perusahaan: U }, () => jalankan("prive perusahaan uji", () => buatPrive(isiPrive(kasU.id, "PRV"))));
  const prive = await db.prive.findFirstOrThrow({ where: { keterangan: `${KODE} PRV` }, include: { jurnal: true } });
  pastikan(prive.perusahaanId === U && prive.jurnal?.perusahaanId === U && prive.jurnal.nomor.startsWith("PRV"), "prive dan jurnal PRV milik perusahaan lingkup (kasus 9)");
  await dengan({ perusahaan: U }, () => harusDitolak("prive dari kas milik utama", () => buatPrive(isiPrive(kasUt.id, "PRV salah")), `Akun ${KODE}-KAS-UT`));

  console.log("=== 6. Barang dan stok dari data induk (D1 §3.5, §9.1 kasus 23) ===");
  const isiBarang = (kode: string, isian: Record<string, string | number>) => formulir({ kode: `${KODE}-${kode}`, nama: `Barang ${kode}`, satuan: "pcs", hargaBeli: 10_000, hargaJual: 20_000, ...isian });
  await harusDitolak("BARANG dijadikan bersama", () => buatDataInduk("barang", isiBarang("BRG-B", { jenis: "BARANG", perusahaanId: NILAI_BERSAMA })), "Barang jenis BARANG wajib milik satu perusahaan");
  await jalankan("jasa bersama lewat data induk", () => buatDataInduk("barang", isiBarang("JSA2", { jenis: "JASA", perusahaanId: NILAI_BERSAMA })));
  const jasa2 = await db.barang.findUniqueOrThrow({ where: { kode: `${KODE}-JSA2` } });
  pastikan(jasa2.perusahaanId === null, "opsi Bersama menyimpan jasa tanpa pemilik");
  await harusDitolak("barang dengan perusahaan arsip", async () => {
    await db.perusahaan.update({ where: { id: U }, data: { aktif: false } });
    try {
      await buatDataInduk("barang", isiBarang("BRG-ARSIP", { jenis: "BARANG", perusahaanId: U }));
    } finally {
      await db.perusahaan.update({ where: { id: U }, data: { aktif: true } });
    }
  }, "sudah diarsipkan");
  await harusDitolak("jumlah awal di gudang milik utama", () => buatDataInduk("barang", isiBarang("BRG-AWAL", { jenis: "BARANG", perusahaanId: U, jumlahAwal: 5, gudangAwalId: gudangUt.id, akunLawanAwalId: modalB.id })), `Gudang ${KODE}-WH-UT`);
  pastikan((await db.barang.count({ where: { kode: `${KODE}-BRG-AWAL` } })) === 0, "barang dengan jumlah awal yang ditolak tidak tersimpan");
  await harusDitolak("jumlah awal dengan akun lawan milik utama", () => buatDataInduk("barang", isiBarang("BRG-AWAL", { jenis: "BARANG", perusahaanId: U, jumlahAwal: 5, gudangAwalId: gudangU.id, akunLawanAwalId: modalUt.id })), `Akun ${KODE}-MODAL-UT`);
  await jalankan("barang perusahaan uji dengan jumlah awal", () => buatDataInduk("barang", isiBarang("BRG-AWAL", { jenis: "BARANG", perusahaanId: U, jumlahAwal: 5, gudangAwalId: gudangU.id, akunLawanAwalId: modalB.id, deskripsi: "Sound system 1000 watt" })));
  const barangAwal = await db.barang.findUniqueOrThrow({ where: { kode: `${KODE}-BRG-AWAL` } });
  const psBarangAwal = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { baris: { some: { barangId: barangAwal.id } } }, include: { jurnal: true } });
  pastikan(barangAwal.perusahaanId === U && barangAwal.deskripsi === "Sound system 1000 watt" && psBarangAwal.perusahaanId === U && psBarangAwal.jurnal?.perusahaanId === U, "barang, deskripsi katalog, penyesuaian jumlah awal, dan jurnalnya milik perusahaan isian");
  await harusDitolak("deskripsi katalog lebih dari 3000 karakter", () => buatDataInduk("barang", isiBarang("BRG-PANJANG", { jenis: "BARANG", deskripsi: "a".repeat(3001) })), "Deskripsi katalog maksimal 3000 karakter");
  await jalankan("barang tanpa isian perusahaan (pemanggil lama)", () => buatDataInduk("barang", isiBarang("BRG-LAMA", { jenis: "BARANG" })));
  pastikan((await db.barang.findUniqueOrThrow({ where: { kode: `${KODE}-BRG-LAMA` } })).perusahaanId === PERUSAHAAN_UTAMA, "barang tanpa isian perusahaan tetap milik utama (bawaan basis data, perilaku lama)");
  await harusDitolak("koreksi stok di gudang milik utama", () => ubahStokBarang(barangU.id, formulir({ gudangId: gudangUt.id, stok: 3, akunLawanId: modalB.id })), `Gudang ${KODE}-WH-UT`);
  await harusDitolak("koreksi stok dengan akun lawan milik utama", () => ubahStokBarang(barangU.id, formulir({ gudangId: gudangU.id, stok: 3, akunLawanId: modalUt.id })), `Akun ${KODE}-MODAL-UT`);
  const ubahBarang = (b: { id: string; kode: string; nama: string; jenis: string }, perusahaanId: string) => ubahDataInduk("barang", b.id, formulir({ kode: b.kode, nama: b.nama, jenis: b.jenis, satuan: "pcs", perusahaanId }));
  await harusDitolak("ganti pemilik barang yang punya stok", () => ubahBarang(barangU, PERUSAHAAN_UTAMA), "Pemilik barang tidak bisa diganti");
  await harusDitolak("barang stok yang punya transaksi dijadikan bersama", () => ubahBarang(barangU, NILAI_BERSAMA), "Barang jenis BARANG wajib milik satu perusahaan");
  await jalankan("jasa bersama tanpa transaksi diberi pemilik", () => ubahBarang(jasa2, U));
  pastikan((await db.barang.findUniqueOrThrow({ where: { id: jasa2.id } })).perusahaanId === U, "jasa tanpa transaksi boleh diberi pemilik");
  await jalankan("jasa dikembalikan menjadi bersama", () => ubahBarang(jasa2, NILAI_BERSAMA));
  pastikan((await db.barang.findUniqueOrThrow({ where: { id: jasa2.id } })).perusahaanId === null, "opsi Bersama di formulir ubah mengosongkan pemilik jasa");
  const galatCheck = await jalankanFormulir(async () => {
    await db.barang.create({ data: { kode: `${KODE}-BRG-NULL`, nama: "Barang Tanpa Pemilik", jenis: "BARANG", perusahaanId: null } });
  });
  pastikan(galatCheck.galat === "Barang jenis BARANG wajib milik satu perusahaan. Pilih perusahaan pemiliknya.", `barang stok tanpa perusahaan ditolak CHECK basis data dengan pesan ramah: "${galatCheck.galat}"`);

  console.log("=== 7. Ganti pemilik akun, gudang, proyek, karyawan (D1 §3.5 butir 2, D5 §4.7) ===");
  const ubahAkun = (a: { id: string; kode: string; nama: string; jenis: string; kasBank: boolean }, perusahaanId: string) =>
    ubahDataInduk("akun", a.id, formulir({ kode: a.kode, nama: a.nama, jenis: a.jenis, ...(a.kasBank ? { kasBank: "on" } : {}), perusahaanId }));
  await harusDitolak("akun yang dipakai jurnal dua perusahaan diberi pemilik", () => ubahAkun(pendapatanB, U), `Akun ${KODE}-PDPT sudah dipakai jurnal DPRO`);
  await harusDitolak("akun yang dipakai jurnal perusahaan uji dijadikan milik utama", () => ubahAkun(kasU, PERUSAHAAN_UTAMA), `Akun ${KODE}-KAS-U sudah dipakai jurnal ${KODE}; tidak bisa dijadikan milik`);
  await jalankan("akun dijadikan bersama", () => ubahAkun(kasU, ""));
  pastikan((await db.akun.findUniqueOrThrow({ where: { id: kasU.id } })).perusahaanId === null, "menjadi akun bersama selalu boleh");
  await jalankan("akun dikembalikan ke perusahaan yang memakainya", () => ubahAkun(kasU, U));
  const kasUBaru = await db.akun.findUniqueOrThrow({ where: { id: kasU.id } });
  pastikan(kasUBaru.perusahaanId === U && kasUBaru.kasBank, "akun yang hanya dipakai jurnal perusahaan itu boleh dijadikan miliknya");
  const ubahGudang = (g: { id: string; kode: string; nama: string }, perusahaanId: string) => ubahDataInduk("gudang", g.id, formulir({ kode: g.kode, nama: g.nama, perusahaanId }));
  await harusDitolak("gudang yang menyimpan stok perusahaan uji dijadikan milik utama", () => ubahGudang(gudangU, PERUSAHAAN_UTAMA), `Gudang ${KODE}-WH-U masih dipakai stok atau dokumen ${KODE}`);
  await harusDitolak("gudang bersama yang dipakai dua perusahaan diberi pemilik", () => ubahGudang(gudangB, U), "masih dipakai stok atau dokumen DPRO");
  await jalankan("gudang baru tanpa pemakaian", () => buatDataInduk("gudang", formulir({ kode: `${KODE}-WH-X`, nama: "Gudang Uji Kosong", perusahaanId: "" })));
  const gudangX = await db.gudang.findUniqueOrThrow({ where: { kode: `${KODE}-WH-X` } });
  pastikan(gudangX.perusahaanId === null, "isian pemilik gudang kosong = gudang bersama");
  await jalankan("gudang tanpa pemakaian diberi pemilik", () => ubahGudang(gudangX, U));
  pastikan((await db.gudang.findUniqueOrThrow({ where: { id: gudangX.id } })).perusahaanId === U, "gudang tanpa pemakaian boleh diberi pemilik");

  const isiProyek = (kode: string, isian: Record<string, string>) => formulir({ kode: `${KODE}-${kode}`, nama: `Event ${kode}`, status: "BERJALAN", ...isian });
  const ubahProyek = (p: { id: string; kode: string; nama: string }, isian: Record<string, string>) => ubahDataInduk("proyek", p.id, formulir({ kode: p.kode, nama: p.nama, status: "BERJALAN", ...isian }));
  await harusDitolak("proyek yang punya jurnal dan dokumen dipindah perusahaan", () => ubahProyek(proyekU, { perusahaanId: PERUSAHAAN_UTAMA }), `Proyek ${KODE}-PRJ-U sudah punya jurnal atau dokumen ${KODE}`);
  await jalankan("PJ kedua barang perusahaan uji untuk event utama", () =>
    buatPeminjamanBarang(denganFoto({ gudangId: gudangU.id, namaPengambil: "Uji", nomorTelepon: "+6281234567890", keterangan: `${KODE} PJ2`, proyekId: proyekUt.id, baris: [{ barangId: barangU.id, jumlah: 1 }] })),
  );
  const pj2 = await db.peminjamanBarang.findFirstOrThrow({ where: { keterangan: `${KODE} PJ2` } });
  await jalankan("proyek yang hanya dipakai peminjaman perusahaan lain dipindah (catatan B)", () => ubahProyek(proyekUt, { perusahaanId: U }));
  pastikan((await db.proyek.findUniqueOrThrow({ where: { id: proyekUt.id } })).perusahaanId === U, "peminjaman lintas perusahaan tidak menahan pemilik proyek");
  await jalankan("proyek dikembalikan ke utama", () => ubahProyek(proyekUt, { perusahaanId: PERUSAHAAN_UTAMA }));
  nomorLog.push(pj2.nomor);
  await jalankan("hapus PJ kedua", () => hapusDokumen("peminjamanBarang", pj2.id));
  await harusDitolak("proyek tanpa perusahaan", () => buatDataInduk("proyek", isiProyek("PRJ-X", { perusahaanId: "" })), "Perusahaan pemilik event wajib diisi");
  await harusDitolak("status proyek tidak dikenal", () => buatDataInduk("proyek", isiProyek("PRJ-X", { perusahaanId: U, status: "AKTIF" })), "Status proyek tidak dikenal");
  await harusDitolak("tanggal selesai sebelum mulai", () => buatDataInduk("proyek", isiProyek("PRJ-X", { perusahaanId: U, tanggalMulai: "2026-03-10", tanggalSelesai: "2026-03-09" })), "Tanggal selesai tidak boleh sebelum tanggal mulai");
  await harusDitolak("nama klien lebih dari 160 karakter", () => buatDataInduk("proyek", isiProyek("PRJ-X", { perusahaanId: U, namaKlien: "k".repeat(161) })), "Nama klien maksimal 160 karakter");
  await jalankan("proyek baru perusahaan uji", () => buatDataInduk("proyek", isiProyek("PRJ-X", { perusahaanId: U, namaKlien: "Klien Uji", tanggalMulai: "2026-03-10", tanggalSelesai: "2026-03-12" })));
  const proyekX = await db.proyek.findUniqueOrThrow({ where: { kode: `${KODE}-PRJ-X` } });
  pastikan(proyekX.perusahaanId === U && proyekX.namaKlien === "Klien Uji" && proyekX.status === "BERJALAN", "proyek baru dengan pemilik, nama klien, dan status");
  await harusDitolak("ubah status proyek tidak dikenal", () => ubahProyek(proyekX, { perusahaanId: U, status: "AKTIF" }), "Status proyek tidak dikenal");
  await harusDitolak("ubah tanggal selesai sebelum mulai", () => ubahProyek(proyekX, { perusahaanId: U, tanggalMulai: "2026-03-10", tanggalSelesai: "2026-03-01" }), "Tanggal selesai tidak boleh sebelum tanggal mulai");
  await jalankan("status proyek BERJALAN menjadi DITUNDA", () => ubahProyek(proyekX, { perusahaanId: U, status: "DITUNDA", namaKlien: "Klien Uji" }));
  const logStatus = await db.logAktivitas.findMany({ where: { aksi: "UBAH_STATUS", nomor: proyekX.kode } });
  pastikan(
    logStatus.length === 1 && logStatus[0].modul === "proyek" && logStatus[0].jenis === "Proyek" && logStatus[0].entitasId === proyekX.id && logStatus[0].keterangan === "Status Berjalan menjadi Ditunda" && logStatus[0].perusahaanId === U && (logStatus[0].meta as { dari?: string } | null)?.dari === "BERJALAN" && (logStatus[0].meta as { ke?: string } | null)?.ke === "DITUNDA",
    `satu log UBAH_STATUS modul proyek: "${logStatus[0]?.keterangan}"`,
  );
  await jalankan("ubah proyek tanpa ganti status", () => ubahProyek(proyekX, { perusahaanId: U, status: "DITUNDA", keterangan: "catatan" }));
  pastikan((await db.logAktivitas.count({ where: { aksi: "UBAH_STATUS", nomor: proyekX.kode } })) === 1, "ubah tanpa ganti status tidak menulis log status");
  await jalankan("proyek tanpa pemakaian dipindah ke utama", () => ubahProyek(proyekX, { perusahaanId: PERUSAHAAN_UTAMA, status: "DIARSIP" }));
  const aktif = await daftarProyekAktif(db);
  pastikan((await db.proyek.findUniqueOrThrow({ where: { id: proyekX.id } })).perusahaanId === PERUSAHAAN_UTAMA && !aktif.some((p) => p.id === proyekX.id), "proyek tanpa jurnal dan dokumen boleh dipindah; proyek DIARSIP tidak muncul di daftarProyekAktif");

  await dengan({ perusahaan: U }, () =>
    jalankan("penggajian perusahaan uji", () => buatPenggajian(formulir({ periode: PERIODE_GAJI, tanggal: `${PERIODE_GAJI}-25`, akunKasId: kasU.id, baris: [{ karyawanId: karyawanU.id, gajiPokok: 1_000_000, tunjangan: 0, potongan: 0 }] }))),
  );
  const isiKaryawan = (kode: string, nama: string, isian: Record<string, string | number>) => formulir({ kode, nama, status: "AKTIF", gajiPokok: 1_000_000, tunjangan: 0, ...isian });
  await harusDitolak("karyawan yang sudah digaji dipindah perusahaan", () => ubahDataInduk("karyawan", karyawanU.id, isiKaryawan(karyawanU.kode, karyawanU.nama, { perusahaanId: PERUSAHAAN_UTAMA })), `Karyawan ${KODE}-KRY-U sudah masuk penggajian ${KODE}`);
  await harusDitolak("karyawan tanpa perusahaan", () => buatDataInduk("karyawan", isiKaryawan(`${KODE}-KRY-X`, "Karyawan X", { perusahaanId: "" })), "Perusahaan pemberi kerja wajib diisi");
  await jalankan("karyawan tanpa isian perusahaan (pemanggil lama)", () => buatDataInduk("karyawan", isiKaryawan(`${KODE}-KRY-LAMA`, "Karyawan Lama", {})));
  pastikan((await db.karyawan.findUniqueOrThrow({ where: { kode: `${KODE}-KRY-LAMA` } })).perusahaanId === PERUSAHAAN_UTAMA, "karyawan tanpa isian perusahaan tetap milik utama (bawaan basis data)");
  await db.perusahaan.update({ where: { id: U }, data: { aktif: false } });
  await harusDitolak("karyawan baru untuk perusahaan arsip", () => buatDataInduk("karyawan", isiKaryawan(`${KODE}-KRY-ARSIP`, "Karyawan Arsip", { perusahaanId: U })), "sudah diarsipkan");
  await jalankan("ubah karyawan perusahaan arsip tanpa ganti pemilik", () => ubahDataInduk("karyawan", karyawanU.id, isiKaryawan(karyawanU.kode, karyawanU.nama, { perusahaanId: U, jabatan: "Kru" })));
  await db.perusahaan.update({ where: { id: U }, data: { aktif: true } });
  pastikan((await db.karyawan.findUniqueOrThrow({ where: { id: karyawanU.id } })).jabatan === "Kru", "data perusahaan arsip tetap bisa diubah selama pemiliknya tidak diganti");

  console.log("=== 7b. Rujukan akun dan akun khusus (tinjauan P13 butir 1 dan 3) ===");
  const akunRuj = await akunBaru("RUJ", "Akun Uji Rujukan", "ASET", null);
  const ruj = { ...akunRuj, jenis: "ASET" };
  const bebanUt = await akunBaru("BEBAN-UT", "Beban Uji Pewarisan Utama", "BEBAN", PERUSAHAAN_UTAMA);
  // pemetaan akun global: kolom opsional dipinjam sebentar lalu dipulihkan
  const peta = await db.pemetaanAkun.findFirstOrThrow({ select: { id: true, selisihKursId: true } });
  await db.pemetaanAkun.update({ where: { id: peta.id }, data: { selisihKursId: akunRuj.id } });
  try {
    await harusDitolak("akun pemetaan akun diberi pemilik", () => ubahAkun(ruj, U), `Akun ${KODE}-RUJ dipakai pemetaan akun yang berlaku untuk semua perusahaan; tidak bisa dijadikan milik PT Uji Pewarisan`);
  } finally {
    await db.pemetaanAkun.update({ where: { id: peta.id }, data: { selisihKursId: peta.selisihKursId } });
  }
  await db.pemetaanAkunTambahan.create({ data: { kunci: `${KODE}-uji`, label: "Uji pewarisan", akunId: akunRuj.id, dibuatOleh: "Uji" } });
  try {
    await harusDitolak("akun pemetaan tambahan diberi pemilik", () => ubahAkun(ruj, U), `dipakai pemetaan akun tambahan ${KODE}-uji`);
  } finally {
    await db.pemetaanAkunTambahan.deleteMany({ where: { kunci: `${KODE}-uji` } });
  }
  // pengaturan pajak: milik perusahaan uji boleh, milik perusahaan lain ditolak
  await db.pengaturanPerusahaan.update({ where: { id: U }, data: { akunPpnMasukanId: akunRuj.id } });
  await harusDitolak("akun pajak perusahaan uji dijadikan milik utama", () => ubahAkun(ruj, PERUSAHAAN_UTAMA), `Akun ${KODE}-RUJ dipakai pengaturan pajak ${KODE}`);
  await jalankan("akun pajak yang hanya dipakai pengaturan perusahaan uji dijadikan miliknya", () => ubahAkun(ruj, U));
  pastikan((await db.akun.findUniqueOrThrow({ where: { id: akunRuj.id } })).perusahaanId === U, "akun pajak perusahaan itu sendiri boleh menjadi miliknya");
  await jalankan("akun uji rujukan kembali bersama", () => ubahAkun(ruj, ""));
  await db.pengaturanPerusahaan.update({ where: { id: U }, data: { akunPpnMasukanId: null } });
  // baris "default" juga berlaku bagi perusahaan tanpa baris pengaturan sendiri
  const pajakDefault = await db.pengaturanPerusahaan.findUnique({ where: { id: "default" }, select: { akunPph23DipotongId: true } });
  const tanpaBaris = await db.perusahaan.count({ where: { id: { not: PERUSAHAAN_UTAMA }, pengaturan: { is: null } } });
  if (pajakDefault && tanpaBaris > 0) {
    await db.pengaturanPerusahaan.update({ where: { id: "default" }, data: { akunPph23DipotongId: akunRuj.id } });
    try {
      await harusDitolak("akun pajak baris default dijadikan milik utama", () => ubahAkun(ruj, PERUSAHAAN_UTAMA), `Akun ${KODE}-RUJ dipakai pengaturan pajak`);
    } finally {
      await db.pengaturanPerusahaan.update({ where: { id: "default" }, data: { akunPph23DipotongId: pajakDefault.akunPph23DipotongId } });
    }
  } else {
    pastikan(true, "baris pengaturan default atau perusahaan tanpa pengaturan tidak ada, kasus default dilewati");
  }
  // akun khusus barang dan karyawan perusahaan lain, serta dokumen kas draf perusahaan lain
  await db.barang.update({ where: { id: barangUt.id }, data: { akunPersediaanId: akunRuj.id } });
  await harusDitolak("akun khusus barang utama dijadikan milik perusahaan uji", () => ubahAkun(ruj, U), `Akun ${KODE}-RUJ dipakai akun khusus barang ${KODE}-BRG-UT milik DPRO`);
  await db.barang.update({ where: { id: barangUt.id }, data: { akunPersediaanId: null } });
  await db.barang.update({ where: { id: jasaB.id }, data: { akunBebanId: akunRuj.id } });
  await harusDitolak("akun khusus jasa bersama diberi pemilik", () => ubahAkun(ruj, U), `Akun ${KODE}-RUJ dipakai akun khusus barang ${KODE}-JSA bersama`);
  await db.barang.update({ where: { id: jasaB.id }, data: { akunBebanId: null } });
  const karyawanLama = await db.karyawan.findUniqueOrThrow({ where: { kode: `${KODE}-KRY-LAMA` } });
  await db.karyawan.update({ where: { id: karyawanLama.id }, data: { akunBebanId: akunRuj.id } });
  await harusDitolak("akun beban karyawan utama dijadikan milik perusahaan uji", () => ubahAkun(ruj, U), `Akun ${KODE}-RUJ dipakai akun beban karyawan ${KODE}-KRY-LAMA di DPRO`);
  await db.karyawan.update({ where: { id: karyawanLama.id }, data: { akunBebanId: null } });
  const kasDraf = await db.dokumenKas.create({ data: { nomor: `${KODE}-KK-DRAF`, jenis: "KELUAR", akunKasId: akunRuj.id, akunLawanId: bebanB.id, jumlah: 1_000, dibuatOleh: "Uji", perusahaanId: PERUSAHAAN_UTAMA } });
  await harusDitolak("akun dokumen kas draf utama dijadikan milik perusahaan uji", () => ubahAkun(ruj, U), `Akun ${KODE}-RUJ dipakai dokumen kas ${KODE}-KK-DRAF DPRO yang belum disetujui`);
  await db.dokumenKas.delete({ where: { id: kasDraf.id } });
  // draf penyesuaian stok, draf penggajian, dan aset tetap aktif perusahaan lain (tinjauan P15 butir 1)
  const psRuj = await db.penyesuaianPersediaan.create({ data: { nomor: `${KODE}-PS-DRAF`, gudangId: gudangUt.id, akunLawanId: akunRuj.id, perusahaanId: PERUSAHAAN_UTAMA } });
  try {
    await harusDitolak("akun lawan draf penyesuaian utama dijadikan milik perusahaan uji", () => ubahAkun(ruj, U), `Akun ${KODE}-RUJ dipakai penyesuaian stok ${KODE}-PS-DRAF DPRO yang belum disetujui`);
  } finally {
    await db.penyesuaianPersediaan.delete({ where: { id: psRuj.id } });
  }
  const gajiRuj = await db.penggajian.create({ data: { nomor: `${KODE}-GJ-DRAF`, periode: `${KODE}-2016-06`, bulan: "2016-06", akunKasId: akunRuj.id, penggunaNama: "Uji", perusahaanId: PERUSAHAAN_UTAMA } });
  try {
    await harusDitolak("akun kas draf penggajian utama dijadikan milik perusahaan uji", () => ubahAkun(ruj, U), `Akun ${KODE}-RUJ dipakai penggajian ${KODE}-GJ-DRAF DPRO yang belum disetujui`);
  } finally {
    await db.penggajian.delete({ where: { id: gajiRuj.id } });
  }
  // aset yang sudah disetujui tetapi belum disusutkan: akun bebannya belum ada di jurnal mana pun
  const asetRuj = await db.asetTetap.create({
    data: { kode: `${KODE}-AST-RUJ`, nama: "Aset Uji Rujukan", hargaPerolehan: 1_000_000, umurBulan: 12, akunAsetId: kasB.id, akunBebanPenyusutanId: akunRuj.id, akunAkumulasiPenyusutanId: kasB.id, statusPersetujuan: "DISETUJUI", perusahaanId: PERUSAHAAN_UTAMA },
  });
  try {
    await harusDitolak("akun beban penyusutan aset aktif utama dijadikan milik perusahaan uji", () => ubahAkun(ruj, U), `Akun ${KODE}-RUJ dipakai aset tetap ${KODE}-AST-RUJ DPRO; tidak bisa dijadikan milik PT Uji Pewarisan`);
    await db.asetTetap.update({ where: { id: asetRuj.id }, data: { akunBebanPenyusutanId: bebanB.id, akunPembayaranId: akunRuj.id, statusPersetujuan: "DRAFT" } });
    await harusDitolak("akun pembayaran draf aset utama dijadikan milik perusahaan uji", () => ubahAkun(ruj, U), `dipakai aset tetap ${KODE}-AST-RUJ DPRO`);
    await db.asetTetap.update({ where: { id: asetRuj.id }, data: { status: "DIJUAL" } });
    await jalankan("aset utama yang sudah dijual tidak menghalangi ganti pemilik", () => ubahAkun(ruj, U));
    await jalankan("akun uji rujukan kembali bersama sesudah kasus aset", () => ubahAkun(ruj, ""));
  } finally {
    await db.asetTetap.delete({ where: { id: asetRuj.id } });
  }
  await jalankan("akun tanpa rujukan perusahaan lain diberi pemilik", () => ubahAkun(ruj, U));
  pastikan((await db.akun.findUniqueOrThrow({ where: { id: akunRuj.id } })).perusahaanId === U, "akun tanpa rujukan perusahaan lain boleh diberi pemilik");
  // akun khusus data induk harus milik pemiliknya atau bersama
  await harusDitolak("barang perusahaan uji dengan akun persediaan khusus milik utama", () => buatDataInduk("barang", isiBarang("BRG-AKUN", { jenis: "BARANG", perusahaanId: U, akunPersediaanId: kasUt.id })), `Akun ${KODE}-KAS-UT Kas Uji Pewarisan Utama milik`);
  pastikan((await db.barang.count({ where: { kode: `${KODE}-BRG-AKUN` } })) === 0, "barang dengan akun khusus perusahaan lain tidak tersimpan");
  await jalankan("barang perusahaan uji dengan akun persediaan khusus miliknya", () => buatDataInduk("barang", isiBarang("BRG-AKUN", { jenis: "BARANG", perusahaanId: U, akunPersediaanId: akunRuj.id })));
  const barangAkun = await db.barang.findUniqueOrThrow({ where: { kode: `${KODE}-BRG-AKUN` } });
  pastikan(barangAkun.akunPersediaanId === akunRuj.id, "akun khusus milik pemilik barang diterima");
  await harusDitolak("barang dipindah ke utama dengan akun khusus milik perusahaan uji", () => ubahDataInduk("barang", barangAkun.id, formulir({ kode: barangAkun.kode, nama: barangAkun.nama, jenis: "BARANG", satuan: "pcs", perusahaanId: PERUSAHAAN_UTAMA, akunPersediaanId: akunRuj.id })), `Akun ${KODE}-RUJ Akun Uji Rujukan milik PT Uji Pewarisan`);
  await harusDitolak("jasa bersama dengan akun beban khusus milik utama", () => buatDataInduk("barang", isiBarang("JSA-AKUN", { jenis: "JASA", perusahaanId: NILAI_BERSAMA, akunBebanId: bebanUt.id })), "jasa bersama hanya bisa memakai akun khusus bersama");
  await jalankan("jasa bersama dengan akun beban khusus bersama", () => buatDataInduk("barang", isiBarang("JSA-AKUN", { jenis: "JASA", perusahaanId: NILAI_BERSAMA, akunBebanId: bebanB.id })));
  await harusDitolak("karyawan perusahaan uji dengan akun beban milik utama", () => ubahDataInduk("karyawan", karyawanU.id, isiKaryawan(karyawanU.kode, karyawanU.nama, { perusahaanId: U, jabatan: "Kru", akunBebanId: bebanUt.id })), `Akun ${KODE}-BEBAN-UT Beban Uji Pewarisan Utama milik`);
  await jalankan("karyawan perusahaan uji dengan akun beban bersama", () => ubahDataInduk("karyawan", karyawanU.id, isiKaryawan(karyawanU.kode, karyawanU.nama, { perusahaanId: U, jabatan: "Kru", akunBebanId: bebanB.id })));
  pastikan((await db.karyawan.findUniqueOrThrow({ where: { id: karyawanU.id } })).akunBebanId === bebanB.id, "akun beban karyawan bersama diterima");

  console.log("=== 8. Hak akses ===");
  await dengan({ peran: "KRU" }, () => harusDitolak("KRU membuat gudang", () => buatDataInduk("gudang", formulir({ kode: `${KODE}-WH-KRU`, nama: "x", perusahaanId: U })), "tidak punya hak"));
  await dengan({ peran: "GUDANG" }, () => harusDitolak("GUDANG membuat jurnal manual", () => buatJurnalManual(formulir(isiJu(1000, "gudang", { perusahaanId: U }))), "tidak punya hak"));
  await dengan({ peran: "KRU" }, () => harusDitolak("KRU membuat pesanan pembelian", () => buatPesananPembelian(isiPsb(barangU.id, proyekU.id)), "tidak punya hak"));
  await dengan({ peran: "GUDANG" }, () => harusDitolak("GUDANG membuat proyek", () => buatDataInduk("proyek", isiProyek("PRJ-GDG", { perusahaanId: U })), "tidak punya hak"));
  await dengan({ peran: "KASIR" }, () => harusDitolak("KASIR membuat prive", () => buatPrive(isiPrive(kasU.id, "PRV kasir")), "tidak punya hak"));

  console.log("=== 9. Keseimbangan dan sinkron per perusahaan ===");
  const jurnalU = await db.barisJurnal.aggregate({ where: { jurnal: { perusahaanId: U } }, _sum: { debit: true, kredit: true } });
  pastikan(D(jurnalU._sum.debit ?? 0).equals(D(jurnalU._sum.kredit ?? 0)) && D(jurnalU._sum.debit ?? 0).gt(0), `jurnal perusahaan uji seimbang (${jurnalU._sum.debit})`);
  const sinkronU = await periksaSinkron(db, { perusahaanId: U });
  pastikan(semuaCocok(sinkronU), `perusahaan uji: semua butir sinkron (persediaan ${sinkronU.persediaan.bukuBesar}/${sinkronU.persediaan.dokumen}, hutang ${sinkronU.hutang.bukuBesar}/${sinkronU.hutang.dokumen}, belum ditagih ${sinkronU.barangBelumDitagih.bukuBesar}/${sinkronU.barangBelumDitagih.dokumen})`);
  const sinkronUt = await periksaSinkron(db, { perusahaanId: PERUSAHAAN_UTAMA });
  pastikan(semuaCocok(sinkronUt), "utama: semua butir sinkron");
  const dokumenSalah = await Promise.all([
    db.pesananPembelian.count({ where: { pemasokId: pemasok.id, NOT: { perusahaanId: U } } }),
    db.penerimaanBarang.count({ where: { pesananId: psb.id, NOT: { perusahaanId: U } } }),
    db.fakturPembelian.count({ where: { pesananId: psb.id, NOT: { perusahaanId: U } } }),
    db.jurnal.count({ where: { id: { in: [tb.jurnalId!, fb.jurnalId!, byr.jurnalId!, rb.jurnalId!] }, NOT: { perusahaanId: U } } }),
  ]);
  pastikan(dokumenSalah.every((n) => n === 0), "semua dokumen anak dan jurnal siklus beli milik perusahaan induknya");

  console.log("=== 10. Bersih-bersih ===");
  await bersihkanData();
  pastikan((await db.perusahaan.count({ where: { kode: KODE } })) === 0 && (await db.barang.count({ where: { kode: { startsWith: `${KODE}-` } } })) === 0 && (await db.akun.count({ where: { kode: { startsWith: `${KODE}-` } } })) === 0, "perusahaan, barang, dan akun uji terhapus");
  pastikan((await db.jurnal.count()) === jumlahJurnalAwal, `jumlah jurnal kembali ${jumlahJurnalAwal}`);
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron sesudah uji sama dengan sebelum uji dan seimbang");
  pastikan((await db.hakAksesPeran.count()) === awalHakAksesPeran, "HakAksesPeran tidak berubah");

  console.log("=== DONE, all pewarisan-perusahaan checks passed ===");
}

main()
  .catch(async (galat) => {
    console.error("TEST FAILED", galat);
    await bersihkanData().catch((e) => console.error("bersih-bersih gagal", e));
    process.exit(1);
  })
  .finally(() => db.$disconnect());
