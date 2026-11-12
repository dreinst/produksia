"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { wajibHakAksi } from "@/lib/otentikasi";
import { catatAktivitas } from "@/lib/log";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { PANJANG_NAMA_KLIEN_PROYEK } from "@/lib/proyek";

/*
 * Tampilan proyek (D5 §3.1): warna lencana dan nama klien teks bebas. Tidak menjurnal. Hak data-induk.tulis. Halaman
 * /proyek/[id] dibuat paket halaman proyek; formulirnya memakai ubahTampilanProyekFormulir dengan pesanSukses
 * "Tampilan proyek disimpan".
 */

const POLA_WARNA = /^#[0-9a-f]{6}$/;

export async function ubahTampilanProyek(proyekId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("data-induk.tulis");
  const warnaMentah = String(dataFormulir.get("warna") ?? "").trim().toLowerCase();
  const warna = warnaMentah || null;
  if (warna && !POLA_WARNA.test(warna)) throw new Error("Warna harus kode #rrggbb");
  const namaKlien = String(dataFormulir.get("namaKlien") ?? "").trim() || null;
  if (namaKlien && [...namaKlien].length > PANJANG_NAMA_KLIEN_PROYEK) throw new Error(`Nama klien maksimal ${PANJANG_NAMA_KLIEN_PROYEK} karakter`);
  const proyek = await db.proyek.findUnique({ where: { id: String(proyekId ?? "") }, select: { id: true, kode: true, perusahaanId: true, warna: true, namaKlien: true } });
  if (!proyek) throw new Error("Proyek tidak ditemukan");

  const meta: Record<string, { dari: string | null; ke: string | null }> = {};
  if (proyek.warna !== warna) meta.warna = { dari: proyek.warna, ke: warna };
  if (proyek.namaKlien !== namaKlien) meta.namaKlien = { dari: proyek.namaKlien, ke: namaKlien };
  if (Object.keys(meta).length === 0) return;
  await db.$transaction(async (tx) => {
    await tx.proyek.update({ where: { id: proyek.id }, data: { warna, namaKlien } });
    await catatAktivitas(tx, pengguna, {
      aksi: "UBAH",
      jenis: "Proyek",
      nomor: proyek.kode,
      keterangan: `Tampilan proyek diubah: ${Object.keys(meta).map((k) => (k === "warna" ? "warna" : "nama klien")).join(" dan ")}`,
      modul: "proyek",
      entitasId: proyek.id,
      meta,
      perusahaanId: proyek.perusahaanId,
    });
  });
  revalidatePath("/proyek");
  revalidatePath(`/proyek/${proyek.id}`);
  revalidatePath("/data-induk/proyek");
}

export async function ubahTampilanProyekFormulir(proyekId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahTampilanProyek(proyekId, dataFormulir));
}
