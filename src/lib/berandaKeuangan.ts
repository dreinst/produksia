import { db } from "@/lib/db";
import { saringPerusahaan } from "@/lib/perusahaan";

/*
 * Kueri tab keuangan beranda (src/app/(aplikasi)/page.tsx) menurut lingkup perusahaan (D1 §8, baris page.tsx beranda).
 * perusahaanId null = gabungan: kuerinya persis kueri beranda sebelum multi perusahaan.
 * Satu perusahaan: dokumen, jurnal, stok, dan barang disaring perusahaanId. Akun tetap semua (saldo akun milik
 * perusahaan lain otomatis nol karena barisnya disaring lewat jurnal); halaman memilih akun kas milik/bersama sendiri.
 * Dipisah dari halaman supaya skrip/uji-lingkup-perusahaan.ts bisa membandingkannya dengan kueri lama.
 */

const LENCANA = { perusahaan: { select: { kode: true, nama: true, warna: true } } } as const;

export async function muatDataBerandaKeuangan(perusahaanId: string | null, sekarang: Date = new Date()) {
  const p = saringPerusahaan(perusahaanId);
  const awalBulan = new Date(sekarang.getFullYear(), sekarang.getMonth(), 1);
  const [
    fakturJualBelumLunas,
    fakturBeliBelumLunas,
    daftarAkun,
    agregatAkun,
    daftarStok,
    jumlahBarang,
    daftarAset,
    penawaranDraf,
    pesananAktif,
    pengirimanBulanIni,
    penerimaanBulanIni,
    fakturTerbaru,
    pesananTerbaru,
    penerimaanTerbaru,
    pengirimanTerbaru,
    fakturBeliTerbaru,
    pembayaranTerbaru,
  ] = await Promise.all([
    // KPI piutang/hutang & nilai aset hanya dari dokumen yang sudah DISETUJUI, supaya angkanya sama dengan buku besar
    db.fakturPenjualan.findMany({ where: { status: { not: "LUNAS" }, statusPersetujuan: "DISETUJUI", ...p }, include: { penerimaan: true, retur: { select: { total: true } } } }),
    db.fakturPembelian.findMany({ where: { status: { not: "LUNAS" }, statusPersetujuan: "DISETUJUI", ...p }, include: { pembayaran: true, retur: { select: { total: true } } } }),
    db.akun.findMany({ orderBy: { kode: "asc" } }),
    perusahaanId
      ? db.barisJurnal.groupBy({ by: ["akunId"], where: { jurnal: p }, _sum: { debit: true, kredit: true } })
      : db.barisJurnal.groupBy({ by: ["akunId"], _sum: { debit: true, kredit: true } }),
    perusahaanId ? db.stokBarang.findMany({ where: { barang: p }, include: { barang: true, gudang: true } }) : db.stokBarang.findMany({ include: { barang: true, gudang: true } }),
    db.barang.count({ where: { jenis: "BARANG", ...p } }),
    db.asetTetap.findMany({ where: { status: "AKTIF", statusPersetujuan: "DISETUJUI", ...p }, include: { penyusutan: true } }),
    db.penawaranPenjualan.findMany({ where: { status: "DRAF", ...p } }),
    db.pesananPenjualan.findMany({ where: { status: { in: ["DRAF", "SEBAGIAN"] }, ...p } }),
    db.pengirimanPesanan.count({ where: { tanggal: { gte: awalBulan }, ...p } }),
    db.penerimaanPenjualan.findMany({ where: { tanggal: { gte: awalBulan }, ...p } }),
    db.fakturPenjualan.findMany({ where: p, include: { pelanggan: true, ...LENCANA }, orderBy: { tanggal: "desc" }, take: 4 }),
    db.pesananPenjualan.findMany({ where: p, include: { pelanggan: true, baris: true, ...LENCANA }, orderBy: { tanggal: "desc" }, take: 4 }),
    db.penerimaanPenjualan.findMany({ where: p, include: { pelanggan: true, ...LENCANA }, orderBy: { tanggal: "desc" }, take: 3 }),
    db.pengirimanPesanan.findMany({ where: p, include: { pesanan: { include: { pelanggan: true } }, ...LENCANA }, orderBy: { tanggal: "desc" }, take: 3 }),
    db.fakturPembelian.findMany({ where: p, include: { pemasok: true, ...LENCANA }, orderBy: { tanggal: "desc" }, take: 3 }),
    db.pembayaranPembelian.findMany({ where: p, include: { pemasok: true, ...LENCANA }, orderBy: { tanggal: "desc" }, take: 2 }),
  ]);
  return {
    fakturJualBelumLunas,
    fakturBeliBelumLunas,
    daftarAkun,
    agregatAkun,
    daftarStok,
    jumlahBarang,
    daftarAset,
    penawaranDraf,
    pesananAktif,
    pengirimanBulanIni,
    penerimaanBulanIni,
    fakturTerbaru,
    pesananTerbaru,
    penerimaanTerbaru,
    pengirimanTerbaru,
    fakturBeliTerbaru,
    pembayaranTerbaru,
  };
}

/** Akun kas KPI dalam lingkup satu perusahaan: hanya akun milik perusahaan itu atau bersama (D1 §8). Gabungan: semua. */
export function akunDalamLingkup(akun: { perusahaanId: string | null }, perusahaanId: string | null): boolean {
  return !perusahaanId || akun.perusahaanId === null || akun.perusahaanId === perusahaanId;
}

/**
 * true bila ada jurnal atau barang stok milik perusahaan selain `perusahaanId`. Dipakai beranda untuk panel yang
 * belum bisa disaring per perusahaan (tren kas dan pemeriksaan integritas memakai fungsi laporan lama yang
 * menghitung semua perusahaan): bila tidak ada data perusahaan lain, angka global sama dengan angka lingkup.
 */
export async function adaDataPerusahaanLain(perusahaanId: string): Promise<boolean> {
  const [jurnal, barang] = await Promise.all([
    db.jurnal.findFirst({ where: { NOT: { perusahaanId } }, select: { id: true } }),
    db.barang.findFirst({ where: { jenis: "BARANG", perusahaanId: { not: null }, NOT: { perusahaanId } }, select: { id: true } }),
  ]);
  return !!jurnal || !!barang;
}
