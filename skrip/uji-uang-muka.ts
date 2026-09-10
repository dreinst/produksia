import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { periksaSinkron } from "../src/lib/sinkron";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { buatPesanan, buatFaktur, buatPenerimaan, buatUangMuka } from "../src/lib/aksi/penjualan";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import { jalankan, formulir, pastikan, harusDitolak } from "./bantuan";

/*
 * Uang muka pelanggan (DP pesanan): JU-UM (Dr Kas / Cr Uang Muka Pelanggan), dipakai FIFO saat faktur
 * (Dr Piutang − DP, Dr Uang Muka Pelanggan), status faktur & sisa tagihan memperhitungkannya,
 * penghapusan faktur mengembalikan DP, DP yang terpakai tidak bisa dihapus, buku besar selalu sinkron.
 */
async function pastikanSinkron(label: string) {
  const s = await periksaSinkron(db);
  const ok = s.seimbang && s.persediaan.sinkron && s.piutang.sinkron && s.hutang.sinkron && s.barangBelumDitagih.sinkron && s.barangTerkirim.sinkron && s.uangMuka.sinkron;
  pastikan(ok, `sinkron setelah ${label} (piutang ${Number(s.piutang.bukuBesar)}/${Number(s.piutang.dokumen)}; uang muka ${Number(s.uangMuka.bukuBesar)}/${Number(s.uangMuka.dokumen)}; persediaan ${Number(s.persediaan.bukuBesar)}/${Number(s.persediaan.dokumen)})`);
  return s;
}
async function saldoAkun(akunId: string) {
  const agg = await db.barisJurnal.aggregate({ where: { akunId }, _sum: { debit: true, kredit: true } });
  return Number(agg._sum.kredit ?? 0) - Number(agg._sum.debit ?? 0);
}

