"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { wajibHakAksi } from "@/lib/otentikasi";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { pastikanTahunTerbuka } from "@/lib/tutupBuku";
import {
  BERKAS,
  catatLogPersetujuan,
  dataAjukan,
  dataSetujui,
  dataTolak,
  hakAjukan,
  hakSetujui,
  pastikanBukanPengaju,
  pastikanTransisi,
  type JenisPersetujuan,
} from "@/lib/persetujuan";

/*
 * Aksi server alur persetujuan, satu berkas untuk semua jenis dokumen (pola yang sama dengan
 * src/lib/aksi/hapusDokumen.ts). Perbedaan tiap jenis dokumen ada di BERKAS di src/lib/persetujuan.ts,
 * jadi logika transisi, pemisahan tugas, dan log aktivitas hanya ditulis sekali.
 */

async function segarkan(jenis: JenisPersetujuan) {
  for (const jalur of BERKAS[jenis].jalur) revalidatePath(jalur);
  revalidatePath("/persetujuan");
  revalidatePath("/");
}

/** Mengajukan dokumen draf ke pemeriksa: DRAFT/DITOLAK → MENUNGGU. Belum ada jurnal pada tahap ini. */
export async function ajukanDokumen(jenis: JenisPersetujuan, id: string) {
  const berkas = BERKAS[jenis];
  const pengguna = await wajibHakAksi(await hakAjukan(jenis, db, id));

  await db.$transaction(async (tx) => {
    const dok = await berkas.baca(tx, id);
    if (!dok) throw new Error(`${berkas.label} tidak ditemukan (mungkin sudah dihapus)`);
    pastikanTransisi(dok, "MENUNGGU", berkas.label);
    await berkas.simpan(tx, id, dataAjukan(pengguna));
    const rinci = berkas.ringkas ? await berkas.ringkas(tx, id) : "";
    await catatLogPersetujuan(tx, pengguna, "AJUKAN", berkas.label, dok.nomor, `Diajukan untuk persetujuan${rinci ? `; ${rinci}` : ""}`);
  });

  await segarkan(jenis);
}

/**
 * Menyetujui dokumen: MENUNGGU → DISETUJUI, dan jurnalnya dicatat SEKARANG, di dalam transaksi yang sama.
 * Dua penjaga sebelum posting: pemisahan tugas (bukan pengaju sendiri) dan tahun buku dokumen masih terbuka.
 */
export async function setujuiDokumen(jenis: JenisPersetujuan, id: string) {
  const berkas = BERKAS[jenis];
  const pengguna = await wajibHakAksi(await hakSetujui(jenis, db, id));

  await db.$transaction(async (tx) => {
    const dok = await berkas.baca(tx, id);
    if (!dok) throw new Error(`${berkas.label} tidak ditemukan (mungkin sudah dihapus)`);
    pastikanTransisi(dok, "DISETUJUI", berkas.label);
    pastikanBukanPengaju(dok, pengguna, berkas.label);
    if (berkas.pastikanBolehSetujui) await berkas.pastikanBolehSetujui(tx, id, pengguna);
    // Dokumen bertanggal tahun yang sudah ditutup tidak boleh dibukukan; menolaknya tetap boleh (pembersihan)
    await pastikanTahunTerbuka(tx, dok.tanggal);
    await berkas.posting(tx, id);
    await berkas.simpan(tx, id, dataSetujui(pengguna));
    const rinci = berkas.ringkas ? await berkas.ringkas(tx, id) : "";
    await catatLogPersetujuan(tx, pengguna, "SETUJUI", berkas.label, dok.nomor, `Disetujui, jurnal dicatat${rinci ? `; ${rinci}` : ""}`);
  });

  await segarkan(jenis);
}

/** Menolak dokumen dengan alasan: DRAFT/MENUNGGU → DITOLAK. Tidak ada jurnal yang dibuat maupun dibalik. */
export async function tolakDokumen(jenis: JenisPersetujuan, id: string, catatan: string) {
  const berkas = BERKAS[jenis];
  const pengguna = await wajibHakAksi(await hakSetujui(jenis, db, id));
  const alasan = catatan.trim();
  if (!alasan) throw new Error("Alasan penolakan wajib diisi supaya pembuat dokumen tahu apa yang harus diperbaiki");
  if (alasan.length > 500) throw new Error("Alasan penolakan maksimal 500 karakter");

  await db.$transaction(async (tx) => {
    const dok = await berkas.baca(tx, id);
    if (!dok) throw new Error(`${berkas.label} tidak ditemukan (mungkin sudah dihapus)`);
    pastikanTransisi(dok, "DITOLAK", berkas.label);
    pastikanBukanPengaju(dok, pengguna, berkas.label);
    await berkas.simpan(tx, id, dataTolak(pengguna, alasan));
    await catatLogPersetujuan(tx, pengguna, "TOLAK", berkas.label, dok.nomor, `Ditolak: ${alasan}`);
  });

  await segarkan(jenis);
}

// ---------- Varian untuk <FormulirAksi> (mengembalikan pesan galat, bukan throw) ----------
// Dipakai lewat .bind(null, jenis, id); argumen (statusSebelumnya, dataFormulir) dari useActionState diabaikan

export async function ajukanDokumenFormulir(jenis: JenisPersetujuan, id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => ajukanDokumen(jenis, id));
}

export async function setujuiDokumenFormulir(jenis: JenisPersetujuan, id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => setujuiDokumen(jenis, id));
}

export async function tolakDokumenFormulir(
  jenis: JenisPersetujuan,
  id: string,
  _sebelumnya: StatusFormulir,
  dataFormulir: FormData,
): Promise<StatusFormulir> {
  return jalankanFormulir(() => tolakDokumen(jenis, id, String(dataFormulir.get("catatanPenolakan") ?? "")));
}
