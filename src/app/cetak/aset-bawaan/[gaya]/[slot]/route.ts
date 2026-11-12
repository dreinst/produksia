import { redirect } from "next/navigation";
import { penggunaSaatIni } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { asetBawaan, folderGaya } from "@/lib/cetak/aset";
import type { GayaEntitas, JenisAsetKop } from "@/prisma-klien/enums";

/*
 * Pratinjau gambar bawaan repo per gaya entitas dan slot (D3 §6.3 butir 3) untuk halaman Kop & Template. Hak
 * pengaturan.tulis. Gaya dan slot dicocokkan dengan daftar putih; tidak ada path dari pengguna yang sampai ke sistem
 * berkas. Tanda tangan dan stempel tidak pernah punya gambar bawaan (404).
 */

export const runtime = "nodejs";

const GAYA: readonly GayaEntitas[] = ["DPRO", "TAPUSSA", "BONANOVA", "SAHARA", "NAWASENA"];
const SLOT: readonly JenisAsetKop[] = ["KOP", "KAKI", "WATERMARK", "LOGO", "JUDUL_INVOICE", "JUDUL_KWITANSI", "LABEL_PEMBAYARAN", "LABEL_SALAM", "TANDA_TANGAN", "STEMPEL"];

const teks = (status: number, pesan: string) => new Response(pesan, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ gaya: string; slot: string }> }) {
  const { gaya, slot } = await params;
  const pengguna = await penggunaSaatIni();
  if (!pengguna) {
    const url = new URL(request.url);
    redirect(`/masuk?kembali=${encodeURIComponent(url.pathname)}`);
  }
  if (!punyaHak(pengguna, "pengaturan.tulis")) return teks(403, "Anda tidak punya hak melihat gambar kop");
  const g = GAYA.find((x) => folderGaya(x) === gaya);
  const s = SLOT.find((x) => x === slot);
  const isi = g && s ? asetBawaan(g, s) : null;
  if (!isi) return teks(404, "Gambar bawaan tidak ditemukan");
  return new Response(Buffer.from(isi), { headers: { "Content-Type": "image/png", "Content-Length": String(isi.byteLength), "Cache-Control": "private, max-age=86400" } });
}
