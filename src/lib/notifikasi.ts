import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import type { JenisNotifikasi, PeranPengguna } from "@/prisma-klien/enums";
import { DAFTAR_PERAN, PERAN_TAMBAHAN_BOLEH, hitungHak, hitungHakPengguna, type Hak } from "@/lib/hakAkses";

/*
 * Notifikasi dalam aplikasi (D7 §3.4). Berkas ini TIDAK "use server" dan tidak mengimpor db: klien basis data
 * selalu dikirim pemanggil (db atau tx), jadi notifikasi ikut transaksi aksi pemicunya. Notifikasi milik penerima
 * dan lintas perusahaan; perusahaanId hanya dipakai untuk mengganti lingkup saat notifikasi dibuka.
 */

export type KlienDb = PrismaClient | Prisma.TransactionClient;

/** Id pengguna semu pintu uji; tidak pernah menjadi penerima. */
const ID_SKRIP_UJI = "skrip-uji";
export const PANJANG_JUDUL_NOTIFIKASI = 120;
export const PANJANG_ISI_NOTIFIKASI = 500;

export const LABEL_JENIS_NOTIFIKASI: Record<JenisNotifikasi, { label: string; cls: string }> = {
  PENUGASAN: { label: "Penugasan", cls: "lencana lencana-blue" },
  STATUS: { label: "Status", cls: "lencana lencana-slate" },
  PERSETUJUAN: { label: "Persetujuan", cls: "lencana lencana-amber" },
  HASIL_PERSETUJUAN: { label: "Hasil persetujuan", cls: "lencana lencana-emerald" },
  REVISI: { label: "Revisi", cls: "lencana lencana-amber" },
  TINDAK_LANJUT: { label: "Tindak lanjut", cls: "lencana lencana-indigo" },
  JATUH_TEMPO: { label: "Jatuh tempo", cls: "lencana lencana-rose" },
};

export type MasukanNotifikasi = {
  penggunaIds: readonly (string | null | undefined)[];
  judul: string;
  isi?: string | null;
  tautan?: string | null;
  jenis: JenisNotifikasi;
  /** Perusahaan data yang dirujuk; dipakai saat notifikasi dibuka untuk mengganti lingkup. */
  perusahaanId?: string | null;
  /** Id pelaku: tidak memberi tahu diri sendiri. */
  kecuali?: string | null;
  /** Pencegah ganda untuk pengingat otomatis (unik per penerima). */
  kunci?: string | null;
};

/**
 * Tautan hanya path internal ("/x", bukan "//x" atau URL luar); selain itu null. Garis miring terbalik dan karakter
 * kendali ditolak karena peramban mengubah "\" menjadi "/" dan membuang tab atau baris baru, sehingga "/\luar.contoh"
 * dan "/<TAB>/luar.contoh" terbuka sebagai URL luar. Basis data menjaga hal yang sama lewat CHECK
 * Notifikasi_tautan_tanpa_kendali.
 */
export function tautanInternal(tautan: string | null | undefined): string | null {
  const t = (tautan ?? "").trim();
  if (/[\\\x00-\x1f\x7f]/.test(t)) return null;
  return t.startsWith("/") && !t.startsWith("//") ? t : null;
}

/** Judul dipangkas dan dipotong ke 120 karakter (diakhiri "…"); kosong melempar galat pemrograman. */
export function rapikanJudulNotifikasi(judul: string): string {
  const j = judul.trim();
  if (!j) throw new Error("Judul notifikasi kosong");
  return j.length > PANJANG_JUDUL_NOTIFIKASI ? `${j.slice(0, PANJANG_JUDUL_NOTIFIKASI - 1)}…` : j;
}

/**
 * Menyimpan satu notifikasi per penerima. Penerima: tanpa null, "", "skrip-uji", pelaku (`kecuali`), dan duplikat,
 * lalu disaring ke pengguna yang ada dan aktif sehingga sisipan tidak pernah gagal FK. Kunci yang sama untuk
 * penerima yang sama tidak tersimpan dua kali. Mengembalikan jumlah baris yang tersimpan.
 */
export async function kirimNotifikasi(tx: KlienDb, m: MasukanNotifikasi): Promise<number> {
  const judul = rapikanJudulNotifikasi(m.judul);
  const calon = [...new Set(m.penggunaIds.filter((id): id is string => !!id && id !== ID_SKRIP_UJI && id !== m.kecuali))];
  if (calon.length === 0) return 0;
  const ada = await tx.pengguna.findMany({ where: { id: { in: calon }, aktif: true }, select: { id: true } });
  if (ada.length === 0) return 0;
  const isi = (m.isi ?? "").trim().slice(0, PANJANG_ISI_NOTIFIKASI) || null;
  const tautan = tautanInternal(m.tautan);
  const hasil = await tx.notifikasi.createMany({
    data: ada.map((p) => ({ penggunaId: p.id, judul, isi, tautan, jenis: m.jenis, perusahaanId: m.perusahaanId ?? null, kunci: m.kunci ?? null })),
    skipDuplicates: true,
  });
  return hasil.count;
}

