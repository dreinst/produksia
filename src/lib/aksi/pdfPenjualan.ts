"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { wajibHakAksi, wajibMasukAksi } from "@/lib/otentikasi";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { HAK_CETAK_PENJUALAN, jenisCetakPenjualanSah, type JenisCetakPenjualan } from "@/lib/dataCetakPenjualan";
import { simpanPdfDokumenPenjualan } from "@/lib/pdf/dokumenPenjualan";

/*
 * Aksi "Simpan PDF ke Lampiran" dokumen penjualan (D2 §6.2, DESAIN F4). Isian formulir sama dengan rute cetak GET:
 * `kop`, `ukuran`, `ttd`, `tampilan`. Tanpa redirect: FormulirCetak menampilkan pesanSukses dan LampiranBerkas di
 * halaman detail memuat PDF baru sesudah revalidasi.
 */

const HALAMAN: Record<JenisCetakPenjualan, string> = {
  penawaran: "/penjualan/penawaran/[id]",
  faktur: "/penjualan/faktur/[id]",
  kwitansi: "/penjualan/penerimaan/[id]",
  "kwitansi-dp": "/penjualan/uang-muka/[id]",
  "tagihan-termin": "/penjualan/pesanan/[id]",
};

export async function simpanPdfDokumen(jenis: string, id: string, dataFormulir: FormData): Promise<void> {
  if (!jenisCetakPenjualanSah(jenis)) {
    await wajibMasukAksi();
    throw new Error("Jenis dokumen tidak dikenal");
  }
  const pengguna = await wajibHakAksi(HAK_CETAK_PENJUALAN[jenis]);
  await simpanPdfDokumenPenjualan(db, pengguna, jenis, id, dataFormulir);
  revalidatePath(HALAMAN[jenis], "page");
  revalidatePath("/berkas");
}

export async function simpanPdfDokumenFormulir(jenis: string, id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData): Promise<StatusFormulir> {
  return jalankanFormulir(() => simpanPdfDokumen(jenis, id, dataFormulir));
}
