"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { nextDocNumber } from "@/lib/numbering";
import { runForm, type FormState } from "@/lib/formState";
import { D, money, parseMoney, sum, type Dec } from "@/lib/money";

export async function createFixedAsset(formData: FormData) {
  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const acquisitionDate = String(formData.get("acquisitionDate") ?? "");
  const usefulLifeMonths = Number(formData.get("usefulLifeMonths") ?? 0);
  const assetAccountId = String(formData.get("assetAccountId") ?? "");
  const depreciationExpenseAccountId = String(formData.get("depreciationExpenseAccountId") ?? "");
  const accumulatedDepreciationAccountId = String(formData.get("accumulatedDepreciationAccountId") ?? "");

  if (!code || !name) throw new Error("Kode dan nama aset wajib diisi");
  const acquisitionCost = parseMoney(formData.get("acquisitionCost"), "Harga perolehan");
  const salvageValue = parseMoney(formData.get("salvageValue"), "Nilai sisa", { allowZero: true });
  if (salvageValue.gte(acquisitionCost)) throw new Error("Nilai sisa harus lebih kecil dari harga perolehan");
  if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths <= 0) {
    throw new Error("Umur ekonomis harus bilangan bulat > 0 (bulan)");
  }
  if (!assetAccountId || !depreciationExpenseAccountId || !accumulatedDepreciationAccountId) {
    throw new Error("Semua akun (Aset, Beban Penyusutan, Akumulasi Penyusutan) wajib dipilih");
  }
  if (new Set([assetAccountId, depreciationExpenseAccountId, accumulatedDepreciationAccountId]).size !== 3) {
    throw new Error("Ketiga akun harus berbeda satu sama lain");
  }

  await db.fixedAsset.create({
    data: {
      code,
      name,
      acquisitionDate: acquisitionDate ? new Date(acquisitionDate) : new Date(),
      acquisitionCost,
      salvageValue,
      usefulLifeMonths,
      assetAccountId,
      depreciationExpenseAccountId,
      accumulatedDepreciationAccountId,
    },
  });

  revalidatePath("/assets");
  redirect("/assets");
}

export async function runMonthlyDepreciation(formData: FormData) {
  const periodStr = String(formData.get("period") ?? "");
  if (!/^\d{4}-\d{2}$/.test(periodStr)) throw new Error("Periode wajib dipilih (format YYYY-MM)");
  const period = new Date(`${periodStr}-01T00:00:00.000Z`);

  const assets = await db.fixedAsset.findMany({
    where: { status: "AKTIF" },
    include: { depreciations: true },
  });

  const toProcess = assets.filter((a) => !a.depreciations.some((d) => d.period.getTime() === period.getTime()));
  if (toProcess.length === 0) {
    throw new Error("Semua aset aktif sudah punya jurnal penyusutan untuk periode ini");
  }

  const zero = D(0);
  const lines: { accountId: string; debit: Dec; credit: Dec; description: string }[] = [];
  const depreciationRecords: { assetId: string; amount: Dec }[] = [];

  for (const asset of toProcess) {
    // garis lurus: (harga perolehan - nilai sisa) / umur; bulan terakhir mengambil sisa agar total pas
    const depreciableBase = D(asset.acquisitionCost).minus(asset.salvageValue);
    const monthlyAmount = money(depreciableBase.div(asset.usefulLifeMonths));
    const alreadyDepreciated = sum(asset.depreciations.map((d) => d.amount));
    const remaining = depreciableBase.minus(alreadyDepreciated);
    if (remaining.lte(0)) continue;
    const amount = monthlyAmount.lte(remaining) ? monthlyAmount : money(remaining);
    if (amount.lte(0)) continue;

    lines.push(
      { accountId: asset.depreciationExpenseAccountId, debit: amount, credit: zero, description: `Penyusutan ${asset.name}` },
      { accountId: asset.accumulatedDepreciationAccountId, debit: zero, credit: amount, description: `Akumulasi penyusutan ${asset.name}` },
    );
    depreciationRecords.push({ assetId: asset.id, amount });
  }

  if (lines.length === 0) {
    throw new Error("Tidak ada aset yang perlu disusutkan (semua sudah mencapai nilai sisa)");
  }

  await db.$transaction(async (tx) => {
    const no = await nextDocNumber(tx.journalEntry, "JU-PNY");
    const journal = await tx.journalEntry.create({
      data: { no, memo: `Penyusutan aset periode ${periodStr}`, source: "PENYUSUTAN", lines: { create: lines } },
    });

    for (const rec of depreciationRecords) {
      await tx.fixedAssetDepreciation.create({
        data: { assetId: rec.assetId, period, amount: rec.amount, journalEntryId: journal.id },
      });
    }
  });

  revalidatePath("/assets");
  revalidatePath("/assets/depreciation");
  redirect("/assets/depreciation");
}

// ---------- Varian untuk <ActionForm> (mengembalikan pesan error, bukan throw) ----------

export async function createFixedAssetForm(_prev: FormState, formData: FormData) {
  return runForm(() => createFixedAsset(formData));
}
export async function runMonthlyDepreciationForm(_prev: FormState, formData: FormData) {
  return runForm(() => runMonthlyDepreciation(formData));
}
