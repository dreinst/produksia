import type { Prisma } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { punyaHak, type Hak, type PenggunaSesi } from "@/lib/hakAkses";
import { cariLead } from "@/lib/crm";
import { cariPemasaran } from "@/lib/pemasaran";
import { cariBerkas } from "@/lib/berkas";
import { daftarPerusahaan, saringPerusahaan } from "@/lib/perusahaan";
import { formatTanggal } from "@/lib/waktu";
import { loloskanWildcard, normalkanKataCari } from "@/lib/daftar";

/*
 * Pencarian global kelompok "Pekerjaan & Berkas" (D7 §3.6, §6.8, DESAIN G12, R1, H5). Kelompok lama di /cari tetap
 * lintas perusahaan; kelompok di sini mengikuti lingkup aktif (perusahaanId null = gabungan). Tiap kelompok hanya
 * dikueri bila pengguna memegang haknya, paling banyak 10 hasil, dan hanya untuk kata kunci minimal 2 karakter.
 * Tautan setiap hasil menuju halaman yang memang boleh dibuka pemegang hak kelompok itu.
 */

export const MIN_KATA_CARI = 2;
export const BATAS_CARI = 10;

export type HasilCari = {
  id: string;
  judul: string;
  sub?: string;
  href: string;
  /** perusahaan pemilik data, untuk lencana di lingkup gabungan */
  perusahaanId?: string;
  /** kelompok Perusahaan: benar bila perusahaan ini lingkup aktif sekarang */
  lingkupAktif?: boolean;
};

export type JenisKelompokCari = "proyek" | "dokumen-mitra" | "lead" | "konten" | "tugas-desain" | "kampanye" | "berkas" | "perusahaan";
export type KelompokCari = { jenis: JenisKelompokCari; label: string; hasil: HasilCari[] };

/**
 * Syarat nomor dokumen penjualan untuk /cari (D2 §8.3): nomor internal ATAU nomor cetak, tanpa beda huruf besar.
 * Dipakai penawaran, faktur, dan penerimaan. `%` dan `_` dicocokkan apa adanya (loloskanWildcard).
 */
export function syaratNomorDokumen(term: string): { OR: [{ nomor: Prisma.StringFilter }, { nomorCetak: Prisma.StringFilter }] } {
  const ci = { contains: loloskanWildcard(term), mode: "insensitive" as const };
  return { OR: [{ nomor: ci }, { nomorCetak: ci }] };
}

/**
 * Tautan hasil Proyek (HAK.md §7 no. 14): detail proyek bila proyek.lihat, selain itu LPJ bila rekonsiliasi.lihat,
 * selain itu daftar data induk proyek. null bila tidak memegang satu pun.
 */
export function tautanProyekCari(pengguna: Pick<PenggunaSesi, "hak">, id: string): string | null {
  if (pengguna.hak.includes("proyek.lihat")) return `/proyek/${id}`;
  if (pengguna.hak.includes("rekonsiliasi.lihat")) return `/rekonsiliasi/event/${id}`;
  if (pengguna.hak.includes("data-induk.lihat")) return "/data-induk/proyek";
  return null;
}

const ci = (term: string) => ({ contains: loloskanWildcard(term), mode: "insensitive" as const });

async function cariProyek(pengguna: PenggunaSesi, term: string, perusahaanId: string | null): Promise<HasilCari[] | null> {
  if (!tautanProyekCari(pengguna, "x")) return null;
  const baris = await db.proyek.findMany({
    where: { ...saringPerusahaan(perusahaanId), OR: [{ kode: ci(term) }, { nama: ci(term) }, { namaKlien: ci(term) }] },
    orderBy: [{ kode: "asc" }],
    take: BATAS_CARI,
    select: { id: true, kode: true, nama: true, namaKlien: true, status: true, perusahaanId: true, pelanggan: { select: { nama: true } } },
  });
  return baris.map((p) => ({
    id: p.id,
    judul: `${p.kode} · ${p.nama}`,
    sub: [p.pelanggan?.nama ?? p.namaKlien, p.status].filter(Boolean).join(" · "),
    href: tautanProyekCari(pengguna, p.id)!,
    perusahaanId: p.perusahaanId,
  }));
}

