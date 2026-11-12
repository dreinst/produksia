import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import type { JenisAkun } from "@/prisma-klien/enums";
import { BAGAN_AKUN_STANDAR, PEMETAAN_STANDAR, type AkunStandar } from "@/lib/baganAkunStandar";

type Klien = PrismaClient | Prisma.TransactionClient;

/** Akun yang kodenya sama dengan akun standar tetapi jenis atau tanda kelompoknya berbeda (mis. akun buatan pengguna). */
export type AkunStandarBerbeda = { kode: string; nama: string; jenis: JenisAkun; kelompok: boolean; namaStandar: string; jenisStandar: JenisAkun; kelompokStandar: boolean };

export type HasilTerapkanBagan = {
  dibuat: number;
  sudahAda: number;
  pemetaanDibuat: boolean;
  berbeda: AkunStandarBerbeda[];
  /** id akun yang baru dibuat di panggilan ini; diteruskan ke terapkanKategoriAnggaranBawaan (tinjauan P36 S1) */
  idDibuat: string[];
};

/** Membandingkan akun yang sudah ada dengan definisi standarnya; null bila jenis dan tanda kelompoknya sama. */
export function bedaDenganStandar(ada: { kode: string; nama: string; jenis: JenisAkun; kelompok: boolean }, standar: AkunStandar): AkunStandarBerbeda | null {
  const kelompokStandar = standar.kelompok ?? false;
  if (ada.jenis === standar.jenis && ada.kelompok === kelompokStandar) return null;
  return { kode: ada.kode, nama: ada.nama, jenis: ada.jenis, kelompok: ada.kelompok, namaStandar: standar.nama, jenisStandar: standar.jenis, kelompokStandar };
}

/**
 * Menerapkan Bagan Akun Standar: akun yang kodenya belum ada dibuat (lengkap dengan induk & tanda),
 * yang sudah ada dibiarkan (nama/tanda buatan pengguna tidak ditimpa; hanya induk yang kosong dilengkapi).
 * Idempoten, aman dijalankan berkali-kali. Pemetaan akun dibuat bila belum ada. Kode yang sudah ada dengan jenis
 * atau tanda kelompok berbeda dari standar dilaporkan di `berbeda` (tidak diubah), supaya Pemilik bisa memutuskan.
 */
