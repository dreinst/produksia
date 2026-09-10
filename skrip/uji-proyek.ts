import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { periksaSinkron } from "../src/lib/sinkron";
import { bacaPeriode, hitungLabaRugi, hitungLabaRugiBulanan } from "../src/lib/laporan";
import { ringkasanProyek, daftarRingkasanProyek } from "../src/lib/proyek";
import { buatPenawaran, konversiPenawaranKePesanan, buatFaktur, buatPenerimaan, buatUangMuka } from "../src/lib/aksi/penjualan";
import { buatPesananPembelian, buatPenerimaanBarang, buatFakturPembelian, buatPembayaranPembelian } from "../src/lib/aksi/pembelian";
import { buatKasKeluar } from "../src/lib/aksi/jurnal";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";

/*
 * Proyek/event sebagai dimensi: penawaran → pesanan mewarisi proyek, semua jurnal turunan (UM, FJ, TRM, TB, FB, BYR, KK)
 * bertanda proyek, Laba Rugi per event & per bulan konsisten, dan LPJ (ringkasanProyek) menjumlahkan dengan benar.
 */
async function jalankan(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    const digest = (err as { digest?: string })?.digest ?? "";
    const pesan = (err as { message?: string })?.message ?? "";
    if (!digest.startsWith("NEXT_REDIRECT") && !pesan.includes("static generation store missing")) throw err;
  }
  console.log(`[ok] ${label}`);
}
function formulir(isian: Record<string, string | number | object>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isian)) fd.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  return fd;
}
function pastikan(kondisi: unknown, pesan: string) {
  if (!kondisi) {
    console.error(`[FAIL] ${pesan}`);
    process.exit(1);
  }
  console.log(`[ok] ${pesan}`);
}
async function harusDitolak(label: string, fn: () => Promise<unknown>, potongan: string) {
  try {
    await fn();
  } catch (err) {
    const pesan = (err as { message?: string })?.message ?? String(err);
    pastikan(pesan.includes(potongan), `${label} ditolak: "${pesan}"`);
    return;
  }
  console.error(`[FAIL] ${label} TIDAK ditolak`);
  process.exit(1);
}
const n = (v: { toString(): string }) => Number(v);

