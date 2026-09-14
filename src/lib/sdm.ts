import type { PrismaClient, Prisma } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { akunPemetaanTambahan } from "@/lib/baganAkun";

type Klien = PrismaClient | Prisma.TransactionClient;

/*
 * Siklus SDM: akun bawaan penggajian. Prioritas: Pemetaan Akun → Pemetaan tambahan
 * ("bebanGaji" / "bebanTunjangan" / "hutangPotonganGaji"), kalau belum diatur jatuh ke akun
 * standar Bagan Akun EO/WO (5-2100 Gaji Pokok, 5-2500 BPJS & Tunjangan, 2-1310 Hutang PPh 21;
 * lihat BAGAN-AKUN.md). Sama seperti Prive yang jatuh ke akun bernama "Prive" bila tambahan kosong.
 */
export type AkunGajiBawaan = {
  bebanGaji: { id: string; kode: string; nama: string } | null;
  bebanTunjangan: { id: string; kode: string; nama: string } | null;
  hutangPotongan: { id: string; kode: string; nama: string } | null;
};

export async function akunGajiBawaan(klien: Klien = db): Promise<AkunGajiBawaan> {
  const [bebanGaji, bebanTunjangan, hutangPotongan, standarBeban, standarTunjangan, standarHutang] = await Promise.all([
    akunPemetaanTambahan(klien, "bebanGaji"),
    akunPemetaanTambahan(klien, "bebanTunjangan"),
    akunPemetaanTambahan(klien, "hutangPotonganGaji"),
    klien.akun.findUnique({ where: { kode: "5-2100" } }),
    klien.akun.findUnique({ where: { kode: "5-2500" } }),
    klien.akun.findUnique({ where: { kode: "2-1310" } }),
  ]);
  return {
    bebanGaji: bebanGaji ?? standarBeban,
    bebanTunjangan: bebanTunjangan ?? standarTunjangan,
    hutangPotongan: hutangPotongan ?? standarHutang,
  };
}

/** Karyawan aktif untuk formulir Proses Gaji, dengan komponen gaji bawaan dari data induk. */
export async function daftarKaryawanAktif(klien: Klien = db) {
  return klien.karyawan.findMany({
    where: { status: "AKTIF" },
    orderBy: { nama: "asc" },
    select: { id: true, kode: true, nama: true, jabatan: true, gajiPokok: true, tunjangan: true, departemen: { select: { nama: true } } },
  });
}
