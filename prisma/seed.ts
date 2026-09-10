import "dotenv/config";
// Seed memanggil aksi server yang sama dengan UI (di luar siklus HTTP), supaya dokumen, stok,
// harga pokok rata-rata, dan jurnal dijamin sinkron — bukan menulis tabel satu per satu.
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { hashKataSandi } from "../src/lib/kataSandi";
import { terapkanBaganAkunStandar } from "../src/lib/baganAkun";
import { BAGAN_AKUN_STANDAR } from "../src/lib/baganAkunStandar";
import { periksaSinkron } from "../src/lib/sinkron";
import { buatPenawaran, konversiPenawaranKePesanan, buatPengiriman, buatFaktur, buatPenerimaan, buatRetur } from "../src/lib/aksi/penjualan";
import { buatPesananPembelian, buatPenerimaanBarang, buatFakturPembelian, buatPembayaranPembelian, buatReturPembelian } from "../src/lib/aksi/pembelian";
import { buatJurnalManual, buatKasMasuk, buatKasKeluar } from "../src/lib/aksi/jurnal";
import { buatAsetTetap, jalankanPenyusutanBulanan } from "../src/lib/aksi/asetTetap";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";

/** Aksi server diakhiri redirect()/revalidatePath() yang melempar di luar Next — efek DB-nya sudah tersimpan. */
async function jalankan(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    const digest = (err as { digest?: string })?.digest ?? "";
    const pesan = (err as { message?: string })?.message ?? "";
    if (!digest.startsWith("NEXT_REDIRECT") && !pesan.includes("static generation store missing")) throw err;
  }
  console.log(`  -> ${label}`);
}

function formulir(isian: Record<string, string | number | object>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isian)) fd.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  return fd;
}

const rp = (n: number | string | { toString(): string }) => Number(n).toLocaleString("id-ID");

/** Akun contoh: Superadmin dan dua Pemilik setara (tingkat tertinggi); peran lain sesuai dummy. Kata sandi = nama peran + 123. */
export const AKUN_CONTOH = [
  { namaPengguna: "superadmin", kataSandi: "superadmin123", nama: "Andrew Steine", peran: "SUPERADMIN" },
  { namaPengguna: "owner", kataSandi: "owner123", nama: "Donny Donatus", peran: "PEMILIK" },
  { namaPengguna: "owner2", kataSandi: "owner123", nama: "Nadia Yuliana", peran: "PEMILIK" },
  { namaPengguna: "admin", kataSandi: "admin123", nama: "Bagus Santoso", peran: "ADMIN" },
  { namaPengguna: "kasir", kataSandi: "kasir123", nama: "Sari Wulandari", peran: "KASIR" },
  { namaPengguna: "gudang", kataSandi: "gudang123", nama: "Joko Prasetyo", peran: "GUDANG" },
] as const;

