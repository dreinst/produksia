"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { runForm, type FormState } from "@/lib/formState";
import { getEntityConfig } from "@/lib/masterConfig";

type PrismaDelegate = {
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  delete: (args: { where: { id: string } }) => Promise<unknown>;
};

function delegate(model: string): PrismaDelegate {
  return (db as unknown as Record<string, PrismaDelegate>)[model];
}

export async function createMasterRecord(slug: string, formData: FormData) {
  const config = getEntityConfig(slug);
  if (!config) throw new Error(`Entitas tidak dikenal: ${slug}`);

  const data: Record<string, unknown> = {};
  for (const field of config.fields) {
    const raw = formData.get(field.name);
    const value = typeof raw === "string" ? raw.trim() : "";

    if (!value) {
      if (field.required) throw new Error(`${field.label} wajib diisi`);
      continue;
    }

    if (field.type === "number") {
      data[field.name] = value;
    } else if (field.name.endsWith("Id")) {
      data[field.name] = value;
    } else {
      data[field.name] = value;
    }
  }

  await delegate(config.model).create({ data });
  revalidatePath(`/master/${slug}`);
}

export async function deleteMasterRecord(slug: string, id: string) {
  const config = getEntityConfig(slug);
  if (!config) throw new Error(`Entitas tidak dikenal: ${slug}`);

  await delegate(config.model).delete({ where: { id } });
  revalidatePath(`/master/${slug}`);
}

// ---------- Varian untuk <ActionForm> (mengembalikan pesan error, bukan throw) ----------

export async function createMasterRecordForm(slug: string, _prev: FormState, formData: FormData) {
  return runForm(() => createMasterRecord(slug, formData));
}
// Dipakai lewat .bind(null, slug, id); argumen (prevState, formData) dari useActionState sengaja diabaikan
export async function deleteMasterRecordForm(slug: string, id: string) {
  return runForm(() => deleteMasterRecord(slug, id));
}