/** Talangan mitra dan pembayaran ke mitra menurut nomor, masing-masing hanya bagi pemegang hak lihatnya (P37). */
async function cariDokumenMitra(pengguna: PenggunaSesi, term: string, perusahaanId: string | null): Promise<HasilCari[] | null> {
  const talangan = punyaHak(pengguna, "talangan-mitra.lihat");
  const bayar = punyaHak(pengguna, "pembayaran-mitra.lihat");
  if (!talangan && !bayar) return null;
  const where = { ...saringPerusahaan(perusahaanId), nomor: ci(term) };
  const pilih = { id: true, nomor: true, tanggal: true, proyekId: true, perusahaanId: true, mitra: { select: { nama: true } }, proyek: { select: { kode: true } } } as const;
  const [t, b] = await Promise.all([
    talangan ? db.talanganMitra.findMany({ where, orderBy: [{ tanggal: "desc" }, { id: "asc" }], take: BATAS_CARI, select: pilih }) : [],
    bayar ? db.pembayaranMitra.findMany({ where, orderBy: [{ tanggal: "desc" }, { id: "asc" }], take: BATAS_CARI, select: pilih }) : [],
  ]);
  const hasil = [
    ...t.map((d) => ({ d, jenis: "Talangan mitra", href: `/proyek/${d.proyekId}/keuangan/talangan/${d.id}` })),
    ...b.map((d) => ({ d, jenis: "Pembayaran ke mitra", href: `/proyek/${d.proyekId}/keuangan/bayar/${d.id}` })),
  ].sort((x, y) => y.d.tanggal.getTime() - x.d.tanggal.getTime() || x.d.nomor.localeCompare(y.d.nomor));
  return hasil.slice(0, BATAS_CARI).map(({ d, jenis, href }) => ({
    id: d.id,
    judul: d.nomor,
    sub: `${jenis} · ${d.mitra.nama} · ${d.proyek.kode} · ${formatTanggal(d.tanggal)}`,
    href,
    perusahaanId: d.perusahaanId,
  }));
}

/**
 * Semua kelompok "Pekerjaan & Berkas" yang boleh dilihat pengguna, urut tetap: Proyek, Dokumen mitra, Lead, Konten,
 * Tugas desain, Kampanye, Berkas, Perusahaan. Kelompok tanpa hak tidak ikut; kelompok yang boleh tetapi kosong juga
 * tidak ikut. Kata kunci di bawah MIN_KATA_CARI karakter menghasilkan [].
 */
export async function cariPekerjaan(pengguna: PenggunaSesi, q: string, perusahaanId: string | null): Promise<KelompokCari[]> {
  const term = normalkanKataCari(q);
  if (term.length < MIN_KATA_CARI) return [];
  const boleh = (h: Hak) => punyaHak(pengguna, h);
  const { proyek, dokumenMitra, lead, pemasaran, berkas, perusahaan } = await Promise.all([
    cariProyek(pengguna, term, perusahaanId),
    cariDokumenMitra(pengguna, term, perusahaanId),
    boleh("lead.lihat") ? cariLead(db, term, perusahaanId) : Promise.resolve(null),
    cariPemasaran(db, term, pengguna, perusahaanId),
    boleh("berkas.lihat") ? cariBerkas(db, pengguna, term, perusahaanId) : Promise.resolve(null),
    daftarPerusahaan(),
  ]).then(([proyek, dokumenMitra, lead, pemasaran, berkas, perusahaan]) => ({ proyek, dokumenMitra, lead, pemasaran, berkas, perusahaan }));

  const kecil = term.toLowerCase();
  const kelompok: (KelompokCari | null)[] = [
    proyek && { jenis: "proyek", label: "Proyek", hasil: proyek },
    dokumenMitra && { jenis: "dokumen-mitra", label: "Dokumen mitra", hasil: dokumenMitra },
    lead && {
      jenis: "lead",
      label: "Lead",
      hasil: lead.map((l) => ({ id: l.id, judul: l.nama, sub: [l.namaUsaha, l.tahap.nama].filter(Boolean).join(" · "), href: `/crm/lead/${l.id}`, perusahaanId: l.perusahaanId })),
    },
    ...(
      [
        ["konten", "Konten", pemasaran.konten],
        ["tugas-desain", "Tugas desain", pemasaran.tugas],
        ["kampanye", "Kampanye", pemasaran.kampanye],
      ] as const
    ).map(([jenis, label, daftar]) =>
      daftar ? { jenis, label, hasil: daftar.map((h) => ({ id: h.id, judul: h.judul, sub: h.keterangan, href: h.tautan, perusahaanId: h.perusahaanId })) } : null,
    ),
    berkas && {
      jenis: "berkas",
      label: "Berkas",
      hasil: berkas.map((b) => ({ id: b.id, judul: b.namaBerkas, sub: `${b.folderKode} · ${formatTanggal(b.dibuatPada)}`, href: b.tautan, perusahaanId: b.perusahaanId })),
    },
    {
      jenis: "perusahaan",
      label: "Perusahaan",
      hasil: perusahaan
        .filter((p) => p.nama.toLowerCase().includes(kecil) || p.kode.toLowerCase().includes(kecil))
        .slice(0, BATAS_CARI)
        .map((p) => ({ id: p.id, judul: p.nama, sub: p.kode, href: "", lingkupAktif: p.id === perusahaanId })),
    },
  ];
  return kelompok.filter((k): k is KelompokCari => !!k && k.hasil.length > 0);
}