async function main() {
  console.log("=== Pengguna (masuk dengan nama pengguna; kata sandi = nama peran + 123) ===");
  for (const a of AKUN_CONTOH) {
    await db.pengguna.create({ data: { namaPengguna: a.namaPengguna, nama: a.nama, peran: a.peran, kataSandiHash: await hashKataSandi(a.kataSandi) } });
    console.log(`  -> ${a.namaPengguna.padEnd(10)} / ${a.kataSandi.padEnd(14)} ${a.nama} (${a.peran})`);
  }

  console.log("=== Data induk (usaha Event/Wedding Organizer) ===");
  const dept = await db.departemen.create({ data: { nama: "Marketing & Event" } });
  const penjual = await db.karyawan.create({ data: { kode: "SLS-01", nama: "Rudi Hartono", departemenId: dept.id } });
  const pelanggan = await db.pelanggan.create({
    data: { kode: "CUST-001", nama: "PT Cahaya Nusantara", alamat: "Jl. Sudirman Kav. 12, Jakarta", telepon: "021-5551234", penjualId: penjual.id },
  });
  const pemasok = await db.pemasok.create({
    data: { kode: "SUP-001", nama: "CV Sinar Dekorasi", alamat: "Jl. Pahlawan No. 5, Bekasi", telepon: "021-4449876" },
  });
  const gudang = await db.gudang.create({ data: { kode: "WH-01", nama: "Gudang Peralatan", alamat: "Jl. Raya Bekasi KM 20" } });
  const kelompokMerch = await db.kelompokBarang.create({ data: { nama: "Merchandise & Produksi" } });
  const kelompokJasa = await db.kelompokBarang.create({ data: { nama: "Jasa Event" } });
  await db.proyek.create({ data: { kode: "PRJ-001", nama: "Wedding Andi & Sari", pelangganId: pelanggan.id, status: "BERJALAN" } });

  console.log(`=== Bagan Akun Standar EO/WO (${BAGAN_AKUN_STANDAR.length} akun) + pemetaan akun ===`);
  await terapkanBaganAkunStandar(db);
  const akun = (kode: string) => db.akun.findUniqueOrThrow({ where: { kode } });
  // Identitas & pajak: usaha kecil non-PKP (faktur tanpa PPN), akun PPh 23 disiapkan agar potongan pajak klien/vendor bisa dicatat
  const [ppnKeluaran, ppnMasukan, pph23Dimuka, pph23Hutang] = await Promise.all(["2-1330", "1-1800", "1-1900", "2-1320"].map(akun));
  await db.pengaturanPerusahaan.create({
    data: { id: "default", nama: "D'Production Event Organizer", pkp: false, tarifPpnPersen: 11, terminHari: 14, akunPpnKeluaranId: ppnKeluaran.id, akunPpnMasukanId: ppnMasukan.id, akunPph23DimukaId: pph23Dimuka.id, akunPph23DipotongId: pph23Hutang.id },
  });
  const [kas, bank, modal, sewa, peralatan, akumPenyusutan, bebanPenyusutan, biayaEvent, pendapatanEvent, pendapatanProduksi] = await Promise.all(
    ["1-1100", "1-1210", "3-1000", "5-4500", "1-2400", "1-2940", "5-9540", "5-1200", "4-1100", "4-2100"].map(akun),
  );

  // Barang produksi/merchandise (persediaan) + jasa (tanpa stok, akun pendapatan/beban sendiri)
  const buatBarang = (data: Parameters<typeof db.barang.create>[0]["data"]) => db.barang.create({ data });
  const lanyard = await buatBarang({ kode: "BRG-001", nama: "Lanyard & ID Card", satuan: "pcs", hargaBeli: 9000, hargaJual: 12000, kelompokId: kelompokMerch.id, stokMinimum: 10, akunPendapatanId: pendapatanProduksi.id });
  const stiker = await buatBarang({ kode: "BRG-002", nama: "Stiker & Kupon Event", satuan: "pack", hargaBeli: 13000, hargaJual: 16000, kelompokId: kelompokMerch.id, stokMinimum: 10, akunPendapatanId: pendapatanProduksi.id });
  const goodieBag = await buatBarang({ kode: "BRG-003", nama: "Goodie Bag Peserta", satuan: "pcs", hargaBeli: 24000, hargaJual: 29000, kelompokId: kelompokMerch.id, stokMinimum: 10, akunPendapatanId: pendapatanProduksi.id });
  const jasaDekor = await buatBarang({ kode: "JSA-001", nama: "Jasa Dekorasi Panggung", jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 2500000, kelompokId: kelompokJasa.id, akunPendapatanId: pendapatanEvent.id });
  const jasaSound = await buatBarang({ kode: "JSA-002", nama: "Jasa Sound Engineer (vendor)", jenis: "JASA", satuan: "hari", hargaBeli: 750000, hargaJual: 1000000, kelompokId: kelompokJasa.id, akunPendapatanId: pendapatanEvent.id, akunBebanId: biayaEvent.id });

  console.log("=== Tahap 0: Modal awal, setor ke bank, saldo awal persediaan ===");
  await jalankan("JU: setoran modal awal Rp 25.000.000 ke Kas", () =>
    buatJurnalManual(formulir({ keterangan: "Setoran modal awal pemilik", baris: [
      { akunId: kas.id, debit: 25000000, kredit: 0, keterangan: "Setoran modal" },
      { akunId: modal.id, debit: 0, kredit: 25000000, keterangan: "Setoran modal" },
    ] })),
  );
  await jalankan("KM: setor tunai Rp 10.000.000 ke Bank", () =>
    buatKasMasuk(formulir({ akunKasId: bank.id, akunLawanId: kas.id, jumlah: 10000000, keterangan: "Setor tunai ke bank" })),
  );
  await jalankan("PS: saldo awal persediaan 100 pcs tiap barang (Dr Persediaan / Cr Modal)", () =>
    buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, keterangan: "Saldo awal persediaan", baris: [
      { barangId: lanyard.id, jumlahSesudah: 100, hargaSatuan: 9000 },
      { barangId: stiker.id, jumlahSesudah: 100, hargaSatuan: 13000 },
      { barangId: goodieBag.id, jumlahSesudah: 100, hargaSatuan: 24000 },
    ] })),
  );

  console.log("=== Tahap 1: Penawaran Penjualan (draft, belum dikonversi) ===");
  await jalankan("PNW-…-0001 draft: 5 lanyard + 5 stiker", () =>
    buatPenawaran(formulir({ pelangganId: pelanggan.id, baris: [
      { barangId: lanyard.id, jumlah: 5, harga: 12000 },
      { barangId: stiker.id, jumlah: 5, harga: 16000 },
    ] })),
  );

  console.log("=== Tahap 2: Penawaran kedua → dikonversi jadi Pesanan Penjualan ===");
  await jalankan("PNW-…-0002: 20 lanyard, 10 stiker, 15 goodie bag, 1 paket dekorasi (jasa)", () =>
    buatPenawaran(formulir({ pelangganId: pelanggan.id, baris: [
      { barangId: lanyard.id, jumlah: 20, harga: 12000 },
      { barangId: stiker.id, jumlah: 10, harga: 16000 },
      { barangId: goodieBag.id, jumlah: 15, harga: 29000 },
      { barangId: jasaDekor.id, jumlah: 1, harga: 2500000 },
    ] })),
  );
  const pnw2 = await db.penawaranPenjualan.findFirstOrThrow({ where: { status: "DRAF", total: { gt: 1000000 } }, orderBy: { nomor: "desc" } });
  await jalankan("PSJ-…-0001 dari konversi PNW-…-0002", () => konversiPenawaranKePesanan(pnw2.id));
  const pesanan = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnw2.id }, include: { baris: true } });
  const barisPesanan = (barangId: string) => pesanan.baris.find((b) => b.barangId === barangId)!;

  console.log("=== Tahap 3-4: Pengiriman sebagian, lalu sisanya (stok berkurang, jasa tanpa stok) ===");
  await jalankan("SJ-…-0001: 10 lanyard + 5 stiker → status SEBAGIAN", () =>
    buatPengiriman(formulir({ pesananId: pesanan.id, gudangId: gudang.id, baris: [
      { barisPesananId: barisPesanan(lanyard.id).id, barangId: lanyard.id, jumlah: 10 },
      { barisPesananId: barisPesanan(stiker.id).id, barangId: stiker.id, jumlah: 5 },
    ] })),
  );
  await jalankan("SJ-…-0002: sisa 10 lanyard, 5 stiker, 15 goodie bag, 1 jasa dekorasi → DIPROSES", () =>
    buatPengiriman(formulir({ pesananId: pesanan.id, gudangId: gudang.id, baris: [
      { barisPesananId: barisPesanan(lanyard.id).id, barangId: lanyard.id, jumlah: 10 },
      { barisPesananId: barisPesanan(stiker.id).id, barangId: stiker.id, jumlah: 5 },
      { barisPesananId: barisPesanan(goodieBag.id).id, barangId: goodieBag.id, jumlah: 15 },
      { barisPesananId: barisPesanan(jasaDekor.id).id, barangId: jasaDekor.id, jumlah: 1 },
    ] })),
  );

  console.log("=== Tahap 5: Faktur Penjualan seluruh pesanan (jurnal JU-FJ: piutang, pendapatan per akun, HPP) ===");
  await jalankan("FJ-…-0001 total Rp 3.335.000", () =>
    buatFaktur(formulir({ pesananId: pesanan.id, baris: pesanan.baris.map((b) => ({ barangId: b.barangId, jumlah: Number(b.jumlah), harga: Number(b.harga) })) })),
  );
  const faktur = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: pesanan.id } });

  console.log("=== Tahap 6-8: Penerimaan cicilan → retur 2 lanyard → pelunasan ===");
  await jalankan("TRM-…-0001: Rp 1.667.500 via Bank → SEBAGIAN", () =>
    buatPenerimaan(formulir({ fakturId: faktur.id, akunId: bank.id, jumlah: 1667500, metodeBayar: "TRANSFER" })),
  );
  await jalankan("RJ-…-0001: retur 2 lanyard (Rp 24.000), stok kembali", () =>
    buatRetur(formulir({ fakturId: faktur.id, gudangId: gudang.id, alasan: "Cetakan lanyard cacat saat pengiriman", baris: [{ barangId: lanyard.id, jumlah: 2 }] })),
  );
  await jalankan("TRM-…-0002: pelunasan Rp 1.643.500 tunai → LUNAS", () =>
    buatPenerimaan(formulir({ fakturId: faktur.id, akunId: kas.id, jumlah: 1643500, metodeBayar: "TUNAI" })),
  );

  console.log("=== Tahap 9-11: Pesanan Pembelian → Terima Barang 2× (jurnal JU-TB, harga pokok rata-rata) ===");
  await jalankan("PSB-…-0001: 50 lanyard @9.000 + 1 hari jasa sound engineer @750.000", () =>
    buatPesananPembelian(formulir({ pemasokId: pemasok.id, baris: [
      { barangId: lanyard.id, jumlah: 50, harga: 9000 },
      { barangId: jasaSound.id, jumlah: 1, harga: 750000 },
    ] })),
  );
  const psb = await db.pesananPembelian.findFirstOrThrow({ where: { pemasokId: pemasok.id }, include: { baris: true } });
  const barisPsb = (barangId: string) => psb.baris.find((b) => b.barangId === barangId)!;
  await jalankan("TB-…-0001: 30 lanyard → SEBAGIAN", () =>
    buatPenerimaanBarang(formulir({ pesananId: psb.id, gudangId: gudang.id, baris: [{ barisPesananId: barisPsb(lanyard.id).id, barangId: lanyard.id, jumlah: 30 }] })),
  );
  await jalankan("TB-…-0002: 20 lanyard + jasa sound → DIPROSES", () =>
    buatPenerimaanBarang(formulir({ pesananId: psb.id, gudangId: gudang.id, baris: [
      { barisPesananId: barisPsb(lanyard.id).id, barangId: lanyard.id, jumlah: 20 },
      { barisPesananId: barisPsb(jasaSound.id).id, barangId: jasaSound.id, jumlah: 1 },
    ] })),
  );

  console.log("=== Tahap 12-15: Faktur Pembelian → bayar sebagian → retur 5 lanyard → pelunasan ===");
  await jalankan("FB-…-0001 total Rp 1.200.000 (JU-FB: barang belum ditagih + beban jasa)", () =>
    buatFakturPembelian(formulir({ pesananId: psb.id, baris: psb.baris.map((b) => ({ barangId: b.barangId, jumlah: Number(b.jumlah), harga: Number(b.harga) })) })),
  );
  const fakturBeli = await db.fakturPembelian.findFirstOrThrow({ where: { pesananId: psb.id } });
  await jalankan("BYR-…-0001: Rp 600.000 via Bank → SEBAGIAN", () =>
    buatPembayaranPembelian(formulir({ fakturId: fakturBeli.id, akunId: bank.id, jumlah: 600000, metodeBayar: "TRANSFER" })),
  );
  await jalankan("RB-…-0001: retur 5 lanyard (Rp 45.000) ke vendor", () =>
    buatReturPembelian(formulir({ fakturId: fakturBeli.id, gudangId: gudang.id, alasan: "Cetakan lanyard buram, dikembalikan ke vendor", baris: [{ barangId: lanyard.id, jumlah: 5 }] })),
  );
  await jalankan("BYR-…-0002: pelunasan Rp 555.000 tunai → LUNAS", () =>
    buatPembayaranPembelian(formulir({ fakturId: fakturBeli.id, akunId: kas.id, jumlah: 555000, metodeBayar: "TUNAI" })),
  );

  console.log("=== Tahap 16: Kas Keluar - bayar sewa kantor ===");
  await jalankan("KK: sewa kantor Rp 1.500.000 dari Kas", () =>
    buatKasKeluar(formulir({ akunKasId: kas.id, akunLawanId: sewa.id, jumlah: 1500000, keterangan: "Bayar sewa kantor bulan ini" })),
  );

  console.log("=== Tahap 17-18: Aset Tetap dibeli dari Bank (JU-AT) → penyusutan periode 2026-08 (JU-PNY) ===");
  await jalankan("AT-001 Sound System Portabel Rp 6.000.000, sisa 600.000, 36 bulan, dibayar dari Bank", () =>
    buatAsetTetap(formulir({
      kode: "AT-001", nama: "Sound System Portabel", tanggalPerolehan: "2026-08-01", hargaPerolehan: 6000000, nilaiSisa: 600000, umurBulan: 36,
      akunAsetId: peralatan.id, akunBebanPenyusutanId: bebanPenyusutan.id, akunAkumulasiPenyusutanId: akumPenyusutan.id, akunPembayaranId: bank.id,
    })),
  );
  await jalankan("JU-PNY periode 2026-08: Rp 150.000", () => jalankanPenyusutanBulanan(formulir({ periode: "2026-08" })));

  console.log("=== Selesai. Ringkasan & pemeriksaan sinkronisasi ===");
  const daftarStok = await db.stokBarang.findMany({ include: { barang: true } });
  for (const s of daftarStok) console.log(`  stok ${s.barang.kode} ${s.barang.nama}: ${rp(s.jumlah)} ${s.barang.satuan} @ ${rp(s.barang.hargaBeli)}`);
  const saldo = async (kode: string) => {
    const a = await akun(kode);
    const agg = await db.barisJurnal.aggregate({ where: { akunId: a.id }, _sum: { debit: true, kredit: true } });
    return Number(agg._sum.debit ?? 0) - Number(agg._sum.kredit ?? 0);
  };
  console.log(`  Kas ${rp(await saldo("1-1100"))} · Bank ${rp(await saldo("1-1210"))} · Persediaan ${rp(await saldo("1-1600"))} · Piutang ${rp(await saldo("1-1300"))} · Hutang ${rp(-(await saldo("2-1100")))}`);
  const sinkron = await periksaSinkron(db);
  const laporan = [
    ["jurnal seimbang", sinkron.seimbang],
    ["persediaan", sinkron.persediaan.sinkron],
    ["piutang", sinkron.piutang.sinkron],
    ["hutang", sinkron.hutang.sinkron],
    ["barang belum ditagih", sinkron.barangBelumDitagih.sinkron],
    ["barang terkirim belum ditagih", sinkron.barangTerkirim.sinkron],
  ] as const;
  for (const [nama, ok] of laporan) console.log(`  ${ok ? "✔" : "✘"} ${nama}`);
  if (laporan.some(([, ok]) => !ok)) throw new Error("Seed selesai tapi buku besar TIDAK sinkron — periksa aturan posting");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("SEED GAGAL", err);
    process.exit(1);
  });
