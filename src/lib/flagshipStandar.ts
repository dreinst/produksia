import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { db } from "@/lib/db";

/*
 * Data induk standar program flagship (tiket, sponsor, tenant) + "Pelanggan Umum" untuk rekap tiket ritel.
 * Idempoten: hanya membuat yang kodenya belum ada; harga jual dibiarkan 0 supaya diisi pemilik.
 * Diterapkan bersama Bagan Akun Standar (seed, skrip siapkan-produksi, tombol Terapkan di Pengaturan).
 */
type Klien = PrismaClient | Prisma.TransactionClient;

export const PELANGGAN_UMUM = { kode: "PLG-UMUM", nama: "Pelanggan Umum (tiket & ritel)" } as const;
export const KELOMPOK_FLAGSHIP = "Program Flagship";

export const JASA_FLAGSHIP_STANDAR: readonly { kode: string; nama: string; satuan: string; akunPendapatan: string }[] = [
  { kode: "TKT-PRESALE", nama: "Tiket Presale", satuan: "tiket", akunPendapatan: "4-1300" },
  { kode: "TKT-REGULER", nama: "Tiket Reguler", satuan: "tiket", akunPendapatan: "4-1300" },
  { kode: "TKT-VIP", nama: "Tiket VIP", satuan: "tiket", akunPendapatan: "4-1300" },
  { kode: "SPN-PLATINUM", nama: "Paket Sponsor Platinum", satuan: "paket", akunPendapatan: "4-1400" },
  { kode: "SPN-GOLD", nama: "Paket Sponsor Gold", satuan: "paket", akunPendapatan: "4-1400" },
  { kode: "SPN-SILVER", nama: "Paket Sponsor Silver", satuan: "paket", akunPendapatan: "4-1400" },
  { kode: "BOOTH-TENANT", nama: "Sewa Booth / Tenant", satuan: "booth", akunPendapatan: "4-1500" },
];

export type HasilFlagship = { jasaDibuat: number; pelangganUmumDibuat: boolean };

export async function terapkanDataFlagship(klien: Klien = db): Promise<HasilFlagship> {
  const hasil: HasilFlagship = { jasaDibuat: 0, pelangganUmumDibuat: false };
  if (!(await klien.pelanggan.findUnique({ where: { kode: PELANGGAN_UMUM.kode } }))) {
    await klien.pelanggan.create({ data: { ...PELANGGAN_UMUM, alamat: "Rekap penjualan tiket/ritel per hari atau per kanal (loket, online)" } });
    hasil.pelangganUmumDibuat = true;
  }
  const kelompok = (await klien.kelompokBarang.findFirst({ where: { nama: KELOMPOK_FLAGSHIP } })) ?? (await klien.kelompokBarang.create({ data: { nama: KELOMPOK_FLAGSHIP } }));
  for (const j of JASA_FLAGSHIP_STANDAR) {
    if (await klien.barang.findUnique({ where: { kode: j.kode } })) continue;
    const akun = await klien.akun.findUnique({ where: { kode: j.akunPendapatan } });
    if (!akun) continue; // bagan akun standar belum diterapkan
    await klien.barang.create({ data: { kode: j.kode, nama: j.nama, jenis: "JASA", satuan: j.satuan, hargaBeli: 0, hargaJual: 0, kelompokId: kelompok.id, akunPendapatanId: akun.id } });
    hasil.jasaDibuat++;
  }
  return hasil;
}
