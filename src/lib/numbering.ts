type NumberedDelegate = {
  findFirst: (args: {
    where: { no: { startsWith: string } };
    orderBy: { no: "desc" };
    select: { no: true };
  }) => Promise<{ no: string } | null>;
};

/**
 * Nomor dokumen berurutan per prefix per tahun, mis. PSJ-2026-0007.
 * Mengambil nomor terakhir yang ada (bukan count), jadi aman walau ada data yang pernah dihapus.
 * Catatan: masih ada celah race condition kalau dua user submit di milidetik yang sama —
 * unique constraint di kolom `no` akan menolak yang kedua, bukan diam-diam duplikat.
 */
export async function nextDocNumber(delegate: NumberedDelegate, prefix: string) {
  const base = `${prefix}-${new Date().getFullYear()}-`;
  const last = await delegate.findFirst({
    where: { no: { startsWith: base } },
    orderBy: { no: "desc" },
    select: { no: true },
  });
  const lastSeq = last ? parseInt(last.no.slice(base.length), 10) : 0;
  const seq = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
  return `${base}${String(seq).padStart(4, "0")}`;
}
