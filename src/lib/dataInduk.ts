import { db } from "@/lib/db";
import type { KonfigurasiEntitas } from "@/lib/konfigurasiDataInduk";
import type { DaftarOpsi } from "@/komponen/data-induk/FormulirDataInduk";

/*
 * Pembacaan data induk generik (dipakai halaman daftar & halaman ubah).
 * Delegasi Prisma dipilih dari nama model di konfigurasi entitas.
 */
type Rekaman = Record<string, unknown>;
type DelegasiBaca = {
  findMany: (args?: { where?: Rekaman; include?: Record<string, boolean>; orderBy?: Rekaman[]; skip?: number; take?: number }) => Promise<Rekaman[]>;
  findUnique: (args: { where: { id: string }; include?: Record<string, boolean> }) => Promise<Rekaman | null>;
  count: (args?: { where?: Rekaman }) => Promise<number>;
};

export function delegasiBaca(model: string): DelegasiBaca {
  return (db as unknown as Record<string, DelegasiBaca>)[model];
}

/** Relasi yang perlu di-include agar kolom "relasi.bidang" bisa ditampilkan. */
export function includeUntukKolom(config: KonfigurasiEntitas): Record<string, boolean> | undefined {
  const include: Record<string, boolean> = {};
  for (const kolom of config.kolom) {
    if (kolom.key.includes(".")) include[kolom.key.split(".")[0]] = true;
  }
  return Object.keys(include).length ? include : undefined;
}

/** Pilihan untuk setiap bidang select yang merujuk model lain. */
export async function ambilDaftarOpsi(config: KonfigurasiEntitas): Promise<DaftarOpsi> {
  const daftarOpsi: DaftarOpsi = {};
  for (const bidang of config.bidang) {
    if (!bidang.opsi) continue;
    const akun = bidang.opsi.model === "akun";
    const isian = await delegasiBaca(bidang.opsi.model).findMany({
      where: bidang.opsi.where,
      orderBy: [{ [akun ? "kode" : bidang.opsi.bidangLabel]: "asc" }],
    });
    daftarOpsi[bidang.nama] = isian.map((r) => ({
      id: String(r[bidang.opsi!.bidangNilai]),
      // akun ditampilkan "kode - nama" agar mudah dicari
      label: akun ? `${String(r.kode)} - ${String(r[bidang.opsi!.bidangLabel])}` : String(r[bidang.opsi!.bidangLabel]),
    }));
  }
  return daftarOpsi;
}

/** Klausa pencarian: cocokkan teks pada semua bidang teks entitas (kode, nama, alamat, …). */
export function wherePencarian(config: KonfigurasiEntitas, q: string): Rekaman | undefined {
  const teks = q.trim();
  if (!teks) return undefined;
  const bidangTeks = config.bidang.filter((b) => b.jenis === "text").map((b) => b.nama);
  return { OR: bidangTeks.map((nama) => ({ [nama]: { contains: teks, mode: "insensitive" } })) };
}
