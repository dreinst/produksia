import { cache } from "react";
import { db } from "@/lib/db";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { diLuarPermintaan, penggunaSaatIni, pastikanHak, sesiSaatIni, wajibMasukAksi } from "@/lib/otentikasi";
import type { Prisma, PrismaClient } from "@/prisma-klien/client";

/*
 * Dimensi perusahaan (D1 §3.1-§3.2). Berkas ini TIDAK "use server": boleh diimpor halaman, aksi, dan
 * pustaka lain, tapi tidak oleh komponen klien karena memakai db. Komponen klien cukup mengimpor tipenya.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export const PERUSAHAAN_UTAMA = "utama";
/** id enam perusahaan standar D'Pro (dibuat migrasi, tidak dihapus prisma/reset.ts) */
export const ID_PERUSAHAAN_STANDAR = ["utama", "tapussa", "smara", "bonanova", "sahara", "nawasena"] as const;
/** Nilai opsi "Bersama (semua perusahaan)" di formulir data induk Barang; dipetakan ke null oleh bacaData */
export const NILAI_BERSAMA = "__bersama";
/** Nilai isian pemilih lingkup untuk "Semua perusahaan (gabungan)"; disimpan sebagai null di Sesi */
export const NILAI_GABUNGAN = "semua";

export type RingkasPerusahaan = { id: string; kode: string; nama: string; warna: string | null; aktif: boolean; urutan: number };
export type Lingkup = { perusahaanId: string | null; perusahaan: RingkasPerusahaan | null; bolehGabungan: boolean };

const PILIH_RINGKAS = { id: true, kode: true, nama: true, warna: true, aktif: true, urutan: true } as const;

/** Daftar perusahaan urut (urutan, nama). Bawaan hanya yang aktif. React cache per permintaan. */
export const daftarPerusahaan = cache(async (termasukNonaktif = false, klien: Klien = db): Promise<RingkasPerusahaan[]> => {
  return klien.perusahaan.findMany({
    where: termasukNonaktif ? {} : { aktif: true },
    select: PILIH_RINGKAS,
    orderBy: [{ urutan: "asc" }, { nama: "asc" }],
  });
});

/** Fungsi murni penentu lingkup; diuji langsung oleh skrip/uji-lingkup-perusahaan.ts. null = gabungan. */
export function tentukanLingkup(masukan: { pilihan: string | null; bolehGabungan: boolean; adaIds: ReadonlySet<string> }): string | null {
  const { pilihan, bolehGabungan, adaIds } = masukan;
  if (pilihan && adaIds.has(pilihan)) return pilihan;
  if (bolehGabungan) return null;
  if (adaIds.has(PERUSAHAAN_UTAMA) || adaIds.size === 0) return PERUSAHAAN_UTAMA;
  return adaIds.values().next().value ?? PERUSAHAAN_UTAMA;
}

/** Pilihan lingkup di luar permintaan HTTP (skrip uji, seed, skrip produksi). UJI_PERUSAHAAN dibaca saat dipanggil. */
function pilihanDiLuarPermintaan(): string | null {
  const gerbangUji = process.env.NODE_ENV !== "production" && process.env.UJI_TANPA_SESI === "1";
  if (!gerbangUji) return PERUSAHAAN_UTAMA;
  const nilai = process.env.UJI_PERUSAHAAN?.trim();
  if (!nilai) return PERUSAHAAN_UTAMA;
  return nilai === NILAI_GABUNGAN ? null : nilai;
}

/** Lingkup aktif permintaan ini (null = gabungan). Lihat D1 §3.2. React cache per permintaan. */
export const lingkupPerusahaan = cache(async (): Promise<Lingkup> => {
  const [pengguna, luar, daftar] = await Promise.all([penggunaSaatIni(), diLuarPermintaan(), daftarPerusahaan(true)]);
  const bolehGabungan = !!pengguna && punyaHak(pengguna, "perusahaan-gabungan.lihat");
  const pilihan = luar ? pilihanDiLuarPermintaan() : ((await sesiSaatIni())?.perusahaanAktifId ?? null);
  // perusahaan nonaktif tetap boleh menjadi lingkup (melihat pembukuan arsip), D1 §3.2 butir 6
  const perusahaanId = tentukanLingkup({ pilihan, bolehGabungan, adaIds: new Set(daftar.map((p) => p.id)) });
  const perusahaan = perusahaanId ? (daftar.find((p) => p.id === perusahaanId) ?? null) : null;
  return { perusahaanId, perusahaan, bolehGabungan };
});