async function main() {
  const mulaiUji = new Date();
  const tahun = new Date().getFullYear();
  console.log("=== Data uji ===");
  const gudang = await db.gudang.create({ data: { kode: "WH-PRJ", nama: "Gudang Uji Proyek" } });
  const pelanggan = await db.pelanggan.create({ data: { kode: "CUST-PRJ", nama: "Klien Uji Proyek" } });
  const pemasok = await db.pemasok.create({ data: { kode: "SUP-PRJ", nama: "Vendor Uji Proyek" } });
  const jasa = await db.barang.create({ data: { kode: "JSA-PRJ", nama: "Jasa Uji Proyek", jenis: "JASA", hargaBeli: 0, hargaJual: 1000000 } });
  const barang = await db.barang.create({ data: { kode: "BRG-PRJ", nama: "Barang Uji Proyek", hargaBeli: 0, hargaJual: 50000 } });
  const kas = await db.akun.create({ data: { kode: "PRJ-KAS", nama: "Kas Uji Proyek", jenis: "ASET", kasBank: true } });
  const modal = await db.akun.create({ data: { kode: "PRJ-MODAL", nama: "Modal Uji Proyek", jenis: "MODAL" } });
  const beban = await db.akun.create({ data: { kode: "PRJ-BEBAN", nama: "Beban Uji Proyek", jenis: "BEBAN" } });
  const proyek = await db.proyek.create({ data: { kode: "PRJ-UJI", nama: "Event Uji", pelangganId: pelanggan.id, nilaiKontrak: 1000000, anggaranBiaya: 400000 } });
  await jalankan("PS saldo awal 10 @ 20.000", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, baris: [{ barangId: barang.id, jumlahSesudah: 10, hargaSatuan: 20000 }] })));
  await harusDitolak("proyek tidak ada", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, proyekId: "tidak-ada", baris: [{ barangId: jasa.id, jumlah: 1, harga: 1000000 }] })), "tidak ditemukan");

  console.log("=== 1. Penawaran → pesanan mewarisi proyek; DP, faktur, penerimaan bertanda proyek ===");
  await jalankan("PNW jasa 1.000.000 (proyek)", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, proyekId: proyek.id, baris: [{ barangId: jasa.id, jumlah: 1, harga: 1000000 }] })));
  const pnw = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id } });
  pastikan(pnw.proyekId === proyek.id, "penawaran menyimpan proyekId");
  await jalankan("konversi → PSJ", () => konversiPenawaranKePesanan(pnw.id));
  const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnw.id } });
  pastikan(psj.proyekId === proyek.id, "pesanan mewarisi proyek dari penawaran");
  await jalankan("UM 300.000", () => buatUangMuka(formulir({ pesananId: psj.id, akunId: kas.id, jumlah: 300000 })));
  await jalankan("FJ 1.000.000 pakai DP 300.000", () => buatFaktur(formulir({ pesananId: psj.id, uangMuka: 300000, baris: [{ barangId: jasa.id, jumlah: 1, harga: 1000000 }] })));
  const fj = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id } });
  await jalankan("TRM 700.000", () => buatPenerimaan(formulir({ fakturId: fj.id, akunId: kas.id, jumlah: 700000 })));
  const jurnalPenjualan = await db.jurnal.findMany({ where: { tanggal: { gte: mulaiUji }, sumber: "PENJUALAN" } });
  pastikan(jurnalPenjualan.length === 3 && jurnalPenjualan.every((j) => j.proyekId === proyek.id), "JU-UM, JU-FJ, JU-TRM semuanya bertanda proyek");

  console.log("=== 2. Pembelian & kas keluar bertanda proyek ===");
  await jalankan("PSB 5 barang @ 20.000 (proyek)", () => buatPesananPembelian(formulir({ pemasokId: pemasok.id, proyekId: proyek.id, baris: [{ barangId: barang.id, jumlah: 5, harga: 20000 }] })));
  const psb = await db.pesananPembelian.findFirstOrThrow({ where: { pemasokId: pemasok.id }, include: { baris: true } });
  await jalankan("TB 5", () => buatPenerimaanBarang(formulir({ pesananId: psb.id, gudangId: gudang.id, baris: [{ barisPesananId: psb.baris[0].id, barangId: barang.id, jumlah: 5 }] })));
  await jalankan("FB 100.000", () => buatFakturPembelian(formulir({ pesananId: psb.id, baris: [{ barangId: barang.id, jumlah: 5, harga: 20000 }] })));
  const fb = await db.fakturPembelian.findFirstOrThrow({ where: { pesananId: psb.id } });
  await jalankan("BYR 100.000", () => buatPembayaranPembelian(formulir({ fakturId: fb.id, akunId: kas.id, jumlah: 100000 })));
  await jalankan("KK beban event 150.000 (proyek)", () => buatKasKeluar(formulir({ akunKasId: kas.id, akunLawanId: beban.id, jumlah: 150000, keterangan: "uji proyek honor", proyekId: proyek.id })));
  await jalankan("KK beban umum 50.000 (tanpa proyek)", () => buatKasKeluar(formulir({ akunKasId: kas.id, akunLawanId: beban.id, jumlah: 50000, keterangan: "uji proyek umum" })));
  const jurnalPembelian = await db.jurnal.findMany({ where: { tanggal: { gte: mulaiUji }, sumber: "PEMBELIAN" } });
  pastikan(jurnalPembelian.length === 3 && jurnalPembelian.every((j) => j.proyekId === proyek.id), "JU-TB, JU-FB, JU-BYR bertanda proyek");
  const kk = await db.jurnal.findMany({ where: { tanggal: { gte: mulaiUji }, sumber: "KAS_KELUAR" }, orderBy: { nomor: "asc" } });
  pastikan(kk.length === 2 && kk.filter((j) => j.proyekId === proyek.id).length === 1, "hanya kas keluar yang diberi proyek yang bertanda");

  console.log("=== 3. Laba Rugi per event & per bulan, LPJ ===");
  const periode = bacaPeriode({ dari: `${tahun}-01-01`, sampai: `${tahun}-12-31` });
  const lrEvent = await hitungLabaRugi(db, periode, { proyekId: proyek.id });
  pastikan(n(lrEvent.totalPendapatan) === 1000000 && n(lrEvent.totalBebanLain) === 150000 && n(lrEvent.labaBersih) === 850000, `Laba Rugi event: pendapatan 1.000.000, beban 150.000 (beban umum tidak ikut), laba 850.000 (${n(lrEvent.labaBersih)})`);
  const lrSemua = await hitungLabaRugi(db, periode);
  pastikan(n(lrSemua.labaBersih) <= n(lrEvent.labaBersih) - 50000 + 0.01 || n(lrSemua.totalBebanLain) >= 200000, "Laba Rugi seluruh perusahaan memuat beban umum 50.000 juga");
  const bulanan = await hitungLabaRugiBulanan(db, tahun, { proyekId: proyek.id });
  pastikan(n(bulanan.total.labaBersih) === 850000 && n(bulanan.bulan[new Date().getMonth()].pendapatan) === 1000000, "Laba Rugi bulanan event: total = 850.000, bulan ini memuat pendapatan 1.000.000");
  const r = (await ringkasanProyek(db, proyek.id))!;
  pastikan(n(r.pemasukan.totalPesanan) === 1000000 && n(r.pemasukan.totalUangMuka) === 300000 && n(r.pemasukan.totalFaktur) === 1000000 && n(r.pemasukan.totalDiterima) === 700000 && n(r.pemasukan.sisaPiutang) === 0, "LPJ pemasukan: pesanan 1.000.000, DP 300.000, faktur 1.000.000, diterima 700.000, sisa 0");
  pastikan(n(r.pengeluaran.totalPesananPembelian) === 100000 && n(r.pengeluaran.totalDibayar) === 100000 && n(r.pengeluaran.sisaHutang) === 0 && n(r.pengeluaran.totalBebanLain) === 150000, "LPJ pengeluaran: PSB 100.000 dibayar lunas, beban langsung 150.000");
  pastikan(n(r.kas.masuk) === 1000000 && n(r.kas.keluar) === 250000 && n(r.kas.bersih) === 750000, "LPJ kas: masuk 1.000.000, keluar 250.000, bersih 750.000");
  pastikan(n(r.labaRugi.laba) === 850000 && n(r.labaRugi.totalBeban) === 150000, "LPJ laba event 850.000 (persediaan yang dibeli belum jadi beban)");
  const daftar = await daftarRingkasanProyek(db);
  const baris = daftar.find((d) => d.id === proyek.id)!;
  pastikan(n(baris.laba) === 850000 && n(baris.nilaiKontrak!) === 1000000 && n(baris.anggaranBiaya!) === 400000, "daftar LPJ konsisten dengan ringkasan");
  const s = await periksaSinkron(db);
  pastikan(s.seimbang && s.persediaan.sinkron && s.piutang.sinkron && s.hutang.sinkron && s.uangMuka.sinkron, "sinkron");

  console.log("=== Bersih-bersih (hapus dokumen urut mundur) ===");
  for (const j of kk) await jalankan(`hapus ${j.nomor}`, () => hapusDokumen("jurnal", j.id));
  const byr = await db.pembayaranPembelian.findFirstOrThrow({ where: { fakturId: fb.id } });
  await jalankan("hapus BYR", () => hapusDokumen("pembayaran", byr.id));
  await jalankan("hapus FB", () => hapusDokumen("fakturPembelian", fb.id));
  const tb = await db.penerimaanBarang.findFirstOrThrow({ where: { pesananId: psb.id } });
  await jalankan("hapus TB", () => hapusDokumen("penerimaanBarang", tb.id));
  await jalankan("hapus PSB", () => hapusDokumen("pesananPembelian", psb.id));
  const trm = await db.penerimaanPenjualan.findFirstOrThrow({ where: { fakturId: fj.id } });
  await jalankan("hapus TRM", () => hapusDokumen("penerimaan", trm.id));
  await jalankan("hapus FJ", () => hapusDokumen("faktur", fj.id));
  const um = await db.uangMukaPelanggan.findFirstOrThrow({ where: { pesananId: psj.id } });
  await jalankan("hapus UM", () => hapusDokumen("uangMuka", um.id));
  await jalankan("hapus PSJ", () => hapusDokumen("pesanan", psj.id));
  await jalankan("hapus PNW", () => hapusDokumen("penawaran", pnw.id));
  const ps = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudang.id } });
  await jalankan("hapus PS", () => hapusDokumen("penyesuaian", ps.id));
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  await db.proyek.delete({ where: { id: proyek.id } });
  await db.stokBarang.deleteMany({ where: { barangId: barang.id } });
  await db.barang.deleteMany({ where: { id: { in: [barang.id, jasa.id] } } });
  await db.pelanggan.delete({ where: { id: pelanggan.id } });
  await db.pemasok.delete({ where: { id: pemasok.id } });
  await db.gudang.delete({ where: { id: gudang.id } });
  await db.akun.deleteMany({ where: { kode: { startsWith: "PRJ-" } } });
  const s2 = await periksaSinkron(db);
  pastikan(s2.seimbang && s2.persediaan.sinkron, "sinkron setelah bersih-bersih");
  console.log("=== DONE, all proyek checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
