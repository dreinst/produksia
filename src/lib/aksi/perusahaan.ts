"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { sesiSaatIni, wajibMasukAksi } from "@/lib/otentikasi";
import { simpanLingkupSesi } from "@/lib/perusahaan";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";

/*
 * Aksi multi perusahaan (D1 §6.1). Paket ini baru memuat ganti lingkup; buat/ubah perusahaan dan
 * transaksi antar perusahaan menyusul di paket domainnya.
 */

/**
 * Mengganti lingkup perusahaan sesi ini. Isian "perusahaanId" = id perusahaan atau "semua" (gabungan).
 * Ganti lingkup bukan hak tersendiri: setiap pengguna yang masuk boleh, tapi "semua" butuh
 * perusahaan-gabungan.lihat. Tanpa log karena tidak mengubah data.
 */
export async function gantiPerusahaanAktif(dataFormulir: FormData) {
  const pengguna = await wajibMasukAksi();
  const pilihan = String(dataFormulir.get("perusahaanId") ?? "");
  const sesi = await sesiSaatIni();
  if (!sesi) throw new Error("Lingkup perusahaan hanya bisa diganti dari peramban yang sedang masuk");
  await simpanLingkupSesi(db, sesi.id, pilihan, pengguna);
  revalidatePath("/", "layout");
}

export async function gantiPerusahaanAktifFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => gantiPerusahaanAktif(dataFormulir));
}
