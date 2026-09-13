import "dotenv/config";
import { db } from "../src/lib/db";
import { bacaPeriode, hitungLabaRugi } from "../src/lib/laporan";
import { ringkasanPendapatan } from "../src/lib/laporanPendapatan";
import { pastikan } from "./bantuan";

const n = (v: { toString(): string }) => Number(v);
const dekat = (a: number, b: number) => Math.abs(a - b) < 0.01;

async function main() {
  const tahunIni = new Date().getFullYear();
  const periode = bacaPeriode({ dari: `${tahunIni}-01-01`, sampai: `${tahunIni}-12-31` });
  const rentang = { gte: periode.dari, lte: periode.sampai };

  console.log("=== 1. Total ringkasan = Pendapatan di Laba Rugi; per pelanggan dan per layanan menjumlah ke total ===");
  const r = await ringkasanPendapatan(db, periode);
  const lr = await hitungLabaRugi(db, periode);
  pastikan(dekat(n(r.total), n(lr.totalPendapatan)), `total ringkasan (${n(r.total)}) = total pendapatan laba rugi (${n(lr.totalPendapatan)})`);
  pastikan(dekat(r.perPelanggan.reduce((s, k) => s + n(k.bersih), 0), n(r.total)), "Σ pendapatan bersih per pelanggan = total");
  pastikan(dekat(r.perLayanan.filter((b) => !b.kelompok).reduce((s, b) => s + n(b.jumlah), 0), n(r.total)), "Σ akun rinci per jenis layanan = total");
  pastikan(r.perPelanggan.some((k) => k.id), "data contoh memuat pendapatan dari faktur pelanggan");

  console.log("=== 2. Angka per pelanggan cocok dengan dokumen faktur & retur yang berjurnal ===");
  for (const k of r.perPelanggan.filter((k) => k.id)) {
    const faktur = await db.fakturPenjualan.findMany({ where: { pelangganId: k.id!, jurnal: { tanggal: rentang } }, select: { dpp: true } });
    const retur = await db.returPenjualan.findMany({ where: { faktur: { pelangganId: k.id! }, jurnal: { tanggal: rentang } }, select: { dpp: true } });
    const dppFaktur = faktur.reduce((s, f) => s + n(f.dpp), 0);
    const dppRetur = retur.reduce((s, x) => s + n(x.dpp), 0);
    pastikan(k.jumlahFaktur === faktur.length, `${k.nama}: jumlah faktur ${k.jumlahFaktur} = ${faktur.length}`);
    pastikan(dekat(n(k.faktur), dppFaktur), `${k.nama}: nilai faktur ${n(k.faktur)} = Σ DPP faktur ${dppFaktur}`);
    pastikan(dekat(n(k.retur), dppRetur), `${k.nama}: retur ${n(k.retur)} = Σ DPP retur ${dppRetur}`);
    pastikan(dekat(n(k.bersih), dppFaktur - dppRetur), `${k.nama}: bersih = faktur − retur`);
  }
  const urut = r.perPelanggan.filter((k) => k.id).map((k) => n(k.bersih));
  pastikan(urut.every((v, i) => i === 0 || urut[i - 1] >= v), "pelanggan terurut dari pendapatan terbesar");

  console.log("=== 3. Pendapatan lewat jurnal manual (tanpa faktur) masuk baris 'tanpa pelanggan' dan total ===");
  const kas = await db.akun.findFirst({ where: { kasBank: true, kelompok: false }, orderBy: { kode: "asc" } });
  const pendapatanLain = await db.akun.findFirst({ where: { jenis: "PENDAPATAN", kelompok: false }, orderBy: { kode: "desc" } });
  pastikan(kas && pendapatanLain, "akun kas & pendapatan tersedia untuk uji");
  const lainSebelum = n(r.perPelanggan.find((k) => !k.id)?.bersih ?? 0);
  const jurnalUji = await db.jurnal.create({
    data: {
      nomor: `UJI-PENDAPATAN-${Date.now()}`,
      tanggal: new Date(`${tahunIni}-06-15T10:00:00`),
      keterangan: "Uji ringkasan pendapatan: kas masuk langsung ke pendapatan",
      sumber: "KAS_MASUK",
      baris: { create: [
        { akunId: kas!.id, debit: 500, kredit: 0 },
        { akunId: pendapatanLain!.id, debit: 0, kredit: 500 },
      ] },
    },
  });
  try {
    const r2 = await ringkasanPendapatan(db, periode);
    const lain = r2.perPelanggan.find((k) => !k.id);
    pastikan(lain && lain.id === null && r2.perPelanggan[r2.perPelanggan.length - 1] === lain, "baris tanpa pelanggan ada dan di urutan terakhir");
    pastikan(dekat(n(lain!.bersih), lainSebelum + 500), `tanpa pelanggan bertambah 500 (${n(lain!.bersih)})`);
    pastikan(dekat(n(r2.total), n(r.total) + 500), "total bertambah 500");
    pastikan(r2.perLayanan.some((b) => b.id === pendapatanLain!.id && n(b.jumlah) >= 500), "akun pendapatan yang dipakai tampil di per jenis layanan");
    for (const k of r2.perPelanggan.filter((k) => k.id)) {
      const lama = r.perPelanggan.find((x) => x.id === k.id);
      pastikan(lama && dekat(n(lama.bersih), n(k.bersih)), `${k.nama}: angka pelanggan tidak berubah`);
    }
  } finally {
    await db.barisJurnal.deleteMany({ where: { jurnalId: jurnalUji.id } });
    await db.jurnal.delete({ where: { id: jurnalUji.id } });
  }

  console.log("=== 4. Periode tanpa jurnal: kosong ===");
  const kosong = await ringkasanPendapatan(db, bacaPeriode({ dari: "2000-01-01", sampai: "2000-12-31" }));
  pastikan(kosong.perPelanggan.length === 0 && kosong.perLayanan.length === 0 && n(kosong.total) === 0 && kosong.jumlahFaktur === 0, "periode 2000 kosong");
  console.log("=== DONE, all pendapatan checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
