import type { PrismaClient } from "@/prisma-klien/client";
import type { PenggunaSesi } from "@/lib/hakAkses";
import { pastikanHak } from "@/lib/otentikasi";
import { JENIS_CETAK_KE_LAMPIRAN, JENIS_LAMPIRAN, simpanBerkas, type MetaBerkas } from "@/lib/berkas";
import { HAK_CETAK_PENJUALAN, dataCetakPenjualan, dataCetakUntukPengguna, jenisCetakPenjualanSah, type JenisCetakPenjualan } from "@/lib/dataCetakPenjualan";
import { GalatCetak, GalatIsiTerlaluTinggi, bacaOpsiCetak, renderPdfDokumenPenjualan, type HasilPdf, type OpsiCetak, type Perekam } from "@/lib/cetak";

/*
 * Inti "Simpan PDF ke Lampiran" dokumen penjualan (D2 §6.2 baris simpanPdfDokumen, D3 §6.2). Server saja, bukan
 * "use server": aksi src/lib/aksi/pdfPenjualan.ts memanggilnya sesudah wajibHakAksi, dan uji bisa memanggilnya dengan
 * pengguna buatan. Urutan sama dengan rute GET /cetak/[jenis]/[id]: hak lihat dokumen, opsi dari formulir,
 * dataCetakPenjualan, dataCetakUntukPengguna, renderPdfDokumenPenjualan. Hak unggah dan pembatasan folder diperiksa
 * simpanBerkas (hak lampiran jenis dokumen atau berkas.buat).
 *
 * Berkas tersimpan dibaca siapa pun yang memegang hak lihat lampiran jenisnya, jadi isinya mengikuti pembaca paling
 * sempit, bukan penyimpan (perbaikan tinjauan P45):
 * - T1: PDF lampiran SELALU tanpa tanda tangan dan stempel gambar, apa pun isian formulirnya. PDF bertanda tangan hanya
 *   bisa diunduh langsung lewat rute GET oleh pemegang tanda-tangan-cetak.buat.
 * - T3: data disaring dataCetakUntukPengguna untuk pengguna sintetis yang hanya memegang hak lihat registri lampiran
 *   jenis itu (pembacaMinimum), mis. kwitansi tanpa baris faktur, tagihan termin tanpa angka bayar.
 */

/** Pengguna sintetis dengan hak minimum pembaca lampiran jenis cetak itu (hak lihat registri JENIS_LAMPIRAN). */
export function pembacaMinimumLampiran(pengguna: PenggunaSesi, jenis: JenisCetakPenjualan): PenggunaSesi {
  return { ...pengguna, hak: [JENIS_LAMPIRAN[JENIS_CETAK_KE_LAMPIRAN[jenis]].hakLihat] };
}

/** PDF tersimpan sebagai lampiran dokumennya (tag DOKUMEN, nama = nama unduhan rute GET). Versi lama tetap sebagai riwayat. */
/** `opsi.perekam` hanya untuk uji: merekam teks dan gambar PDF yang disimpan. */
export async function simpanPdfDokumenPenjualan(klien: PrismaClient, pengguna: PenggunaSesi, jenis: string, id: string, dataFormulir: FormData, opsiUji: { perekam?: Perekam } = {}): Promise<MetaBerkas> {
  if (!jenisCetakPenjualanSah(jenis)) throw new Error("Jenis dokumen tidak dikenal");
  pastikanHak(pengguna, HAK_CETAK_PENJUALAN[jenis]);
  const idDokumen = String(id ?? "");
  let opsi: OpsiCetak;
  try {
    opsi = bacaOpsiCetak(dataFormulir);
  } catch (e) {
    if (e instanceof GalatCetak) throw new Error(e.message);
    throw e;
  }
  const mentah = await dataCetakPenjualan(jenis, idDokumen, klien);
  if (!mentah) throw new Error("Dokumen tidak ditemukan");
  const data = dataCetakUntukPengguna(mentah, pembacaMinimumLampiran(pengguna, jenis));
  let hasil: HasilPdf;
  try {
    hasil = await renderPdfDokumenPenjualan(data, pengguna, { ...opsi, ttd: false }, { perekam: opsiUji.perekam });
  } catch (e) {
    // pesan GalatCetak dan GalatIsiTerlaluTinggi aman ditampilkan; galat render lain hanya dicatat (tinjauan P45 R2)
    if (e instanceof GalatCetak || e instanceof GalatIsiTerlaluTinggi) throw new Error(e.message);
    console.error("[cetak] simpan PDF dokumen penjualan", e);
    throw new Error("PDF gagal dibuat. Coba lagi atau hubungi admin.");
  }
  return klien.$transaction(
    async (tx) => {
      const simpan = await simpanBerkas(tx, pengguna, {
        berkas: new File([Buffer.from(hasil.isi)], hasil.namaBerkas, { type: "application/pdf" }),
        jenisEntitas: JENIS_CETAK_KE_LAMPIRAN[jenis],
        entitasId: idDokumen,
        tag: "DOKUMEN",
      });
      if (!simpan.ok) throw new Error(simpan.galat);
      return simpan.nilai;
    },
    { timeout: 60_000 },
  );
}
