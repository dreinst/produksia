import { db } from "@/lib/db";
import { penggunaSaatIni } from "@/lib/otentikasi";
import { BATAS_PERMINTAAN_UNGGAH, bacaFormulirTerbatas, bolehUnggahSesuatu, simpanBerkas } from "@/lib/berkas";

/*
 * Unggah satu berkas (D7 §3.3.9). Lewat route handler, bukan aksi server, karena badan sampai 25 MB sedangkan aksi
 * dibatasi 3 MB. Route handler tidak ikut pemeriksaan Origin bawaan aksi server, jadi asal permintaan diperiksa di sini.
 * Jalur /api/berkas dikeluarkan dari matcher src/proxy.ts supaya badan tidak disangga proxy sebelum rute berjalan:
 * sesi, asal, hak, dan Content-Length diperiksa lebih dulu, lalu badan dibaca dengan aliran yang dipotong di batas.
 */

const galat = (status: number, pesan: string) => Response.json({ ok: false, galat: pesan }, { status });

/** Asal halaman yang sah: proto dan host dari kepala proxy (bila ada), selain itu host permintaan. */
function asalSah(request: Request): string {
  const h = request.headers;
  const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0].trim();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  return `${proto}://${host}`;
}

export async function POST(request: Request) {
  try {
    const pengguna = await penggunaSaatIni();
    if (!pengguna) return galat(401, "Belum masuk");
    if (request.headers.get("origin") !== asalSah(request)) return galat(403, "Permintaan ditolak karena asal halaman tidak cocok");
    if (!bolehUnggahSesuatu(pengguna)) return galat(403, "Anda tidak punya hak mengunggah berkas");

    const panjang = request.headers.get("content-length");
    if (!panjang || !/^\d+$/.test(panjang)) return galat(411, "Ukuran unggahan tidak diketahui; muat ulang halaman lalu coba lagi");
    if (Number(panjang) > BATAS_PERMINTAAN_UNGGAH) return galat(413, "Ukuran berkas maksimal 25 MB");

    const fd = await bacaFormulirTerbatas(request, BATAS_PERMINTAAN_UNGGAH);
    if (fd === 413) return galat(413, "Ukuran berkas maksimal 25 MB");
    if (fd === 400) return galat(400, "Formulir unggah tidak valid");
    const isian = (k: string) => {
      const v = fd.get(k);
      return typeof v === "string" ? v : null;
    };
    const hasil = await simpanBerkas(db, pengguna, {
      berkas: fd.get("berkas"),
      folderKode: isian("folderKode"),
      jenisEntitas: isian("jenisEntitas"),
      entitasId: isian("entitasId"),
      tag: isian("tag"),
      proyekId: isian("proyekId"),
      dataFormulir: fd,
    });
    if (!hasil.ok) return galat(hasil.status, hasil.galat);
    const b = hasil.nilai;
    return Response.json(
      { ok: true, berkas: { id: b.id, namaBerkas: b.namaBerkas, ukuran: b.ukuran, tipeMime: b.tipeMime, folderKode: b.folderKode, dibuatPada: b.dibuatPada } },
      { status: 201 },
    );
  } catch (e) {
    console.error("[berkas]", e);
    return galat(500, "Terjadi kesalahan. Coba lagi.");
  }
}