export async function terapkanBaganAkunStandar(klien: Klien = db): Promise<HasilTerapkanBagan> {
  const hasil: HasilTerapkanBagan = { dibuat: 0, sudahAda: 0, pemetaanDibuat: false, berbeda: [], idDibuat: [] };
  const idByKode = new Map<string, string>();

  for (const a of BAGAN_AKUN_STANDAR) {
    const indukId = a.induk ? idByKode.get(a.induk) : undefined;
    const ada = await klien.akun.findUnique({ where: { kode: a.kode } });
    if (ada) {
      idByKode.set(a.kode, ada.id);
      hasil.sudahAda++;
      const beda = bedaDenganStandar(ada, a);
      if (beda) hasil.berbeda.push(beda);
      if (!ada.indukId && indukId) await klien.akun.update({ where: { id: ada.id }, data: { indukId } });
      continue;
    }
    const baru = await klien.akun.create({
      data: {
        kode: a.kode,
        nama: a.nama,
        jenis: a.jenis,
        indukId,
        kelompok: a.kelompok ?? false,
        kasBank: a.kasBank ?? false,
        keterangan: a.keterangan,
      },
    });
    idByKode.set(a.kode, baru.id);
    hasil.dibuat++;
    hasil.idDibuat.push(baru.id);
  }

  if (!(await klien.pemetaanAkun.findUnique({ where: { id: "default" } }))) {
    const id = (kode: string) => {
      const v = idByKode.get(kode);
      if (!v) throw new Error(`Akun standar ${kode} tidak ditemukan`);
      return v;
    };
    await klien.pemetaanAkun.create({
      data: {
        id: "default",
        piutangUsahaId: id(PEMETAAN_STANDAR.piutangUsaha),
        persediaanId: id(PEMETAAN_STANDAR.persediaan),
        hppId: id(PEMETAAN_STANDAR.hpp),
        pendapatanPenjualanId: id(PEMETAAN_STANDAR.pendapatanPenjualan),
        utangUsahaId: id(PEMETAAN_STANDAR.utangUsaha),
        bebanJasaId: id(PEMETAAN_STANDAR.bebanJasa),
        barangBelumDitagihId: id(PEMETAAN_STANDAR.barangBelumDitagih),
        selisihPersediaanId: id(PEMETAAN_STANDAR.selisihPersediaan),
        barangTerkirimId: id(PEMETAAN_STANDAR.barangTerkirim),
        uangMukaPelangganId: id(PEMETAAN_STANDAR.uangMukaPelanggan),
        labaDitahanId: id(PEMETAAN_STANDAR.labaDitahan),
        diskonPenjualanId: id(PEMETAAN_STANDAR.diskonPenjualan),
        pendapatanLainId: id(PEMETAAN_STANDAR.pendapatanLain),
      },
    });
    hasil.pemetaanDibuat = true;
  } else {
    // Peran yang masih kosong pada pemetaan lama (mis. peran baru setelah pembaruan) diisi dari standar; yang sudah diatur tidak diubah
    const lama = (await klien.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" } })) as unknown as Record<string, unknown>;
    const isi: Record<string, string> = {};
    for (const [peran, kode] of Object.entries(PEMETAAN_STANDAR)) {
      const kolom = `${peran}Id`;
      const akunId = idByKode.get(kode);
      if (!lama[kolom] && akunId) isi[kolom] = akunId;
    }
    if (Object.keys(isi).length > 0) await klien.pemetaanAkun.update({ where: { id: "default" }, data: isi });
  }
  return hasil;
}

/** Menolak jurnal ke akun kelompok (induk). Dipanggil sebelum jurnal apa pun dibuat. */
export async function pastikanAkunRinci(klien: Klien, daftarAkunId: string[]): Promise<void> {
  const unik = [...new Set(daftarAkunId.filter(Boolean))];
  if (unik.length === 0) return;
  const kelompok = await klien.akun.findMany({ where: { id: { in: unik }, kelompok: true }, select: { kode: true, nama: true } });
  if (kelompok.length > 0) {
    const daftar = kelompok.map((a) => `${a.kode} ${a.nama}`).join(", ");
    throw new Error(`Akun kelompok tidak bisa dijurnal: ${daftar}. Pilih akun rinci di bawahnya.`);
  }
}

/**
 * Menolak akun milik perusahaan lain di pembukuan `perusahaanId` (D1 §3.4). Akun bersama (perusahaanId null) selalu
 * lolos. Diletakkan di sini, bukan di perusahaan.ts, supaya akuntansi.ts tidak mengimpor modul yang menyentuh sesi;
 * perusahaan.ts mengekspor ulang.
 */
export async function pastikanAkunMilik(klien: Klien, akunIds: string[], perusahaanId: string): Promise<void> {
  const unik = [...new Set(akunIds.filter(Boolean))];
  if (unik.length === 0) return;
  const lain = await klien.akun.findFirst({
    where: { id: { in: unik }, perusahaanId: { not: null }, NOT: { perusahaanId } },
    select: { kode: true, nama: true, perusahaanId: true },
    orderBy: { kode: "asc" },
  });
  if (!lain) return;
  const nama = new Map((await klien.perusahaan.findMany({ where: { id: { in: [lain.perusahaanId!, perusahaanId] } }, select: { id: true, nama: true } })).map((p) => [p.id, p.nama]));
  throw new Error(`Akun ${lain.kode} ${lain.nama} milik ${nama.get(lain.perusahaanId!) ?? lain.perusahaanId}, tidak bisa dipakai di pembukuan ${nama.get(perusahaanId) ?? perusahaanId}`);
}

/**
 * Pilihan akun Kas/Bank: yang ditandai kasBank; bila belum ada yang ditandai, semua akun aset rinci.
 * `perusahaanId` diisi: hanya akun milik perusahaan itu atau akun bersama. Kosong: semua (perilaku lama).
 */
export async function daftarAkunKasBank(klien: Klien = db, perusahaanId?: string | null) {
  // sama dengan saringMilikAtauBersama di perusahaan.ts (tidak diimpor supaya berkas ini bebas sesi)
  const milik = perusahaanId ? { OR: [{ perusahaanId }, { perusahaanId: null }] } : {};
  const ditandai = await klien.akun.findMany({ where: { kasBank: true, kelompok: false, ...milik }, orderBy: { kode: "asc" } });
  if (ditandai.length > 0) return ditandai;
  // cadangan "semua akun aset" hanya bila belum ada satu pun akun bertanda kasBank, supaya perusahaan yang belum
  // punya rekening sendiri tidak ditawari akun aset biasa sebagai kas
  if (perusahaanId && (await klien.akun.count({ where: { kasBank: true, kelompok: false } })) > 0) return ditandai;
  return klien.akun.findMany({ where: { jenis: "ASET", kelompok: false, ...milik }, orderBy: { kode: "asc" } });
}

/** Akun dari pemetaan tambahan (Pengaturan, Pemetaan Akun) menurut kuncinya, mis. "prive". */
export async function akunPemetaanTambahan(klien: Klien, kunci: string) {
  const p = await klien.pemetaanAkunTambahan.findUnique({ where: { kunci }, include: { akun: true } });
  return p?.akun ?? null;
}
