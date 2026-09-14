import type { Prisma } from "@/prisma-klien/client";
import { catatJurnal, ambilPemetaanAkun } from "@/lib/akuntansi";
import { kursPada } from "@/lib/mataUang";
import { D, format, uang, jumlahkan, type Desimal } from "@/lib/uang";

/*
 * Penilaian kembali (revaluasi) piutang & hutang mata uang asing.
 *
 * Kenapa perlu: faktur mata uang asing dibukukan ke IDR dengan kurs saat dokumen dibuat (snapshot),
 * jadi saldo Piutang/Hutang Usaha di buku besar masih memakai kurs lama. Pada akhir periode saldo
 * yang masih terbuka harus dinilai dengan kurs penutup; selisihnya adalah laba/rugi kurs BELUM
 * TEREALISASI (unrealized), diakui ke akun Selisih Kurs (PemetaanAkun › Selisih Kurs).
 *
 * Cara hitungnya:
 *   saldo terbuka (mata uang asing) = saldo terbuka rupiah menurut kurs dokumen / kurs dokumen
 *   selisih                         = saldo terbuka (asing) × (kurs baru − kurs yang sedang dibawa)
 *   kurs yang sedang dibawa         = `kursRevaluasi` bila pernah dinilai, kalau belum = `kurs` dokumen
 *
 * Karena kurs yang sedang dibawa disimpan di dokumen, menjalankan penilaian dua kali pada kurs yang
 * sama menghasilkan nol (idempoten), dan penilaian periode berikutnya hanya mencatat perubahan sejak
 * penilaian terakhir. Tidak perlu jurnal pembalik di awal periode.
 *
 * Tanda:
 *   piutang naik (rupiah)  → aset naik    → LABA kurs  : Dr Piutang / Cr Selisih Kurs
 *   piutang turun          → aset turun   → RUGI kurs  : Dr Selisih Kurs / Cr Piutang
 *   hutang naik (rupiah)   → kewajiban naik → RUGI kurs: Dr Selisih Kurs / Cr Hutang
 *   hutang turun           → kewajiban turun → LABA kurs: Dr Hutang / Cr Selisih Kurs
 *
 * Batas yang disengaja: fungsi ini hanya laba/rugi kurs BELUM terealisasi atas piutang & hutang usaha.
 * Laba/rugi kurs TEREALISASI saat pelunasan belum ditangani; lihat DOKUMENTASI-PERSETUJUAN-KURS-BACKUP.md
 * bagian "Pertanyaan desain yang masih terbuka".
 */

type Tx = Prisma.TransactionClient;

export type BarisRevaluasi = {
  jenis: "PIUTANG" | "HUTANG";
  nomor: string;
  rekanan: string;
  kodeMataUang: string;
  /** Saldo terbuka dalam mata uang transaksi */
  saldoAsli: Desimal;
  kursLama: Desimal;
  kursBaru: Desimal;
  /** Selisih rupiah: positif = nilai rupiah saldo naik */
  selisih: Desimal;
};

export type RingkasanRevaluasi = {
  tanggal: Date;
  baris: BarisRevaluasi[];
  totalPiutang: Desimal;
  totalHutang: Desimal;
  /** Laba (positif) atau rugi (negatif) kurs bersih */
  labaRugi: Desimal;
};

const NOL = D(0);

/** Kurs yang saldo terbuka dokumen sedang dibawa: hasil penilaian terakhir, atau kurs dokumen. */
function kursDibawa(dok: { kurs: Desimal | number | string; kursRevaluasi: Desimal | number | string | null }): Desimal {
  return dok.kursRevaluasi === null ? D(dok.kurs) : D(dok.kursRevaluasi);
}

/**
 * Hitung penilaian kembali per `tanggal` tanpa menulis apa pun (pratinjau).
 * Hanya faktur DISETUJUI dengan mata uang asing dan saldo terbuka > 0 yang ikut.
 */
