import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { penggunaSaatIni } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { catatAktivitas } from "@/lib/log";
import { kepalaDisposisi } from "@/lib/berkas";
import { GalatIsiTerlaluTinggi } from "@/lib/cetak";
import { buatPdfLaporanKeuanganProyek, dataLaporanKeuanganProyek, namaBerkasLaporanKeuangan } from "@/lib/pdf/laporanKeuanganProyek";

/*
 * PDF laporan keuangan satu proyek (D5 §6.4). Di luar /api, jadi pengguna tanpa cookie dialihkan proxy ke
 * /masuk?kembali=... Pratinjau dibuka di tab baru (inline) tanpa log; ?unduh=1 menjadi attachment dan dicatat CETAK
 * modul anggaran-proyek. Header keamanan global tidak dilonggarkan. Bagian bagi hasil hanya untuk bagi-hasil.lihat
 * (diatur dataLaporanKeuanganProyek).
 */

export const runtime = "nodejs";

const teks = (status: number, pesan: string) => new Response(pesan, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const pengguna = await penggunaSaatIni();
  if (!pengguna) redirect(`/masuk?kembali=${encodeURIComponent(url.pathname + url.search)}`);
  if (!punyaHak(pengguna, "anggaran-proyek.lihat")) return teks(403, "Anda tidak punya hak melihat keuangan proyek ini");
  try {
    const data = await dataLaporanKeuanganProyek(db, id, pengguna);
    if (!data) return teks(404, "Proyek tidak ditemukan");
    const isi = await buatPdfLaporanKeuanganProyek(data);
    const unduh = url.searchParams.get("unduh") === "1";
    if (unduh) {
      try {
        await catatAktivitas(db, pengguna, {
          aksi: "CETAK",
          jenis: "Laporan Keuangan Proyek",
          nomor: data.proyek.kode,
          keterangan: "Unduh PDF",
          modul: "anggaran-proyek",
          entitasId: data.proyek.id,
          perusahaanId: data.proyek.perusahaan.id,
        });
      } catch (e) {
        console.error("[cetak] log gagal", e);
      }
    }
    return new Response(Buffer.from(isi), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": kepalaDisposisi(unduh ? "attachment" : "inline", namaBerkasLaporanKeuangan(data.proyek)),
        "Content-Length": String(isi.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof GalatIsiTerlaluTinggi) return teks(400, e.message);
    console.error("[cetak]", e);
    return teks(500, "PDF gagal dibuat. Coba lagi atau hubungi admin.");
  }
}
