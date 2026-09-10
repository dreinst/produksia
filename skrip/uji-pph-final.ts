import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { periksaSinkron } from "../src/lib/sinkron";
import { ambilPengaturanPerusahaan } from "../src/lib/pengaturanPerusahaan";
import { ringkasanPajak, batasBulan, periodeBulan } from "../src/lib/pajak";
import { catatPphFinal } from "../src/lib/aksi/pajak";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { jalankan, formulir, pastikan, harusDitolak } from "./bantuan";

/*
 * Ringkasan pajak per masa & PPh Final UMKM: omzet = DPP faktur − retur bulan itu, PPh Final = omzet × tarif,
 * jurnal Dr Beban PPh Final / Cr Hutang PPh Final, penolakan (ganda, periode depan/tak valid, tanpa omzet),
 * hapus membalik jurnal, catat ulang menghasilkan jumlah yang sama.
 */
const n = (v: { toString(): string }) => Number(v);

async function main() {
  const mulaiUji = new Date();
  const sekarang = new Date();
  const tahun = sekarang.getFullYear(), bulan = sekarang.getMonth() + 1;
  const periode = periodeBulan(tahun, bulan);
  const pengaturan = await ambilPengaturanPerusahaan(db);
  pastikan(pengaturan.akunBebanPphFinalId && pengaturan.akunHutangPphFinalId, "pengaturan punya akun beban & hutang PPh Final");
  pastikan(n(pengaturan.pphFinalPersen) === 0.5, "tarif PPh Final bawaan 0,5%");

  console.log(`=== 1. Ringkasan pajak ${periode} = dokumen ===`);
  const { dari, sampai } = batasBulan(tahun, bulan);
  const [fj, rj] = await Promise.all([
    db.fakturPenjualan.aggregate({ where: { tanggal: { gte: dari, lte: sampai } }, _sum: { dpp: true, ppn: true } }),
    db.returPenjualan.aggregate({ where: { tanggal: { gte: dari, lte: sampai } }, _sum: { dpp: true, ppn: true } }),
  ]);
  const omzetHarap = n(fj._sum.dpp ?? 0) - n(rj._sum.dpp ?? 0);
  const r = await ringkasanPajak(db, tahun, pengaturan.pphFinalPersen);
  const b = r.bulan[bulan - 1];
  pastikan(b.periode === periode && Math.abs(n(b.omzet) - omzetHarap) < 0.01, `omzet ${periode} = Σ DPP faktur − retur (${omzetHarap})`);
  pastikan(Math.abs(n(b.pphFinal) - Math.round(omzetHarap * 0.5) / 100) < 0.01, `PPh Final ${periode} = 0,5% × omzet = ${n(b.pphFinal)}`);
  if (!pengaturan.pkp) pastikan(n(b.ppnKeluaran) === 0 && n(b.ppnMasukan) === 0, "non-PKP: PPN keluaran & masukan nol");
  pastikan(Math.abs(n(r.total.omzet) - r.bulan.reduce((s, x) => s + n(x.omzet), 0)) < 0.01, "total tahunan = Σ bulan");
  pastikan(omzetHarap > 0, "bulan berjalan punya omzet (data seed)");

  console.log("=== 2. Seed sudah mencatat PPh Final bulan berjalan; catat ganda & periode tak sah ditolak ===");
  pastikan(b.tercatat && Math.abs(n(b.tercatat.jumlah) - n(b.pphFinal)) < 0.01 && b.tercatat.nomorJurnal?.startsWith("JU-PPHF"), `tercatat ${b.tercatat?.nomorJurnal} sebesar ${n(b.tercatat?.jumlah ?? 0)}`);
  const jurnalSeed = await db.jurnal.findUniqueOrThrow({ where: { nomor: b.tercatat!.nomorJurnal! }, include: { baris: true } });
  pastikan(jurnalSeed.baris.some((x) => x.akunId === pengaturan.akunBebanPphFinalId && n(x.debit) === n(b.pphFinal)) && jurnalSeed.baris.some((x) => x.akunId === pengaturan.akunHutangPphFinalId && n(x.kredit) === n(b.pphFinal)), "JU-PPHF: Dr Beban PPh Final / Cr Hutang PPh Final");
  pastikan(jurnalSeed.tanggal.getMonth() + 1 === bulan && jurnalSeed.tanggal.getFullYear() === tahun, "jurnal bertanggal di bulan periodenya");
  await harusDitolak("catat ganda", () => catatPphFinal(formulir({ periode })), "sudah dicatat");
  await harusDitolak("periode belum berjalan", () => catatPphFinal(formulir({ periode: periodeBulan(tahun + 1, 1) })), "belum berjalan");
  await harusDitolak("periode tak valid", () => catatPphFinal(formulir({ periode: "2026-13" })), "tidak valid");
  await harusDitolak("format salah", () => catatPphFinal(formulir({ periode: "Sep 2026" })), "YYYY-MM");
  const bulanKosong = r.bulan.find((x) => x.omzet.lte(0) && new Date(tahun, x.bulan - 1, 1) <= sekarang);
  if (bulanKosong) await harusDitolak(`bulan tanpa omzet (${bulanKosong.periode})`, () => catatPphFinal(formulir({ periode: bulanKosong.periode })), "Tidak ada omzet");

  console.log("=== 3. Hapus → jurnal hilang; catat ulang → jumlah sama ===");
  const jumlahJurnalSebelum = await db.jurnal.count();
  await jalankan("hapus PPh Final bulan berjalan", () => hapusDokumen("pphFinal", b.tercatat!.id));
  pastikan((await db.pphFinalBulanan.count({ where: { periode } })) === 0 && (await db.jurnal.count()) === jumlahJurnalSebelum - 1, "catatan & jurnal PPh Final hilang");
  const r2 = await ringkasanPajak(db, tahun, pengaturan.pphFinalPersen);
  pastikan(!r2.bulan[bulan - 1].tercatat && n(r2.totalPphFinalTercatat) === 0, "ringkasan menandai belum tercatat");
  await jalankan("catat ulang", () => catatPphFinal(formulir({ periode })));
  const r3 = await ringkasanPajak(db, tahun, pengaturan.pphFinalPersen);
  pastikan(r3.bulan[bulan - 1].tercatat && Math.abs(n(r3.bulan[bulan - 1].tercatat!.jumlah) - n(b.pphFinal)) < 0.01, "catat ulang menghasilkan jumlah yang sama");
  pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, jenis: "PPh Final Bulanan" } })) === 2, "hapus & catat tercatat di log aktivitas");

  console.log("=== Bersih-bersih ===");
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  const s = await periksaSinkron(db);
  pastikan(s.seimbang && s.piutang.sinkron && s.persediaan.sinkron, "sinkron setelah uji");
  console.log("=== DONE, all pph final checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
