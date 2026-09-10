import type { Prisma } from "@/prisma-klien/client";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { D, type Desimal } from "@/lib/uang";
import { pastikanAkunRinci } from "@/lib/baganAkun";

type Tx = Prisma.TransactionClient;
type InputBarisJurnal = { akunId: string; debit: Desimal; kredit: Desimal; keterangan: string };

const NOL = D(0);

async function nomorJurnalBerikutnya(tx: Tx, prefix: string) {
  return nomorDokumenBerikutnya(tx.jurnal, prefix);
}

export async function ambilPemetaanAkun(tx: Tx) {
  const pemetaan = await tx.pemetaanAkun.findUnique({ where: { id: "default" } });
  if (!pemetaan) {
    throw new Error(
      "Pemetaan akun belum diatur. Buka menu Buku Besar > Pemetaan Akun sebelum membuat transaksi ini.",
    );
  }
  return pemetaan;
}

async function catatJurnal(tx: Tx, prefix: string, keterangan: string, sumber: "PENJUALAN" | "PEMBELIAN", daftarBaris: InputBarisJurnal[]) {
  await pastikanAkunRinci(tx, daftarBaris.map((b) => b.akunId));
  const nomor = await nomorJurnalBerikutnya(tx, prefix);
  await tx.jurnal.create({ data: { nomor, keterangan, sumber, baris: { create: daftarBaris } } });
}

/** Faktur Penjualan: Dr Piutang / Cr Pendapatan; plus Dr HPP / Cr Persediaan bila ada harga pokok. */
export async function catatJurnalFakturPenjualan(tx: Tx, faktur: { total: Desimal | number | string }, hargaPokok: Desimal) {
  const m = await ambilPemetaanAkun(tx);
  const total = D(faktur.total);
  const daftarBaris: InputBarisJurnal[] = [
    { akunId: m.piutangUsahaId, debit: total, kredit: NOL, keterangan: "Piutang Faktur Penjualan" },
    { akunId: m.pendapatanPenjualanId, debit: NOL, kredit: total, keterangan: "Pendapatan Penjualan" },
  ];
  if (hargaPokok.gt(0)) {
    daftarBaris.push(
      { akunId: m.hppId, debit: hargaPokok, kredit: NOL, keterangan: "HPP Penjualan" },
      { akunId: m.persediaanId, debit: NOL, kredit: hargaPokok, keterangan: "Pengurangan Persediaan" },
    );
  }
  await catatJurnal(tx, "JU-FJ", "Faktur Penjualan", "PENJUALAN", daftarBaris);
}

/** Penerimaan Penjualan: Dr Kas/Bank pilihan / Cr Piutang. */
export async function catatJurnalPenerimaanPenjualan(tx: Tx, penerimaan: { akunId: string; jumlah: Desimal | number | string }) {
  const m = await ambilPemetaanAkun(tx);
  const jumlah = D(penerimaan.jumlah);
  await catatJurnal(tx, "JU-TRM", "Penerimaan Penjualan", "PENJUALAN", [
    { akunId: penerimaan.akunId, debit: jumlah, kredit: NOL, keterangan: "Penerimaan dari pelanggan" },
    { akunId: m.piutangUsahaId, debit: NOL, kredit: jumlah, keterangan: "Pelunasan piutang" },
  ]);
}

/** Retur Penjualan: kebalikan faktur (Dr Pendapatan / Cr Piutang; Dr Persediaan / Cr HPP). */
export async function catatJurnalReturPenjualan(tx: Tx, nilaiRetur: Desimal, hargaPokok: Desimal) {
  const m = await ambilPemetaanAkun(tx);
  const daftarBaris: InputBarisJurnal[] = [
    { akunId: m.pendapatanPenjualanId, debit: nilaiRetur, kredit: NOL, keterangan: "Retur Penjualan" },
    { akunId: m.piutangUsahaId, debit: NOL, kredit: nilaiRetur, keterangan: "Pengurangan Piutang" },
  ];
  if (hargaPokok.gt(0)) {
    daftarBaris.push(
      { akunId: m.persediaanId, debit: hargaPokok, kredit: NOL, keterangan: "Barang retur masuk gudang" },
      { akunId: m.hppId, debit: NOL, kredit: hargaPokok, keterangan: "Koreksi HPP" },
    );
  }
  await catatJurnal(tx, "JU-RJ", "Retur Penjualan", "PENJUALAN", daftarBaris);
}

/** Faktur Pembelian: Dr Persediaan / Cr Utang. */
export async function catatJurnalFakturPembelian(tx: Tx, faktur: { total: Desimal | number | string }) {
  const m = await ambilPemetaanAkun(tx);
  const total = D(faktur.total);
  await catatJurnal(tx, "JU-FB", "Faktur Pembelian", "PEMBELIAN", [
    { akunId: m.persediaanId, debit: total, kredit: NOL, keterangan: "Penambahan Persediaan" },
    { akunId: m.utangUsahaId, debit: NOL, kredit: total, keterangan: "Utang Faktur Pembelian" },
  ]);
}

/** Pembayaran Pembelian: Dr Utang / Cr Kas/Bank pilihan. */
export async function catatJurnalPembayaranPembelian(tx: Tx, pembayaran: { akunId: string; jumlah: Desimal | number | string }) {
  const m = await ambilPemetaanAkun(tx);
  const jumlah = D(pembayaran.jumlah);
  await catatJurnal(tx, "JU-BYR", "Pembayaran Pembelian", "PEMBELIAN", [
    { akunId: m.utangUsahaId, debit: jumlah, kredit: NOL, keterangan: "Pelunasan utang" },
    { akunId: pembayaran.akunId, debit: NOL, kredit: jumlah, keterangan: "Pembayaran ke pemasok" },
  ]);
}

/** Retur Pembelian: Dr Utang / Cr Persediaan. */
export async function catatJurnalReturPembelian(tx: Tx, nilaiRetur: Desimal) {
  const m = await ambilPemetaanAkun(tx);
  await catatJurnal(tx, "JU-RB", "Retur Pembelian", "PEMBELIAN", [
    { akunId: m.utangUsahaId, debit: nilaiRetur, kredit: NOL, keterangan: "Pengurangan Utang" },
    { akunId: m.persediaanId, debit: NOL, kredit: nilaiRetur, keterangan: "Barang keluar retur ke pemasok" },
  ]);
}
