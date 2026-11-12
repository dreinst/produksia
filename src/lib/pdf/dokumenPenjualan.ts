import type { PrismaClient } from "@/prisma-klien/client";
import type { PenggunaSesi } from "@/lib/hakAkses";
import { pastikanHak } from "@/lib/otentikasi";
import { JENIS_CETAK_KE_LAMPIRAN, JENIS_LAMPIRAN, simpanBerkas, type MetaBerkas } from "@/lib/berkas";
import { catatAktivitas } from "@/lib/log";
import { HAK_CETAK_PENJUALAN, dataCetakPenjualan, dataCetakUntukPengguna, jenisCetakPenjualanSah } from "@/lib/dataCetakPenjualan";
import { GalatCetak, GalatIsiTerlaluTinggi, bacaOpsiCetak, renderPdfDokumenPenjualan, type HasilPdf } from "@/lib/cetak";
import { LABEL_UKURAN } from "@/lib/cetak/kop";

/*
 * Inti "Simpan PDF ke Lampiran" dokumen penjualan (D2 §6.2 baris simpanPdfDokumen, D3 §6.2). Server saja, bukan
 * "use server": aksi src/lib/aksi/pdfPenjualan.ts memanggilnya sesudah wajibHakAksi, dan uji bisa memanggilnya dengan
 * pengguna buatan. Urutan sama dengan rute GET /cetak/[jenis]/[id]: hak lihat dokumen, opsi dari formulir,
 * dataCetakPenjualan, dataCetakUntukPengguna, renderPdfDokumenPenjualan. Hak unggah dan pembatasan folder diperiksa
 * simpanBerkas (hak lampiran jenis dokumen atau berkas.buat).
 */

/** PDF tersimpan sebagai lampiran dokumennya (tag DOKUMEN, nama = nama unduhan rute GET). Versi lama tetap sebagai riwayat. */
export async function simpanPdfDokumenPenjualan(klien: PrismaClient, pengguna: PenggunaSesi, jenis: string, id: string, dataFormulir: FormData): Promise<MetaBerkas> {
  if (!jenisCetakPenjualanSah(jenis)) throw new Error("Jenis dokumen tidak dikenal");
  pastikanHak(pengguna, HAK_CETAK_PENJUALAN[jenis]);
  const idDokumen = String(id ?? "");
  let hasil: HasilPdf;
  let perusahaanId: string;
  let nomorInternal: string;
  try {
    const opsi = bacaOpsiCetak(dataFormulir);
    const mentah = await dataCetakPenjualan(jenis, idDokumen, klien);
    if (!mentah) throw new Error("Dokumen tidak ditemukan");
    const data = dataCetakUntukPengguna(mentah, pengguna);
    ({ perusahaanId, nomorInternal } = data);
    hasil = await renderPdfDokumenPenjualan(data, pengguna, opsi);
  } catch (e) {
    // pesan GalatCetak dan GalatIsiTerlaluTinggi aman ditampilkan; subkelas Error disamarkan jalankanFormulir
    if (e instanceof GalatCetak || e instanceof GalatIsiTerlaluTinggi) throw new Error(e.message);
    throw e;
  }
  const jenisEntitas = JENIS_CETAK_KE_LAMPIRAN[jenis];
  return klien.$transaction(
    async (tx) => {
      const simpan = await simpanBerkas(tx, pengguna, {
        berkas: new File([Buffer.from(hasil.isi)], hasil.namaBerkas, { type: "application/pdf" }),
        jenisEntitas,
        entitasId: idDokumen,
        tag: "DOKUMEN",
      });
      if (!simpan.ok) throw new Error(simpan.galat);
      // cetakan bertanda tangan selalu dicatat (D3 §6.3 langkah 7), sama dengan rute GET
      if (hasil.tandaTangan)
        await catatAktivitas(tx, pengguna, {
          aksi: "CETAK",
          jenis: JENIS_LAMPIRAN[jenisEntitas].label,
          nomor: nomorInternal,
          keterangan: `Simpan PDF ${LABEL_UKURAN[hasil.ukuran]} bertanda tangan ke lampiran`,
          modul: "dokumen",
          entitasId: idDokumen,
          meta: { ukuran: hasil.ukuran, kopSuratId: hasil.kopSuratId, tataLetak: hasil.tataLetak, tandaTangan: true, disimpanKeBerkas: true, berkasId: simpan.nilai.id },
          perusahaanId,
        });
      return simpan.nilai;
    },
    { timeout: 60_000 },
  );
}
