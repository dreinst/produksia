import "dotenv/config";
import { db } from "../src/lib/db";
import { periksaSinkron } from "../src/lib/sinkron";

/** Memastikan buku besar sinkron dengan dokumen & stok pada keadaan basis data saat ini. */
async function main() {
  const s = await periksaSinkron(db);
  const rp = (v: { toString(): string }) => Number(v).toLocaleString("id-ID");
  const baris = [
    ["Jurnal seimbang", s.seimbang, `debit ${rp(s.totalDebit)} · kredit ${rp(s.totalKredit)}`],
    ["Persediaan = stok × harga pokok", s.persediaan.sinkron, `buku besar ${rp(s.persediaan.bukuBesar)} · stok ${rp(s.persediaan.dokumen)} · selisih ${rp(s.persediaan.selisih)}`],
    ["Piutang = sisa faktur penjualan", s.piutang.sinkron, `buku besar ${rp(s.piutang.bukuBesar)} · dokumen ${rp(s.piutang.dokumen)}`],
    ["Hutang = sisa faktur pembelian", s.hutang.sinkron, `buku besar ${rp(s.hutang.bukuBesar)} · dokumen ${rp(s.hutang.dokumen)}`],
    ["Barang diterima belum ditagih", s.barangBelumDitagih.sinkron, `buku besar ${rp(s.barangBelumDitagih.bukuBesar)} · TB belum difaktur ${rp(s.barangBelumDitagih.dokumen)}`],
    ["Barang terkirim belum ditagih", s.barangTerkirim.sinkron, `buku besar ${rp(s.barangTerkirim.bukuBesar)} · SJ belum difaktur ${rp(s.barangTerkirim.dokumen)}`],
  ] as const;
  let gagal = 0;
  for (const [nama, ok, detail] of baris) {
    console.log(`${ok ? "[ok]  " : "[FAIL]"} ${nama} — ${detail}`);
    if (!ok) gagal++;
  }
  if (!s.pemetaanAda) console.log("[info] pemetaan akun belum ada — hanya keseimbangan jurnal yang diperiksa");
  if (gagal) {
    console.error(`=== ${gagal} pemeriksaan sinkronisasi GAGAL ===`);
    process.exit(1);
  }
  console.log("=== DONE, buku besar sinkron dengan dokumen & stok ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
