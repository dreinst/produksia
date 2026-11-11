"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { wajibMasukAksi } from "@/lib/otentikasi";
import { aturPerusahaanAktif, lingkupPerusahaan } from "@/lib/perusahaan";
import { tandaiDibuka } from "@/lib/notifikasi";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";

/*
 * Aksi notifikasi (D7 §6.4). Notifikasi milik penerimanya: setiap aksi hanya menyentuh baris milik pengguna yang
 * masuk, dan id milik orang lain diabaikan tanpa galat. Membaca dan menandai notifikasi tidak dicatat di log.
 */

/**
 * Membuka notifikasi: tandai dibaca, ganti lingkup bila notifikasi merujuk perusahaan lain dari lingkup satu
 * perusahaan yang aktif (gabungan tidak diganti), lalu kembalikan tautannya. Dipanggil langsung oleh lonceng.
 */
export async function bukaNotifikasi(id: string): Promise<{ tautan: string | null }> {
  const pengguna = await wajibMasukAksi();
  const n = await tandaiDibuka(db, pengguna.id, String(id ?? ""));
  if (!n) return { tautan: null };
  if (n.perusahaanId) {
    const lingkup = await lingkupPerusahaan();
    if (lingkup.perusahaanId && lingkup.perusahaanId !== n.perusahaanId) {
      // perusahaan yang sudah diarsipkan tidak bisa menjadi lingkup; notifikasi tetap terbuka di lingkup lama
      try {
        await aturPerusahaanAktif(n.perusahaanId);
      } catch (galat) {
        console.error("[notifikasi lingkup]", galat);
      }
    }
  }
  revalidatePath("/", "layout");
  return { tautan: n.tautan };
}

/** Tiap butir di /notifikasi; argumen useActionState diabaikan. */
export async function bukaNotifikasiFormulir(id: string): Promise<StatusFormulir> {
  return jalankanFormulir(async () => redirect((await bukaNotifikasi(id)).tautan ?? "/notifikasi"));
}

/** Menandai satu notifikasi milik pengguna dibaca; milik orang lain atau yang sudah dibaca tidak berubah. */
export async function tandaiNotifikasiDibaca(id: string) {
  const pengguna = await wajibMasukAksi();
  await db.notifikasi.updateMany({ where: { id: String(id ?? ""), penggunaId: pengguna.id, dibaca: false }, data: { dibaca: true, dibacaPada: new Date() } });
}

export async function tandaiNotifikasiDibacaFormulir(id: string): Promise<StatusFormulir> {
  return jalankanFormulir(async () => {
    await tandaiNotifikasiDibaca(id);
    revalidatePath("/notifikasi");
  });
}

/** Menandai semua notifikasi pengguna dibaca, lintas perusahaan. */
export async function tandaiSemuaNotifikasiDibaca() {
  const pengguna = await wajibMasukAksi();
  await db.notifikasi.updateMany({ where: { penggunaId: pengguna.id, dibaca: false }, data: { dibaca: true, dibacaPada: new Date() } });
  revalidatePath("/notifikasi");
}

export async function tandaiSemuaNotifikasiDibacaFormulir(): Promise<StatusFormulir> {
  return jalankanFormulir(() => tandaiSemuaNotifikasiDibaca());
}
