import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { saldoAkunPeriode, type AkunSaldo } from "@/lib/laporan";
import { D, jumlahkan, type Desimal } from "@/lib/uang";

/*
 * Tutup buku tahunan: pendapatan & beban tahun itu dipindahkan ke Laba Ditahan lewat jurnal JU-TUTUP
 * bertanggal 31 Desember. Tahun yang sudah ditutup terkunci: jurnal baru maupun penghapusan dokumen
 * bertanggal tahun itu ditolak sampai tahun dibuka kembali.
 *
 * Multi perusahaan (D1 §4.3, K4): tutup buku berjalan serentak untuk semua perusahaan dengan satu kunci tahun
 * global (TutupBuku.tahun), tetapi jurnal penutupnya satu per perusahaan yang punya saldo pendapatan atau beban,
 * dicatat di TutupBukuPerusahaan. Berkas ini bebas sesi; tidak mengimpor perusahaan.ts.
 */
type Klien = PrismaClient | Prisma.TransactionClient;

export function akhirTahun(tahun: number): Date {
  return new Date(tahun, 11, 31, 23, 59, 59, 999);
}
export function awalTahun(tahun: number): Date {
  return new Date(tahun, 0, 1, 0, 0, 0, 0);
}

/**
 * Kunci tahun buku (tinjauan P12 R3), kunci advisory PostgreSQL yang lepas sendiri saat transaksi selesai. tutupTahun
 * dan bukaKembaliTahun memegang kunci eksklusif, sedangkan pencatat dan penghapus jurnal (pastikanTahunTerbuka)
 * memegang kunci bersama. Akibatnya tutup buku menunggu semua transaksi jurnal tahun itu yang sedang berjalan selesai
 * sebelum membaca saldo, dan transaksi jurnal yang datang sesudahnya menunggu tutup buku selesai lalu membaca
 * TutupBuku yang sudah tersimpan. Pencatat jurnal tidak saling menunggu. Kunci bertingkat transaksi aman dipakai
 * lewat PgBouncer mode transaksi. Di luar transaksi kunci langsung lepas sesudah perintahnya, jadi hanya berarti
 * menunggu tutup buku yang sedang berjalan selesai; pencatat jurnal wajib memanggilnya di transaksi yang sama.
 */
