"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { runForm, type FormState } from "@/lib/formState";

export async function saveAccountMapping(formData: FormData) {
  const piutangUsahaId = String(formData.get("piutangUsahaId") ?? "");
  const persediaanId = String(formData.get("persediaanId") ?? "");
  const hppId = String(formData.get("hppId") ?? "");
  const pendapatanPenjualanId = String(formData.get("pendapatanPenjualanId") ?? "");
  const utangUsahaId = String(formData.get("utangUsahaId") ?? "");

  if (!piutangUsahaId || !persediaanId || !hppId || !pendapatanPenjualanId || !utangUsahaId) {
    throw new Error("Semua pemetaan akun wajib diisi");
  }

  await db.accountMapping.upsert({
    where: { id: "default" },
    create: { id: "default", piutangUsahaId, persediaanId, hppId, pendapatanPenjualanId, utangUsahaId },
    update: { piutangUsahaId, persediaanId, hppId, pendapatanPenjualanId, utangUsahaId },
  });

  revalidatePath("/settings/account-mapping");
}

// ---------- Varian untuk <ActionForm> (mengembalikan pesan error, bukan throw) ----------

export async function saveAccountMappingForm(_prev: FormState, formData: FormData) {
  return runForm(() => saveAccountMapping(formData));
}
