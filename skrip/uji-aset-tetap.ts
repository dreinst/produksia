import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { buatAsetTetap, jalankanPenyusutanBulanan } from "../src/lib/aksi/asetTetap";

async function jalankanAbaikanRedirect(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`[ok, nomor redirect thrown] ${label}`);
  } catch (err: unknown) {
    const digest = (err as { digest?: string })?.digest;
    const message = (err as { message?: string })?.message ?? "";
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      console.log(`[ok] ${label} -> redirected as expected`);
    } else if (message.includes("static generation store missing")) {
      console.log(`[ok, ignored outside-Next-context artifact] ${label}`);
    } else {
      console.error(`[FAIL] ${label}`, err);
      throw err;
    }
  }
}

async function harapGagal(label: string, fn: () => Promise<void>, expectedSubstring: string) {
  try {
    await fn();
    throw new Error(`${label} should have thrown`);
  } catch (err: unknown) {
    const message = (err as { message?: string })?.message ?? "";
    if (message.includes(expectedSubstring)) {
      console.log(`[ok] ${label} -> rejected as expected: ${message}`);
    } else {
      throw err;
    }
  }
}

async function main() {
  const mulaiUji = new Date();
  console.log("=== Seed akun & aset test ===");
  const assetAcc = await db.akun.create({ data: { kode: "ATEST-ASET", nama: "Peralatan Test", jenis: "ASET" } });
  const expenseAcc = await db.akun.create({ data: { kode: "ATEST-BEBAN", nama: "Beban Penyusutan Test", jenis: "BEBAN" } });
  const accumAcc = await db.akun.create({ data: { kode: "ATEST-AKUM", nama: "Akumulasi Penyusutan Test", jenis: "ASET" } });

  console.log("=== 1. Create Fixed Asset (cost 12.000.000, life 12 bulan, salvage 0) ===");
  const fd = new FormData();
  fd.set("kode", "AT-TEST-01");
  fd.set("nama", "Mesin Giling Test");
  fd.set("tanggalPerolehan", "2026-01-01");
  fd.set("hargaPerolehan", "12000000");
  fd.set("nilaiSisa", "0");
  fd.set("umurBulan", "12");
  fd.set("akunAsetId", assetAcc.id);
  fd.set("akunBebanPenyusutanId", expenseAcc.id);
  fd.set("akunAkumulasiPenyusutanId", accumAcc.id);
  await jalankanAbaikanRedirect("buatAsetTetap", () => buatAsetTetap(fd));

  const aset = await db.asetTetap.findUniqueOrThrow({ where: { kode: "AT-TEST-01" } });
  console.log("Asset created, expected monthly depreciation: 1.000.000");

  console.log("=== 2. Run depreciation for 2026-02 ===");
  const dep1 = new FormData();
  dep1.set("periode", "2026-02");
  await jalankanAbaikanRedirect("jalankanPenyusutanBulanan (2026-02)", () => jalankanPenyusutanBulanan(dep1));

  const rec1 = await db.penyusutanAset.findFirstOrThrow({ where: { asetId: aset.id } });
  console.log("Depreciation jumlah (expect 1000000):", rec1.jumlah.toString());
  if (Number(rec1.jumlah) !== 1000000) throw new Error(`Salah, dapat ${rec1.jumlah}`);

  console.log("=== 3. Run depreciation again for SAME periode should reject (nomor daftarAset to process) ===");
  const dep1b = new FormData();
  dep1b.set("periode", "2026-02");
  await harapGagal("jalankanPenyusutanBulanan (duplicate periode)", () => jalankanPenyusutanBulanan(dep1b), "sudah punya jurnal");

  console.log("=== 4. Run depreciation for 2026-03 (should succeed, second month) ===");
  const dep2 = new FormData();
  dep2.set("periode", "2026-03");
  await jalankanAbaikanRedirect("jalankanPenyusutanBulanan (2026-03)", () => jalankanPenyusutanBulanan(dep2));

  const allDeps = await db.penyusutanAset.findMany({ where: { asetId: aset.id } });
  const totalDepreciated = allDeps.reduce((s, d) => s + Number(d.jumlah), 0);
  console.log("Total depreciated after 2 months (expect 2000000):", totalDepreciated);
  if (totalDepreciated !== 2000000) throw new Error(`Salah, dapat ${totalDepreciated}`);

  console.log("=== 5. Verify jurnal balance for depreciation daftarJurnal ===");
  const journalIds = allDeps.map((d) => d.jurnalId).filter((id): id is string => !!id);
  const daftarBaris = await db.barisJurnal.findMany({ where: { jurnalId: { in: journalIds } } });
  const totalDebit = daftarBaris.reduce((s, l) => s + Number(l.debit), 0);
  const totalKredit = daftarBaris.reduce((s, l) => s + Number(l.kredit), 0);
  console.log(`Journal debit: ${totalDebit}, kredit: ${totalKredit}`);
  if (totalDebit !== totalKredit) throw new Error("Jurnal penyusutan tidak balance!");

  console.log("=== 6. Book value check (12.000.000 - 2.000.000 = 10.000.000) ===");
  const bookValue = Number(aset.hargaPerolehan) - totalDepreciated;
  console.log("Book nilai:", bookValue);
  if (bookValue !== 10000000) throw new Error(`Salah, dapat ${bookValue}`);

  console.log("=== Cleanup ===");
  await db.penyusutanAset.deleteMany({ where: { asetId: aset.id } });
  await db.asetTetap.deleteMany({ where: { id: aset.id } });
  const cleanupJournalIds = (
    await db.jurnal.findMany({ where: { tanggal: { gte: mulaiUji } }, select: { id: true } })
  ).map((j) => j.id);
  // penyusutan periode uji juga mengenai aset lain (seed) — buang catatannya agar akumulasi aset seed tetap = buku besar
  await db.penyusutanAset.deleteMany({ where: { jurnalId: { in: cleanupJournalIds } } });
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: cleanupJournalIds } } });
  await db.jurnal.deleteMany({ where: { id: { in: cleanupJournalIds } } });
  await db.akun.deleteMany({ where: { id: { in: [assetAcc.id, expenseAcc.id, accumAcc.id] } } });

  console.log("=== DONE, all fixed aset checks passed ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("TEST SUITE FAILED", err);
  process.exit(1);
});
