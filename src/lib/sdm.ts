import type { PrismaClient, Prisma } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { akunPemetaanTambahan } from "@/lib/baganAkun";
import { catatJurnal, type OpsiJurnal } from "@/lib/akuntansi";
import { D, format, jumlahkan, type Desimal } from "@/lib/uang";

type Klien = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

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

/**
 * Jurnal satu dokumen Penggajian yang SUDAH tersimpan:
 * Dr Beban Gaji Pokok (per akun; karyawan bisa punya akun sendiri, mis. Upah Harian/Honor Volunteer)
 * + Dr Beban Tunjangan (per akun) / Cr Hutang Potongan Gaji (bila ada potongan) / Cr Kas-Bank (gaji bersih).
 *
 * Dipisah dari aksi pembuatan dokumen supaya jurnalnya bisa dicatat di dua waktu yang berbeda:
 * langsung saat dokumen dibuat (alur persetujuan mati) atau saat dokumen DISETUJUI (alur persetujuan hidup).
 */
export async function catatJurnalPenggajian(tx: Tx, penggajianId: string, opsi: OpsiJurnal = {}) {
  const g = await tx.penggajian.findUniqueOrThrow({
    where: { id: penggajianId },
    include: { baris: { include: { karyawan: { select: { akunBebanId: true } } } } },
  });
  const gaji = await akunGajiBawaan(tx);
  if (!gaji.bebanGaji) {
    throw new Error('Akun Beban Gaji belum ada. Terapkan Bagan Akun Standar (5-2100) atau atur Pemetaan Akun > Pemetaan tambahan "bebanGaji"');
  }
  const totalPotongan = jumlahkan(g.baris.map((b) => b.potongan));
  if (totalPotongan.gt(0) && !gaji.hutangPotongan) {
    throw new Error('Ada potongan, tapi akun Hutang Potongan Gaji belum ada. Terapkan Bagan Akun Standar (2-1310) atau atur Pemetaan Akun > Pemetaan tambahan "hutangPotonganGaji"');
  }

  const pokok = new Map<string, Desimal>();
  const tunjangan = new Map<string, Desimal>();
  const tambah = (peta: Map<string, Desimal>, akunId: string, nilai: Desimal) => {
    if (nilai.isZero()) return;
    peta.set(akunId, (peta.get(akunId) ?? D(0)).plus(nilai));
  };
  for (const b of g.baris) {
    const akunKaryawan = b.karyawan.akunBebanId ?? gaji.bebanGaji.id;
    tambah(pokok, akunKaryawan, D(b.gajiPokok));
    tambah(tunjangan, gaji.bebanTunjangan?.id ?? akunKaryawan, D(b.tunjangan));
  }
  const NOL = D(0);
  const baris = [
    ...[...pokok].map(([akunId, v]) => ({ akunId, debit: v, kredit: NOL, keterangan: `Beban gaji pokok ${g.periode}` })),
    ...[...tunjangan].map(([akunId, v]) => ({ akunId, debit: v, kredit: NOL, keterangan: `Beban tunjangan ${g.periode}` })),
    ...(totalPotongan.gt(0) ? [{ akunId: gaji.hutangPotongan!.id, debit: NOL, kredit: totalPotongan, keterangan: `Potongan gaji ${g.periode}` }] : []),
    { akunId: g.akunKasId, debit: NOL, kredit: D(g.totalDibayar), keterangan: `Pembayaran gaji ${g.periode}` },
  ];
  const jurnal = await catatJurnal(
    tx,
    "GJ",
    `Penggajian ${g.periode}${g.keterangan ? `: ${g.keterangan}` : ""}`,
    "PENGGAJIAN",
    baris,
    { tanggal: g.tanggal, proyekId: g.proyekId, ...opsi },
  );
  if (jurnal) await tx.penggajian.update({ where: { id: g.id }, data: { jurnalId: jurnal.id } });
  return jurnal;
}

/** Keterangan log aktivitas untuk satu dokumen Penggajian (dipakai saat dibuat maupun saat disetujui). */
export function ringkasanPenggajian(g: {
  periode: string;
  totalGajiPokok: Desimal | number | string;
  totalTunjangan: Desimal | number | string;
  totalPotongan: Desimal | number | string;
  totalDibayar: Desimal | number | string;
  baris: unknown[];
}): string {
  return `Periode ${g.periode}: ${g.baris.length} karyawan, gaji pokok ${format(g.totalGajiPokok)}, tunjangan ${format(g.totalTunjangan)}, potongan ${format(g.totalPotongan)}, dibayar ${format(g.totalDibayar)}`;
}

/** Karyawan aktif untuk formulir Proses Gaji, dengan komponen gaji bawaan dari data induk. */
export async function daftarKaryawanAktif(klien: Klien = db) {
  return klien.karyawan.findMany({
    where: { status: "AKTIF" },
    orderBy: { nama: "asc" },
    select: { id: true, kode: true, nama: true, jabatan: true, gajiPokok: true, tunjangan: true, departemen: { select: { nama: true } } },
  });
}
