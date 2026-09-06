"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { nextDocNumber } from "@/lib/numbering";
import { runForm, type FormState } from "@/lib/formState";
import { D, fmt, money, parseMoney, sum, type Dec } from "@/lib/money";
import type { JournalSource } from "@/generated/prisma/enums";

type JournalLineInput = { accountId: string; debit: Dec; credit: Dec; description?: string };

function parseJournalLines(raw: FormDataEntryValue | null): JournalLineInput[] {
  if (typeof raw !== "string" || !raw) throw new Error("Minimal 2 baris jurnal wajib diisi");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Format baris jurnal tidak valid");
  }
  if (!Array.isArray(parsed)) throw new Error("Minimal 2 baris jurnal wajib diisi");
  return (parsed as { accountId?: string; debit?: unknown; credit?: unknown; description?: string }[])
    .map((l) => ({
      accountId: String(l.accountId ?? ""),
      debit: money(l.debit as string | number | undefined),
      credit: money(l.credit as string | number | undefined),
      description: l.description ? String(l.description) : undefined,
    }))
    .filter((l) => l.debit.gt(0) || l.credit.gt(0));
}

async function createBalancedJournal(memo: string, lines: JournalLineInput[], source: JournalSource, prefix: string) {
  if (lines.length < 2) throw new Error("Jurnal minimal punya 2 baris (debit & kredit) dengan nominal > 0");
  if (lines.some((l) => !l.accountId)) throw new Error("Setiap baris jurnal harus memilih akun");
  if (lines.some((l) => l.debit.isNegative() || l.credit.isNegative())) throw new Error("Nominal tidak boleh negatif");
  if (lines.some((l) => l.debit.gt(0) && l.credit.gt(0))) {
    throw new Error("Satu baris hanya boleh debit ATAU kredit, bukan keduanya");
  }

  const totalDebit = sum(lines.map((l) => l.debit));
  const totalCredit = sum(lines.map((l) => l.credit));
  if (!totalDebit.equals(totalCredit)) {
    throw new Error(`Jurnal tidak seimbang: total debit ${fmt(totalDebit)} vs kredit ${fmt(totalCredit)}`);
  }
  if (totalDebit.isZero()) throw new Error("Jumlah jurnal tidak boleh nol");

  const no = await nextDocNumber(db.journalEntry, prefix);

  await db.journalEntry.create({
    data: {
      no,
      memo,
      source,
      lines: {
        create: lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          description: l.description || null,
        })),
      },
    },
  });

  return no;
}

// ---------- Jurnal Umum (manual) ----------

export async function createManualJournal(formData: FormData) {
  const memo = String(formData.get("memo") ?? "");
  const lines = parseJournalLines(formData.get("lines"));

  await createBalancedJournal(memo, lines, "MANUAL", "JU");

  revalidatePath("/ledger/journal");
  redirect("/ledger/journal");
}

// ---------- Kas Masuk / Kas Keluar ----------

function parseCashForm(formData: FormData) {
  const cashAccountId = String(formData.get("cashAccountId") ?? "");
  const counterAccountId = String(formData.get("counterAccountId") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  if (!cashAccountId) throw new Error("Akun Kas/Bank wajib dipilih");
  if (!counterAccountId) throw new Error("Akun lawan wajib dipilih");
  if (cashAccountId === counterAccountId) throw new Error("Akun Kas/Bank dan akun lawan tidak boleh sama");
  const amount = parseMoney(formData.get("amount"), "Jumlah");
  return { cashAccountId, counterAccountId, description, amount };
}

export async function createCashIn(formData: FormData) {
  const { cashAccountId, counterAccountId, description, amount } = parseCashForm(formData);
  const zero = D(0);

  await createBalancedJournal(
    description || "Kas Masuk",
    [
      { accountId: cashAccountId, debit: amount, credit: zero, description },
      { accountId: counterAccountId, debit: zero, credit: amount, description },
    ],
    "KAS_MASUK",
    "KM",
  );

  revalidatePath("/cashbank/in");
  redirect("/cashbank/in");
}

export async function createCashOut(formData: FormData) {
  const { cashAccountId, counterAccountId, description, amount } = parseCashForm(formData);
  const zero = D(0);

  await createBalancedJournal(
    description || "Kas Keluar",
    [
      { accountId: counterAccountId, debit: amount, credit: zero, description },
      { accountId: cashAccountId, debit: zero, credit: amount, description },
    ],
    "KAS_KELUAR",
    "KK",
  );

  revalidatePath("/cashbank/out");
  redirect("/cashbank/out");
}

// ---------- Varian untuk <ActionForm> (mengembalikan pesan error, bukan throw) ----------

export async function createManualJournalForm(_prev: FormState, formData: FormData) {
  return runForm(() => createManualJournal(formData));
}
export async function createCashInForm(_prev: FormState, formData: FormData) {
  return runForm(() => createCashIn(formData));
}
export async function createCashOutForm(_prev: FormState, formData: FormData) {
  return runForm(() => createCashOut(formData));
}