/**
 * Menyimpan pilihan lingkup ke baris Sesi. Dipanggil aksi gantiPerusahaanAktif (setelah sesi terbukti ada)
 * dan langsung oleh skrip uji. "semua" butuh hak perusahaan-gabungan.lihat dan disimpan sebagai null;
 * id lain harus perusahaan yang ada dan aktif.
 */
export async function simpanLingkupSesi(klien: Klien, sesiId: string, pilihan: string, pengguna: PenggunaSesi): Promise<string | null> {
  const nilai = pilihan.trim();
  if (!nilai) throw new Error("Pilih perusahaan atau Semua perusahaan");
  let perusahaanAktifId: string | null;
  if (nilai === NILAI_GABUNGAN) {
    pastikanHak(pengguna, "perusahaan-gabungan.lihat");
    perusahaanAktifId = null;
  } else {
    const p = await klien.perusahaan.findUnique({ where: { id: nilai }, select: { id: true, nama: true, aktif: true } });
    if (!p) throw new Error("Perusahaan tidak ditemukan");
    if (!p.aktif) throw new Error(`Perusahaan ${p.nama} sudah diarsipkan; pilih perusahaan yang aktif`);
    perusahaanAktifId = p.id;
  }
  await klien.sesi.update({ where: { id: sesiId }, data: { perusahaanAktifId } });
  return perusahaanAktifId;
}

/**
 * Mengganti lingkup sesi peramban yang sedang masuk tanpa redirect (D7 §3.4.6, dipakai bukaNotifikasi dan
 * pencarian). null = gabungan. Aturannya sama dengan simpanLingkupSesi: gabungan butuh perusahaan-gabungan.lihat,
 * perusahaan harus ada dan aktif. Mengembalikan false tanpa mengubah apa pun bila tidak ada sesi peramban
 * (skrip, seed). `opsi.sesiId` hanya untuk skrip uji yang membuat baris Sesi sendiri.
 */
export async function aturPerusahaanAktif(perusahaanId: string | null, opsi: { sesiId?: string; klien?: Klien } = {}): Promise<boolean> {
  const pengguna = await wajibMasukAksi();
  const klien = opsi.klien ?? db;
  const sesiId = opsi.sesiId ?? (await sesiSaatIni())?.id;
  if (!sesiId) return false;
  // sesi titipan harus milik pengguna ini, supaya lingkup sesi orang lain tidak bisa diganti
  if (opsi.sesiId && !(await klien.sesi.findFirst({ where: { id: opsi.sesiId, penggunaId: pengguna.id }, select: { id: true } }))) throw new Error("Sesi tidak ditemukan");
  await simpanLingkupSesi(klien, sesiId, perusahaanId ?? NILAI_GABUNGAN, pengguna);
  return true;
}

/** Perusahaan untuk DOKUMEN AKAR baru: isian formulir "perusahaanId", kalau kosong lingkup aktif, kalau gabungan → galat. */
export async function perusahaanDokumenBaru(dataFormulir: FormData, klien: Klien = db): Promise<string> {
  const isian = String(dataFormulir.get("perusahaanId") ?? "").trim();
  const id = isian || (await lingkupPerusahaan()).perusahaanId;
  if (!id) throw new Error("Pilih perusahaan untuk dokumen ini");
  const p = await klien.perusahaan.findUnique({ where: { id }, select: { nama: true, aktif: true } });
  if (!p) throw new Error("Perusahaan tidak ditemukan");
  if (!p.aktif) throw new Error(`Perusahaan ${p.nama} sudah diarsipkan; dokumen baru tidak bisa dibuat untuknya`);
  return id;
}

/** Perusahaan dokumen ANAK = perusahaan induk. Bila formulir mengirim "perusahaanId" berbeda → galat. */
export function perusahaanDariInduk(induk: { perusahaanId: string; nomor: string }, dataFormulir?: FormData): string {
  const isian = String(dataFormulir?.get("perusahaanId") ?? "").trim();
  if (isian && isian !== induk.perusahaanId) {
    throw new Error(`Dokumen induk ${induk.nomor} milik perusahaan lain; dokumen turunannya harus di perusahaan yang sama`);
  }
  return induk.perusahaanId;
}

