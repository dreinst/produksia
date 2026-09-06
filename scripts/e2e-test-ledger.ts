import "dotenv/config";
import { db } from "../src/lib/db";
import { createManualJournal, createCashIn, createCashOut } from "../src/lib/actions/journal";

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

async function expectThrow(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.error(`[FAIL] ${label} - expected an error but none was thrown`);
    throw new Error(`${label} should have thrown`);
  } catch (err: unknown) {
    const message = (err as { message?: string })?.message ?? "";
    if (message.includes("tidak balance") || message.includes("harus lebih dari 0")) {
      console.log(`[ok] ${label} -> rejected as expected: ${message}`);
    } else {
      throw err;
    }
  }
}

async function main() {
  const testStart = new Date();
  console.log("=== Seed akun test ===");
  const kas = await db.account.create({ data: { code: "1-TEST-KAS", name: "Kas Test", type: "ASET" } });
  const bank = await db.account.create({ data: { code: "1-TEST-BANK", name: "Bank Test", type: "ASET" } });
  const modal = await db.account.create({ data: { code: "3-TEST-MODAL", name: "Modal Test", type: "MODAL" } });
  const beban = await db.account.create({ data: { code: "5-TEST-BEBAN", name: "Beban Test", type: "BEBAN" } });

  console.log("=== 1. Jurnal manual tidak balance harus ditolak ===");
  const badFd = new FormData();
  badFd.set("memo", "test tidak balance");
  badFd.set("lines", JSON.stringify([
    { accountId: kas.id, debit: 100000, credit: 0 },
    { accountId: modal.id, debit: 0, credit: 50000 },
  ]));
  await expectThrow("createManualJournal (unbalanced)", () => createManualJournal(badFd));

  console.log("=== 2. Jurnal manual balance harus diterima (setoran modal awal) ===");
  const goodFd = new FormData();
  goodFd.set("memo", "Setoran modal awal");
  goodFd.set("lines", JSON.stringify([
    { accountId: kas.id, debit: 1000000, credit: 0 },
    { accountId: modal.id, debit: 0, credit: 1000000 },
  ]));
  await runIgnoringRedirect("createManualJournal (balanced)", () => createManualJournal(goodFd));

  console.log("=== 3. Kas Masuk (pindah dari Kas ke Bank ceritanya setor tunai) ===");
  const cashInFd = new FormData();
  cashInFd.set("cashAccountId", bank.id);
  cashInFd.set("counterAccountId", kas.id);
  cashInFd.set("amount", "400000");
  cashInFd.set("description", "Setor tunai ke bank");
  await runIgnoringRedirect("createCashIn", () => createCashIn(cashInFd));

  console.log("=== 4. Kas Keluar (bayar beban dari Kas) ===");
  const cashOutFd = new FormData();
  cashOutFd.set("cashAccountId", kas.id);
  cashOutFd.set("counterAccountId", beban.id);
  cashOutFd.set("amount", "150000");
  cashOutFd.set("description", "Bayar beban listrik");
  await runIgnoringRedirect("createCashOut", () => createCashOut(cashOutFd));

  console.log("=== Verifikasi saldo Buku Besar akun Kas ===");
  const kasLines = await db.journalLine.findMany({ where: { accountId: kas.id } });
  const kasDebit = kasLines.reduce((s, l) => s + Number(l.debit), 0);
  const kasCredit = kasLines.reduce((s, l) => s + Number(l.credit), 0);
  const kasBalance = kasDebit - kasCredit; // ASET = debit normal
  console.log(`Kas: debit ${kasDebit}, credit ${kasCredit}, saldo (expect 450000): ${kasBalance}`);
  if (kasBalance !== 450000) throw new Error(`Saldo Kas salah, dapat ${kasBalance}, harusnya 450000`);

  const bankLines = await db.journalLine.findMany({ where: { accountId: bank.id } });
  const bankBalance = bankLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  console.log(`Bank saldo (expect 400000): ${bankBalance}`);
  if (bankBalance !== 400000) throw new Error(`Saldo Bank salah, dapat ${bankBalance}, harusnya 400000`);

  console.log("=== Verifikasi Neraca Saldo balance (total debit = total kredit) ===");
  const allLines = await db.journalLine.findMany({
    where: { accountId: { in: [kas.id, bank.id, modal.id, beban.id] } },
  });
  const totalDebit = allLines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = allLines.reduce((s, l) => s + Number(l.credit), 0);
  console.log(`Total debit: ${totalDebit}, total credit: ${totalCredit}`);
  if (totalDebit !== totalCredit) throw new Error("Neraca saldo tidak balance!");

  console.log("=== Cleanup ===");
  // Hanya hapus jurnal yang dibuat SELAMA test ini (berdasarkan waktu), bukan berdasarkan memo —
  // memo "Setoran modal"/"Setor tunai" juga dipakai data seed dan pernah bikin cleanup salah sasaran.
  const journalIds = (
    await db.journalEntry.findMany({ where: { date: { gte: testStart } }, select: { id: true } })
  ).map((j) => j.id);
  await db.journalLine.deleteMany({ where: { journalEntryId: { in: journalIds } } });
  await db.journalEntry.deleteMany({ where: { id: { in: journalIds } } });
  await db.account.deleteMany({ where: { id: { in: [kas.id, bank.id, modal.id, beban.id] } } });

  console.log("=== DONE, all ledger checks passed ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("TEST SUITE FAILED", err);
  process.exit(1);
});
