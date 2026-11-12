import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { BAGAN_AKUN_STANDAR } from "@/lib/baganAkunStandar";

/*
 * Kategori anggaran proyek (D5 §2.6, §3.4): kategori bawaan HKA, normalisasi nama (padanan _canon HKA), cari atau buat
 * kategori, pemetaan akun beban bawaan, dan resolusi akun ke kategori (pemetaan terdekat ke atas pohon akun menang).
 * Kategori dan pemetaannya global untuk semua perusahaan karena bagan akun bersama. Bukan "use server".
 */

type Klien = PrismaClient | Prisma.TransactionClient;

/** Sembilan kategori HKA (D5 §2.6) beserta kode akun beban yang dipetakan bawaan. */
export const KATEGORI_BAWAAN: readonly { nama: string; urutan: number; kodeAkun: readonly string[] }[] = [
  { nama: "Talent / Artis", urutan: 10, kodeAkun: ["5-1500"] },
  { nama: "Venue", urutan: 20, kodeAkun: ["5-1600"] },
  { nama: "Produksi", urutan: 30, kodeAkun: ["5-1100", "5-1300"] },
  { nama: "Vendor", urutan: 40, kodeAkun: ["5-1200"] },
  { nama: "Kru / Tenaga Kerja", urutan: 50, kodeAkun: ["5-2000"] },
  { nama: "Pemasaran", urutan: 60, kodeAkun: ["5-7000"] },
  { nama: "Logistik", urutan: 70, kodeAkun: ["5-3100", "5-3200", "5-3300", "5-3400"] },
  { nama: "Operasional", urutan: 80, kodeAkun: ["5-3000", "5-4000", "5-6000"] },
  { nama: "Lainnya", urutan: 90, kodeAkun: ["5-1400", "5-5000", "5-8000", "5-8500", "5-9000", "5-9500"] },
];

/** Urutan kategori bawaan "Lainnya" (cadangan kategori baris impor tanpa bagian dan tanpa akun beban barang). */
export const URUTAN_KATEGORI_LAINNYA = 90;
/** Urutan kategori buatan pengguna atau impor. */
export const URUTAN_KATEGORI_BUATAN = 1000;
export const PANJANG_NAMA_KATEGORI = 60;

/** Spasi dirapikan: potongan tanpa spasi kosong digabung satu spasi (D5 §3.4). */
export function rapikanNama(s: string): string {
  return s.split(/\s+/).filter(Boolean).join(" ");
}

/** Kunci unik tanpa beda huruf besar (pengganti _canon HKA). */
export function kunciNama(s: string): string {
  return rapikanNama(s).toLowerCase();
}

/** Nama kategori dari isian formulir: dirapikan, 1-60 karakter. */
export function bacaNamaKategori(v: FormDataEntryValue | null): string {
  const nama = rapikanNama(typeof v === "string" ? v : "");
  if (!nama) throw new Error("Nama kategori wajib diisi");
  if ([...nama].length > PANJANG_NAMA_KATEGORI) throw new Error(`Nama kategori maksimal ${PANJANG_NAMA_KATEGORI} karakter`);
  return nama;
}

/**
 * Kategori dengan kunci nama yang sama, atau kategori baru (urutan 1000) bila belum ada. Ejaan kategori yang sudah ada
 * selalu menang ("venue" memakai "Venue"). Dua panggilan serentak dengan nama sama tetap menghasilkan satu kategori
 * (unik namaKunci + skipDuplicates). `baru` = kategori dibuat panggilan ini.
 */
export async function cariAtauBuatKategori(tx: Klien, namaMentah: string): Promise<{ id: string; nama: string; baru: boolean }> {
  const nama = bacaNamaKategori(namaMentah);
  const namaKunci = kunciNama(nama);
  const ada = await tx.kategoriAnggaran.findUnique({ where: { namaKunci }, select: { id: true, nama: true } });
  if (ada) return { ...ada, baru: false };
  const { count } = await tx.kategoriAnggaran.createMany({ data: [{ nama, namaKunci, urutan: URUTAN_KATEGORI_BUATAN }], skipDuplicates: true });
  const k = await tx.kategoriAnggaran.findUniqueOrThrow({ where: { namaKunci }, select: { id: true, nama: true } });
  return { ...k, baru: count === 1 };
}

const STANDAR = new Map(BAGAN_AKUN_STANDAR.map((a) => [a.kode, a]));

/**
 * Alasan akun berkode bawaan tidak diberi pemetaan bawaan, atau null bila cocok. Akun harus berjenis BEBAN, kelompok
 * atau rinci sama dengan bagan standar, DAN namanya (dirapikan, tanpa beda huruf besar) sama dengan bagan standar,
 * karena kode standar bisa sudah dipakai akun buatan pengguna dengan arti lain (tinjauan P34 R4).
 */