export type PenerimaHak = { id: string; nama: string; peran: PeranPengguna; peranTambahan: PeranPengguna[] };

/**
 * Pengguna aktif yang memegang `hak`, termasuk lewat peran tambahan, urut nama. Penyesuaian Pengaturan › Hak Akses
 * ikut dihitung, dan hasil akhirnya disaring dengan hitungHakPengguna supaya sama persis dengan hak sesinya.
 * `tanpaSuperadmin` membuang peran utama SUPERADMIN, kecuali bila hasilnya jadi kosong.
 */
export async function penggunaDenganHak(klien: KlienDb, hak: Hak, opsi: { tanpaSuperadmin?: boolean } = {}): Promise<PenerimaHak[]> {
  const penyesuaian = await klien.hakAksesPeran.findMany({ select: { peran: true, hak: true, boleh: true } });
  const peranBerhak = DAFTAR_PERAN.filter((p) => hitungHak(p, penyesuaian.filter((x) => x.peran === p)).includes(hak));
  if (peranBerhak.length === 0) return [];
  const tambahanBerhak = peranBerhak.filter((p) => PERAN_TAMBAHAN_BOLEH.includes(p));
  const calon = await klien.pengguna.findMany({
    where: {
      aktif: true,
      OR: [{ peran: { in: peranBerhak } }, ...(tambahanBerhak.length > 0 ? [{ peranTambahan: { hasSome: tambahanBerhak } }] : [])],
    },
    select: { id: true, nama: true, peran: true, peranTambahan: true },
    orderBy: { nama: "asc" },
  });
  const berhak = calon.filter((p) => hitungHakPengguna(p.peran, p.peranTambahan, penyesuaian).includes(hak));
  return opsi.tanpaSuperadmin ? tanpaSuperadminKecualiKosong(berhak) : berhak;
}

/** Membuang peran utama SUPERADMIN (meniru HKA), kecuali bila hasilnya jadi kosong: penerima tidak pernah nol. */
export function tanpaSuperadminKecualiKosong<T extends { peran: PeranPengguna }>(daftar: T[]): T[] {
  const tanpa = daftar.filter((p) => p.peran !== "SUPERADMIN");
  return tanpa.length > 0 ? tanpa : daftar;
}

export type ButirNotifikasi = {
  id: string;
  judul: string;
  isi: string | null;
  tautan: string | null;
  jenis: JenisNotifikasi;
  dibaca: boolean;
  dibuatPada: Date;
  perusahaan: { id: string; nama: string } | null;
};

const PILIH_BUTIR = {
  id: true, judul: true, isi: true, tautan: true, jenis: true, dibaca: true, dibuatPada: true,
  perusahaan: { select: { id: true, nama: true } },
} as const;

/** Jumlah belum dibaca dan `batas` notifikasi terbaru milik pengguna (lintas perusahaan). */
export async function ringkasNotifikasi(klien: KlienDb, penggunaId: string, batas: number): Promise<{ belumDibaca: number; terbaru: ButirNotifikasi[] }> {
  if (!penggunaId || penggunaId === ID_SKRIP_UJI) return { belumDibaca: 0, terbaru: [] };
  const [belumDibaca, terbaru] = await Promise.all([
    klien.notifikasi.count({ where: { penggunaId, dibaca: false } }),
    klien.notifikasi.findMany({ where: { penggunaId }, select: PILIH_BUTIR, orderBy: [{ dibuatPada: "desc" }, { id: "desc" }], take: batas }),
  ]);
  return { belumDibaca, terbaru };
}

/** Saringan halaman /notifikasi: milik pengguna, opsional belum dibaca saja dan kata kunci judul/isi. */
export function syaratDaftarNotifikasi(penggunaId: string, opsi: { belum?: boolean; q?: string }): Prisma.NotifikasiWhereInput {
  const q = (opsi.q ?? "").trim();
  return {
    penggunaId,
    ...(opsi.belum ? { dibaca: false } : {}),
    ...(q ? { OR: [{ judul: { contains: q, mode: "insensitive" as const } }, { isi: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
}

/**
 * Menandai satu notifikasi milik pengguna dibaca dan mengembalikan tautan serta perusahaannya.
 * Notifikasi milik orang lain atau yang tidak ada → null (tanpa galat). Dipakai aksi bukaNotifikasi.
 */
export async function tandaiDibuka(klien: KlienDb, penggunaId: string, id: string, sekarang = new Date()): Promise<{ tautan: string | null; perusahaanId: string | null } | null> {
  const n = await klien.notifikasi.findFirst({ where: { id, penggunaId }, select: { tautan: true, perusahaanId: true, dibaca: true } });
  if (!n) return null;
  if (!n.dibaca) await klien.notifikasi.updateMany({ where: { id, penggunaId, dibaca: false }, data: { dibaca: true, dibacaPada: sekarang } });
  return { tautan: tautanInternal(n.tautan), perusahaanId: n.perusahaanId };
}
