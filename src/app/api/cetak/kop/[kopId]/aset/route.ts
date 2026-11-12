import { db } from "@/lib/db";
import { penggunaSaatIni } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { catatAktivitas } from "@/lib/log";
import { bacaFormulirTerbatas, buangSatuBerkas, simpanBerkas } from "@/lib/berkas";
import { LABEL_SLOT_ASET, periksaAsetKop } from "@/lib/cetak/kop";
import type { InfoGambar } from "@/lib/cetak/aset";
import type { JenisAsetKop } from "@/prisma-klien/enums";

/*
 * Unggah satu gambar kop (D3 §6.3 butir 4). Lewat route handler, bukan aksi server (K7), dengan pemeriksaan sesi, asal
 * permintaan (aturan POST /api/berkas, D7 §3.3.9), hak pengaturan.tulis, dan Content-Length sebelum badan dibaca.
 * Gambar diperiksa periksaAsetKop (2 MB, PNG/JPEG, dimensi dari kepala berkas, lalu periksaGambar sinkron) sebelum
 * disimpan, jadi gambar rusak ditolak tanpa mematikan proses. Berkas disimpan privat sebagai lampiran kop-surat milik
 * perusahaan kop; gambar lama slot itu dibuang ke Sampah di transaksi yang sama dengan baris AsetKopSurat baru.
 */

export const runtime = "nodejs";

/** Batas badan permintaan: gambar 2 MB ditambah kepala multipart. */
const BATAS_PERMINTAAN = 3 * 1024 * 1024;
const SLOT: readonly JenisAsetKop[] = ["KOP", "KAKI", "WATERMARK", "LOGO", "JUDUL_INVOICE", "JUDUL_KWITANSI", "LABEL_PEMBAYARAN", "LABEL_SALAM", "TANDA_TANGAN", "STEMPEL"];

const galat = (status: number, pesan: string) => Response.json({ ok: false, galat: pesan }, { status, headers: { "Cache-Control": "private, no-store" } });

/** Asal halaman yang sah: proto dan host dari kepala proxy (bila ada), selain itu host permintaan (sama dengan /api/berkas). */
function asalSah(request: Request): string {
  const h = request.headers;
  const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0].trim();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  return `${proto}://${host}`;
}

export async function POST(request: Request, { params }: { params: Promise<{ kopId: string }> }) {
  try {
    const { kopId } = await params;
    const pengguna = await penggunaSaatIni();
    if (!pengguna) return galat(401, "Belum masuk");
    if (request.headers.get("origin") !== asalSah(request)) return galat(403, "Permintaan ditolak karena asal halaman tidak cocok");
    if (!punyaHak(pengguna, "pengaturan.tulis")) return galat(403, "Anda tidak punya hak mengubah kop surat");

    const panjang = request.headers.get("content-length");
    if (!panjang || !/^\d+$/.test(panjang)) return galat(411, "Ukuran unggahan tidak diketahui; muat ulang halaman lalu coba lagi");
    if (Number(panjang) > BATAS_PERMINTAAN) return galat(413, "Ukuran gambar maksimal 2 MB");
    const fd = await bacaFormulirTerbatas(request, BATAS_PERMINTAAN);
    if (fd === 413) return galat(413, "Ukuran gambar maksimal 2 MB");
    if (fd === 400) return galat(400, "Formulir unggah tidak valid");

    const jenisMasukan = fd.get("jenis");
    const jenis = SLOT.find((s) => s === jenisMasukan);
    if (!jenis) return galat(400, "Jenis gambar tidak dikenal");
    const gambar = fd.get("gambar");
    if (!(gambar instanceof File) || (gambar.size === 0 && !gambar.name)) return galat(400, "Pilih satu gambar");
    const kop = await db.kopSurat.findUnique({ where: { id: kopId }, select: { id: true, nama: true, perusahaanId: true, dihapusPada: true } });
    if (!kop || kop.dihapusPada) return galat(404, "Kop surat tidak ditemukan");

    const isi = new Uint8Array(await gambar.arrayBuffer());
    let info: InfoGambar;
    try {
      info = periksaAsetKop(isi);
    } catch (e) {
      return galat(400, (e as Error).message);
    }

    // berkas dibuat dari salinan isi yang sudah diperiksa, jadi yang tersimpan persis yang lolos pemeriksaan
    const berkas = new File([Buffer.from(isi)], gambar.name || `${jenis.toLowerCase()}.${info.tipe === "image/png" ? "png" : "jpg"}`, { type: info.tipe });
    const simpan = await simpanBerkas(db, pengguna, { berkas, jenisEntitas: "kop-surat", entitasId: kop.id, folderKode: "KOP", tag: "REFERENSI" });
    if (!simpan.ok) return galat(simpan.status, simpan.galat);
    const berkasId = simpan.nilai.id;

    try {
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "KopSurat" WHERE "id" = ${kop.id} FOR NO KEY UPDATE`;
        const kini = await tx.kopSurat.findUnique({ where: { id: kop.id }, select: { dihapusPada: true } });
        if (!kini || kini.dihapusPada) throw new Error("Kop surat sudah dihapus");
        const lama = await tx.asetKopSurat.findUnique({ where: { kopSuratId_jenis: { kopSuratId: kop.id, jenis } } });
        if (lama) {
          await tx.asetKopSurat.delete({ where: { id: lama.id } });
          await buangSatuBerkas(tx, lama.berkasId, pengguna, { keterangan: `Gambar ${LABEL_SLOT_ASET[jenis]} kop ${kop.nama} diganti` });
        }
        await tx.asetKopSurat.create({ data: { kopSuratId: kop.id, jenis, berkasId, lebarPx: info.lebarPx, tinggiPx: info.tinggiPx } });
        await catatAktivitas(tx, pengguna, {
          aksi: "UBAH",
          jenis: "Kop Surat",
          nomor: kop.nama,
          keterangan: `Gambar ${LABEL_SLOT_ASET[jenis]} diunggah`,
          modul: "pengaturan",
          entitasId: kop.id,
          meta: { jenis, berkasId, lebarPx: info.lebarPx, tinggiPx: info.tinggiPx, berkasLama: lama?.berkasId ?? null },
          perusahaanId: kop.perusahaanId,
        });
      });
    } catch (e) {
      // kompensasi: berkas baru dibuang supaya tidak ada lampiran kop yatim
      await buangSatuBerkas(db, berkasId, pengguna, { keterangan: "Unggah gambar kop dibatalkan" }).catch((x) => console.error("[cetak aset] kompensasi gagal", x));
      if (e instanceof Error && e.message === "Kop surat sudah dihapus") return galat(404, "Kop surat tidak ditemukan");
      throw e;
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[cetak aset]", e);
    return galat(500, "Terjadi kesalahan. Coba lagi.");
  }
}
