"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { ambilKonfigurasiEntitas, type KonfigurasiEntitas } from "@/lib/konfigurasiDataInduk";
import { wajibHakAksi } from "@/lib/otentikasi";

type DelegasiPrisma = {
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  delete: (args: { where: { id: string } }) => Promise<unknown>;
};

function delegasi(model: string): DelegasiPrisma {
  return (db as unknown as Record<string, DelegasiPrisma>)[model];
}

async function konfigurasiDenganHak(slug: string): Promise<KonfigurasiEntitas> {
  const config = ambilKonfigurasiEntitas(slug);
  if (!config) throw new Error(`Entitas tidak dikenal: ${slug}`);
  // Bagan akun menentukan struktur laporan keuangan → butuh hak buku besar, bukan sekadar data induk
  await wajibHakAksi(slug === "akun" ? "buku-besar.tulis" : "data-induk.tulis");
  return config;
}

/**
 * Membaca isian formulir sesuai konfigurasi entitas.
 * `untukUbah` = true → isian kosong pada bidang opsional ditulis sebagai null (mengosongkan nilai lama),
 * sedangkan saat membuat data baru bidang kosong dilewati saja (pakai default skema).
 */
function bacaData(config: KonfigurasiEntitas, dataFormulir: FormData, untukUbah: boolean) {
  const data: Record<string, unknown> = {};
  for (const bidang of config.bidang) {
    const mentah = dataFormulir.get(bidang.nama);
    const nilai = typeof mentah === "string" ? mentah.trim() : "";

    if (!nilai) {
      if (bidang.wajib) throw new Error(`${bidang.label} wajib diisi`);
      if (untukUbah) data[bidang.nama] = bidang.nilaiBawaan ?? null;
      continue;
    }
    if (bidang.jenis === "number" && Number.isNaN(Number(nilai))) throw new Error(`${bidang.label} harus berupa angka`);
    data[bidang.nama] = nilai;
  }
  return data;
}

export async function buatDataInduk(slug: string, dataFormulir: FormData) {
  const config = await konfigurasiDenganHak(slug);
  await delegasi(config.model).create({ data: bacaData(config, dataFormulir, false) });
  revalidatePath(`/data-induk/${slug}`);
}

export async function ubahDataInduk(slug: string, id: string, dataFormulir: FormData) {
  const config = await konfigurasiDenganHak(slug);
  const data = bacaData(config, dataFormulir, true);
  if ("indukId" in data && data.indukId === id) throw new Error("Data tidak bisa menjadi induk dirinya sendiri");
  await delegasi(config.model).update({ where: { id }, data });
  revalidatePath(`/data-induk/${slug}`);
  redirect(`/data-induk/${slug}`);
}

export async function hapusDataInduk(slug: string, id: string) {
  const config = await konfigurasiDenganHak(slug);
  await delegasi(config.model).delete({ where: { id } });
  revalidatePath(`/data-induk/${slug}`);
}

// ---------- Varian untuk <FormulirAksi> (mengembalikan pesan error, bukan throw) ----------

export async function buatDataIndukFormulir(slug: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatDataInduk(slug, dataFormulir));
}
export async function ubahDataIndukFormulir(slug: string, id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahDataInduk(slug, id, dataFormulir));
}
// Dipakai lewat .bind(null, slug, id); argumen (prevState, dataFormulir) dari useActionState sengaja diabaikan
export async function hapusDataIndukFormulir(slug: string, id: string) {
  return jalankanFormulir(() => hapusDataInduk(slug, id));
}
