import "dotenv/config";
import { db } from "../src/lib/db";

/**
 * Satu alur cerita tunggal yang melewati SETIAP tahap siklus penjualan,
 * supaya tiap halaman (Penawaran, Pesanan, Pengiriman, Faktur, Penerimaan, Retur)
 * langsung punya contoh data yang bisa dilihat dan saling terhubung.
 */
async function main() {
  console.log("=== Master data ===");
  const dept = await db.departemen.create({ data: { nama: "Penjualan" } });
  const penjual = await db.karyawan.create({
    data: { kode: "SLS-01", nama: "Rudi Hartono", departemenId: dept.id },
  });
  const pelanggan = await db.pelanggan.create({
    data: {
      kode: "CUST-001",
      nama: "Toko Kue Manis",
      alamat: "Jl. Melati No. 7, Jakarta",
      telepon: "021-5551234",
      penjualId: penjual.id,
    },
  });
  const pemasok = await db.pemasok.create({
    data: { kode: "SUP-001", nama: "PT Sumber Tepung Jaya", alamat: "Kawasan Industri Pulogadung", telepon: "021-4449876" },
  });
  const gudang = await db.gudang.create({
    data: { kode: "WH-01", nama: "Gudang Utama", alamat: "Jl. Raya Bekasi KM 20" },
  });
  const kelompok = await db.kelompokBarang.create({ data: { nama: "Bahan Baku" } });
  await db.proyek.create({
    data: { kode: "PRJ-001", nama: "Pesanan Ulang Tahun", pelangganId: pelanggan.id, status: "BERJALAN" },
  });

  console.log("=== Daftar Akun (Chart of Accounts) ===");
  const accountDefs = [
    { kode: "1-1000", nama: "Kas", jenis: "ASET" as const },
    { kode: "1-1100", nama: "Bank", jenis: "ASET" as const },
    { kode: "1-1200", nama: "Piutang Usaha", jenis: "ASET" as const },
    { kode: "1-1300", nama: "Persediaan Barang Dagang", jenis: "ASET" as const },
    { kode: "2-1000", nama: "Utang Usaha", jenis: "KEWAJIBAN" as const },
    { kode: "3-1000", nama: "Modal Pemilik", jenis: "MODAL" as const },
    { kode: "4-1000", nama: "Pendapatan Penjualan", jenis: "PENDAPATAN" as const },
    { kode: "5-1000", nama: "Harga Pokok Penjualan", jenis: "BEBAN" as const },
    { kode: "5-2000", nama: "Beban Sewa", jenis: "BEBAN" as const },
    { kode: "5-2100", nama: "Beban Listrik & Air", jenis: "BEBAN" as const },
    { kode: "1-2000", nama: "Peralatan Dapur", jenis: "ASET" as const },
    { kode: "1-2100", nama: "Akumulasi Penyusutan Peralatan", jenis: "ASET" as const },
    { kode: "5-3000", nama: "Beban Penyusutan", jenis: "BEBAN" as const },
  ];
  const daftarAkun: Record<string, Awaited<ReturnType<typeof db.akun.create>>> = {};
  for (const def of accountDefs) {
    daftarAkun[def.kode] = await db.akun.create({ data: def });
  }
  const [kas, bank, piutang, persediaanAkun, utang, modal, pendapatan, hpp, sewa, , peralatan, akumPenyusutan, bebanPenyusutan] =
    Object.values(daftarAkun);

  await db.pemetaanAkun.create({
    data: {
      id: "default",
      piutangUsahaId: piutang.id,
      persediaanId: persediaanAkun.id,
      hppId: hpp.id,
      pendapatanPenjualanId: pendapatan.id,
      utangUsahaId: utang.id,
    },
  });

  const itemDefs = [
    { kode: "BRG-001", nama: "Tepung Terigu 1kg", satuan: "pack", hargaBeli: 9000, hargaJual: 12000 },
    { kode: "BRG-002", nama: "Gula Pasir 1kg", satuan: "pack", hargaBeli: 13000, hargaJual: 16000 },
    { kode: "BRG-003", nama: "Telur Ayam 1kg", satuan: "pack", hargaBeli: 24000, hargaJual: 29000 },
  ];
  const daftarBarang: Record<string, Awaited<ReturnType<typeof db.barang.create>>> = {};
  for (const def of itemDefs) {
    const barang = await db.barang.create({
      data: { ...def, kelompokId: kelompok.id, stokMinimum: 10 },
    });
    daftarBarang[def.kode] = barang;
    await db.stokBarang.create({ data: { barangId: barang.id, gudangId: gudang.id, jumlah: 100 } });
  }
  const tepung = daftarBarang["BRG-001"];
  const gula = daftarBarang["BRG-002"];
  const telur = daftarBarang["BRG-003"];

  console.log("=== Tahap 1: Penawaran Penjualan (draft, belum dikonversi) ===");
  await db.penawaranPenjualan.create({
    data: {
      nomor: "PNW-2026-0001",
      pelangganId: pelanggan.id,
      status: "DRAF",
      total: 5 * 12000 + 5 * 16000,
      baris: {
        create: [
          { barangId: tepung.id, jumlah: 5, harga: 12000, subtotal: 60000 },
          { barangId: gula.id, jumlah: 5, harga: 16000, subtotal: 80000 },
        ],
      },
    },
  });
  console.log("  -> PNW-2026-0001 dibuat (cek halaman Penawaran Penjualan)");

  console.log("=== Tahap 2: Penawaran kedua, dikonversi jadi Pesanan ===");
  const qtyTepung = 20;
  const qtyGula = 10;
  const qtyTelur = 15;
  const orderTotal = qtyTepung * 12000 + qtyGula * 16000 + qtyTelur * 29000;

  const q2 = await db.penawaranPenjualan.create({
    data: {
      nomor: "PNW-2026-0002",
      pelangganId: pelanggan.id,
      status: "DIKONVERSI",
      total: orderTotal,
      baris: {
        create: [
          { barangId: tepung.id, jumlah: qtyTepung, harga: 12000, subtotal: qtyTepung * 12000 },
          { barangId: gula.id, jumlah: qtyGula, harga: 16000, subtotal: qtyGula * 16000 },
          { barangId: telur.id, jumlah: qtyTelur, harga: 29000, subtotal: qtyTelur * 29000 },
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
          { barangId: tepung.id, jumlah: qtyTepung, harga: 12000 },
          { barangId: gula.id, jumlah: qtyGula, harga: 16000 },
          { barangId: telur.id, jumlah: qtyTelur, harga: 29000 },
        ],
      },
    },
    include: { baris: true },
  });
  console.log("  -> PNW-2026-0002 dikonversi jadi PSJ-2026-0001 (cek halaman Pesanan Penjualan)");

  const orderLineTepung = pesanan.baris.find((l) => l.barangId === tepung.id)!;
  const orderLineGula = pesanan.baris.find((l) => l.barangId === gula.id)!;
  const orderLineTelur = pesanan.baris.find((l) => l.barangId === telur.id)!;

  console.log("=== Tahap 3: Pengiriman sebagian (parsial) ===");
  await db.pengirimanPesanan.create({
    data: {
      nomor: "SJ-2026-0001",
      pesananId: pesanan.id,
      gudangId: gudang.id,
      status: "DIPROSES",
      baris: {
        create: [
          { barisPesananId: orderLineTepung.id, barangId: tepung.id, jumlah: 10 },
          { barisPesananId: orderLineGula.id, barangId: gula.id, jumlah: 5 },
        ],
      },
    },
  });
  await db.barisPesananPenjualan.update({ where: { id: orderLineTepung.id }, data: { jumlahTerkirim: 10 } });
  await db.barisPesananPenjualan.update({ where: { id: orderLineGula.id }, data: { jumlahTerkirim: 5 } });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: tepung.id, gudangId: gudang.id } },
    data: { jumlah: { decrement: 10 } },
  });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: gula.id, gudangId: gudang.id } },
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
          { barisPesananId: orderLineTepung.id, barangId: tepung.id, jumlah: 10 },
          { barisPesananId: orderLineGula.id, barangId: gula.id, jumlah: 5 },
          { barisPesananId: orderLineTelur.id, barangId: telur.id, jumlah: qtyTelur },
        ],
      },
    },
  });
  await db.barisPesananPenjualan.update({ where: { id: orderLineTepung.id }, data: { jumlahTerkirim: qtyTepung } });
  await db.barisPesananPenjualan.update({ where: { id: orderLineGula.id }, data: { jumlahTerkirim: qtyGula } });
  await db.barisPesananPenjualan.update({ where: { id: orderLineTelur.id }, data: { jumlahTerkirim: qtyTelur } });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: tepung.id, gudangId: gudang.id } },
    data: { jumlah: { decrement: 10 } },
  });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: gula.id, gudangId: gudang.id } },
    data: { jumlah: { decrement: 5 } },
  });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: telur.id, gudangId: gudang.id } },
    data: { jumlah: { decrement: qtyTelur } },
  });
  await db.pesananPenjualan.update({ where: { id: pesanan.id }, data: { status: "DIPROSES" } });
  console.log("  -> SJ-2026-0002 (sisa), status Pesanan jadi DIPROSES, stok Tepung/Gula/Telur berkurang penuh");

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
          { barangId: tepung.id, jumlah: qtyTepung, harga: 12000, subtotal: qtyTepung * 12000 },
          { barangId: gula.id, jumlah: qtyGula, harga: 16000, subtotal: qtyGula * 16000 },
          { barangId: telur.id, jumlah: qtyTelur, harga: 29000, subtotal: qtyTelur * 29000 },
        ],
      },
    },
  });
  await db.barisPesananPenjualan.update({ where: { id: orderLineTepung.id }, data: { jumlahDifaktur: qtyTepung } });
  await db.barisPesananPenjualan.update({ where: { id: orderLineGula.id }, data: { jumlahDifaktur: qtyGula } });
  await db.barisPesananPenjualan.update({ where: { id: orderLineTelur.id }, data: { jumlahDifaktur: qtyTelur } });
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
      alasan: "Kemasan tepung rusak saat pengiriman",
      baris: { create: [{ barangId: tepung.id, jumlah: 2 }] },
    },
  });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: tepung.id, gudangId: gudang.id } },
    data: { jumlah: { increment: 2 } },
  });
  console.log("  -> RJ-2026-0001, stok Tepung bertambah 2 (cek halaman Retur Penjualan & Barang)");

  console.log("=== Tahap 9: Pesanan Pembelian (restock Tepung ke pemasok) ===");
  const qtyBeli = 50;
  const poTotal = qtyBeli * 9000;
  const po = await db.pesananPembelian.create({
    data: {
      nomor: "PSB-2026-0001",
      pemasokId: pemasok.id,
      status: "DRAF",
      total: poTotal,
      baris: { create: [{ barangId: tepung.id, jumlah: qtyBeli, harga: 9000 }] },
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
      baris: { create: [{ barisPesananId: poLine.id, barangId: tepung.id, jumlah: 30 }] },
    },
  });
  await db.barisPesananPembelian.update({ where: { id: poLine.id }, data: { jumlahDiterima: 30 } });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: tepung.id, gudangId: gudang.id } },
    data: { jumlah: { increment: 30 } },
  });
  await db.pesananPembelian.update({ where: { id: po.id }, data: { status: "SEBAGIAN" } });
  console.log("  -> TB-2026-0001 (30 dari 50), status Pesanan Pembelian jadi SEBAGIAN, stok Tepung bertambah (cek halaman Penerimaan Barang)");

  console.log("=== Tahap 11: Penerimaan Barang sisa ===");
  await db.penerimaanBarang.create({
    data: {
      nomor: "TB-2026-0002",
      pesananId: po.id,
      gudangId: gudang.id,
      status: "DIPROSES",
      baris: { create: [{ barisPesananId: poLine.id, barangId: tepung.id, jumlah: 20 }] },
    },
  });
  await db.barisPesananPembelian.update({ where: { id: poLine.id }, data: { jumlahDiterima: qtyBeli } });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: tepung.id, gudangId: gudang.id } },
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
      baris: { create: [{ barangId: tepung.id, jumlah: qtyBeli, harga: 9000, subtotal: poTotal }] },
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
      alasan: "Tepung apek, dikembalikan ke pemasok",
      baris: { create: [{ barangId: tepung.id, jumlah: 5 }] },
    },
  });
  await db.stokBarang.update({
    where: { barangId_gudangId: { barangId: tepung.id, gudangId: gudang.id } },
    data: { jumlah: { decrement: 5 } },
  });
  console.log("  -> RB-2026-0001, stok Tepung berkurang 5 (cek halaman Retur Pembelian & Barang)");

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

  console.log("=== Tahap 19: Aset Tetap - beli mixer adonan ===");
  const mixer = await db.asetTetap.create({
    data: {
      kode: "AT-001",
      nama: "Mixer Adonan Industrial",
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
  const monthlyDepreciation = (Number(mixer.hargaPerolehan) - Number(mixer.nilaiSisa)) / mixer.umurBulan;
  const depCount = await db.jurnal.count();
  const depNo = `JU-PNY-2026-${String(depCount + 1).padStart(4, "0")}`;
  const depJournal = await db.jurnal.create({
    data: {
      nomor: depNo,
      keterangan: "Penyusutan aset periode 2026-08",
      sumber: "PENYUSUTAN",
      baris: {
        create: [
          { akunId: bebanPenyusutan.id, debit: monthlyDepreciation, kredit: 0, keterangan: "Penyusutan Mixer Adonan Industrial" },
          { akunId: akumPenyusutan.id, debit: 0, kredit: monthlyDepreciation, keterangan: "Akumulasi penyusutan Mixer Adonan Industrial" },
        ],
      },
    },
  });
  await db.penyusutanAset.create({
    data: { asetId: mixer.id, periode: new Date("2026-08-01"), jumlah: monthlyDepreciation, jurnalId: depJournal.id },
  });
  console.log(`  -> ${depNo}, nilai buku Mixer jadi 6.000.000 - 150.000 = 5.850.000 (cek halaman Penyusutan)`);

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
