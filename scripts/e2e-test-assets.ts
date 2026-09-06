import "dotenv/config";
import { db } from "../src/lib/db";
import { createFixedAsset, runMonthlyDepreciation } from "../src/lib/actions/fixedAssets";

async function runIgnoringRedirect(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`[ok, no redirect thrown] ${label}`);
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

async function expectThrow(label: string, fn: () => Promise<void>, expectedSubstring: string) {
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
  const testStart = new Date();
  console.log("=== Seed akun & aset test ===");
  const assetAcc = await db.account.create({ data: { code: "ATEST-ASET", name: "Peralatan Test", type: "ASET" } });
  const expenseAcc = await db.account.create({ data: { code: "ATEST-BEBAN", name: "Beban Penyusutan Test", type: "BEBAN" } });
  const accumAcc = await db.account.create({ data: { code: "ATEST-AKUM", name: "Akumulasi Penyusutan Test", type: "ASET" } });

  console.log("=== 1. Create Fixed Asset (cost 12.000.000, life 12 bulan, salvage 0) ===");
  const fd = new FormData();
  fd.set("code", "AT-TEST-01");
  fd.set("name", "Mesin Giling Test");
  fd.set("acquisitionDate", "2026-01-01");
  fd.set("acquisitionCost", "12000000");
  fd.set("salvageValue", "0");
  fd.set("usefulLifeMonths", "12");
  fd.set("assetAccountId", assetAcc.id);
  fd.set("depreciationExpenseAccountId", expenseAcc.id);
  fd.set("accumulatedDepreciationAccountId", accumAcc.id);
  await runIgnoringRedirect("createFixedAsset", () => createFixedAsset(fd));

  const asset = await db.fixedAsset.findUniqueOrThrow({ where: { code: "AT-TEST-01" } });
  console.log("Asset created, expected monthly depreciation: 1.000.000");

  console.log("=== 2. Run depreciation for 2026-02 ===");
  const dep1 = new FormData();
  dep1.set("period", "2026-02");
  await runIgnoringRedirect("runMonthlyDepreciation (2026-02)", () => runMonthlyDepreciation(dep1));

  const rec1 = await db.fixedAssetDepreciation.findFirstOrThrow({ where: { assetId: asset.id } });
  console.log("Depreciation amount (expect 1000000):", rec1.amount.toString());
  if (Number(rec1.amount) !== 1000000) throw new Error(`Salah, dapat ${rec1.amount}`);

  console.log("=== 3. Run depreciation again for SAME period should reject (no assets to process) ===");
  const dep1b = new FormData();
  dep1b.set("period", "2026-02");
  await expectThrow("runMonthlyDepreciation (duplicate period)", () => runMonthlyDepreciation(dep1b), "sudah punya jurnal");

  console.log("=== 4. Run depreciation for 2026-03 (should succeed, second month) ===");
  const dep2 = new FormData();
  dep2.set("period", "2026-03");
  await runIgnoringRedirect("runMonthlyDepreciation (2026-03)", () => runMonthlyDepreciation(dep2));

  const allDeps = await db.fixedAssetDepreciation.findMany({ where: { assetId: asset.id } });
  const totalDepreciated = allDeps.reduce((s, d) => s + Number(d.amount), 0);
  console.log("Total depreciated after 2 months (expect 2000000):", totalDepreciated);
  if (totalDepreciated !== 2000000) throw new Error(`Salah, dapat ${totalDepreciated}`);

  console.log("=== 5. Verify journal balance for depreciation entries ===");
  const journalIds = allDeps.map((d) => d.journalEntryId).filter((id): id is string => !!id);
  const lines = await db.journalLine.findMany({ where: { journalEntryId: { in: journalIds } } });
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0);
  console.log(`Journal debit: ${totalDebit}, credit: ${totalCredit}`);
  if (totalDebit !== totalCredit) throw new Error("Jurnal penyusutan tidak balance!");

  console.log("=== 6. Book value check (12.000.000 - 2.000.000 = 10.000.000) ===");
  const bookValue = Number(asset.acquisitionCost) - totalDepreciated;
  console.log("Book value:", bookValue);
  if (bookValue !== 10000000) throw new Error(`Salah, dapat ${bookValue}`);

  console.log("=== Cleanup ===");
  await db.fixedAssetDepreciation.deleteMany({ where: { assetId: asset.id } });
  await db.fixedAsset.deleteMany({ where: { id: asset.id } });
  const cleanupJournalIds = (
    await db.journalEntry.findMany({ where: { date: { gte: testStart } }, select: { id: true } })
  ).map((j) => j.id);
  await db.journalLine.deleteMany({ where: { journalEntryId: { in: cleanupJournalIds } } });
  await db.journalEntry.deleteMany({ where: { id: { in: cleanupJournalIds } } });
  await db.account.deleteMany({ where: { id: { in: [assetAcc.id, expenseAcc.id, accumAcc.id] } } });

  console.log("=== DONE, all fixed asset checks passed ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("TEST SUITE FAILED", err);
  process.exit(1);
});
