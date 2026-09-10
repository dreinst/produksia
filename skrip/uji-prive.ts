import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { periksaSinkron } from "../src/lib/sinkron";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { buatPrive } from "../src/lib/aksi/prive";
import { buatPenawaran } from "../src/lib/aksi/penjualan";
import { tambahPemetaanTambahan, ubahPemetaanTambahan, hapusPemetaanTambahan } from "../src/lib/aksi/pengaturan";
import { akunPemetaanTambahan } from "../src/lib/baganAkun";
import { hitungLaporanPrive } from "../src/lib/laporanPrive";
import { jalankan, formulir, pastikan, harusDitolak } from "./bantuan";

/*
 * Prive (PRV: Dr Prive / Cr Kas), laporan prive per pemilik, pemetaan akun tambahan (kunci "prive"),
 * dan aturan nego harga: di bawah harga jual perlu hak "harga.nego", di bawah harga minimum hanya Pemilik/Superadmin.
 */
const hariIni = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function main() {
  const kas = await db.akun.findFirstOrThrow({ where: { kasBank: true, kelompok: false }, orderBy: { kode: "asc" } });
  const akunPrive = await db.akun.findFirstOrThrow({ where: { jenis: "MODAL", kelompok: false, nama: { contains: "Prive", mode: "insensitive" } } });
  const modalLain = await db.akun.findFirstOrThrow({ where: { jenis: "MODAL", kelompok: false, id: { not: akunPrive.id } } });
  const beban = await db.akun.findFirstOrThrow({ where: { jenis: "BEBAN", kelompok: false } });
  const sebelum = await periksaSinkron(db);
  pastikan(sebelum.seimbang, "buku besar seimbang sebelum uji");
  const jumlahPriveAwal = await db.prive.count();

  console.log("=== 1. Prive: validasi & jurnal PRV ===");
  const dasar = { pemilikNama: "Donny Donatus", tanggal: hariIni(), akunKasId: kas.id, akunPriveId: akunPrive.id, jumlah: 250000, keterangan: "uji prive" };
  await harusDitolak("tanpa nama pemilik", () => buatPrive(formulir({ ...dasar, pemilikNama: "" })), "Nama pemilik");
  await harusDitolak("akun sumber bukan kas", () => buatPrive(formulir({ ...dasar, akunKasId: beban.id })), "kas/bank");
  await harusDitolak("akun prive bukan modal", () => buatPrive(formulir({ ...dasar, akunPriveId: beban.id })), "akun modal");
  await harusDitolak("jumlah 0", () => buatPrive(formulir({ ...dasar, jumlah: 0 })), "Jumlah");
  await jalankan("catat prive 250.000", () => buatPrive(formulir(dasar)));
  const prive = await db.prive.findFirstOrThrow({ where: { keterangan: "uji prive" }, include: { jurnal: { include: { baris: true } } } });
  pastikan(prive.nomor.startsWith("PRV") && prive.jurnal?.sumber === "PRIVE" && prive.jurnal.nomor.startsWith("PRV"), `nomor ${prive.nomor}, jurnal ${prive.jurnal?.nomor} sumber PRIVE`);
  const dr = prive.jurnal!.baris.find((b) => b.akunId === akunPrive.id);
  const cr = prive.jurnal!.baris.find((b) => b.akunId === kas.id);
  pastikan(Number(dr?.debit) === 250000 && Number(cr?.kredit) === 250000, "Dr Prive 250.000 / Cr Kas 250.000");
  pastikan((await db.logAktivitas.count({ where: { jenis: "Prive", nomor: prive.nomor, aksi: "BUAT" } })) === 1, "tercatat di log aktivitas");
  pastikan((await periksaSinkron(db)).seimbang, "buku besar tetap seimbang");

  console.log("=== 2. Laporan prive per pemilik ===");
  const tahun = new Date().getFullYear();
  const laporan = await hitungLaporanPrive(db, new Date(tahun, 0, 1), new Date(tahun, 11, 31, 23, 59, 59));
  const barisDonny = laporan.perPemilik.find((p) => p.pemilikNama === "Donny Donatus");
  pastikan(barisDonny && Number(barisDonny.total) >= 250000 && laporan.rincian.some((r) => r.id === prive.id), `laporan memuat Donny Donatus (total ${barisDonny ? Number(barisDonny.total).toLocaleString("id-ID") : "-"})`);

  console.log("=== 3. Hapus prive ===");
  await jalankan("hapus prive", () => hapusDokumen("prive", prive.id));
  pastikan((await db.prive.count()) === jumlahPriveAwal && (await db.jurnal.findUnique({ where: { id: prive.jurnal!.id } })) === null, "prive & jurnalnya terhapus");
  pastikan((await periksaSinkron(db)).seimbang, "buku besar seimbang setelah hapus");

  console.log("=== 4. Pemetaan akun tambahan ===");
  await db.pemetaanAkunTambahan.deleteMany({ where: { kunci: "prive-uji" } });
  await harusDitolak("tanpa nama", () => tambahPemetaanTambahan(formulir({ label: "", akunId: akunPrive.id })), "Nama peran");
  await harusDitolak("tanpa akun", () => tambahPemetaanTambahan(formulir({ label: "Prive Uji", akunId: "" })), "Akun wajib");
  await jalankan("tambah 'Prive Uji'", () => tambahPemetaanTambahan(formulir({ label: "Prive Uji", akunId: akunPrive.id, keterangan: "uji" })));
  const peta = await db.pemetaanAkunTambahan.findUniqueOrThrow({ where: { kunci: "prive-uji" } });
  pastikan(peta.akunId === akunPrive.id && peta.label === "Prive Uji", "kunci 'prive-uji' dari label, akun tersimpan");
  pastikan((await akunPemetaanTambahan(db, "prive-uji"))?.id === akunPrive.id, "akunPemetaanTambahan() mengembalikan akun");
  await harusDitolak("nama ganda", () => tambahPemetaanTambahan(formulir({ label: "prive uji", akunId: akunPrive.id })), "sudah ada");
  await jalankan("ganti akun", () => ubahPemetaanTambahan(peta.id, formulir({ akunId: modalLain.id })));
  pastikan((await akunPemetaanTambahan(db, "prive-uji"))?.id === modalLain.id, "akun pemetaan tambahan berganti");
  await jalankan("hapus pemetaan", () => hapusPemetaanTambahan(peta.id));
  pastikan((await akunPemetaanTambahan(db, "prive-uji")) === null, "pemetaan tambahan terhapus");

  console.log("=== 5. Nego harga: harga jual, harga minimum, hak ===");
  await db.hakAksesPeran.deleteMany({ where: { peran: "KASIR", hak: "harga.nego" } });
  const sisaBarang = await db.barang.findUnique({ where: { kode: "UJI-NEGO" } });
  if (sisaBarang) {
    for (const p of await db.penawaranPenjualan.findMany({ where: { baris: { some: { barangId: sisaBarang.id } } } })) await hapusDokumen("penawaran", p.id).catch(() => undefined);
    await db.barang.delete({ where: { id: sisaBarang.id } });
  }
  const barang = await db.barang.create({ data: { kode: "UJI-NEGO", nama: "Barang Uji Nego", jenis: "JASA", satuan: "paket", hargaBeli: 5000, hargaJual: 10000, hargaMinimum: 8000 } });
  const pelanggan = await db.pelanggan.findFirstOrThrow();
  const penawaran = (harga: number) => buatPenawaran(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: barang.id, jumlah: 1, harga }] }));
  const jumlahPenawaran = () => db.penawaranPenjualan.count({ where: { baris: { some: { barangId: barang.id } } } });

  await jalankan("Pemilik: harga 7.000 (di bawah minimum) boleh", () => penawaran(7000));
  pastikan((await jumlahPenawaran()) === 1, "penawaran Pemilik tersimpan");

  process.env.UJI_PERAN = "KASIR";
  await jalankan("Kasir: nego 9.000 (di atas minimum) boleh", () => penawaran(9000));
  pastikan((await jumlahPenawaran()) === 2, "penawaran Kasir tersimpan");
  await harusDitolak("Kasir: 7.000 di bawah harga minimum", () => penawaran(7000), "harga minimum");
  await db.hakAksesPeran.create({ data: { peran: "KASIR", hak: "harga.nego", boleh: false } });
  await harusDitolak("Kasir tanpa hak nego: 9.000 di bawah harga jual", () => penawaran(9000), "harga jual");
  await jalankan("Kasir tanpa hak nego: harga jual 10.000 boleh", () => penawaran(10000));
  pastikan((await jumlahPenawaran()) === 3, "penawaran harga jual tersimpan");
  process.env.UJI_PERAN = "GUDANG";
  await harusDitolak("Gudang tidak punya hak penawaran", () => penawaran(10000), "tidak punya hak");
  delete process.env.UJI_PERAN;

  console.log("=== Bersih-bersih ===");
  await db.hakAksesPeran.deleteMany({ where: { peran: "KASIR", hak: "harga.nego" } });
  for (const p of await db.penawaranPenjualan.findMany({ where: { baris: { some: { barangId: barang.id } } } })) await jalankan(`hapus ${p.nomor}`, () => hapusDokumen("penawaran", p.id));
  await db.barang.delete({ where: { id: barang.id } });
  pastikan((await db.barang.count({ where: { kode: "UJI-NEGO" } })) === 0 && (await db.prive.count()) === jumlahPriveAwal, "data uji bersih");
  const akhir = await periksaSinkron(db);
  pastikan(akhir.seimbang && akhir.piutang.sinkron && akhir.persediaan.sinkron, "buku besar sinkron di akhir");
  console.log("=== DONE, all prive/pemetaan/nego checks passed ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
