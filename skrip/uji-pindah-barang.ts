import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { periksaSinkron } from "../src/lib/sinkron";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { buatPenyesuaianPersediaan, buatPindahBarang } from "../src/lib/aksi/persediaan";
import { jalankan, formulir, pastikan, harusDitolak } from "./bantuan";

/*
 * Pindah barang antar gudang: stok fisik berpindah, nilai persediaan & buku besar tidak berubah (tanpa jurnal),
 * penolakan (gudang sama, JASA, melebihi stok, baris kosong), penghapusan mengembalikan stok, dan ditolak bila
 * stok di gudang tujuan sudah terpakai.
 */
async function pastikanSinkron(label: string) {
  const s = await periksaSinkron(db);
  pastikan(s.seimbang && s.persediaan.sinkron, `sinkron setelah ${label} (persediaan ${Number(s.persediaan.bukuBesar)}/${Number(s.persediaan.dokumen)})`);
}
const stok = async (barangId: string, gudangId: string) => Number((await db.stokBarang.findUnique({ where: { barangId_gudangId: { barangId, gudangId } } }))?.jumlah ?? 0);

async function main() {
  const mulaiUji = new Date();
  const jumlahJurnalAwal = await db.jurnal.count();

  console.log("=== Data uji ===");
  const gudangA = await db.gudang.create({ data: { kode: "WH-PB-A", nama: "Gudang Uji Pindah A" } });
  const gudangB = await db.gudang.create({ data: { kode: "WH-PB-B", nama: "Gudang Uji Pindah B" } });
  const barang = await db.barang.create({ data: { kode: "BRG-PB", nama: "Barang Uji Pindah", hargaBeli: 0, hargaJual: 20000 } });
  const jasa = await db.barang.create({ data: { kode: "JSA-PB", nama: "Jasa Uji Pindah", jenis: "JASA", hargaBeli: 0, hargaJual: 50000 } });
  const modal = await db.akun.create({ data: { kode: "PB-MODAL", nama: "Modal Uji Pindah", jenis: "MODAL" } });
  await jalankan("PS saldo awal 20 @ 5.000 di gudang A", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudangA.id, akunLawanId: modal.id, baris: [{ barangId: barang.id, jumlahSesudah: 20, hargaSatuan: 5000 }] })));
  const jurnalSetelahPs = await db.jurnal.count();
  await pastikanSinkron("saldo awal");

  console.log("=== 1. Penolakan ===");
  await harusDitolak("gudang asal = tujuan", () => buatPindahBarang(formulir({ gudangAsalId: gudangA.id, gudangTujuanId: gudangA.id, baris: [{ barangId: barang.id, jumlah: 1 }] })), "harus berbeda");
  await harusDitolak("tanpa gudang tujuan", () => buatPindahBarang(formulir({ gudangAsalId: gudangA.id, baris: [{ barangId: barang.id, jumlah: 1 }] })), "Gudang tujuan wajib");
  await harusDitolak("baris kosong", () => buatPindahBarang(formulir({ gudangAsalId: gudangA.id, gudangTujuanId: gudangB.id, baris: [] })), "Minimal 1 baris");
  await harusDitolak("baris JASA", () => buatPindahBarang(formulir({ gudangAsalId: gudangA.id, gudangTujuanId: gudangB.id, baris: [{ barangId: jasa.id, jumlah: 1 }] })), "JASA");
  await harusDitolak("melebihi stok asal (21 > 20)", () => buatPindahBarang(formulir({ gudangAsalId: gudangA.id, gudangTujuanId: gudangB.id, baris: [{ barangId: barang.id, jumlah: 21 }] })), "tidak cukup");
  await harusDitolak("barang ganda", () => buatPindahBarang(formulir({ gudangAsalId: gudangA.id, gudangTujuanId: gudangB.id, baris: [{ barangId: barang.id, jumlah: 1 }, { barangId: barang.id, jumlah: 1 }] })), "hanya boleh muncul sekali");
  pastikan((await stok(barang.id, gudangA.id)) === 20 && (await stok(barang.id, gudangB.id)) === 0, "penolakan tidak mengubah stok");

  console.log("=== 2. Pindah 8 dari A ke B ===");
  await jalankan("PB 8", () => buatPindahBarang(formulir({ gudangAsalId: gudangA.id, gudangTujuanId: gudangB.id, keterangan: "uji pindah", baris: [{ barangId: barang.id, jumlah: 8 }] })));
  const pb = await db.pindahBarang.findFirstOrThrow({ where: { gudangAsalId: gudangA.id }, include: { baris: true } });
  pastikan(pb.nomor.startsWith("PB-") && pb.baris.length === 1 && Number(pb.baris[0].jumlah) === 8, `dokumen ${pb.nomor} tersimpan dengan 1 baris × 8`);
  pastikan((await stok(barang.id, gudangA.id)) === 12 && (await stok(barang.id, gudangB.id)) === 8, "stok A 12, B 8");
  pastikan((await db.jurnal.count()) === jurnalSetelahPs, "pindah barang tidak membuat jurnal");
  pastikan(Number((await db.barang.findUniqueOrThrow({ where: { id: barang.id } })).hargaBeli) === 5000, "harga pokok rata-rata tetap 5.000");
  await pastikanSinkron("PB (nilai persediaan tetap 100.000)");
  await harusDitolak("pindah 13 dari A (sisa 12)", () => buatPindahBarang(formulir({ gudangAsalId: gudangA.id, gudangTujuanId: gudangB.id, baris: [{ barangId: barang.id, jumlah: 13 }] })), "tersedia 12");

  console.log("=== 3. Hapus PB ditolak bila stok tujuan sudah terpakai, lalu dihapus bersih ===");
  await jalankan("PS opname gudang B → 3 (5 terpakai)", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudangB.id, akunLawanId: modal.id, baris: [{ barangId: barang.id, jumlahSesudah: 3 }] })));
  await harusDitolak("hapus PB saat stok B tinggal 3", () => hapusDokumen("pindahBarang", pb.id), "tidak cukup");
  const psB = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudangB.id } });
  await jalankan("hapus PS opname B", () => hapusDokumen("penyesuaian", psB.id));
  pastikan((await stok(barang.id, gudangB.id)) === 8, "stok B kembali 8");
  await jalankan("hapus PB", () => hapusDokumen("pindahBarang", pb.id));
  pastikan((await stok(barang.id, gudangA.id)) === 20 && (await stok(barang.id, gudangB.id)) === 0, "stok kembali A 20, B 0");
  pastikan((await db.pindahBarang.count({ where: { id: pb.id } })) === 0 && (await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, jenis: "Pindah Barang" } })) === 1, "dokumen hilang dan tercatat di log aktivitas");
  await pastikanSinkron("hapus PB");
  const psA = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudangA.id } });
  await jalankan("hapus PS saldo awal", () => hapusDokumen("penyesuaian", psA.id));
  pastikan((await db.jurnal.count()) === jumlahJurnalAwal, "tidak ada jurnal uji yang tersisa");

  console.log("=== Bersih-bersih ===");
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  await db.stokBarang.deleteMany({ where: { barangId: barang.id } });
  await db.barang.deleteMany({ where: { id: { in: [barang.id, jasa.id] } } });
  await db.gudang.deleteMany({ where: { id: { in: [gudangA.id, gudangB.id] } } });
  await db.akun.deleteMany({ where: { kode: { startsWith: "PB-" } } });
  await pastikanSinkron("bersih-bersih");
  console.log("=== DONE, all pindah barang checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
