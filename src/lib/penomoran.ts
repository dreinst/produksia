type DelegasiBernomor = {
  findFirst: (args: {
    where: { nomor: { startsWith: string } };
    orderBy: { nomor: "desc" };
    select: { nomor: true };
  }) => Promise<{ nomor: string } | null>;
};

/**
 * Nomor dokumen berurutan per prefix per tahun, mis. PSJ-2026-0007.
 * Mengambil nomor terakhir yang ada (bukan count), jadi aman walau ada data yang pernah dihapus.
 * Catatan: masih ada celah race condition kalau dua user submit di milidetik yang sama -
 * unique constraint di kolom `nomor` akan menolak yang kedua, bukan diam-diam duplikat.
 */
export async function nomorDokumenBerikutnya(delegasi: DelegasiBernomor, prefix: string) {
  const base = `${prefix}-${new Date().getFullYear()}-`;
  const terakhir = await delegasi.findFirst({
    where: { nomor: { startsWith: base } },
    orderBy: { nomor: "desc" },
    select: { nomor: true },
  });
  const lastSeq = terakhir ? parseInt(terakhir.nomor.slice(base.length), 10) : 0;
  const seq = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
  return `${base}${String(seq).padStart(4, "0")}`;
}