export async function kunciTahunBuku(klien: Klien, tahun: number, eksklusif: boolean) {
  if (eksklusif) await klien.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tutup-buku'), ${tahun}::int)`;
  else await klien.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('tutup-buku'), ${tahun}::int)`;
}

/**
 * Menolak pencatatan/penghapusan jurnal bertanggal di tahun yang sudah ditutup. Di dalam transaksi, kunci bersama
 * tahun itu dipegang sampai transaksi selesai (lihat kunciTahunBuku), jadi pemeriksaan ini tidak bisa disalip
 * tutup buku yang sedang berjalan.
 */
export async function pastikanTahunTerbuka(klien: Klien, tanggal: Date) {
  const tahun = tanggal.getFullYear();
  await kunciTahunBuku(klien, tahun, false);
  const tutup = await klien.tutupBuku.findUnique({ where: { tahun }, include: { jurnal: { select: { nomor: true } } } });
  if (tutup) {
    throw new Error(
      `Tahun buku ${tahun} sudah ditutup${tutup.jurnal ? ` (jurnal penutup ${tutup.jurnal.nomor})` : ""}; buka kembali di Buku Besar › Tutup Buku sebelum mencatat atau menghapus transaksi bertanggal ${tahun}`,
    );
  }
}

export type BarisPenutupan = { akunId: string; kode: string; nama: string; jenis: string; saldo: Desimal };
export type RingkasanPenutupan = {
  tahun: number;
  pendapatan: BarisPenutupan[];
  beban: BarisPenutupan[];
  totalPendapatan: Desimal;
  totalBeban: Desimal;
  labaBersih: Desimal;
  jumlahJurnal: number;
};

/**
 * Saldo pendapatan & beban rinci tahun `tahun` (tanpa jurnal penutup), bahan jurnal penutup dan pratinjaunya.
 * `perusahaanId` diisi: hanya jurnal perusahaan itu. Kosong: semua perusahaan (perilaku lama).
 */
export async function ringkasanPenutupan(klien: Klien, tahun: number, perusahaanId?: string | null): Promise<RingkasanPenutupan> {
  const milik = perusahaanId ? { perusahaanId } : {};
  const [daftar, jumlahJurnal] = await Promise.all([
    saldoAkunPeriode(klien as PrismaClient, awalTahun(tahun), akhirTahun(tahun), true, milik),
    klien.jurnal.count({ where: { tanggal: { gte: awalTahun(tahun), lte: akhirTahun(tahun) }, sumber: { not: "PENUTUP" }, ...milik } }),
  ]);
  const ambil = (jenis: string) =>
    daftar
      .filter((a: AkunSaldo) => !a.kelompok && a.jenis === jenis && !a.saldo.isZero())
      .map((a) => ({ akunId: a.id, kode: a.kode, nama: a.nama, jenis: a.jenis, saldo: a.saldo }));
  const pendapatan = ambil("PENDAPATAN");
  const beban = ambil("BEBAN");
  const totalPendapatan = jumlahkan(pendapatan.map((b) => b.saldo));
  const totalBeban = jumlahkan(beban.map((b) => b.saldo));
  return { tahun, pendapatan, beban, totalPendapatan, totalBeban, labaBersih: totalPendapatan.minus(totalBeban), jumlahJurnal };
}

const NOL = D(0);

export type BarisJurnalPenutup = { akunId: string; debit: Desimal; kredit: Desimal; keterangan: string };

/**
 * Baris jurnal penutup satu ringkasan (satu perusahaan): pendapatan dan beban dinolkan, selisihnya (laba atau rugi
 * bersih) ke Laba Ditahan. Kosong bila tidak ada saldo. Bentuknya sama persis dengan jurnal penutup sebelum ada multi
 * perusahaan; hasilnya selalu seimbang.
 */
export function barisJurnalPenutup(ringkasan: RingkasanPenutupan, labaDitahanId: string): BarisJurnalPenutup[] {
  const { tahun } = ringkasan;
  const baris: BarisJurnalPenutup[] = [
    // pendapatan bersaldo kredit → didebit agar nol (saldo negatif = akun kontra, dikredit)
    ...ringkasan.pendapatan.map((b) => ({ akunId: b.akunId, debit: b.saldo.gt(0) ? b.saldo : NOL, kredit: b.saldo.lt(0) ? b.saldo.neg() : NOL, keterangan: `Tutup ${b.kode} ${b.nama} ${tahun}` })),
    // beban bersaldo debit → dikredit agar nol
    ...ringkasan.beban.map((b) => ({ akunId: b.akunId, debit: b.saldo.lt(0) ? b.saldo.neg() : NOL, kredit: b.saldo.gt(0) ? b.saldo : NOL, keterangan: `Tutup ${b.kode} ${b.nama} ${tahun}` })),
  ];
  const laba = ringkasan.labaBersih;
  if (!laba.isZero()) {
    baris.push({ akunId: labaDitahanId, debit: laba.lt(0) ? laba.neg() : NOL, kredit: laba.gt(0) ? laba : NOL, keterangan: `${laba.gte(0) ? "Laba" : "Rugi"} bersih ${tahun} ke Laba Ditahan` });
  }
  return baris;
}

export type PerusahaanPenutupan = { id: string; kode: string; nama: string; aktif: boolean };
export type PenutupanPerusahaan = { perusahaan: PerusahaanPenutupan; ringkasan: RingkasanPenutupan };

/**
 * Ringkasan penutupan setiap perusahaan (termasuk yang diarsipkan), urut menurut urutan lalu nama. Dipakai tutupTahun
 * dan pratinjauTutupBuku supaya pratinjau sama dengan yang dibukukan.
 */
export async function ringkasanPenutupanPerPerusahaan(klien: Klien, tahun: number): Promise<PenutupanPerusahaan[]> {
  const daftar = await klien.perusahaan.findMany({ select: { id: true, kode: true, nama: true, aktif: true }, orderBy: [{ urutan: "asc" }, { nama: "asc" }] });
  const hasil: PenutupanPerusahaan[] = [];
  // berurutan antar perusahaan supaya jumlah kueri serentak di satu koneksi transaksi tetap kecil (ringkasanPenutupan
  // sendiri masih memakai Promise.all untuk dua kuerinya)
  for (const perusahaan of daftar) hasil.push({ perusahaan, ringkasan: await ringkasanPenutupan(klien, tahun, perusahaan.id) });
  return hasil;
}

/** Benar bila perusahaan punya saldo pendapatan atau beban di tahun itu, yaitu akan mendapat jurnal penutup. */
export function punyaSaldoPenutupan(r: RingkasanPenutupan): boolean {
  return r.pendapatan.length + r.beban.length > 0;
}

/**
 * Pratinjau tutup buku serentak (untuk halaman Tutup Buku, P17): satu baris per perusahaan yang punya saldo
 * pendapatan atau beban di tahun itu. Perusahaan tanpa saldo tidak tampil karena tidak mendapat jurnal penutup.
 */
export async function pratinjauTutupBuku(klien: Klien, tahun: number): Promise<PenutupanPerusahaan[]> {
  return (await ringkasanPenutupanPerPerusahaan(klien, tahun)).filter((x) => punyaSaldoPenutupan(x.ringkasan));
}
