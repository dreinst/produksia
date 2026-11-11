import { cache } from "react";
import { db } from "@/lib/db";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { diLuarPermintaan, penggunaSaatIni, pastikanHak, sesiSaatIni, wajibMasukAksi } from "@/lib/otentikasi";
import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { pastikanAkunMilik } from "@/lib/baganAkun";
import { D, type Desimal } from "@/lib/uang";

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

/**
 * Perusahaan untuk DOKUMEN AKAR baru: isian formulir "perusahaanId", kalau kosong lingkup aktif, kalau gabungan → galat.
 * Isian tidak dibandingkan dengan lingkup: hak berlaku global dan lingkup hanya pilihan tampilan, jadi pengguna boleh
 * membuat dokumen untuk perusahaan aktif mana pun (keputusan orkestrator, KONTRAK-TAMBAHAN). Syaratnya isian harus
 * perusahaan yang ada dan aktif, dan gabungan (lingkup null) hanya terjadi bagi pemegang perusahaan-gabungan.lihat
 * (lingkupPerusahaan), sehingga pengguna lain tanpa isian selalu mendapat perusahaan lingkupnya.
 */
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

/**
 * Perusahaan dokumen persediaan (PS, PB, PJ, BR) = pemilik tunggal barang. Isian "perusahaanId" formulir yang berbeda
 * dari pemilik barang ditolak, dan pemilik yang sudah diarsipkan ditolak karena arsip berarti buku perusahaan itu
 * tidak menerima dokumen baru (keputusan tinjauan P13 butir 4 dan 8).
 */
export async function perusahaanDokumenPersediaan(klien: Klien, barangIds: string[], dataFormulir?: FormData): Promise<string> {
  const perusahaanId = await pemilikTunggalBarang(klien, barangIds);
  const isian = String(dataFormulir?.get("perusahaanId") ?? "").trim();
  if (isian && isian !== perusahaanId) {
    throw new Error(`Barang di dokumen ini milik ${await namaPerusahaan(klien, perusahaanId)}; dokumen persediaan harus di perusahaan pemilik barang`);
  }
  await pastikanPerusahaanAktif(klien, perusahaanId);
  return perusahaanId;
}

/** Galat bila perusahaan pemilik sudah diarsipkan (dokumen persediaan dan koreksi stok, keputusan tinjauan P13 butir 4). */
export async function pastikanPerusahaanAktif(klien: Klien, perusahaanId: string): Promise<void> {
  const p = await klien.perusahaan.findUnique({ where: { id: perusahaanId }, select: { nama: true, aktif: true } });
  if (p && !p.aktif) throw new Error(`Perusahaan ${p.nama} sudah diarsipkan; aktifkan dulu`);
}

export async function pastikanKaryawanMilik(klien: Klien, karyawanIds: string[], perusahaanId: string): Promise<void> {
  const ids = unik(karyawanIds);
  if (ids.length === 0) return;
  const lain = await klien.karyawan.findFirst({ where: { id: { in: ids }, NOT: { perusahaanId } }, select: { kode: true, nama: true, perusahaanId: true } });
  if (lain) throw new Error(`Karyawan ${lain.kode} - ${lain.nama} terdaftar di ${await namaPerusahaan(klien, lain.perusahaanId)}, bukan ${await namaPerusahaan(klien, perusahaanId)}`);
}

/** Kontrak D1 §3.1: pastikanAkunMilik tinggal di baganAkun.ts (bebas sesi) dan diekspor ulang dari sini. */
export { pastikanAkunMilik };

/** Kunci unik Penggajian.periode (D1 §2.4.3): didefinisikan di sdm.ts yang bebas sesi, diekspor ulang dari sini. */
export { kunciPeriodeGaji } from "@/lib/sdm";

type AkunRingkas = { id: string; kode: string; nama: string };
type AkunCalon = AkunRingkas & { jenis: string; kelompok: boolean; perusahaanId: string | null };

const PERAN_ANTAR = {
  piutang: { label: "Piutang Antar Perusahaan", jenis: "ASET", labelJenis: "Aset", kunci: "piutang-antar-perusahaan" },
  hutang: { label: "Hutang Antar Perusahaan", jenis: "KEWAJIBAN", labelJenis: "Kewajiban", kunci: "hutang-antar-perusahaan" },
} as const;

/**
 * Akun dari pemetaan tambahan atau kode standar, lalu diperiksa: jenis benar (ASET untuk piutang, KEWAJIBAN untuk
 * hutang), bukan kelompok, dan tanpa pemilik (akun ini dipakai dua perusahaan sekaligus, jadi akun berpemilik akan
 * ditolak catatJurnal di salah satu sisi). Kode standar 1-1750/2-1550 bisa saja sudah dipakai akun buatan pengguna
 * sebelum bagan standar diterapkan (tinjauan P11 butir 2). Akun yang tidak cocok tidak dikembalikan; alasannya di `masalah`.
 */