export async function hitungRevaluasi(tx: Tx, tanggal: Date): Promise<RingkasanRevaluasi> {
  const [fakturJual, fakturBeli] = await Promise.all([
    tx.fakturPenjualan.findMany({
      where: { statusPersetujuan: "DISETUJUI", mataUangId: { not: null }, tanggal: { lte: tanggal } },
      include: { mataUang: true, pelanggan: { select: { nama: true } }, penerimaan: true, retur: true },
    }),
    tx.fakturPembelian.findMany({
      where: { statusPersetujuan: "DISETUJUI", mataUangId: { not: null }, tanggal: { lte: tanggal } },
      include: { mataUang: true, pemasok: { select: { nama: true } }, pembayaran: true, retur: true },
    }),
  ]);

  // kurs penutup per mata uang, dibaca sekali per mata uang
  const kursBaruPer = new Map<string, Desimal>();
  const kursBaruUntuk = async (mataUangId: string) => {
    const ada = kursBaruPer.get(mataUangId);
    if (ada) return ada;
    const k = await kursPada(tx, mataUangId, tanggal);
    kursBaruPer.set(mataUangId, k);
    return k;
  };

  const baris: BarisRevaluasi[] = [];

  for (const f of fakturJual) {
    if (!f.mataUangId || !f.mataUang) continue;
    const dibayar = jumlahkan(f.penerimaan.map((p) => D(p.jumlah).plus(p.potonganPajak)));
    const diretur = jumlahkan(f.retur.map((r) => r.total));
    const terbukaIdrAsli = D(f.total).minus(f.uangMuka).minus(dibayar).minus(diretur);
    if (terbukaIdrAsli.lte(0)) continue;
    const kursDok = D(f.kurs);
    if (kursDok.lte(0)) continue;
    const saldoAsli = uang(terbukaIdrAsli.div(kursDok));
    const kursLama = kursDibawa(f);
    const kursBaru = await kursBaruUntuk(f.mataUangId);
    const selisih = uang(saldoAsli.mul(kursBaru.minus(kursLama)));
    if (selisih.isZero()) continue;
    baris.push({ jenis: "PIUTANG", nomor: f.nomor, rekanan: f.pelanggan.nama, kodeMataUang: f.mataUang.kode, saldoAsli, kursLama, kursBaru, selisih });
  }

  for (const f of fakturBeli) {
    if (!f.mataUangId || !f.mataUang) continue;
    const dibayar = jumlahkan(f.pembayaran.map((p) => D(p.jumlah).plus(p.potonganPajak)));
    const diretur = jumlahkan(f.retur.map((r) => r.total));
    const terbukaIdrAsli = D(f.total).minus(dibayar).minus(diretur);
    if (terbukaIdrAsli.lte(0)) continue;
    const kursDok = D(f.kurs);
    if (kursDok.lte(0)) continue;
    const saldoAsli = uang(terbukaIdrAsli.div(kursDok));
    const kursLama = kursDibawa(f);
    const kursBaru = await kursBaruUntuk(f.mataUangId);
    const selisih = uang(saldoAsli.mul(kursBaru.minus(kursLama)));
    if (selisih.isZero()) continue;
    baris.push({ jenis: "HUTANG", nomor: f.nomor, rekanan: f.pemasok.nama, kodeMataUang: f.mataUang.kode, saldoAsli, kursLama, kursBaru, selisih });
  }

  const totalPiutang = jumlahkan(baris.filter((b) => b.jenis === "PIUTANG").map((b) => b.selisih));
  const totalHutang = jumlahkan(baris.filter((b) => b.jenis === "HUTANG").map((b) => b.selisih));
  // piutang naik = laba; hutang naik = rugi
  return { tanggal, baris, totalPiutang, totalHutang, labaRugi: totalPiutang.minus(totalHutang) };
}

/**
 * Jalankan penilaian kembali: satu jurnal JU-SK bertanggal `tanggal`, lalu kurs yang dibawa tiap
 * faktur diperbarui. Mengembalikan ringkasan + nomor jurnalnya (null bila tidak ada selisih).
 */
export async function jalankanRevaluasi(tx: Tx, tanggal: Date): Promise<{ ringkasan: RingkasanRevaluasi; nomorJurnal: string | null }> {
  const ringkasan = await hitungRevaluasi(tx, tanggal);
  if (ringkasan.baris.length === 0) return { ringkasan, nomorJurnal: null };

  const m = await ambilPemetaanAkun(tx);
  if (!m.selisihKursId) {
    throw new Error("Pemetaan akun 'Selisih Kurs' belum diatur (Pengaturan › Pemetaan Akun). Akun ini menampung laba/rugi kurs.");
  }

  const { totalPiutang, totalHutang } = ringkasan;
  // Selisih kurs bersih dari sisi akun Selisih Kurs: laba dikredit, rugi didebit
  const laba = totalPiutang.minus(totalHutang);
  const barisJurnal = [
    {
      akunId: m.piutangUsahaId,
      debit: totalPiutang.gt(0) ? totalPiutang : NOL,
      kredit: totalPiutang.lt(0) ? totalPiutang.neg() : NOL,
      keterangan: `Penilaian kembali piutang mata uang asing per ${tanggal.toLocaleDateString("id-ID")}`,
    },
    {
      akunId: m.utangUsahaId,
      debit: totalHutang.lt(0) ? totalHutang.neg() : NOL,
      kredit: totalHutang.gt(0) ? totalHutang : NOL,
      keterangan: `Penilaian kembali hutang mata uang asing per ${tanggal.toLocaleDateString("id-ID")}`,
    },
    {
      akunId: m.selisihKursId,
      debit: laba.lt(0) ? laba.neg() : NOL,
      kredit: laba.gt(0) ? laba : NOL,
      keterangan: `${laba.gte(0) ? "Laba" : "Rugi"} kurs belum terealisasi ${format(laba.abs())}`,
    },
  ];

  const jurnal = await catatJurnal(
    tx,
    "JU-SK",
    `Penilaian kembali kurs per ${tanggal.toLocaleDateString("id-ID")}: ${ringkasan.baris.length} faktur, ${laba.gte(0) ? "laba" : "rugi"} kurs ${format(laba.abs())}`,
    "SELISIH_KURS",
    barisJurnal,
    { tanggal },
  );

  // Kurs yang dibawa diperbarui hanya untuk faktur yang ikut dinilai
  const nomorPiutang = ringkasan.baris.filter((b) => b.jenis === "PIUTANG");
  const nomorHutang = ringkasan.baris.filter((b) => b.jenis === "HUTANG");
  for (const b of nomorPiutang) {
    await tx.fakturPenjualan.update({ where: { nomor: b.nomor }, data: { kursRevaluasi: b.kursBaru, revaluasiPada: tanggal } });
  }
  for (const b of nomorHutang) {
    await tx.fakturPembelian.update({ where: { nomor: b.nomor }, data: { kursRevaluasi: b.kursBaru, revaluasiPada: tanggal } });
  }

  return { ringkasan, nomorJurnal: jurnal?.nomor ?? null };
}