/** Penyaring Prisma: {} untuk gabungan, { perusahaanId } untuk satu perusahaan. Gabungkan dengan AND bila where lain memakai OR. */
export function saringPerusahaan(perusahaanId: string | null | undefined): { perusahaanId?: string } {
  return perusahaanId ? { perusahaanId } : {};
}

/** Penyaring Prisma untuk master ber-pemilik opsional (Akun, Gudang, Barang JASA): milik perusahaan itu ATAU bersama. */
export function saringMilikAtauBersama(perusahaanId: string | null | undefined): { OR?: [{ perusahaanId: string }, { perusahaanId: null }] } {
  return perusahaanId ? { OR: [{ perusahaanId }, { perusahaanId: null }] } : {};
}

/** Nama perusahaan untuk pesan galat (tanpa melempar bila tidak ada; mengembalikan id). */
export async function namaPerusahaan(klien: Klien, id: string): Promise<string> {
  const p = await klien.perusahaan.findUnique({ where: { id }, select: { nama: true } });
  return p?.nama ?? id;
}

const unik = (ids: string[]) => [...new Set(ids.filter(Boolean))];

export async function pastikanGudangMilik(klien: Klien, gudangIds: string[], perusahaanId: string): Promise<void> {
  const ids = unik(gudangIds);
  if (ids.length === 0) return;
  const lain = await klien.gudang.findFirst({ where: { id: { in: ids }, perusahaanId: { not: null }, NOT: { perusahaanId } }, select: { kode: true, nama: true, perusahaanId: true } });
  if (lain) throw new Error(`Gudang ${lain.kode} ${lain.nama} milik ${await namaPerusahaan(klien, lain.perusahaanId!)}, tidak bisa dipakai dokumen ${await namaPerusahaan(klien, perusahaanId)}`);
}

export async function pastikanBarangMilik(klien: Klien, barangIds: string[], perusahaanId: string): Promise<void> {
  const ids = unik(barangIds);
  if (ids.length === 0) return;
  const lain = await klien.barang.findFirst({ where: { id: { in: ids }, perusahaanId: { not: null }, NOT: { perusahaanId } }, select: { kode: true, nama: true, perusahaanId: true } });
  if (lain) throw new Error(`${lain.kode} - ${lain.nama} milik ${await namaPerusahaan(klien, lain.perusahaanId!)}; daftarkan barang untuk ${await namaPerusahaan(klien, perusahaanId)} atau pakai jual-beli antar perusahaan`);
}

/** Pemilik tunggal sekumpulan barang stok (dokumen persediaan); galat bila lebih dari satu pemilik. */
export async function pemilikTunggalBarang(klien: Klien, barangIds: string[]): Promise<string> {
  const ids = unik(barangIds);
  const daftar = await klien.barang.findMany({ where: { id: { in: ids } }, select: { perusahaanId: true } });
  const pemilik = unik(daftar.map((b) => b.perusahaanId ?? ""));
  if (pemilik.length > 1) {
    const kode = await klien.perusahaan.findMany({ where: { id: { in: pemilik } }, select: { kode: true }, orderBy: { kode: "asc" } });
    throw new Error(`Satu dokumen hanya untuk barang milik satu perusahaan (${kode.map((p) => p.kode).join(", ")})`);
  }
  return pemilik[0] ?? PERUSAHAAN_UTAMA;
}

export async function pastikanKaryawanMilik(klien: Klien, karyawanIds: string[], perusahaanId: string): Promise<void> {
  const ids = unik(karyawanIds);
  if (ids.length === 0) return;
  const lain = await klien.karyawan.findFirst({ where: { id: { in: ids }, NOT: { perusahaanId } }, select: { kode: true, nama: true, perusahaanId: true } });
  if (lain) throw new Error(`Karyawan ${lain.kode} - ${lain.nama} terdaftar di ${await namaPerusahaan(klien, lain.perusahaanId)}, bukan ${await namaPerusahaan(klien, perusahaanId)}`);
}
