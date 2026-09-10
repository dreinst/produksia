import "dotenv/config";
import { db } from "../src/lib/db";
import { hashKataSandi } from "../src/lib/kataSandi";
import { terapkanBaganAkunStandar } from "../src/lib/baganAkun";
import { BAGAN_AKUN_STANDAR } from "../src/lib/baganAkunStandar";

/**
 * Satu alur cerita tunggal yang melewati SETIAP tahap siklus penjualan,
 * supaya tiap halaman (Penawaran, Pesanan, Pengiriman, Faktur, Penerimaan, Retur)
 * langsung punya contoh data yang bisa dilihat dan saling terhubung.
 */
async function main() {
  console.log("=== Pengguna (kata sandi semua: rahasia123) ===");
  const kataSandiHash = await hashKataSandi("rahasia123");
  await db.pengguna.createMany({
    data: [
      { email: "pemilik@contoh.id", nama: "Dewi Lestari", peran: "PEMILIK", kataSandiHash },
      { email: "admin@contoh.id", nama: "Bagus Santoso", peran: "ADMIN", kataSandiHash },
      { email: "kasir@contoh.id", nama: "Sari Wulandari", peran: "KASIR", kataSandiHash },
      { email: "gudang@contoh.id", nama: "Joko Prasetyo", peran: "GUDANG", kataSandiHash },
    ],
  });

  console.log("=== Master data ===");
  const dept = await db.departemen.create({ data: { nama: "Marketing & Event" } });
  const penjual = await db.karyawan.create({
    data: { kode: "SLS-01", nama: "Rudi Hartono", departemenId: dept.id },
  });
  const pelanggan = await db.pelanggan.create({
    data: {
      kode: "CUST-001",
      nama: "PT Cahaya Nusantara",
      alamat: "Jl. Sudirman Kav. 12, Jakarta",
      telepon: "021-5551234",
      penjualId: penjual.id,
    },
  });
  const pemasok = await db.pemasok.create({
    data: { kode: "SUP-001", nama: "CV Sinar Dekorasi", alamat: "Jl. Pahlawan No. 5, Bekasi", telepon: "021-4449876" },
  });
  const gudang = await db.gudang.create({
    data: { kode: "WH-01", nama: "Gudang Peralatan", alamat: "Jl. Raya Bekasi KM 20" },
  });
  const kelompok = await db.kelompokBarang.create({ data: { nama: "Merchandise & Produksi" } });
  await db.proyek.create({
    data: { kode: "PRJ-001", nama: "Wedding Andi & Sari", pelangganId: pelanggan.id, status: "BERJALAN" },
  });

  console.log(`=== Bagan Akun Standar EO/WO (${BAGAN_AKUN_STANDAR.length} akun) + pemetaan akun ===`);
  await terapkanBaganAkunStandar(db);
  const akun = (kode: string) => db.akun.findUniqueOrThrow({ where: { kode } });
  const [kas, bank, modal, sewa, peralatan, akumPenyusutan, bebanPenyusutan] = await Promise.all(
    ["1-1100", "1-1210", "3-1000", "5-4500", "1-2400", "1-2940", "5-9540"].map(akun),
  );

  const itemDefs = [
    { kode: "BRG-001", nama: "Lanyard & ID Card", satuan: "pcs", hargaBeli: 9000, hargaJual: 12000 },
    { kode: "BRG-002", nama: "Stiker & Kupon Event", satuan: "pack", hargaBeli: 13000, hargaJual: 16000 },
    { kode: "BRG-003", nama: "Goodie Bag Peserta", satuan: "pcs", hargaBeli: 24000, hargaJual: 29000 },
  ];
  const daftarBarang: Record<string, Awaited<ReturnType<typeof db.barang.create>>> = {};
  for (const def of itemDefs) {
    const barang = await db.barang.create({
      data: { ...def, kelompokId: kelompok.id, stokMinimum: 10 },
    });
    daftarBarang[def.kode] = barang;
    await db.stokBarang.create({ data: { barangId: barang.id, gudangId: gudang.id, jumlah: 100 } });
  }
  const lanyard = daftarBarang["BRG-001"];
  const stiker = daftarBarang["BRG-002"];
  const goodieBag = daftarBarang["BRG-003"];

  console.log("=== Tahap 1: Penawaran Penjualan (draft, belum dikonversi) ===");
  await db.penawaranPenjualan.create({
    data: {
      nomor: "PNW-2026-0001",
      pelangganId: pelanggan.id,
      status: "DRAF",
      total: 5 * 12000 + 5 * 16000,
      baris: {
        create: [
          { barangId: lanyard.id, jumlah: 5, harga: 12000, subtotal: 60000 },
          { barangId: stiker.id, jumlah: 5, harga: 16000, subtotal: 80000 },
        ],
      },
    },
  });
  console.log("  -> PNW-2026-0001 dibuat (cek halaman Penawaran Penjualan)");

  console.log("=== Tahap 2: Penawaran kedua, dikonversi jadi Pesanan ===");
  const qtyLanyard = 20;
  const qtyStiker = 10;
  const qtyGoodieBag = 15;
  const orderTotal = qtyLanyard * 12000 + qtyStiker * 16000 + qtyGoodieBag * 29000;

  const q2 = await db.penawaranPenjualan.create({
    data: {
      nomor: "PNW-2026-0002",
      pelangganId: pelanggan.id,
      status: "DIKONVERSI",
      total: orderTotal,
      baris: {
        create: [
          { barangId: lanyard.id, jumlah: qtyLanyard, harga: 12000, subtotal: qtyLanyard * 12000 },
          { barangId: stiker.id, jumlah: qtyStiker, harga: 16000, subtotal: qtyStiker * 16000 },
          { barangId: goodieBag.id, jumlah: qtyGoodieBag, harga: 29000, subtotal: qtyGoodieBag * 29000 },
        ],
      },
    },
  });

  const pesanan = await db.pesananPenjualan.create({
    data: {
      nomor: "PSJ-2026-0001",
      pelangganId: pelanggan.id,
      penawaranId: q2.id,
      status: "DRAF",
      total: orderTotal,
      baris: {
        create: [
          { barangId: lanyard.id, jumlah: qtyLanyard, harga: 12000 },
          { barangId: stiker.id, jumlah: qtyStiker, harga: 16000 },
          { barangId: goodieBag.id, jumlah: qtyGoodieBag, harga: 29000 },
        ],
      },
    },
    include: { baris: true },
  });
  console.log("  -> PNW-2026-0002 dikonversi jadi PSJ-2026-0001 (cek halaman Pesanan Penjualan)");

  const orderLineLanyard = pesanan.baris.find((l) => l.barangId === lanyard.id)!;
  const orderLineStiker = pesanan.baris.find((l) => l.barangId === stiker.id)!;
  const orderLineGoodieBag = pesanan.baris.find((l) => l.barangId === goodieBag.id)!;

  console.log("=== Tahap 3: Pengiriman sebagian (parsial) ===");
  await db.pengirimanPesanan.create({
    data: {
      nomor: "SJ-2026-0001",
      pesananId: pesanan.id,
      gudangId: gudang.id,
      status: "DIPROSES",
      baris: {
        create: [
          { barisPesananId: orderLineLanyard.id, barangId: lanyard.id, jumlah: 10 },
          { barisPesananId: orderLineStiker.id, barangId: stiker.id, jumlah: 5 },
        ],
      },
    },
  });
  await db.barisPesananPenjualan.update({ where: { id: orderLineLanyard.id }, data: { jumlahTerkirim: 10 } });
  await db.barisPesananPenjualan.update({ where: { id: orderLineStiker.id }, data: { jumlahTerkirim: 5 } });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: lanyard.id, gudangId: gudang.id } },
    data: { jumlah: { decrement: 10 } },
  });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: stiker.id, gudangId: gudang.id } },
    data: { jumlah: { decrement: 5 } },
  });
  await db.pesananPenjualan.update({ where: { id: pesanan.id }, data: { status: "SEBAGIAN" } });
  console.log("  -> SJ-2026-0001 (parsial), status Pesanan jadi SEBAGIAN, stok berkurang (cek halaman Pengiriman & Barang)");

  console.log("=== Tahap 4: Pengiriman sisa (lengkap) ===");
  await db.pengirimanPesanan.create({
    data: {
      nomor: "SJ-2026-0002",
      pesananId: pesanan.id,
      gudangId: gudang.id,
      status: "DIPROSES",
      baris: {
        create: [
          { barisPesananId: orderLineLanyard.id, barangId: lanyard.id, jumlah: 10 },
          { barisPesananId: orderLineStiker.id, barangId: stiker.id, jumlah: 5 },
          { barisPesananId: orderLineGoodieBag.id, barangId: goodieBag.id, jumlah: qtyGoodieBag },
        ],
      },
    },
  });
  await db.barisPesananPenjualan.update({ where: { id: orderLineLanyard.id }, data: { jumlahTerkirim: qtyLanyard } });
  await db.barisPesananPenjualan.update({ where: { id: orderLineStiker.id }, data: { jumlahTerkirim: qtyStiker } });
  await db.barisPesananPenjualan.update({ where: { id: orderLineGoodieBag.id }, data: { jumlahTerkirim: qtyGoodieBag } });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: lanyard.id, gudangId: gudang.id } },
    data: { jumlah: { decrement: 10 } },
  });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: stiker.id, gudangId: gudang.id } },
    data: { jumlah: { decrement: 5 } },
  });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: goodieBag.id, gudangId: gudang.id } },
    data: { jumlah: { decrement: qtyGoodieBag } },
  });
  await db.pesananPenjualan.update({ where: { id: pesanan.id }, data: { status: "DIPROSES" } });
  console.log("  -> SJ-2026-0002 (sisa), status Pesanan jadi DIPROSES, stok Lanyard/Stiker/Goodie Bag berkurang penuh");

  console.log("=== Tahap 5: Faktur Penjualan (untuk seluruh jumlah pesanan) ===");
  const faktur = await db.fakturPenjualan.create({
    data: {
      nomor: "FJ-2026-0001",
      pelangganId: pelanggan.id,
      pesananId: pesanan.id,
      status: "DRAF",
      total: orderTotal,
      jatuhTempo: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      baris: {
        create: [
          { barangId: lanyard.id, jumlah: qtyLanyard, harga: 12000, subtotal: qtyLanyard * 12000 },
          { barangId: stiker.id, jumlah: qtyStiker, harga: 16000, subtotal: qtyStiker * 16000 },
          { barangId: goodieBag.id, jumlah: qtyGoodieBag, harga: 29000, subtotal: qtyGoodieBag * 29000 },
        ],
      },
    },
  });
  await db.barisPesananPenjualan.update({ where: { id: orderLineLanyard.id }, data: { jumlahDifaktur: qtyLanyard } });
  await db.barisPesananPenjualan.update({ where: { id: orderLineStiker.id }, data: { jumlahDifaktur: qtyStiker } });
  await db.barisPesananPenjualan.update({ where: { id: orderLineGoodieBag.id }, data: { jumlahDifaktur: qtyGoodieBag } });
  console.log(`  -> FJ-2026-0001 terbit, total ${orderTotal.toLocaleString("id-ID")} (cek halaman Faktur Penjualan)`);

  console.log("=== Tahap 6: Penerimaan sebagian (cicilan pertama) ===");
  const firstPayment = Math.round(orderTotal / 2);
  await db.penerimaanPenjualan.create({
    data: { nomor: "TRM-2026-0001", pelangganId: pelanggan.id, fakturId: faktur.id, akunId: bank.id, jumlah: firstPayment, metodeBayar: "TRANSFER" },
  });
  await db.fakturPenjualan.update({ where: { id: faktur.id }, data: { status: "SEBAGIAN" } });
  console.log(`  -> TRM-2026-0001 (${firstPayment.toLocaleString("id-ID")}), status Faktur jadi SEBAGIAN`);

  console.log("=== Tahap 7: Penerimaan pelunasan ===");
  const secondPayment = orderTotal - firstPayment;
  await db.penerimaanPenjualan.create({
    data: { nomor: "TRM-2026-0002", pelangganId: pelanggan.id, fakturId: faktur.id, akunId: kas.id, jumlah: secondPayment, metodeBayar: "TUNAI" },
  });
  await db.fakturPenjualan.update({ where: { id: faktur.id }, data: { status: "LUNAS" } });
  console.log(`  -> TRM-2026-0002 (${secondPayment.toLocaleString("id-ID")}), status Faktur jadi LUNAS (cek halaman Penerimaan Penjualan)`);

  console.log("=== Tahap 8: Retur sebagian barang ===");
  await db.returPenjualan.create({
    data: {
      nomor: "RJ-2026-0001",
      fakturId: faktur.id,
      gudangId: gudang.id,
      alasan: "Cetakan lanyard cacat saat pengiriman",
      baris: { create: [{ barangId: lanyard.id, jumlah: 2 }] },
    },
  });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: lanyard.id, gudangId: gudang.id } },
    data: { jumlah: { increment: 2 } },
  });
  console.log("  -> RJ-2026-0001, stok Lanyard bertambah 2 (cek halaman Retur Penjualan & Barang)");

  console.log("=== Tahap 9: Pesanan Pembelian (restock Lanyard ke pemasok) ===");
  const qtyBeli = 50;
  const poTotal = qtyBeli * 9000;
  const po = await db.pesananPembelian.create({
    data: {
      nomor: "PSB-2026-0001",
      pemasokId: pemasok.id,
      status: "DRAF",
      total: poTotal,
      baris: { create: [{ barangId: lanyard.id, jumlah: qtyBeli, harga: 9000 }] },
    },
    include: { baris: true },
  });
  const poLine = po.baris[0];
  console.log("  -> PSB-2026-0001 dibuat (cek halaman Pesanan Pembelian)");

  console.log("=== Tahap 10: Penerimaan Barang sebagian ===");
  await db.penerimaanBarang.create({
    data: {
      nomor: "TB-2026-0001",
      pesananId: po.id,
      gudangId: gudang.id,
      status: "DIPROSES",
      baris: { create: [{ barisPesananId: poLine.id, barangId: lanyard.id, jumlah: 30 }] },
    },
  });
  await db.barisPesananPembelian.update({ where: { id: poLine.id }, data: { jumlahDiterima: 30 } });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: lanyard.id, gudangId: gudang.id } },
    data: { jumlah: { increment: 30 } },
  });
  await db.pesananPembelian.update({ where: { id: po.id }, data: { status: "SEBAGIAN" } });
  console.log("  -> TB-2026-0001 (30 dari 50), status Pesanan Pembelian jadi SEBAGIAN, stok Lanyard bertambah (cek halaman Penerimaan Barang)");

  console.log("=== Tahap 11: Penerimaan Barang sisa ===");
  await db.penerimaanBarang.create({
    data: {
      nomor: "TB-2026-0002",
      pesananId: po.id,
      gudangId: gudang.id,
      status: "DIPROSES",
      baris: { create: [{ barisPesananId: poLine.id, barangId: lanyard.id, jumlah: 20 }] },
    },
  });
  await db.barisPesananPembelian.update({ where: { id: poLine.id }, data: { jumlahDiterima: qtyBeli } });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: lanyard.id, gudangId: gudang.id } },
    data: { jumlah: { increment: 20 } },
  });
  await db.pesananPembelian.update({ where: { id: po.id }, data: { status: "DIPROSES" } });
  console.log("  -> TB-2026-0002 (sisa 20), status Pesanan Pembelian jadi DIPROSES");

  console.log("=== Tahap 12: Faktur Pembelian ===");
  const fakturPembelian = await db.fakturPembelian.create({
    data: {
      nomor: "FB-2026-0001",
      pemasokId: pemasok.id,
      pesananId: po.id,
      status: "DRAF",
      total: poTotal,
      jatuhTempo: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      baris: { create: [{ barangId: lanyard.id, jumlah: qtyBeli, harga: 9000, subtotal: poTotal }] },
    },
  });
  await db.barisPesananPembelian.update({ where: { id: poLine.id }, data: { jumlahDifaktur: qtyBeli } });
  console.log(`  -> FB-2026-0001 terbit, total ${poTotal.toLocaleString("id-ID")} (cek halaman Faktur Pembelian)`);

  console.log("=== Tahap 13: Pembayaran sebagian ke pemasok ===");
  const firstPurchasePayment = Math.round(poTotal / 2);
  await db.pembayaranPembelian.create({
    data: { nomor: "BYR-2026-0001", pemasokId: pemasok.id, fakturId: fakturPembelian.id, akunId: bank.id, jumlah: firstPurchasePayment, metodeBayar: "TRANSFER" },
  });
  await db.fakturPembelian.update({ where: { id: fakturPembelian.id }, data: { status: "SEBAGIAN" } });
  console.log(`  -> BYR-2026-0001 (${firstPurchasePayment.toLocaleString("id-ID")}), status Faktur Pembelian jadi SEBAGIAN (cek halaman Pembayaran Pembelian)`);

  console.log("=== Tahap 14: Pelunasan ke pemasok ===");
  const secondPurchasePayment = poTotal - firstPurchasePayment;
  await db.pembayaranPembelian.create({
    data: { nomor: "BYR-2026-0002", pemasokId: pemasok.id, fakturId: fakturPembelian.id, akunId: kas.id, jumlah: secondPurchasePayment, metodeBayar: "TUNAI" },
  });
  await db.fakturPembelian.update({ where: { id: fakturPembelian.id }, data: { status: "LUNAS" } });
  console.log(`  -> BYR-2026-0002 (${secondPurchasePayment.toLocaleString("id-ID")}), status Faktur Pembelian jadi LUNAS`);

  console.log("=== Tahap 15: Retur sebagian barang ke pemasok ===");
  await db.returPembelian.create({
    data: {
      nomor: "RB-2026-0001",
      fakturId: fakturPembelian.id,
      gudangId: gudang.id,
      alasan: "Cetakan lanyard buram, dikembalikan ke vendor",
      baris: { create: [{ barangId: lanyard.id, jumlah: 5 }] },
    },
  });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: lanyard.id, gudangId: gudang.id } },
    data: { jumlah: { decrement: 5 } },
  });
  console.log("  -> RB-2026-0001, stok Lanyard berkurang 5 (cek halaman Retur Pembelian & Barang)");

  console.log("=== Tahap 16: Jurnal Umum - setoran modal awal ===");
  await db.jurnal.create({
    data: {
      nomor: "JU-2026-0001",
      keterangan: "Setoran modal awal pemilik",
      sumber: "MANUAL",
      baris: {
        create: [
          { akunId: kas.id, debit: 10000000, kredit: 0, keterangan: "Setoran modal" },
          { akunId: modal.id, debit: 0, kredit: 10000000, keterangan: "Setoran modal" },
        ],
      },
    },
  });
  console.log("  -> JU-2026-0001 (cek halaman Jurnal Umum)");

  console.log("=== Tahap 17: Kas Masuk - setor tunai ke bank ===");
  await db.jurnal.create({
    data: {
      nomor: "KM-2026-0001",
      keterangan: "Setor tunai ke bank",
      sumber: "KAS_MASUK",
      baris: {
        create: [
          { akunId: bank.id, debit: 2000000, kredit: 0, keterangan: "Setor tunai ke bank" },
          { akunId: kas.id, debit: 0, kredit: 2000000, keterangan: "Setor tunai ke bank" },
        ],
      },
    },
  });
  console.log("  -> KM-2026-0001 (cek halaman Kas Masuk)");

  console.log("=== Tahap 18: Kas Keluar - bayar sewa tempat ===");
  await db.jurnal.create({
    data: {
      nomor: "KK-2026-0001",
      keterangan: "Bayar sewa tempat bulan ini",
      sumber: "KAS_KELUAR",
      baris: {
        create: [
          { akunId: sewa.id, debit: 1500000, kredit: 0, keterangan: "Bayar sewa tempat" },
          { akunId: kas.id, debit: 0, kredit: 1500000, keterangan: "Bayar sewa tempat" },
        ],
      },
    },
  });
  console.log("  -> KK-2026-0001, saldo Kas jadi 10.000.000 - 2.000.000 - 1.500.000 = 6.500.000 (cek halaman Kas Keluar & Buku Besar)");

  console.log("=== Tahap 19: Aset Tetap - beli sound system portabel ===");
  const soundSystem = await db.asetTetap.create({
    data: {
      kode: "AT-001",
      nama: "Sound System Portabel",
      tanggalPerolehan: new Date("2026-01-01"),
      hargaPerolehan: 6000000,
      nilaiSisa: 600000,
      umurBulan: 36,
      akunAsetId: peralatan.id,
      akunBebanPenyusutanId: bebanPenyusutan.id,
      akunAkumulasiPenyusutanId: akumPenyusutan.id,
    },
  });
  console.log("  -> AT-001 terdaftar, penyusutan bulanan: (6.000.000-600.000)/36 = 150.000 (cek halaman Daftar Aset)");

  console.log("=== Tahap 20: Jalankan Penyusutan periode 2026-08 ===");
  const monthlyDepreciation = (Number(soundSystem.hargaPerolehan) - Number(soundSystem.nilaiSisa)) / soundSystem.umurBulan;
  const depCount = await db.jurnal.count();
  const depNo = `JU-PNY-2026-${String(depCount + 1).padStart(4, "0")}`;
  const depJournal = await db.jurnal.create({
    data: {
      nomor: depNo,
      keterangan: "Penyusutan aset periode 2026-08",
      sumber: "PENYUSUTAN",
      baris: {
        create: [
          { akunId: bebanPenyusutan.id, debit: monthlyDepreciation, kredit: 0, keterangan: "Penyusutan Sound System Portabel" },
          { akunId: akumPenyusutan.id, debit: 0, kredit: monthlyDepreciation, keterangan: "Akumulasi penyusutan Sound System Portabel" },
        ],
      },
    },
  });
  await db.penyusutanAset.create({
    data: { asetId: soundSystem.id, periode: new Date("2026-08-01"), jumlah: monthlyDepreciation, jurnalId: depJournal.id },
  });
  console.log(`  -> ${depNo}, nilai buku Sound System jadi 6.000.000 - 150.000 = 5.850.000 (cek halaman Penyusutan)`);

  console.log("\n=== Selesai. Ringkasan stok akhir ===");
  const finalStock = await db.stokBarang.findMany({ include: { barang: true }, where: { gudangId: gudang.id } });
  for (const s of finalStock) {
    console.log(`  ${s.barang.nama}: ${s.jumlah.toString()}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("SEED FAILED", err);
    process.exit(1);
  });
