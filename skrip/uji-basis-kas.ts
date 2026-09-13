import "dotenv/config";
import { db } from "../src/lib/db";
import { bacaPeriode } from "../src/lib/laporan";
import { hitungArusKas } from "../src/lib/arusKas";
import { labaRugiKas, labaRugiKasBulanan } from "../src/lib/basisKas";
import { pastikan } from "./bantuan";

/*
 * Laba Rugi & Ringkasan Pendapatan basis kas: surplus kas operasi = arus kas operasi (metode langsung);
 * kas dari pelanggan (DP + pelunasan + kas masuk langsung) = pendapatan dialokasikan + PPN titipan;
 * kas masuk langsung ke pendapatan & kas keluar ke beban terbaca; prive/aset tetap tidak ikut; periode kosong nol.
 */
const n = (v: { toString(): string }) => Number(v);
const dekat = (a: number, b: number) => Math.abs(a - b) < 0.01;

async function main() {
  const tahun = new Date().getFullYear();
  const periode = bacaPeriode({ dari: `${tahun}-01-01`, sampai: `${tahun}-12-31` });

  console.log("=== 1. Surplus kas operasi = arus kas operasi; semua bagian menjumlah ===");
  const k = await labaRugiKas(db, periode);
  const a = await hitungArusKas(db, periode);
  pastikan(dekat(n(k.surplus), n(a.totalOperasi)), `surplus kas operasi (${n(k.surplus)}) = arus kas operasi (${n(a.totalOperasi)})`);
  pastikan(dekat(n(k.totalPendapatan) + n(k.ppnTitipan) + n(k.totalPenerimaanLain) - n(k.totalPengeluaran), n(k.surplus)), "pendapatan + PPN titipan + penerimaan lain − pengeluaran = surplus");
  pastikan(dekat(n(k.totalDariPelanggan), n(k.totalPendapatan) + n(k.ppnTitipan)), `kas dari pelanggan (${n(k.totalDariPelanggan)}) = pendapatan dialokasikan + PPN titipan (${n(k.totalPendapatan) + n(k.ppnTitipan)})`);
  pastikan(dekat(k.perPelanggan.reduce((s, p) => s + n(p.total), 0), n(k.totalDariPelanggan)), "Σ per pelanggan = kas dari pelanggan");
  pastikan(dekat(k.pendapatan.filter((b) => !b.kelompok).reduce((s, b) => s + n(b.jumlah), 0), n(k.totalPendapatan)), "Σ akun rinci pendapatan = total pendapatan diterima");
  pastikan(k.perPelanggan.some((p) => p.id && (n(p.uangMuka) > 0 || n(p.pelunasan) > 0)), "data contoh memuat DP atau pelunasan dari pelanggan");
  const bulanan = await labaRugiKasBulanan(db, tahun);
  pastikan(dekat(n(bulanan.total.surplus), n(k.surplus)) && dekat(n(bulanan.total.diterima) - n(bulanan.total.dikeluarkan), n(bulanan.total.surplus)), "tabel bulanan menjumlah ke surplus periode");

  console.log("=== 2. Kas masuk langsung ke pendapatan & kas keluar ke beban terbaca; prive tidak ikut ===");
  const [kas, pendapatan, beban, modal] = await Promise.all([
    db.akun.findFirst({ where: { kasBank: true, kelompok: false }, orderBy: { kode: "asc" } }),
    db.akun.findFirst({ where: { jenis: "PENDAPATAN", kelompok: false, kode: { startsWith: "4-1" } }, orderBy: { kode: "asc" } }),
    db.akun.findFirst({ where: { jenis: "BEBAN", kelompok: false, kode: { startsWith: "5-2" } }, orderBy: { kode: "asc" } }),
    db.akun.findFirst({ where: { jenis: "MODAL", kelompok: false }, orderBy: { kode: "asc" } }),
  ]);
  pastikan(kas && pendapatan && beban && modal, "akun kas, pendapatan, beban, modal tersedia");
  const tanggal = new Date(`${tahun}-06-15T10:00:00`);
  const dibuat = await Promise.all([
    db.jurnal.create({ data: { nomor: `UJI-KAS-KM-${Date.now()}`, tanggal, keterangan: "uji kas masuk langsung", sumber: "KAS_MASUK", baris: { create: [{ akunId: kas!.id, debit: 500, kredit: 0 }, { akunId: pendapatan!.id, debit: 0, kredit: 500 }] } } }),
    db.jurnal.create({ data: { nomor: `UJI-KAS-KK-${Date.now()}`, tanggal, keterangan: "uji kas keluar beban", sumber: "KAS_KELUAR", baris: { create: [{ akunId: beban!.id, debit: 300, kredit: 0 }, { akunId: kas!.id, debit: 0, kredit: 300 }] } } }),
    db.jurnal.create({ data: { nomor: `UJI-KAS-PRV-${Date.now()}`, tanggal, keterangan: "uji prive", sumber: "MANUAL", baris: { create: [{ akunId: modal!.id, debit: 1000, kredit: 0 }, { akunId: kas!.id, debit: 0, kredit: 1000 }] } } }),
  ]);
  try {
    const k2 = await labaRugiKas(db, periode);
    pastikan(dekat(n(k2.totalPendapatan) - n(k.totalPendapatan), 500), `pendapatan diterima bertambah 500 (${n(k2.totalPendapatan) - n(k.totalPendapatan)})`);
    const tanpa = k2.perPelanggan.find((p) => !p.id);
    pastikan(tanpa && dekat(n(tanpa.lainnya) - n(k.perPelanggan.find((p) => !p.id)?.lainnya ?? 0), 500), "baris tanpa pelanggan bertambah 500");
    const barisBeban = k2.pengeluaran.find((b) => b.id === beban!.id);
    pastikan(barisBeban && dekat(n(barisBeban.jumlah) - n(k.pengeluaran.find((b) => b.id === beban!.id)?.jumlah ?? 0), 300), `pengeluaran ${beban!.nama} bertambah 300`);
    pastikan(dekat(n(k2.surplus) - n(k.surplus), 200), `surplus bertambah 500 − 300 = 200 (prive 1.000 tidak ikut) (${n(k2.surplus) - n(k.surplus)})`);
    const a2 = await hitungArusKas(db, periode);
    pastikan(dekat(n(k2.surplus), n(a2.totalOperasi)), "surplus tetap = arus kas operasi");
    const b2 = await labaRugiKasBulanan(db, tahun);
    pastikan(dekat(n(b2.bulan[5].surplus) - n(bulanan.bulan[5].surplus), 200), "bulan Juni bertambah 200");
  } finally {
    for (const j of dibuat) {
      await db.barisJurnal.deleteMany({ where: { jurnalId: j.id } });
      await db.jurnal.delete({ where: { id: j.id } });
    }
  }

  console.log("=== 3. Periode tanpa jurnal: nol ===");
  const kosong = await labaRugiKas(db, bacaPeriode({ dari: "2000-01-01", sampai: "2000-12-31" }));
  pastikan(n(kosong.surplus) === 0 && kosong.perPelanggan.length === 0 && kosong.pendapatan.length === 0 && kosong.pengeluaran.length === 0, "periode 2000 kosong");
  console.log("=== DONE, all basis kas checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
