import { db } from "@/lib/db";
import { penggunaSaatIni } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";

/** Isi foto barang / foto bukti peminjaman. Wajib masuk; hak mengikuti pemilik foto. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const pengguna = await penggunaSaatIni();
  if (!pengguna) return Response.json({ ok: false, galat: "Belum masuk" }, { status: 401 });

  const { id } = await params;
  const foto = await db.foto.findUnique({ where: { id }, select: { id: true, tipe: true, ukuran: true, isi: true, barangId: true, peminjamanId: true, kerusakanId: true, penggunaId: true } });
  if (!foto) return Response.json({ ok: false, galat: "Foto tidak ditemukan" }, { status: 404 });

  // Foto profil: siapa pun yang sudah masuk boleh melihat (dipakai avatar di daftar pengguna), tidak sensitif.
  if (!foto.penggunaId) {
    const hak = foto.barangId ? "persediaan.lihat" : foto.kerusakanId ? "kerusakan.lihat" : "peminjaman.lihat";
    if (!punyaHak(pengguna, hak)) return Response.json({ ok: false, galat: "Tidak berhak melihat foto ini" }, { status: 403 });
  }

  // Isi foto tidak pernah berubah (hapus = id hilang), jadi aman di-cache lama di peramban; private agar CDN tidak ikut menyimpan.
  const etag = `"${foto.id}"`;
  const kepala: Record<string, string> = { "Cache-Control": "private, max-age=31536000, immutable", ETag: etag };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: kepala });

  return new Response(new Uint8Array(foto.isi), {
    headers: { ...kepala, "Content-Type": foto.tipe, "Content-Length": String(foto.ukuran) },
  });
}
