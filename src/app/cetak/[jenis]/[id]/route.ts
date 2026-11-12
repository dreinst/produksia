import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { penggunaSaatIni } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { catatAktivitas } from "@/lib/log";
import { JENIS_CETAK_KE_LAMPIRAN, JENIS_LAMPIRAN, kepalaDisposisi } from "@/lib/berkas";
import { HAK_CETAK_PENJUALAN, dataCetakPenjualan, dataCetakUntukPengguna, jenisCetakPenjualanSah } from "@/lib/dataCetakPenjualan";
import { GalatCetak, GalatIsiTerlaluTinggi, bacaOpsiCetak, renderPdfDokumenPenjualan } from "@/lib/cetak";
import { LABEL_UKURAN } from "@/lib/cetak/kop";

/*
 * PDF satu dokumen penjualan (D3 §6.3 butir 1). Di luar /api supaya pengguna tanpa cookie dialihkan proxy ke
 * /masuk?kembali=/cetak/... lalu kembali ke PDF sesudah masuk. Pratinjau dibuka di tab baru (navigasi tingkat atas),
 * jadi header keamanan global (X-Frame-Options DENY, frame-ancestors 'none') tetap berlaku tanpa dilonggarkan.
 * Log CETAK modul dokumen hanya untuk unduhan dan cetakan bertanda tangan.
 */

export const runtime = "nodejs";

const teks = (status: number, pesan: string) => new Response(pesan, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ jenis: string; id: string }> }) {
  const { jenis, id } = await params;
  const url = new URL(request.url);
  const pengguna = await penggunaSaatIni();
  if (!pengguna) redirect(`/masuk?kembali=${encodeURIComponent(url.pathname + url.search)}`);
  if (!jenisCetakPenjualanSah(jenis)) return teks(404, "Jenis dokumen tidak dikenal");
  if (!punyaHak(pengguna, HAK_CETAK_PENJUALAN[jenis])) return teks(403, "Anda tidak punya hak melihat dokumen ini");
  try {
    const opsi = bacaOpsiCetak(url.searchParams);
    const unduh = url.searchParams.get("unduh") === "1";
    const mentah = await dataCetakPenjualan(jenis, id);
    if (!mentah) return teks(404, "Dokumen tidak ditemukan");
    const data = dataCetakUntukPengguna(mentah, pengguna);
    const hasil = await renderPdfDokumenPenjualan(data, pengguna, opsi);
    if (unduh || hasil.tandaTangan) {
      try {
        await catatAktivitas(db, pengguna, {
          aksi: "CETAK",
          jenis: JENIS_LAMPIRAN[JENIS_CETAK_KE_LAMPIRAN[jenis]].label,
          nomor: data.nomorInternal,
          keterangan: `${unduh ? "Unduh PDF" : "Pratinjau PDF"} ${LABEL_UKURAN[hasil.ukuran]}${hasil.tandaTangan ? " bertanda tangan" : ""}`,
          modul: "dokumen",
          entitasId: id,
          meta: { ukuran: hasil.ukuran, kopSuratId: hasil.kopSuratId, tataLetak: hasil.tataLetak, tandaTangan: hasil.tandaTangan, unduh },
          perusahaanId: data.perusahaanId,
        });
      } catch (e) {
        console.error("[cetak] log gagal", e);
      }
    }
    return new Response(Buffer.from(hasil.isi), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": kepalaDisposisi(unduh ? "attachment" : "inline", hasil.namaBerkas),
        "Content-Length": String(hasil.isi.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof GalatCetak) return teks(e.status, e.message);
    if (e instanceof GalatIsiTerlaluTinggi) return teks(400, e.message);
    console.error("[cetak]", e);
    return teks(500, "PDF gagal dibuat. Coba lagi atau hubungi admin.");
  }
}
