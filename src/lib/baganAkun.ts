import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { BAGAN_AKUN_STANDAR, PEMETAAN_STANDAR } from "@/lib/baganAkunStandar";

type Klien = PrismaClient | Prisma.TransactionClient;

export type HasilTerapkanBagan = { dibuat: number; sudahAda: number; pemetaanDibuat: boolean };

/**
 * Menerapkan Bagan Akun Standar: akun yang kodenya belum ada dibuat (lengkap dengan induk & tanda),
 * yang sudah ada dibiarkan (nama/tanda buatan pengguna tidak ditimpa; hanya induk yang kosong dilengkapi).
 * Idempoten — aman dijalankan berkali-kali. Pemetaan akun dibuat bila belum ada.
 */
export async function terapkanBaganAkunStandar(klien: Klien = db): Promise<HasilTerapkanBagan> {
  const hasil: HasilTerapkanBagan = { dibuat: 0, sudahAda: 0, pemetaanDibuat: false };
  const idByKode = new Map<string, string>();

  for (const a of BAGAN_AKUN_STANDAR) {
    const indukId = a.induk ? idByKode.get(a.induk) : undefined;
    const ada = await klien.akun.findUnique({ where: { kode: a.kode } });
    if (ada) {
      idByKode.set(a.kode, ada.id);
      hasil.sudahAda++;
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
      },
    });
    hasil.pemetaanDibuat = true;
  } else {
    // Pemetaan lama (5 peran): lengkapi peran opsional yang masih kosong dengan akun standar
    const ada = await klien.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" } });
    const lengkap = {
      bebanJasaId: ada.bebanJasaId ?? idByKode.get(PEMETAAN_STANDAR.bebanJasa),
      barangBelumDitagihId: ada.barangBelumDitagihId ?? idByKode.get(PEMETAAN_STANDAR.barangBelumDitagih),
      selisihPersediaanId: ada.selisihPersediaanId ?? idByKode.get(PEMETAAN_STANDAR.selisihPersediaan),
      barangTerkirimId: ada.barangTerkirimId ?? idByKode.get(PEMETAAN_STANDAR.barangTerkirim),
      uangMukaPelangganId: ada.uangMukaPelangganId ?? idByKode.get(PEMETAAN_STANDAR.uangMukaPelanggan),
    };
    if (
      lengkap.bebanJasaId !== ada.bebanJasaId ||
      lengkap.barangBelumDitagihId !== ada.barangBelumDitagihId ||
      lengkap.selisihPersediaanId !== ada.selisihPersediaanId ||
      lengkap.barangTerkirimId !== ada.barangTerkirimId ||
      lengkap.uangMukaPelangganId !== ada.uangMukaPelangganId
    ) {
      await klien.pemetaanAkun.update({ where: { id: "default" }, data: lengkap });
    }
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

/** Akun yang boleh dipilih di formulir (bukan kelompok), opsional dibatasi jenis. */
export function whereAkunRinci(jenis?: Prisma.AkunWhereInput["jenis"]): Prisma.AkunWhereInput {
  return { kelompok: false, ...(jenis ? { jenis } : {}) };
}

/** Pilihan akun Kas/Bank: yang ditandai kasBank; bila belum ada yang ditandai, semua akun aset rinci. */
export async function daftarAkunKasBank(klien: Klien = db) {
  const ditandai = await klien.akun.findMany({ where: { kasBank: true, kelompok: false }, orderBy: { kode: "asc" } });
  if (ditandai.length > 0) return ditandai;
  return klien.akun.findMany({ where: { jenis: "ASET", kelompok: false }, orderBy: { kode: "asc" } });
}
