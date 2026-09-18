export const BATAS_UKURAN_FOTO = 1_000_000;
export const MAKS_FOTO_PER_KIRIM = 3;

/** Jenis berkas dibaca dari magic bytes, bukan dari file.type yang bisa dipalsukan klien. */
function tipeGambar(isi: Uint8Array): string | null {
  const awal = (mulai: number, teks: string) => [...teks].every((c, i) => isi[mulai + i] === c.charCodeAt(0));
  if (isi.length >= 3 && isi[0] === 0xff && isi[1] === 0xd8 && isi[2] === 0xff) return "image/jpeg";
  if (isi.length >= 4 && isi[0] === 0x89 && awal(1, "PNG")) return "image/png";
  if (isi.length >= 12 && awal(0, "RIFF") && awal(8, "WEBP")) return "image/webp";
  return null;
}

/** Membaca foto dari input file multiple; entri kosong yang dikirim browser saat input kosong diabaikan. */
export async function bacaFotoDariFormulir(
  dataFormulir: FormData,
  nama: string,
  opsi: { maksimal?: number; wajib?: boolean } = {},
): Promise<{ tipe: string; ukuran: number; isi: Uint8Array<ArrayBuffer> }[]> {
  const maksimal = opsi.maksimal ?? MAKS_FOTO_PER_KIRIM;
  const berkas = dataFormulir.getAll(nama).filter((b): b is File => b instanceof File && (b.size > 0 || b.name !== ""));
  if (berkas.length === 0) {
    if (opsi.wajib) throw new Error("Foto wajib dilampirkan");
    return [];
  }
  if (berkas.length > maksimal) throw new Error(`Maksimal ${maksimal} foto per kirim`);
  const hasil = [];
  for (const b of berkas) {
    if (b.size > BATAS_UKURAN_FOTO) throw new Error(`Ukuran foto maksimal ${Math.round(BATAS_UKURAN_FOTO / 1000)} KB (${b.name || "foto"} ${Math.round(b.size / 1000)} KB)`);
    // Uint8Array<ArrayBuffer>, bukan Buffer: kolom Bytes Prisma 7 menolak Buffer<ArrayBufferLike>
    const isi = new Uint8Array(await b.arrayBuffer());
    const tipe = tipeGambar(isi);
    if (!tipe) throw new Error(`Format ${b.name || "foto"} tidak didukung (hanya JPEG, PNG, WebP)`);
    hasil.push({ tipe, ukuran: isi.length, isi });
  }
  return hasil;
}