export function alasanLewatiPemetaanBawaan(a: { kode: string; nama: string; jenis: string; kelompok: boolean }): string | null {
  const st = STANDAR.get(a.kode);
  if (!st) return "kode ini tidak ada di bagan standar";
  if (a.jenis !== "BEBAN") return `berjenis ${a.jenis}, bukan BEBAN`;
  if (a.kelompok !== !!st.kelompok) return a.kelompok ? "berupa kelompok, di bagan standar akun rinci" : "akun rinci, di bagan standar berupa kelompok";
  if (kunciNama(a.nama) !== kunciNama(st.nama)) return `namanya berbeda dari bagan standar (${st.nama})`;
  return null;
}

/**
 * Menerapkan kategori bawaan dan pemetaan akunnya (D5 §3.4), idempoten. Kategori bawaan dikenali dari tanda `bawaan`
 * dan urutannya, jadi kategori bawaan yang sudah diganti nama tidak dibuat ulang; kategori buatan pengguna yang
 * namanya sama dengan kategori bawaan dijadikan kategori bawaan itu.
 *
 * Pemetaan bawaan hanya dibuat untuk kategori bawaan yang baru dibuat (atau baru dijadikan bawaan) di panggilan ini
 * (tinjauan P34 S2). Pemetaan yang sengaja dikosongkan pengguna sesudah kategori ada tidak pernah dibuat ulang oleh
 * "Terapkan ke sistem", "Siapkan kategori bawaan", atau sinkron. Ini menyimpang dari kalimat D5 §3.4 ("akun yang belum
 * punya pemetaan"). Pemetaan juga hanya untuk akun yang lolos alasanLewatiPemetaanBawaan, dan pemetaan buatan
 * pengguna tidak pernah ditimpa.
 *
 * `akunBaru` (tinjauan P36 S1): id akun yang baru dibuat terapkanBaganAkunStandar di panggilan yang sama. Akun itu tetap
 * diberi pemetaan bawaan walaupun kategorinya sudah ada (misalnya 5-1500 dan 5-1600 sesudah "Siapkan kategori bawaan"
 * dijalankan lebih dulu). Akun yang baru lahir tidak mungkin sudah dikosongkan pengguna, jadi keputusan S2 tetap terjaga.
 */
export async function terapkanKategoriAnggaranBawaan(klien: Klien, opsi: { akunBaru?: string[] } = {}): Promise<{ kategoriDibuat: number; pemetaanDibuat: number }> {
  let kategoriDibuat = 0;
  const idPerUrutan = new Map<number, string>();
  const baruDiPanggilanIni = new Set<number>();
  const bawaan = await klien.kategoriAnggaran.findMany({ where: { bawaan: true }, select: { id: true, urutan: true }, orderBy: [{ dibuatPada: "asc" }, { id: "asc" }] });
  for (const k of bawaan) if (!idPerUrutan.has(k.urutan)) idPerUrutan.set(k.urutan, k.id);
  for (const k of KATEGORI_BAWAAN) {
    if (idPerUrutan.has(k.urutan)) continue;
    const namaKunci = kunciNama(k.nama);
    const { count } = await klien.kategoriAnggaran.createMany({ data: [{ nama: k.nama, namaKunci, urutan: k.urutan, bawaan: true }], skipDuplicates: true });
    kategoriDibuat += count;
    const baris = await klien.kategoriAnggaran.update({ where: { namaKunci }, data: { bawaan: true, urutan: k.urutan }, select: { id: true } });
    idPerUrutan.set(k.urutan, baris.id);
    baruDiPanggilanIni.add(k.urutan);
  }

  const akunBaru = new Set(opsi.akunBaru ?? []);
  // kategori yang baru dibuat memetakan semua akun berkodenya; kategori lama hanya memetakan akun yang baru dibuat
  const perluPemetaan = KATEGORI_BAWAAN.filter((k) => baruDiPanggilanIni.has(k.urutan) || akunBaru.size > 0);
  if (perluPemetaan.length === 0) return { kategoriDibuat, pemetaanDibuat: 0 };
  const semuaKode = perluPemetaan.flatMap((k) => k.kodeAkun);
  const akun = await klien.akun.findMany({ where: { kode: { in: semuaKode } }, select: { id: true, kode: true, nama: true, jenis: true, kelompok: true, kategoriAnggaran: { select: { akunId: true } } } });
  const perKode = new Map(akun.map((a) => [a.kode, a]));
  const data: { akunId: string; kategoriId: string }[] = [];
  for (const k of perluPemetaan) {
    const kategoriBaru = baruDiPanggilanIni.has(k.urutan);
    for (const kode of k.kodeAkun) {
      const a = perKode.get(kode);
      if (!a || a.kategoriAnggaran || alasanLewatiPemetaanBawaan(a) !== null) continue;
      if (!kategoriBaru && !akunBaru.has(a.id)) continue;
      data.push({ akunId: a.id, kategoriId: idPerUrutan.get(k.urutan)! });
    }
  }
  const pemetaanDibuat = data.length ? (await klien.akunKategoriAnggaran.createMany({ data, skipDuplicates: true })).count : 0;
  return { kategoriDibuat, pemetaanDibuat };
}

