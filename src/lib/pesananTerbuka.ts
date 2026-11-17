import { db } from "@/lib/db";
import { saringPerusahaan } from "@/lib/perusahaan";
import { D } from "@/lib/uang";

/*
 * Antrean kerja gudang: pesanan yang masih punya BARANG (bukan jasa) untuk diterima atau dikirim.
 *
 * Gudang memegang penerimaan-barang.buat dan pengiriman.buat, tetapi tidak membuka halaman Pesanan Pembelian dan
 * Pesanan Penjualan (lihat peran GUDANG di src/lib/hakAkses.ts). Daftar ini menjadi jalan masuknya ke formulir
 * "Terima Barang" dan "Kirim", tampil di halaman Penerimaan Barang dan Pengiriman bagi pemegang hak buat.
 *
 * Yang dibaca hanya nomor, tanggal, nama mitra, dan sisa kuantitas per barang. Harga dan total pesanan tidak ikut,
 * sama dengan formulir Terima Barang dan Kirim yang sudah bisa dibuka Gudang. Pesanan yang sisanya tinggal jasa
 * tidak masuk daftar: jasa tidak menggerakkan stok, dan penyerahannya tetap dicatat dari halaman Pesanan.
 */

/** Batas tampil; pesanan terlama lebih dulu supaya yang paling lama menunggu tidak tertimbun. */
export const BATAS_PESANAN_MENUNGGU = 50;

export type BarisMenunggu = { id: string; kode: string; nama: string; satuan: string; sisa: number };

export type PesananMenunggu = {
  id: string;
  nomor: string;
  tanggal: Date;
  mitra: string;
  perusahaan: { kode: string; nama: string; warna: string | null };
  baris: BarisMenunggu[];
};

export type AntreanPesanan = { total: number; daftar: PesananMenunggu[] };

const PILIH_PERUSAHAAN = { select: { kode: true, nama: true, warna: true } } as const;
const PILIH_BARANG = { select: { kode: true, nama: true, satuan: true } } as const;
const URUT = [{ tanggal: "asc" as const }, { nomor: "asc" as const }];

/** Pesanan pembelian yang barangnya belum diterima semua. perusahaanId kosong = gabungan (semua perusahaan). */
export async function pesananMenungguDiterima(perusahaanId: string | null | undefined): Promise<AntreanPesanan> {
  const barisSisa = { barang: { jenis: "BARANG" as const }, jumlahDiterima: { lt: db.barisPesananPembelian.fields.jumlah } };
  const where = { status: { not: "DIBATALKAN" as const }, ...saringPerusahaan(perusahaanId), baris: { some: barisSisa } };
  const [total, daftar] = await Promise.all([
    db.pesananPembelian.count({ where }),
    db.pesananPembelian.findMany({
      where,
      orderBy: URUT,
      take: BATAS_PESANAN_MENUNGGU,
      select: {
        id: true,
        nomor: true,
        tanggal: true,
        pemasok: { select: { nama: true } },
        perusahaan: PILIH_PERUSAHAAN,
        baris: { where: barisSisa, orderBy: { id: "asc" }, select: { id: true, jumlah: true, jumlahDiterima: true, barang: PILIH_BARANG } },
      },
    }),
  ]);
  return {
    total,
    daftar: daftar.map((p) => ({
      id: p.id,
      nomor: p.nomor,
      tanggal: p.tanggal,
      mitra: p.pemasok.nama,
      perusahaan: p.perusahaan,
      baris: p.baris.map((b) => ({ id: b.id, kode: b.barang.kode, nama: b.barang.nama, satuan: b.barang.satuan, sisa: D(b.jumlah).minus(b.jumlahDiterima).toNumber() })),
    })),
  };
}

/** Pesanan penjualan yang barangnya belum dikirim semua. perusahaanId kosong = gabungan (semua perusahaan). */
export async function pesananMenungguDikirim(perusahaanId: string | null | undefined): Promise<AntreanPesanan> {
  const barisSisa = { barang: { jenis: "BARANG" as const }, jumlahTerkirim: { lt: db.barisPesananPenjualan.fields.jumlah } };
  const where = { status: { not: "DIBATALKAN" as const }, ...saringPerusahaan(perusahaanId), baris: { some: barisSisa } };
  const [total, daftar] = await Promise.all([
    db.pesananPenjualan.count({ where }),
    db.pesananPenjualan.findMany({
      where,
      orderBy: URUT,
      take: BATAS_PESANAN_MENUNGGU,
      select: {
        id: true,
        nomor: true,
        tanggal: true,
        pelanggan: { select: { nama: true } },
        perusahaan: PILIH_PERUSAHAAN,
        // nama dan satuan tampil baris pesanan (D2 §8.3) didahulukan, sama dengan formulir Kirim
        baris: { where: barisSisa, orderBy: [{ urutan: "asc" }, { id: "asc" }], select: { id: true, jumlah: true, jumlahTerkirim: true, nama: true, satuan: true, barang: PILIH_BARANG } },
      },
    }),
  ]);
  return {
    total,
    daftar: daftar.map((p) => ({
      id: p.id,
      nomor: p.nomor,
      tanggal: p.tanggal,
      mitra: p.pelanggan.nama,
      perusahaan: p.perusahaan,
      baris: p.baris.map((b) => ({ id: b.id, kode: b.barang.kode, nama: b.nama ?? b.barang.nama, satuan: b.satuan ?? b.barang.satuan, sisa: D(b.jumlah).minus(b.jumlahTerkirim).toNumber() })),
    })),
  };
}
