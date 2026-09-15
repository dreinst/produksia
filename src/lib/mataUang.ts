import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { D, format, uang, type Desimal } from "@/lib/uang";

/*
 * Mata uang transaksi vs mata uang fungsional.
 *
 * IDR adalah mata uang fungsional (mata uang pelaporan): SELURUH buku besar dicatat dalam IDR, jadi
 * Neraca, Laba Rugi, Arus Kas, dan pajak tidak pernah mencampur satuan. Mata uang asing hanya melekat
 * pada dokumen (faktur penjualan/pembelian, penerimaan, pembayaran) dan pada saldo piutang/hutang
 * yang dokumen itu bentuk. Ini pola yang sama dengan software akuntansi komersial pada umumnya.
 *
 * Kurs yang dipakai sebuah dokumen DISIMPAN di dokumennya (snapshot). Kurs baru yang dimasukkan
 * belakangan karena itu tidak pernah menggeser jurnal yang sudah tercatat; selisihnya diakui lewat
 * penilaian kembali (src/lib/selisihKurs.ts), bukan dengan mengubah data lama.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export const KODE_FUNGSIONAL_BAWAAN = "IDR";

export type MataUangRingkas = { id: string; kode: string; nama: string; simbol: string; desimal: number; fungsional: boolean };

/** Mata uang fungsional (pelaporan). Kosong berarti daftar mata uang belum diisi sama sekali = semua IDR. */
export async function mataUangFungsional(klien: Klien = db): Promise<MataUangRingkas | null> {
  return klien.mataUang.findFirst({
    where: { fungsional: true },
    select: { id: true, kode: true, nama: true, simbol: true, desimal: true, fungsional: true },
  });
}

export async function daftarMataUangAktif(klien: Klien = db): Promise<MataUangRingkas[]> {
  return klien.mataUang.findMany({
    where: { aktif: true },
    orderBy: [{ fungsional: "desc" }, { kode: "asc" }],
    select: { id: true, kode: true, nama: true, simbol: true, desimal: true, fungsional: true },
  });
}

/**
 * Kurs yang berlaku pada sebuah tanggal = kurs terakhir yang dicatat pada tanggal itu atau sebelumnya.
 * Kalau belum ada satu pun kurs, transaksinya ditolak dengan pesan jelas, bukan diam-diam memakai 1.
 */
export async function kursPada(klien: Klien, mataUangId: string, tanggal: Date): Promise<Desimal> {
  const mu = await klien.mataUang.findUnique({ where: { id: mataUangId } });
  if (!mu) throw new Error("Mata uang tidak ditemukan");
  if (mu.fungsional) return D(1);
  const baris = await klien.kursMataUang.findFirst({
    where: { mataUangId, tanggal: { lte: tanggal } },
    orderBy: { tanggal: "desc" },
  });
  if (!baris) {
    throw new Error(
      `Kurs ${mu.kode} pada ${tanggal.toLocaleDateString("id-ID")} belum ada. Masukkan kursnya di Pengaturan › Mata Uang & Kurs lebih dulu`,
    );
  }
  return D(baris.kurs);
}

export type MataUangDokumen = {
  /** null = mata uang fungsional (IDR); kolom uang dokumen langsung dipakai apa adanya */
  mataUangId: string | null;
  /** 1 unit mata uang dokumen = `kurs` rupiah */
  kurs: Desimal;
};

/**
 * Mata uang & kurs sebuah dokumen dari formulir.
 * Urutan: pilihan di formulir → mata uang bawaan rekanan (pelanggan/pemasok) → mata uang fungsional.
 * Kurs boleh diisi manual di formulir (kurs kontrak/kurs bank hari itu); kalau kosong memakai
 * kurs terakhir yang tercatat sampai tanggal dokumen.
 */
export async function bacaMataUangDokumen(
  klien: Klien,
  dataFormulir: FormData,
  bawaanRekananId: string | null,
  tanggal: Date,
): Promise<MataUangDokumen> {
  const dipilih = String(dataFormulir.get("mataUangId") ?? "").trim();
  const mataUangId = dipilih || bawaanRekananId || null;
  if (!mataUangId) return { mataUangId: null, kurs: D(1) };

  const mu = await klien.mataUang.findUnique({ where: { id: mataUangId } });
  if (!mu) throw new Error("Mata uang tidak ditemukan");
  if (!mu.aktif) throw new Error(`Mata uang ${mu.kode} sudah dinonaktifkan`);
  // Mata uang fungsional disimpan sebagai null supaya dokumen rupiah tetap sederhana (kurs selalu 1)
  if (mu.fungsional) return { mataUangId: null, kurs: D(1) };

  const kursMentah = dataFormulir.get("kurs");
  if (typeof kursMentah === "string" && kursMentah.trim() !== "") {
    const kurs = D(kursMentah.trim()).toDecimalPlaces(6);
    if (kurs.lte(0)) throw new Error("Kurs harus lebih dari 0");
    return { mataUangId, kurs };
  }
  return { mataUangId, kurs: await kursPada(klien, mataUangId, tanggal) };
}

/** Nilai dalam mata uang dokumen: nilai rupiah dibagi kurs (untuk ditampilkan & disimpan sebagai nilaiAsli). */
export function nilaiDalamMataUang(nilaiIdr: Desimal | number | string, kurs: Desimal): Desimal {
  const k = D(kurs);
  return k.gt(0) ? uang(D(nilaiIdr).div(k)) : D(nilaiIdr);
}

/**
 * Mata uang asing aktif + kurs terakhir yang tercatat, untuk pilihan mata uang di komposer faktur.
 * Mata uang fungsional tidak ikut: itu pilihan bawaan "IDR (rupiah)" di formulir.
 */
export async function opsiMataUangDokumen(klien: Klien = db) {
  const daftar = await klien.mataUang.findMany({
    where: { aktif: true, fungsional: false },
    orderBy: { kode: "asc" },
    include: { kurs: { orderBy: { tanggal: "desc" }, take: 1 } },
  });
  return daftar.map((m) => ({
    id: m.id,
    kode: m.kode,
    nama: m.nama,
    kursTerakhir: m.kurs[0] ? Number(m.kurs[0].kurs) : null,
  }));
}

/** "USD 1.500,00 @ 15.800 = Rp 23.700.000" untuk ditampilkan di daftar & log. */
export function teksMataUang(kode: string, nilaiAsli: Desimal | number | string, kurs: Desimal | number | string, nilaiIdr: Desimal | number | string): string {
  return `${kode} ${format(nilaiAsli)} @ ${format(kurs)} = Rp ${format(nilaiIdr)}`;
}
