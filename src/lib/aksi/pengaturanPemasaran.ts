"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { wajibHakAksi } from "@/lib/otentikasi";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { JENIS_LOG_PENGATURAN, MAKS_BUTIR_DAFTAR, catatLogPemasaran, rapikanDaftarPilihan } from "@/lib/pemasaran";

/*
 * Aksi daftar jenis dan pilar konten per perusahaan (D6 §6.5). Hak sementara pengaturan.tulis (sama dengan
 * settings.edit HKA yang hanya Owner); bila halaman Daftar Pilihan menetapkan kunci lain, cukup ganti wajibHakAksi.
 * Kedua larik selalu dikirim saat menyimpan (M-5).
 */

function bacaDaftar(dataFormulir: FormData, nama: string, label: string): string[] {
  try {
    return rapikanDaftarPilihan(String(dataFormulir.get(nama) ?? ""));
  } catch {
    throw new Error(`Maksimal ${MAKS_BUTIR_DAFTAR} butir per daftar (${label})`);
  }
}

export async function simpanPengaturanPemasaran(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pengaturan.tulis");
  const perusahaanId = String(dataFormulir.get("perusahaanId") ?? "").trim();
  if (!perusahaanId) throw new Error("Pilih perusahaan untuk daftar ini");
  const jenisKonten = bacaDaftar(dataFormulir, "jenisKonten", "Jenis konten");
  const pilarKonten = bacaDaftar(dataFormulir, "pilarKonten", "Pilar konten");
  await db.$transaction(async (tx) => {
    const p = await tx.perusahaan.findUnique({ where: { id: perusahaanId }, select: { nama: true, aktif: true } });
    if (!p) throw new Error("Perusahaan tidak ditemukan");
    if (!p.aktif) throw new Error(`Perusahaan ${p.nama} sudah diarsipkan; aktifkan dulu`);
    await tx.pengaturanPemasaran.upsert({
      where: { perusahaanId },
      create: { perusahaanId, jenisKonten, pilarKonten, diubahOlehNama: pengguna.nama },
      update: { jenisKonten, pilarKonten, diubahOlehNama: pengguna.nama },
    });
    await catatLogPemasaran(tx, pengguna, {
      modul: "konten",
      aksi: "UBAH",
      jenis: JENIS_LOG_PENGATURAN,
      label: p.nama,
      entitasId: perusahaanId,
      keterangan: `Daftar jenis konten (${jenisKonten.length}) dan pilar konten (${pilarKonten.length}) disimpan`,
      meta: { perusahaanId },
      perusahaanId,
    });
  });
  revalidatePath("/pemasaran/konten");
  revalidatePath("/pengaturan/daftar-pilihan");
}

export async function simpanPengaturanPemasaranFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => simpanPengaturanPemasaran(dataFormulir));
}