async function bacaAkunAntarPerusahaan(klien: Klien): Promise<{ piutang: AkunRingkas | null; hutang: AkunRingkas | null; masalah: string[] }> {
  const pilih = { id: true, kode: true, nama: true, jenis: true, kelompok: true, perusahaanId: true } as const;
  const [petaPiutang, petaHutang, standarPiutang, standarHutang] = await Promise.all([
    klien.pemetaanAkunTambahan.findUnique({ where: { kunci: PERAN_ANTAR.piutang.kunci }, select: { akun: { select: pilih } } }),
    klien.pemetaanAkunTambahan.findUnique({ where: { kunci: PERAN_ANTAR.hutang.kunci }, select: { akun: { select: pilih } } }),
    klien.akun.findUnique({ where: { kode: "1-1750" }, select: pilih }),
    klien.akun.findUnique({ where: { kode: "2-1550" }, select: pilih }),
  ]);
  const masalah: string[] = [];
  const periksa = (a: AkunCalon | null | undefined, peran: (typeof PERAN_ANTAR)[keyof typeof PERAN_ANTAR]): AkunRingkas | null => {
    if (!a) return null;
    if (a.jenis === peran.jenis && !a.kelompok && a.perusahaanId === null) return { id: a.id, kode: a.kode, nama: a.nama };
    masalah.push(
      `Akun ${a.kode} ${a.nama} tidak bisa dipakai sebagai ${peran.label}: harus akun ${peran.labelJenis} rinci yang dipakai bersama (tanpa pemilik). Perbaiki akunnya atau atur pemetaan tambahan ${peran.kunci} di Pengaturan, Pemetaan Akun`,
    );
    return null;
  };
  return {
    piutang: periksa(petaPiutang?.akun ?? standarPiutang, PERAN_ANTAR.piutang),
    hutang: periksa(petaHutang?.akun ?? standarHutang, PERAN_ANTAR.hutang),
    masalah,
  };
}

/**
 * Akun Piutang/Hutang Antar Perusahaan: pemetaan tambahan "piutang-antar-perusahaan"/"hutang-antar-perusahaan",
 * kalau kosong akun standar 1-1750/2-1550 (D1 §4.5). null bila akunnya tidak ada. Melempar galat yang menyebut akun
 * dan cara memperbaikinya bila akun yang ditemukan bukan akun ASET/KEWAJIBAN rinci tanpa pemilik.
 */
export async function akunAntarPerusahaan(klien: Klien): Promise<{ piutang: AkunRingkas | null; hutang: AkunRingkas | null }> {
  const { piutang, hutang, masalah } = await bacaAkunAntarPerusahaan(klien);
  if (masalah.length > 0) throw new Error(masalah.join(". "));
  return { piutang, hutang };
}

/**
 * Saldo gabungan (semua perusahaan) kedua akun antar perusahaan sampai tanggal itu, untuk catatan laporan gabungan
 * (D1 §4.6). piutang = debit - kredit, hutang = kredit - debit, selisih = piutang - hutang (0 bila semua transaksi
 * antar perusahaan tercatat di kedua sisi). akunPiutang/akunHutang berisi "kode nama", null bila akunnya tidak ada.
 * Tidak melempar galat untuk akun yang tidak cocok (halaman laporan tetap tampil): akun itu dianggap tidak ada dan
 * alasannya dikembalikan di `masalah`.
 */
export async function saldoAntarPerusahaan(
  klien: Klien,
  sampai: Date,
): Promise<{ piutang: Desimal; hutang: Desimal; selisih: Desimal; akunPiutang: string | null; akunHutang: string | null; masalah: string[] }> {
  const akun = await bacaAkunAntarPerusahaan(klien);
  const jumlah = async (a: AkunRingkas | null) => {
    if (!a) return { debit: D(0), kredit: D(0) };
    const r = await klien.barisJurnal.aggregate({ where: { akunId: a.id, jurnal: { tanggal: { lte: sampai } } }, _sum: { debit: true, kredit: true } });
    return { debit: D(r._sum.debit ?? 0), kredit: D(r._sum.kredit ?? 0) };
  };
  const [p, h] = await Promise.all([jumlah(akun.piutang), jumlah(akun.hutang)]);
  const piutang = p.debit.minus(p.kredit);
  const hutang = h.kredit.minus(h.debit);
  const label = (a: AkunRingkas | null) => (a ? `${a.kode} ${a.nama}` : null);
  return { piutang, hutang, selisih: piutang.minus(hutang), akunPiutang: label(akun.piutang), akunHutang: label(akun.hutang), masalah: akun.masalah };
}
