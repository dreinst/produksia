import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { buatJurnalManual, buatKasMasuk, buatKasKeluar } from "../src/lib/aksi/jurnal";

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

async function harapGagal(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.error(`[FAIL] ${label} - expected an error but none was thrown`);
    throw new Error(`${label} should have thrown`);
  } catch (err: unknown) {
    const message = (err as { message?: string })?.message ?? "";
    if (message.includes("tidak seimbang") || message.includes("harus lebih dari 0")) {
      console.log(`[ok] ${label} -> rejected as expected: ${message}`);
    } else {
      throw err;
    }
  }
}

async function main() {
  const mulaiUji = new Date();
  console.log("=== Seed akun test ===");
  const kas = await db.akun.create({ data: { kode: "1-TEST-KAS", nama: "Kas Test", jenis: "ASET" } });
  const bank = await db.akun.create({ data: { kode: "1-TEST-BANK", nama: "Bank Test", jenis: "ASET" } });
  const modal = await db.akun.create({ data: { kode: "3-TEST-MODAL", nama: "Modal Test", jenis: "MODAL" } });
  const beban = await db.akun.create({ data: { kode: "5-TEST-BEBAN", nama: "Beban Test", jenis: "BEBAN" } });

  console.log("=== 1. Jurnal manual tidak seimbang harus ditolak ===");
  const badFd = new FormData();
  badFd.set("keterangan", "test tidak seimbang");
  badFd.set("baris", JSON.stringify([
    { akunId: kas.id, debit: 100000, kredit: 0 },
    { akunId: modal.id, debit: 0, kredit: 50000 },
  ]));
  await harapGagal("buatJurnalManual (unbalanced)", () => buatJurnalManual(badFd));

  console.log("=== 2. Jurnal manual balance harus diterima (setoran modal awal) ===");
  const goodFd = new FormData();
  goodFd.set("keterangan", "Setoran modal awal");
  goodFd.set("baris", JSON.stringify([
    { akunId: kas.id, debit: 1000000, kredit: 0 },
    { akunId: modal.id, debit: 0, kredit: 1000000 },
  ]));
  await jalankanAbaikanRedirect("buatJurnalManual (seimbang)", () => buatJurnalManual(goodFd));

  console.log("=== 3. Kas Masuk (pindah dari Kas ke Bank ceritanya setor tunai) ===");
  const cashInFd = new FormData();
  cashInFd.set("akunKasId", bank.id);
  cashInFd.set("akunLawanId", kas.id);
  cashInFd.set("jumlah", "400000");
  cashInFd.set("keterangan", "Setor tunai ke bank");
  await jalankanAbaikanRedirect("buatKasMasuk", () => buatKasMasuk(cashInFd));

  console.log("=== 4. Kas Keluar (bayar beban dari Kas) ===");
  const cashOutFd = new FormData();
  cashOutFd.set("akunKasId", kas.id);
  cashOutFd.set("akunLawanId", beban.id);
  cashOutFd.set("jumlah", "150000");
  cashOutFd.set("keterangan", "Bayar beban listrik");
  await jalankanAbaikanRedirect("buatKasKeluar", () => buatKasKeluar(cashOutFd));

  console.log("=== Verifikasi saldo Buku Besar akun Kas ===");
  const kasLines = await db.barisJurnal.findMany({ where: { akunId: kas.id } });
  const kasDebit = kasLines.reduce((s, l) => s + Number(l.debit), 0);
  const kasCredit = kasLines.reduce((s, l) => s + Number(l.kredit), 0);
  const kasBalance = kasDebit - kasCredit; // ASET = debit normal
  console.log(`Kas: debit ${kasDebit}, kredit ${kasCredit}, saldo (expect 450000): ${kasBalance}`);
  if (kasBalance !== 450000) throw new Error(`Saldo Kas salah, dapat ${kasBalance}, harusnya 450000`);

  const bankLines = await db.barisJurnal.findMany({ where: { akunId: bank.id } });
  const bankBalance = bankLines.reduce((s, l) => s + Number(l.debit) - Number(l.kredit), 0);
  console.log(`Bank saldo (expect 400000): ${bankBalance}`);
  if (bankBalance !== 400000) throw new Error(`Saldo Bank salah, dapat ${bankBalance}, harusnya 400000`);

  console.log("=== Verifikasi Neraca Saldo balance (total debit = total kredit) ===");
  const allLines = await db.barisJurnal.findMany({
    where: { akunId: { in: [kas.id, bank.id, modal.id, beban.id] } },
  });
  const totalDebit = allLines.reduce((s, l) => s + Number(l.debit), 0);
  const totalKredit = allLines.reduce((s, l) => s + Number(l.kredit), 0);
  console.log(`Total debit: ${totalDebit}, total kredit: ${totalKredit}`);
  if (totalDebit !== totalKredit) throw new Error("Neraca saldo tidak seimbang!");

  console.log("=== Cleanup ===");
  // Hanya hapus jurnal yang dibuat SELAMA test ini (berdasarkan waktu), bukan berdasarkan keterangan —
  // keterangan "Setoran modal"/"Setor tunai" juga dipakai data seed dan pernah bikin cleanup salah sasaran.
  const journalIds = (
    await db.jurnal.findMany({ where: { tanggal: { gte: mulaiUji } }, select: { id: true } })
  ).map((j) => j.id);
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: journalIds } } });
  await db.jurnal.deleteMany({ where: { id: { in: journalIds } } });
  await db.akun.deleteMany({ where: { id: { in: [kas.id, bank.id, modal.id, beban.id] } } });

  console.log("=== DONE, all ledger checks passed ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("TEST SUITE FAILED", err);
  process.exit(1);
});
