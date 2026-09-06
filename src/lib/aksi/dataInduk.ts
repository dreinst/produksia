"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { ambilKonfigurasiEntitas } from "@/lib/konfigurasiDataInduk";

type DelegasiPrisma = {
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  delete: (args: { where: { id: string } }) => Promise<unknown>;
};

function delegasi(model: string): DelegasiPrisma {
  return (db as unknown as Record<string, DelegasiPrisma>)[model];
}

export async function buatDataInduk(slug: string, dataFormulir: FormData) {
  const config = ambilKonfigurasiEntitas(slug);
  if (!config) throw new Error(`Entitas tidak dikenal: ${slug}`);

  const data: Record<string, unknown> = {};
  for (const bidang of config.bidang) {
    const raw = dataFormulir.get(bidang.nama);
    const value = typeof raw === "string" ? raw.trim() : "";

    if (!value) {
      if (bidang.wajib) throw new Error(`${bidang.label} wajib diisi`);
      continue;
    }

    if (bidang.jenis === "number") {
      data[bidang.nama] = value;
    } else if (bidang.nama.endsWith("Id")) {
      data[bidang.nama] = value;
    } else {
      data[bidang.nama] = value;
    }
  }

  await delegasi(config.model).create({ data });
  revalidatePath(`/data-induk/${slug}`);
}

export async function hapusDataInduk(slug: string, id: string) {
  const config = ambilKonfigurasiEntitas(slug);
  if (!config) throw new Error(`Entitas tidak dikenal: ${slug}`);

  await delegasi(config.model).delete({ where: { id } });
  revalidatePath(`/data-induk/${slug}`);
}

// ---------- Varian untuk <FormulirAksi> (mengembalikan pesan error, bukan throw) ----------

export async function buatDataIndukFormulir(slug: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatDataInduk(slug, dataFormulir));
}
// Dipakai lewat .bind(null, slug, id); argumen (prevState, dataFormulir) dari useActionState sengaja diabaikan
export async function hapusDataIndukFormulir(slug: string, id: string) {
  return jalankanFormulir(() => hapusDataInduk(slug, id));
}