export type PemetaanBawaanDilewati = { akunId: string; kode: string; nama: string; kategori: string; alasan: string };

/**
 * Akun berkode pemetaan bawaan yang tidak punya pemetaan dan tidak lolos alasanLewatiPemetaanBawaan: daftar periksa
 * manual di halaman Kategori Anggaran Proyek dan sesudah deploy (CATATAN-DEPLOY). Akun yang dikosongkan pengguna
 * dengan sengaja tetapi lolos aturan tidak dicantumkan.
 */
export async function pemetaanBawaanDilewati(klien: Klien): Promise<PemetaanBawaanDilewati[]> {
  const kodeKe = new Map(KATEGORI_BAWAAN.flatMap((k) => k.kodeAkun.map((kode) => [kode, k] as const)));
  const akun = await klien.akun.findMany({ where: { kode: { in: [...kodeKe.keys()] }, kategoriAnggaran: { is: null } }, orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, jenis: true, kelompok: true } });
  const hasil: PemetaanBawaanDilewati[] = [];
  for (const a of akun) {
    const alasan = alasanLewatiPemetaanBawaan(a);
    if (alasan) hasil.push({ akunId: a.id, kode: a.kode, nama: a.nama, kategori: kodeKe.get(a.kode)!.nama, alasan });
  }
  return hasil;
}

/** Kategori bawaan "Lainnya" (dikenali dari urutannya, jadi tetap ditemukan sesudah diganti nama), dibuat bila belum ada. */
export async function kategoriLainnya(tx: Klien): Promise<{ id: string; nama: string }> {
  const ada = await tx.kategoriAnggaran.findFirst({ where: { bawaan: true, urutan: URUTAN_KATEGORI_LAINNYA }, orderBy: [{ dibuatPada: "asc" }, { id: "asc" }], select: { id: true, nama: true } });
  if (ada) return ada;
  await terapkanKategoriAnggaranBawaan(tx);
  return tx.kategoriAnggaran.findFirstOrThrow({ where: { bawaan: true, urutan: URUTAN_KATEGORI_LAINNYA }, orderBy: [{ dibuatPada: "asc" }, { id: "asc" }], select: { id: true, nama: true } });
}

/** Batas tingkat penelusuran induk akun (pengaman siklus, D5 §3.4). */
const MAKS_TINGKAT = 20;

/**
 * Penentu kategori satu akun dari peta induk dan pemetaan langsung (murni): mulai dari akun itu, naik ke induk,
 * pemetaan pertama menang; berhenti pada siklus atau sesudah 20 tingkat; tanpa pemetaan = null ("Belum dikategorikan").
 */
export function penentuKategori(induk: ReadonlyMap<string, string | null>, langsung: ReadonlyMap<string, string>): (akunId: string) => string | null {
  const tembolok = new Map<string, string | null>();
  return (akunId: string): string | null => {
    if (tembolok.has(akunId)) return tembolok.get(akunId)!;
    let id: string | null | undefined = akunId;
    const dilihat = new Set<string>();
    let hasil: string | null = null;
    while (id && !dilihat.has(id) && dilihat.size < MAKS_TINGKAT) {
      dilihat.add(id);
      const k = langsung.get(id);
      if (k) {
        hasil = k;
        break;
      }
      id = induk.get(id);
    }
    tembolok.set(akunId, hasil);
    return hasil;
  };
}

/** Peta akun ke kategori anggaran dan nama kategori (D5 §6.3), dimuat sekali per permintaan. */
export async function muatPetaKategori(klien: Klien): Promise<{ kategoriUntukAkun: (akunId: string) => string | null; namaKategori: Map<string, string> }> {
  // berurutan: klien bisa berupa transaksi interaktif, yang tidak boleh menjalankan kueri bersamaan
  const akun = await klien.akun.findMany({ select: { id: true, indukId: true } });
  const peta = await klien.akunKategoriAnggaran.findMany({ select: { akunId: true, kategoriId: true } });
  const kategori = await klien.kategoriAnggaran.findMany({ select: { id: true, nama: true } });
  return {
    kategoriUntukAkun: penentuKategori(new Map(akun.map((a) => [a.id, a.indukId])), new Map(peta.map((p) => [p.akunId, p.kategoriId]))),
    namaKategori: new Map(kategori.map((k) => [k.id, k.nama])),
  };
}
