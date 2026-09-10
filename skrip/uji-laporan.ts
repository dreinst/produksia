import "dotenv/config";
import { db } from "../src/lib/db";
import { bacaPeriode, hitungLabaRugi, hitungNeraca } from "../src/lib/laporan";

function pastikan(kondisi: unknown, pesan: string) {
  if (!kondisi) {
    console.error(`[FAIL] ${pesan}`);
    process.exit(1);
  }
  console.log(`[ok] ${pesan}`);
}
const n = (v: { toString(): string }) => Number(v);

async function main() {
  const tahunIni = new Date().getFullYear();
  const periode = bacaPeriode({ dari: `${tahunIni}-01-01`, sampai: `${tahunIni}-12-31` });

  console.log("=== 1. Neraca seimbang & konsisten dengan laba rugi ===");
  const lr = await hitungLabaRugi(db, periode);
  const neraca = await hitungNeraca(db, periode.sampai, periode.sampaiTeks);
  pastikan(neraca.seimbang, `neraca seimbang: aset ${n(neraca.totalAset)} = pasiva ${n(neraca.totalPasiva)}`);
  pastikan(Math.abs(n(neraca.labaBerjalan) - n(lr.labaBersih)) < 0.01, `laba tahun berjalan di neraca (${n(neraca.labaBerjalan)}) = laba bersih laba rugi (${n(lr.labaBersih)})`);
  pastikan(Math.abs(n(lr.labaKotor) - (n(lr.totalPendapatan) - n(lr.totalBebanPokok))) < 0.01, "laba kotor = pendapatan − beban pokok");
  pastikan(Math.abs(n(lr.labaBersih) - (n(lr.labaKotor) - n(lr.totalBebanLain))) < 0.01, "laba bersih = laba kotor − beban lain");
  const subtotalPendapatan = lr.pendapatan.filter((b) => b.kelompok && b.kedalaman === 0).reduce((s, b) => s + n(b.jumlah), 0) + lr.pendapatan.filter((b) => !b.kelompok && b.kedalaman === 0).reduce((s, b) => s + n(b.jumlah), 0);
  pastikan(Math.abs(subtotalPendapatan - n(lr.totalPendapatan)) < 0.01, `subtotal kelompok tingkat atas = total pendapatan (${subtotalPendapatan})`);

  console.log("=== 2. Jurnal tahun lalu masuk ke laba ditahan, tidak ke laba tahun berjalan ===");
  const kas = await db.akun.findFirst({ where: { kasBank: true, kelompok: false }, orderBy: { kode: "asc" } });
  const pendapatanLain = await db.akun.findFirst({ where: { jenis: "PENDAPATAN", kelompok: false }, orderBy: { kode: "desc" } });
  pastikan(kas && pendapatanLain, "akun kas & pendapatan tersedia untuk uji");
  const jurnalLama = await db.jurnal.create({
    data: {
      nomor: `UJI-LAPORAN-${Date.now()}`,
      tanggal: new Date(`${tahunIni - 1}-06-15T10:00:00`),
      keterangan: "Uji laporan: pendapatan tahun lalu",
      sumber: "MANUAL",
      baris: { create: [
        { akunId: kas!.id, debit: 1000, kredit: 0 },
        { akunId: pendapatanLain!.id, debit: 0, kredit: 1000 },
      ] },
    },
  });
  try {
    const lr2 = await hitungLabaRugi(db, periode);
    const neraca2 = await hitungNeraca(db, periode.sampai, periode.sampaiTeks);
    pastikan(Math.abs(n(lr2.labaBersih) - n(lr.labaBersih)) < 0.01, "laba bersih tahun ini tidak berubah");
    pastikan(Math.abs(n(neraca2.labaDitahan) - n(neraca.labaDitahan) - 1000) < 0.01, "laba ditahan bertambah 1.000");
    pastikan(Math.abs(n(neraca2.totalAset) - n(neraca.totalAset) - 1000) < 0.01 && neraca2.seimbang, "aset bertambah 1.000 dan neraca tetap seimbang");
    const lrTahunLalu = await hitungLabaRugi(db, bacaPeriode({ dari: `${tahunIni - 1}-01-01`, sampai: `${tahunIni - 1}-12-31` }));
    pastikan(n(lrTahunLalu.totalPendapatan) >= 1000, "laba rugi tahun lalu memuat pendapatan 1.000");
  } finally {
    await db.barisJurnal.deleteMany({ where: { jurnalId: jurnalLama.id } });
    await db.jurnal.delete({ where: { id: jurnalLama.id } });
  }
  console.log("=== DONE, all laporan checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
