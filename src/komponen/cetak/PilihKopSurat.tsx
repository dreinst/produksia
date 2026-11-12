import { db } from "@/lib/db";

/**
 * Pilihan kop surat untuk formulir dokumen penjualan (D3 §7.1): "Bawaan perusahaan" (nilai kosong) ditambah kop yang
 * belum dihapus milik perusahaan dokumen. Server tetap memeriksa isian lewat pastikanKopSuratDokumen (D2).
 */
export default async function PilihKopSurat({ perusahaanId, nilai, name = "kopSuratId", id = "kopSuratId" }: { perusahaanId: string; nilai?: string | null; name?: string; id?: string }) {
  const daftar = await db.kopSurat.findMany({ where: { perusahaanId, dihapusPada: null }, orderBy: [{ nama: "asc" }, { id: "asc" }], select: { id: true, nama: true, bawaan: true } });
  return (
    <select id={id} name={name} defaultValue={nilai ?? ""} className="isian">
      <option value="">Bawaan perusahaan</option>
      {daftar.map((k) => (
        <option key={k.id} value={k.id}>
          {k.nama}
          {k.bawaan ? " (bawaan)" : ""}
        </option>
      ))}
    </select>
  );
}