async function main() {
  const mulaiUji = new Date();
  const jumlahJurnalAwal = await db.jurnal.count();
  const pemetaan = await db.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" } });
  pastikan(pemetaan.uangMukaPelangganId, "pemetaan punya akun Uang Muka Pelanggan");
  const akunUm = pemetaan.uangMukaPelangganId!;
  const saldoUmAwal = await saldoAkun(akunUm);

  console.log("=== Data uji ===");
  const gudang = await db.gudang.create({ data: { kode: "WH-UM", nama: "Gudang Uji DP" } });
  const pelanggan = await db.pelanggan.create({ data: { kode: "CUST-UM", nama: "Pelanggan Uji DP" } });
  const barang = await db.barang.create({ data: { kode: "BRG-UM", nama: "Barang Uji DP", hargaBeli: 0, hargaJual: 20000 } });
  const kas = await db.akun.create({ data: { kode: "UM-KAS", nama: "Kas Uji DP", jenis: "ASET", kasBank: true } });
  const modal = await db.akun.create({ data: { kode: "UM-MODAL", nama: "Modal Uji DP", jenis: "MODAL" } });
  await jalankan("PS saldo awal 20 @ 5.000", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, baris: [{ barangId: barang.id, jumlahSesudah: 20, hargaSatuan: 5000 }] })));

  console.log("=== 1. Pesanan 10 @ 20.000 = 200.000, DP bertahap ===");
  await jalankan("PSJ", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: barang.id, jumlah: 10, harga: 20000 }] })));
  const pesanan = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id }, include: { baris: true } });
  await harusDitolak("DP tanpa pesanan", () => buatUangMuka(formulir({ akunId: kas.id, jumlah: 1000 })), "Pesanan wajib");
  await harusDitolak("DP tanpa akun kas", () => buatUangMuka(formulir({ pesananId: pesanan.id, jumlah: 1000 })), "Akun Kas/Bank");
  await harusDitolak("DP nol", () => buatUangMuka(formulir({ pesananId: pesanan.id, akunId: kas.id, jumlah: 0 })), "Jumlah uang muka");
  await harusDitolak("DP melebihi nilai pesanan", () => buatUangMuka(formulir({ pesananId: pesanan.id, akunId: kas.id, jumlah: 250000 })), "melebihi nilai pesanan");
  await jalankan("UM-1 50.000 tunai", () => buatUangMuka(formulir({ pesananId: pesanan.id, akunId: kas.id, jumlah: 50000, metodeBayar: "TUNAI", keterangan: "DP pertama" })));
  const um1 = await db.uangMukaPelanggan.findFirstOrThrow({ where: { pesananId: pesanan.id }, include: { jurnal: { include: { baris: true } } } });
  pastikan(um1.nomor.startsWith("UM-") && um1.jurnal?.nomor.startsWith("JU-UM") && um1.jurnal.keterangan?.includes(um1.nomor) && um1.jurnal.keterangan.includes(pesanan.nomor), `UM-1 ${um1.nomor} punya jurnal ${um1.jurnal?.nomor} bertaut ke pesanan`);
  pastikan(um1.jurnal!.baris.some((b) => b.akunId === kas.id && Number(b.debit) === 50000) && um1.jurnal!.baris.some((b) => b.akunId === akunUm && Number(b.kredit) === 50000), "JU-UM: Dr Kas 50.000 / Cr Uang Muka Pelanggan 50.000");
  pastikan((await saldoAkun(akunUm)) - saldoUmAwal === 50000, "saldo akun Uang Muka Pelanggan naik 50.000");
  await pastikanSinkron("UM-1");
  await harusDitolak("hapus pesanan yang punya DP", () => hapusDokumen("pesanan", pesanan.id), "sudah punya uang muka");
  await jalankan("UM-2 30.000 transfer", () => buatUangMuka(formulir({ pesananId: pesanan.id, akunId: kas.id, jumlah: 30000 })));
  const um2 = await db.uangMukaPelanggan.findFirstOrThrow({ where: { pesananId: pesanan.id, id: { not: um1.id } } });
  await harusDitolak("DP ketiga melebihi sisa nilai pesanan (maks 120.000)", () => buatUangMuka(formulir({ pesananId: pesanan.id, akunId: kas.id, jumlah: 120001 })), "maks 120.000");
  await pastikanSinkron("UM-2 (DP 80.000 belum dipakai)");

  console.log("=== 2. Faktur sebagian memakai DP 30.000 → piutang 50.000 ===");
  const barisFj = (jumlah: number) => [{ barangId: barang.id, jumlah, harga: 20000 }];
  await harusDitolak("faktur memakai DP melebihi yang tersedia", () => buatFaktur(formulir({ pesananId: pesanan.id, uangMuka: 100000, baris: barisFj(4) })), "melebihi sisa uang muka");
  await harusDitolak("faktur memakai DP melebihi total faktur", () => buatFaktur(formulir({ pesananId: pesanan.id, uangMuka: 80000, baris: barisFj(3) })), "melebihi total faktur");
  await jalankan("FJ-1 4 pcs = 80.000, DP dipakai 30.000", () => buatFaktur(formulir({ pesananId: pesanan.id, uangMuka: 30000, baris: barisFj(4) })));
  const fj1 = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: pesanan.id }, include: { jurnal: { include: { baris: true } }, pemakaianUangMuka: true } });
  pastikan(Number(fj1.total) === 80000 && Number(fj1.uangMuka) === 30000 && fj1.status === "SEBAGIAN", `FJ-1 total 80.000, uang muka 30.000, status ${fj1.status}`);
  pastikan(fj1.jurnal!.baris.some((b) => b.akunId === pemetaan.piutangUsahaId && Number(b.debit) === 50000) && fj1.jurnal!.baris.some((b) => b.akunId === akunUm && Number(b.debit) === 30000), "JU-FJ: Dr Piutang 50.000 + Dr Uang Muka Pelanggan 30.000");
  const um1Setelah = await db.uangMukaPelanggan.findUniqueOrThrow({ where: { id: um1.id } });
  const um2Setelah = await db.uangMukaPelanggan.findUniqueOrThrow({ where: { id: um2.id } });
  pastikan(Number(um1Setelah.jumlahDipakai) === 30000 && Number(um2Setelah.jumlahDipakai) === 0 && fj1.pemakaianUangMuka.length === 1, "DP dipakai FIFO: UM-1 terpakai 30.000, UM-2 utuh");
  let s = await pastikanSinkron("FJ-1");
  pastikan(Number(s.piutang.dokumen) === 50000 && Number(s.uangMuka.dokumen) - (Number(s.uangMuka.bukuBesar) - Number(s.uangMuka.dokumen)) >= 0, "piutang dokumen 50.000 setelah DP");
  await harusDitolak("hapus UM-1 yang sudah dipakai", () => hapusDokumen("uangMuka", um1.id), "sudah dipakai faktur");
  await harusDitolak("bayar melebihi sisa (sisa 50.000)", () => buatPenerimaan(formulir({ fakturId: fj1.id, akunId: kas.id, jumlah: 50001 })), "melebihi sisa tagihan");
  await jalankan("TRM-1 50.000 → LUNAS", () => buatPenerimaan(formulir({ fakturId: fj1.id, akunId: kas.id, jumlah: 50000 })));
  pastikan((await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fj1.id } })).status === "LUNAS", "FJ-1 LUNAS setelah DP + penerimaan = total");
  await pastikanSinkron("TRM-1");

  console.log("=== 3. Faktur kedua memakai sisa DP 50.000 lintas dua DP ===");
  await jalankan("FJ-2 6 pcs = 120.000, DP dipakai 50.000", () => buatFaktur(formulir({ pesananId: pesanan.id, uangMuka: 50000, baris: barisFj(6) })));
  const fj2 = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: pesanan.id, id: { not: fj1.id } }, include: { pemakaianUangMuka: true } });
  pastikan(Number(fj2.uangMuka) === 50000 && fj2.status === "SEBAGIAN" && fj2.pemakaianUangMuka.length === 2, "FJ-2 memakai 20.000 dari UM-1 dan 30.000 dari UM-2 (2 jejak pemakaian)");
  pastikan(Number((await db.uangMukaPelanggan.findUniqueOrThrow({ where: { id: um1.id } })).jumlahDipakai) === 50000 && Number((await db.uangMukaPelanggan.findUniqueOrThrow({ where: { id: um2.id } })).jumlahDipakai) === 30000, "UM-1 & UM-2 terpakai penuh");
  s = await pastikanSinkron("FJ-2");
  pastikan(Number(s.uangMuka.dokumen) === Number(s.uangMuka.bukuBesar), "akun Uang Muka Pelanggan = Σ DP belum dipakai (0 dari uji ini)");
  await harusDitolak("DP setelah pesanan difaktur seluruhnya", () => buatUangMuka(formulir({ pesananId: pesanan.id, akunId: kas.id, jumlah: 1000 })), "sudah difaktur seluruhnya");

  console.log("=== 4. Hapus urut mundur: DP kembali ke sisa, semua bersih ===");
  await jalankan("hapus FJ-2", () => hapusDokumen("faktur", fj2.id));
  pastikan(Number((await db.uangMukaPelanggan.findUniqueOrThrow({ where: { id: um1.id } })).jumlahDipakai) === 30000 && Number((await db.uangMukaPelanggan.findUniqueOrThrow({ where: { id: um2.id } })).jumlahDipakai) === 0, "hapus FJ-2 mengembalikan DP: UM-1 30.000 terpakai, UM-2 utuh");
  pastikan((await db.pemakaianUangMuka.count({ where: { fakturId: fj2.id } })) === 0, "jejak pemakaian FJ-2 hilang");
  await pastikanSinkron("hapus FJ-2");
  await jalankan("hapus UM-2 (belum dipakai)", () => hapusDokumen("uangMuka", um2.id));
  await pastikanSinkron("hapus UM-2");
  const trm = await db.penerimaanPenjualan.findFirstOrThrow({ where: { fakturId: fj1.id } });
  await jalankan("hapus TRM-1", () => hapusDokumen("penerimaan", trm.id));
  pastikan((await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fj1.id } })).status === "SEBAGIAN", "FJ-1 kembali SEBAGIAN (DP masih terpakai)");
  await jalankan("hapus FJ-1", () => hapusDokumen("faktur", fj1.id));
  pastikan(Number((await db.uangMukaPelanggan.findUniqueOrThrow({ where: { id: um1.id } })).jumlahDipakai) === 0, "UM-1 kembali utuh");
  await pastikanSinkron("hapus FJ-1");
  await jalankan("hapus UM-1", () => hapusDokumen("uangMuka", um1.id));
  pastikan((await saldoAkun(akunUm)) === saldoUmAwal, "saldo akun Uang Muka Pelanggan kembali seperti semula");
  await jalankan("hapus PSJ", () => hapusDokumen("pesanan", pesanan.id));
  const ps = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudang.id } });
  await jalankan("hapus PS", () => hapusDokumen("penyesuaian", ps.id));
  await pastikanSinkron("hapus PS");
  pastikan((await db.jurnal.count()) === jumlahJurnalAwal, "tidak ada jurnal uji yang tersisa");

  console.log("=== Bersih-bersih ===");
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  await db.stokBarang.deleteMany({ where: { barangId: barang.id } });
  await db.barang.delete({ where: { id: barang.id } });
  await db.pelanggan.delete({ where: { id: pelanggan.id } });
  await db.gudang.delete({ where: { id: gudang.id } });
  await db.akun.deleteMany({ where: { kode: { startsWith: "UM-" } } });
  await pastikanSinkron("bersih-bersih");
  console.log("=== DONE, all uang muka checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
