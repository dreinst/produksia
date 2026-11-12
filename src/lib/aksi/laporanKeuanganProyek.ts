"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { wajibHakAksi } from "@/lib/otentikasi";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { simpanLaporanKeuanganProyek } from "@/lib/pdf/laporanKeuanganProyek";

/*
 * Simpan PDF laporan keuangan proyek ke Berkas (D5 §6.2). Hak lihat anggaran-proyek.lihat lebih dulu; hak unggah
 * (anggaran-proyek.ubah atau berkas.buat) dan pembatasan folder diperiksa simpanBerkas. Tanpa redirect: formulir
 * menampilkan pesanSukses "Laporan disimpan ke Berkas proyek".
 */

export async function simpanLaporanKeuanganKeBerkas(proyekId: string): Promise<void> {
  const pengguna = await wajibHakAksi("anggaran-proyek.lihat");
  const berkas = await simpanLaporanKeuanganProyek(db, pengguna, proyekId);
  revalidatePath(`/proyek/${berkas.proyekId}/keuangan`);
  revalidatePath("/berkas");
}

export async function simpanLaporanKeuanganKeBerkasFormulir(proyekId: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => simpanLaporanKeuanganKeBerkas(proyekId));
}
